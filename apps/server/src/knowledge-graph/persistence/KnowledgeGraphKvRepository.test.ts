// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  KnowledgeGraphDeterministicPatchV1,
  KnowledgeGraphScopeId,
  KnowledgeGraphScopeV1,
  KnowledgeGraphNodeId,
  ProjectId,
} from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { expect } from "vite-plus/test";

import { KnowledgeGraphRepository } from "./KnowledgeGraphRepository.ts";
import { knowledgeGraphKvLayerAt } from "./KnowledgeGraphKvRepository.ts";

const scope = Schema.decodeUnknownSync(KnowledgeGraphScopeV1)({
  version: 1,
  scopeId: KnowledgeGraphScopeId.make("kv-scope"),
  environmentId: "environment-1",
  projectId: ProjectId.make("project-1"),
  effectiveWorkspaceRoot: "/workspace/project",
  isWorktree: false,
});
const patch = Schema.decodeUnknownSync(KnowledgeGraphDeterministicPatchV1)({
  version: 1,
  scope,
  baseRevision: 0,
  nodes: [
    {
      version: 1,
      nodeId: KnowledgeGraphNodeId.make("file"),
      scopeId: scope.scopeId,
      kind: "file",
      label: "src/index.ts",
      source: { path: "src/index.ts" },
      provenance: "deterministic",
      confidence: 1,
      evidenceIds: [],
      nodeRevision: 1,
    },
  ],
  edges: [],
  evidence: [],
  removals: { nodeIds: [], edgeIds: [], evidenceIds: [], fingerprintPaths: [] },
  fileFingerprints: [
    {
      path: "src/index.ts",
      fingerprint: "sha256:file",
      sizeBytes: 123,
      modifiedAtMs: 1_788_000_000_000,
      extractionVersion: 1,
      seenGeneration: 1,
    },
  ],
  changedNodeIds: ["file"],
  truncation: {
    eligibleFiles: false,
    nodes: false,
    visibleNodes: false,
    omittedFileCount: 0,
    omittedNodeCount: 0,
  },
  committedAt: "2026-08-29T10:00:00.000Z",
});
const linked = Schema.decodeUnknownSync(KnowledgeGraphDeterministicPatchV1)({
  ...patch,
  baseRevision: 1,
  nodes: [
    {
      ...patch.nodes[0],
      nodeId: KnowledgeGraphNodeId.make("linked-file"),
      label: "src/linked.ts",
      source: { path: "src/linked.ts" },
      nodeRevision: 2,
    },
  ],
  edges: [
    {
      version: 1,
      edgeId: "link",
      scopeId: scope.scopeId,
      kind: "imports",
      sourceNodeId: KnowledgeGraphNodeId.make("file"),
      targetNodeId: KnowledgeGraphNodeId.make("linked-file"),
      provenance: "deterministic",
      confidence: 1,
      evidenceIds: [],
      edgeRevision: 2,
    },
  ],
  fileFingerprints: [],
  changedNodeIds: ["linked-file"],
});

it.effect("persists graph commits, revisions, and scoped clear in RocksDB", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-graph-kv-"))),
        (path) => Effect.sync(() => NodeFS.rmSync(path, { recursive: true, force: true })),
      );
      const directory = NodePath.join(root, "graph.rocksdb");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* KnowledgeGraphRepository;
          yield* repository.ensureScope(scope);
          const commit = yield* repository.applyDeterministicPatch(patch);
          expect(commit.revision).toBe(1);
          const conflict = yield* Effect.flip(repository.applyDeterministicPatch(patch));
          expect(conflict.reason).toBe("revision-conflict");
        }).pipe(Effect.provide(knowledgeGraphKvLayerAt(directory))),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* KnowledgeGraphRepository;
          const snapshot = yield* repository.getSnapshot(scope.scopeId);
          expect(Option.getOrThrow(snapshot).nodes.map((node) => node.nodeId)).toEqual(["file"]);
          expect(Option.getOrThrow(snapshot).revision).toBe(1);
          expect(
            (yield* repository.getFileFingerprints(scope.scopeId)).map((item) => item.path),
          ).toEqual(["src/index.ts"]);
          expect(
            (yield* repository.listPatchesAfter({ scopeId: scope.scopeId, afterRevision: 0 }))
              .length,
          ).toBe(1);
          yield* repository.applyDeterministicPatch(linked);
          const result = yield* repository.query({
            scopeId: scope.scopeId,
            query: {
              queries: [
                {
                  id: "neighbors",
                  type: "neighbors",
                  nodeId: KnowledgeGraphNodeId.make("file"),
                  depth: 1,
                  direction: "outgoing",
                },
              ],
            },
          });
          expect(result.results[0]?.nodes.map((node) => node.nodeId)).toEqual([
            "file",
            "linked-file",
          ]);
          expect(result.results[0]?.edges.map((edge) => edge.edgeId)).toEqual(["link"]);
          yield* repository.clearScope(scope.scopeId);
          expect(Option.isNone(yield* repository.getSnapshot(scope.scopeId))).toBe(true);
        }).pipe(Effect.provide(knowledgeGraphKvLayerAt(directory))),
      );
    }),
  ),
);
