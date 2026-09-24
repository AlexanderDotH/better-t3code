// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it } from "@effect/vitest";
import {
  type ProjectCallsiteV1,
  type ProjectEntityV1,
  type ProjectSourceFileV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect } from "vite-plus/test";

import {
  openExistingKnowledgeStore,
  openKnowledgeStore,
  type KnowledgeStore,
  type WriterLease,
} from "./KnowledgeStore.ts";

const roots: string[] = [];
const range = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 2,
  startOffset: 0,
  endOffset: 1,
};
const source = (path: string): ProjectSourceFileV1 => ({
  path,
  contentHash: "hash",
  language: "typescript",
  bytes: 1,
  classification: "source",
  status: "indexed",
  configDependencies: [],
});
const entity = (id: string, filePath = `${id}.ts`): ProjectEntityV1 => ({
  id,
  filePath,
  name: id,
  qualifiedName: id,
  kind: "function",
  language: "typescript",
  range,
  sourceHash: "hash",
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
});
const call = (id: string, caller: string, target: string): ProjectCallsiteV1 => ({
  id,
  callerEntityId: caller,
  filePath: `${caller}.ts`,
  range,
  expression: `${target}()`,
  dispatch: "direct",
  resolution: "resolved",
  targetEntityIds: [target],
  sourceHash: "hash",
  provenance: "compiler",
  freshness: "current",
  evidenceIds: [],
});
function withStore<A, E, R>(
  run: (store: KnowledgeStore, lease: WriterLease) => Effect.Effect<A, E, R>,
) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-knowledge-planning-"));
  roots.push(root);
  return Effect.scoped(
    Effect.gen(function* () {
      const store = yield* openKnowledgeStore({ workspaceRoot: root });
      const lease = yield* store.acquireLease("worker");
      yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "first" });
      return yield* run(store, lease);
    }),
  );
}
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("bounded knowledge planning", () => {
  it.effect(
    "aggregates exhaustive coverage and filters file pages before applying their limit",
    () =>
      withStore((store, lease) =>
        Effect.gen(function* () {
          const indexed = Array.from({ length: 300 }, (_, index) =>
            source(`src/file-${index.toString().padStart(3, "0")}.ts`),
          );
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: {
              files: [
                ...indexed,
                { ...source("a-skipped.bin"), status: "skipped" },
                { ...source("b-skipped.bin"), status: "skipped" },
                { ...source("c-failed.ts"), status: "failed" },
                { ...source("d-pending.ts"), status: "pending" },
              ],
              entities: [
                entity("a", indexed[0]!.path),
                { ...entity("b", indexed[1]!.path), freshness: "stale" },
              ],
              callsites: [
                { ...call("resolved", "a", "b"), filePath: indexed[0]!.path },
                {
                  ...call("candidate", "a", "b"),
                  filePath: indexed[0]!.path,
                  resolution: "candidate",
                  targetEntityIds: ["a", "b"],
                },
                {
                  ...call("unresolved", "a", "b"),
                  filePath: indexed[0]!.path,
                  resolution: "unresolved",
                  targetEntityIds: [],
                },
              ],
            },
          });
          expect(yield* store.countFiles(1)).toBe(304);
          expect(yield* store.aggregateCoverage(1)).toEqual({
            discoveredFiles: 304,
            eligibleFiles: 302,
            indexedFiles: 300,
            skippedFiles: 2,
            failedFiles: 1,
            totalEntities: 2,
            analyzedEntities: 0,
            totalImports: 0,
            resolvedImports: 0,
            totalCallsites: 3,
            resolvedCallsites: 1,
            candidateCallsites: 1,
            unresolvedCallsites: 1,
          });
          const page = yield* store.listRecords({
            kind: "files",
            revision: 1,
            fileStatuses: ["indexed"],
            fileClassifications: ["source"],
            limit: 2,
          });
          expect(page.items.map((file) => file.path)).toEqual([
            "src/file-000.ts",
            "src/file-001.ts",
          ]);
          expect(page.nextCursor).toBe("src/file-001.ts");
          const reader = yield* openExistingKnowledgeStore({
            workspaceRoot: store.workspace.workspaceRoot,
          });
          expect(reader).not.toBeNull();
          expect(yield* reader!.countFiles(1)).toBe(304);
          expect(yield* reader!.aggregateCoverage(1)).toEqual(yield* store.aggregateCoverage(1));
        }),
      ),
  );

  it.effect(
    "traverses caller and configuration dependencies through cycles with stable pagination",
    () =>
      withStore((store, lease) =>
        Effect.gen(function* () {
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: {
              files: [
                source("a.ts"),
                { ...source("b.ts"), configDependencies: ["settings.data"] },
                source("c.ts"),
                source("d.ts"),
                source("island.ts"),
                { ...source("settings.data"), classification: "documentation" },
              ],
              entities: [entity("a"), entity("b"), entity("c"), entity("d"), entity("island")],
              callsites: [
                call("a-b", "a", "b"),
                call("b-c", "b", "c"),
                call("c-a", "c", "a"),
                call("d-c", "d", "c"),
              ],
            },
          });
          const first = yield* store.getAffectedFilePaths({
            revision: 1,
            changedPaths: ["settings.data"],
            limit: 2,
          });
          expect(first.items).toEqual(["a.ts", "b.ts"]);
          const second = yield* store.getAffectedFilePaths({
            revision: 1,
            changedPaths: ["settings.data"],
            limit: 2,
            afterPath: first.nextCursor!,
          });
          expect(second.items).toEqual(["c.ts", "d.ts"]);
          const third = yield* store.getAffectedFilePaths({
            revision: 1,
            changedPaths: ["settings.data"],
            limit: 2,
            afterPath: second.nextCursor!,
          });
          expect(third.items).toEqual(["settings.data"]);
          expect(third.nextCursor).toBeNull();
        }),
      ),
  );

  it.effect(
    "pages beyond query caps through a long dependency chain without truncating invalidation",
    () =>
      withStore((store, lease) =>
        Effect.gen(function* () {
          const ids = Array.from(
            { length: 251 },
            (_, index) => `node-${index.toString().padStart(3, "0")}`,
          );
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: {
              files: ids.map((id) => source(`${id}.ts`)),
              entities: ids.map((id) => entity(id)),
              callsites: ids
                .slice(0, -1)
                .map((id, index) => call(`call-${id}`, id, ids[index + 1]!)),
            },
          });
          let afterPath: string | undefined;
          let count = 0;
          do {
            const page = yield* store.getAffectedFilePaths({
              revision: 1,
              changedPaths: ["node-250.ts"],
              limit: 64,
              ...(afterPath ? { afterPath } : {}),
            });
            expect(page.items.length).toBeLessThanOrEqual(64);
            if (afterPath) expect(page.items[0]! > afterPath).toBe(true);
            count += page.items.length;
            afterPath = page.nextCursor ?? undefined;
          } while (afterPath !== undefined);
          expect(count).toBe(251);
        }),
      ),
  );

  it.effect(
    "compares revisions in SQL and expands newly added configuration changes globally",
    () =>
      withStore((store, lease) =>
        Effect.gen(function* () {
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: {
              files: [source("a.ts"), source("b.ts"), source("deleted.ts"), source("untouched.ts")],
            },
          });
          yield* store.publishGeneration({ lease, revision: 1 });
          yield* store.beginGeneration({ lease, expectedRevision: 1, idempotencyKey: "second" });
          yield* store.applyBatch({
            lease,
            revision: 2,
            removeFilePaths: ["deleted.ts"],
            batch: {
              files: [
                { ...source("a.ts"), contentHash: "changed" },
                { ...source("b.ts"), configDependencies: ["tsconfig.added.json"] },
                { ...source("tsconfig.added.json"), classification: "configuration" },
              ],
            },
          });
          const changed = yield* store.getChangedFilePaths({
            revision: 1,
            currentRevision: 2,
            limit: 2,
          });
          expect(changed.items).toEqual(["a.ts", "b.ts"]);
          expect(
            (yield* store.getChangedFilePaths({
              revision: 1,
              currentRevision: 2,
              limit: 2,
              afterPath: changed.nextCursor!,
            })).items,
          ).toEqual(["deleted.ts", "tsconfig.added.json"]);
          expect(
            (yield* store.getAffectedFilePaths({
              revision: 1,
              currentRevision: 2,
              changedPaths: ["tsconfig.added.json"],
            })).items,
          ).toEqual(["a.ts", "b.ts", "deleted.ts", "tsconfig.added.json", "untouched.ts"]);
        }),
      ),
  );
});
