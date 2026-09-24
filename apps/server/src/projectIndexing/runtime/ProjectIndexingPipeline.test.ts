// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  type ProjectCallsiteV1,
  type ProjectEntityV1,
  type ProjectSourceFileV1,
} from "@t3tools/contracts";

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { openKnowledgeStore } from "../persistence/KnowledgeStore.ts";
import { runProjectIndexResolution } from "./ProjectIndexResolutionStage.ts";
import { initialProjectIndexGenerationMetadata } from "./ProjectIndexingMetadata.ts";
import { liveProjectIndexExtraction } from "./ProjectIndexingExtraction.ts";

const projectIndexAffectedPaths = Effect.fn("PipelineTest.affectedPaths")(function* (input: {
  readonly changedPaths: ReadonlySet<string>;
  readonly files: ReadonlyArray<ProjectSourceFileV1>;
  readonly entities: ReadonlyArray<ProjectEntityV1>;
  readonly callsites: ReadonlyArray<ProjectCallsiteV1>;
}) {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-dependencies-"))),
    (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
  );
  const store = yield* openKnowledgeStore({ workspaceRoot: root });
  const lease = yield* store.acquireLease("dependency-test");
  const generation = yield* store.beginGeneration({
    lease,
    expectedRevision: 0,
    idempotencyKey: "fixture",
  });
  yield* store.applyBatch({
    lease,
    revision: generation.revision,
    batch: { files: input.files, entities: input.entities, callsites: input.callsites },
  });
  const page = yield* store.getAffectedFilePaths({
    revision: generation.revision,
    changedPaths: [...input.changedPaths],
    limit: 200,
  });
  return new Set(page.items);
});

const range = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 2,
  startOffset: 0,
  endOffset: 1,
};
function file(
  path: string,
  classification: ProjectSourceFileV1["classification"] = "source",
): ProjectSourceFileV1 {
  return {
    path,
    contentHash: path,
    language: "typescript",
    bytes: 1,
    classification,
    status: "indexed",
    configDependencies: ["tsconfig.json"],
  };
}
function entity(filePath: string): ProjectEntityV1 {
  return {
    id: filePath,
    filePath,
    kind: "function",
    name: filePath,
    qualifiedName: filePath,
    language: "typescript",
    range,
    sourceHash: filePath,
    provenance: "parser",
    freshness: "current",
    evidenceIds: [],
  };
}
function call(caller: string, callee: string): ProjectCallsiteV1 {
  return {
    id: `${caller}:${callee}`,
    callerEntityId: caller,
    filePath: caller,
    range,
    expression: callee,
    dispatch: "direct",
    resolution: "resolved",
    targetEntityIds: [callee],
    sourceHash: caller,
    provenance: "compiler",
    freshness: "current",
    evidenceIds: [],
  };
}

describe("project indexing invalidation", () => {
  it.live("reports resolution and updated counts for each committed compiler batch", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() =>
            NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-resolution-progress-")),
          ),
          (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
        );
        const store = yield* openKnowledgeStore({ workspaceRoot: root });
        const lease = yield* store.acquireLease("resolution-test");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "fixture",
        });
        const calls = [call("a.ts", "b.ts"), call("b.ts", "a.ts")];
        yield* store.applyBatch({
          lease,
          revision,
          batch: {
            files: [file("a.ts"), file("b.ts")],
            entities: [entity("a.ts"), entity("b.ts")],
            callsites: calls.map((call) => ({
              ...call,
              resolution: "unresolved",
              targetEntityIds: [],
            })),
          },
        });
        let metadata = initialProjectIndexGenerationMetadata({
          kind: "initial",
          manual: true,
          startedAt: "2026-09-24T00:00:00.000Z",
        });
        const progress: { state: string; phase: string; resolved: number }[] = [];
        yield* runProjectIndexResolution({
          store,
          lease,
          revision,
          resolved: {
            workspaceRoot: root,
            scope: {
              projectId: ProjectId.make("resolution"),
              scopeId: "resolution",
              workspaceFingerprint: "fixture",
            },
          },
          extraction: {
            ...liveProjectIndexExtraction,
            resolveBatches: () => Stream.make(...calls.map((call) => ({ callsites: [call] }))),
          },
          assertCurrent: Effect.void,
          progress: () => Effect.void,
          getMetadata: () => metadata,
          setMetadata: (value) => {
            metadata = value;
          },
          runJobs: () => Effect.void,
          checkpoint: (patch, state) =>
            Effect.sync(() => {
              metadata = { ...metadata, ...patch };
              progress.push({
                state,
                phase: metadata.phase,
                resolved: metadata.coverage.resolvedCallsites,
              });
            }),
        });
        expect(progress).toEqual(
          [0, 1, 2, 2].map((resolved) => ({ state: "updating", phase: "validation", resolved })),
        );
        expect(metadata.resolutionComplete).toBe(true);
      }),
    ),
  );

  it.live("invalidates transitive callers when only the callee body changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const affected = yield* projectIndexAffectedPaths({
          changedPaths: new Set(["leaf.ts"]),
          files: [file("entry.ts"), file("middle.ts"), file("leaf.ts"), file("other.ts")],
          entities: [entity("entry.ts"), entity("middle.ts"), entity("leaf.ts")],
          callsites: [
            call("entry.ts", "middle.ts"),
            call("middle.ts", "leaf.ts"),
            call("leaf.ts", "middle.ts"),
          ],
        });
        expect([...affected].sort()).toEqual(["entry.ts", "leaf.ts", "middle.ts"]);
      }),
    ),
  );

  it.live("invalidates the project on configuration or rule deletion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const changed of [file("tsconfig.json", "configuration"), file("AGENTS.md", "rule")]) {
          const affected = yield* projectIndexAffectedPaths({
            changedPaths: new Set([changed.path]),
            files: [changed, file("first.ts"), file("second.ts")],
            entities: [],
            callsites: [],
          });
          expect([...affected].sort()).toEqual([changed.path, "first.ts", "second.ts"].sort());
        }
      }),
    ),
  );

  it.live(
    "invalidates compiler dependents even when the changed config has left the inventory",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const affected = yield* projectIndexAffectedPaths({
            changedPaths: new Set(["tsconfig.json"]),
            files: [file("dependent.ts")],
            entities: [],
            callsites: [],
          });
          expect([...affected].sort()).toEqual(["dependent.ts", "tsconfig.json"]);
        }),
      ),
  );
});
