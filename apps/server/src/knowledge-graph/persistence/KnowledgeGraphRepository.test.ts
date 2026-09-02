import { assert, it } from "@effect/vitest";
import { KnowledgeGraphDeterministicPatchV1, KnowledgeGraphScopeV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import Migration0059 from "../../persistence/Migrations/059_KnowledgeGraphDerivedData.ts";
import {
  KnowledgeGraphRepository,
  KnowledgeGraphRepositoryLive,
} from "./KnowledgeGraphRepository.ts";

const migratedSqlite = Layer.effectDiscard(Migration0059).pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
);
const layer = KnowledgeGraphRepositoryLive.pipe(Layer.provideMerge(migratedSqlite));

const decodeDeterministicPatch = Schema.decodeUnknownSync(KnowledgeGraphDeterministicPatchV1);

const scope = Schema.decodeUnknownSync(KnowledgeGraphScopeV1)({
  version: 1,
  scopeId: "scope-main",
  environmentId: "environment-1",
  projectId: "project-1",
  effectiveWorkspaceRoot: "/workspace/project",
  isWorktree: false,
});

const patch = decodeDeterministicPatch({
  version: 1,
  scope,
  baseRevision: 0,
  nodes: [
    {
      version: 1,
      nodeId: "node-file",
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
  changedNodeIds: ["node-file"],
  truncation: {
    eligibleFiles: false,
    nodes: false,
    visibleNodes: false,
    omittedFileCount: 0,
    omittedNodeCount: 0,
  },
  committedAt: "2026-08-29T10:00:00.000Z",
});

it.layer(layer)("KnowledgeGraphRepository", (it) => {
  it.effect("commits one contiguous revision and restores it after restart", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      yield* repository.ensureScope(scope);

      const committed = yield* repository.applyDeterministicPatch(patch);
      const snapshot = yield* repository.getSnapshot(scope.scopeId);
      const patches = yield* repository.listPatchesAfter({
        scopeId: scope.scopeId,
        afterRevision: 0,
      });
      const fingerprints = yield* repository.getFileFingerprints(scope.scopeId);

      assert.equal(committed.revision, 1);
      assert.equal(committed.changedNodes[0]?.node.label, "src/index.ts");
      assert.isTrue(Option.isSome(snapshot));
      assert.equal(Option.getOrThrow(snapshot).revision, 1);
      assert.equal(Option.getOrThrow(snapshot).nodes[0]?.nodeId, "node-file");
      assert.deepStrictEqual(
        patches.map(({ revision }) => revision),
        [1],
      );
      assert.deepStrictEqual(
        fingerprints.map(({ path }) => path),
        ["src/index.ts"],
      );
    }),
  );

  it.effect("rejects a stale base revision without mutating the graph", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      const staleScope = {
        ...scope,
        scopeId: "scope-stale",
        effectiveWorkspaceRoot: "/workspace/stale",
      };
      const stalePatch = {
        ...patch,
        scope: staleScope,
        nodes: patch.nodes.map((node) => ({ ...node, scopeId: staleScope.scopeId })),
        fileFingerprints: patch.fileFingerprints,
      };
      yield* repository.ensureScope(staleScope);
      yield* repository.applyDeterministicPatch(stalePatch);

      const error = yield* Effect.flip(repository.applyDeterministicPatch(stalePatch));
      const status = yield* repository.getStatus(staleScope.scopeId);

      assert.equal(error.operation, "apply-deterministic-patch");
      assert.equal(error.reason, "revision-conflict");
      assert.equal(Option.getOrThrow(status).revision, 1);
    }),
  );

  it.effect("commits bind-safe entity, fingerprint, and evidence-link batches", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      const sql = yield* SqlClient.SqlClient;
      const batchScope = {
        ...scope,
        scopeId: "scope-bind-batches",
        effectiveWorkspaceRoot: "/workspace/bind-batches",
      };
      const itemCount = 1_802;
      const suffixes = Array.from({ length: itemCount }, (_, index) =>
        String(index).padStart(4, "0"),
      );
      const evidence = suffixes.map((suffix) => ({
        version: 1 as const,
        evidenceId: `batch-evidence-${suffix}`,
        scopeId: batchScope.scopeId,
        kind: "source" as const,
        source: { path: `src/batch-${suffix}.ts`, startLine: 1, endLine: 2 },
        excerpt: `export const batch${suffix} = true;`,
        fingerprint: `sha256:evidence-${suffix}`,
        confidence: 1,
        evidenceRevision: 1,
      }));
      const nodes = suffixes.map((suffix) => ({
        version: 1 as const,
        nodeId: `batch-node-${suffix}`,
        scopeId: batchScope.scopeId,
        kind: "file" as const,
        label: `src/batch-${suffix}.ts`,
        source: { path: `src/batch-${suffix}.ts` },
        provenance: "deterministic" as const,
        confidence: 1,
        evidenceIds: [`batch-evidence-${suffix}`],
        nodeRevision: 1,
      }));
      const edges = suffixes.map((suffix) => ({
        version: 1 as const,
        edgeId: `batch-edge-${suffix}`,
        scopeId: batchScope.scopeId,
        kind: "documents" as const,
        sourceNodeId: `batch-node-${suffix}`,
        targetNodeId: `batch-node-${suffix}`,
        provenance: "deterministic" as const,
        confidence: 1,
        evidenceIds: [`batch-evidence-${suffix}`],
        edgeRevision: 1,
      }));
      const fileFingerprints = suffixes.map((suffix) => ({
        path: `src/batch-${suffix}.ts`,
        fingerprint: `sha256:file-${suffix}`,
        sizeBytes: 100,
        modifiedAtMs: 1_788_000_000_000,
        extractionVersion: 1,
        seenGeneration: 1,
      }));
      const initialPatch = decodeDeterministicPatch({
        ...patch,
        scope: batchScope,
        nodes,
        edges,
        evidence,
        fileFingerprints,
        changedNodeIds: nodes.map(({ nodeId }) => nodeId),
      });
      yield* repository.applyDeterministicPatch(initialPatch);

      const removedSuffixes = suffixes.slice(0, itemCount / 2);
      const retainedSuffixes = suffixes.slice(itemCount / 2);
      const retainedSuffix = retainedSuffixes.at(-1)!;
      const updatedEvidence = evidence.slice(itemCount / 2).map((item, index) => ({
        ...item,
        excerpt: `export const retained${retainedSuffixes[index]} = 'updated';`,
        fingerprint: `sha256:evidence-updated-${retainedSuffixes[index]}`,
        evidenceRevision: 2,
      }));
      const updatedNodes = nodes.slice(itemCount / 2).map((node, index) => ({
        ...node,
        label: `src/retained-${retainedSuffixes[index]}.ts`,
        summary: "Retained after the batched removals.",
        nodeRevision: 2,
      }));
      const updatedEdges = edges.slice(itemCount / 2).map((edge) => ({
        ...edge,
        confidence: 0.75,
        edgeRevision: 2,
      }));
      const updatedFingerprints = fileFingerprints
        .slice(itemCount / 2)
        .map((fingerprint, index) => ({
          ...fingerprint,
          fingerprint: `sha256:file-updated-${retainedSuffixes[index]}`,
          sizeBytes: 200,
          seenGeneration: 2,
        }));
      const updatePatch = decodeDeterministicPatch({
        ...patch,
        scope: batchScope,
        baseRevision: 1,
        nodes: updatedNodes,
        edges: updatedEdges,
        evidence: updatedEvidence,
        removals: {
          nodeIds: removedSuffixes.map((suffix) => `batch-node-${suffix}`),
          edgeIds: removedSuffixes.map((suffix) => `batch-edge-${suffix}`),
          evidenceIds: removedSuffixes.map((suffix) => `batch-evidence-${suffix}`),
          fingerprintPaths: removedSuffixes.map((suffix) => `src/batch-${suffix}.ts`),
        },
        fileFingerprints: updatedFingerprints,
        changedNodeIds: updatedNodes.map(({ nodeId }) => nodeId),
        committedAt: "2026-08-29T10:01:00.000Z",
      });
      const committed = yield* repository.applyDeterministicPatch(updatePatch);
      const state = Option.getOrThrow(yield* repository.getDeterministicState(batchScope.scopeId));
      const bundle = Option.getOrThrow(
        yield* repository.getNodeBundle({
          scopeId: batchScope.scopeId,
          nodeId: updatedNodes.at(-1)!.nodeId,
        }),
      );
      const nodeEvidenceRows = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count
        FROM knowledge_graph_node_evidence
        WHERE scope_id = ${batchScope.scopeId}
      `;
      const edgeEvidenceRows = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count
        FROM knowledge_graph_edge_evidence
        WHERE scope_id = ${batchScope.scopeId}
      `;

      assert.strictEqual(committed.revision, 2);
      assert.deepStrictEqual(
        committed.changedNodes.map(({ node }) => node.nodeId),
        updatedNodes.map(({ nodeId }) => nodeId),
      );
      assert.strictEqual(state.nodes.length, retainedSuffixes.length);
      assert.strictEqual(state.edges.length, retainedSuffixes.length);
      assert.strictEqual(state.evidence.length, retainedSuffixes.length);
      assert.strictEqual(state.fileFingerprints.length, retainedSuffixes.length);
      assert.strictEqual(state.nodes.at(-1)?.label, `src/retained-${retainedSuffix}.ts`);
      assert.strictEqual(state.edges.at(-1)?.confidence, 0.75);
      assert.strictEqual(
        state.evidence.at(-1)?.fingerprint,
        `sha256:evidence-updated-${retainedSuffix}`,
      );
      assert.strictEqual(
        state.fileFingerprints.at(-1)?.fingerprint,
        `sha256:file-updated-${retainedSuffix}`,
      );
      assert.deepStrictEqual(
        bundle.evidence.map(({ evidenceId }) => evidenceId),
        [`batch-evidence-${retainedSuffix}`],
      );
      assert.strictEqual(nodeEvidenceRows[0]?.count, retainedSuffixes.length);
      assert.strictEqual(edgeEvidenceRows[0]?.count, retainedSuffixes.length);
    }),
  );

  it.effect("clears one canonical scope without touching another worktree", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      const main = { ...scope, scopeId: "scope-clear", effectiveWorkspaceRoot: "/workspace/clear" };
      const worktree = {
        ...scope,
        scopeId: "scope-worktree",
        effectiveWorkspaceRoot: "/workspace/.worktrees/feature",
        isWorktree: true,
      };
      yield* repository.ensureScope(main);
      yield* repository.ensureScope(worktree);
      yield* repository.clearScope(main.scopeId);

      assert.isTrue(Option.isNone(yield* repository.getStatus(main.scopeId)));
      assert.isTrue(Option.isSome(yield* repository.getStatus(worktree.scopeId)));
    }),
  );

  it.effect("queries a requested node beyond the 300-node visualization snapshot", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      const largeScope = {
        ...scope,
        scopeId: "scope-large",
        effectiveWorkspaceRoot: "/workspace/large",
      };
      const nodes = Array.from({ length: 301 }, (_, index) => ({
        version: 1 as const,
        nodeId: `node-${String(index).padStart(3, "0")}`,
        scopeId: largeScope.scopeId,
        kind: "file" as const,
        label: index === 300 ? "zzzz-target.ts" : `src/${String(index).padStart(3, "0")}.ts`,
        provenance: "deterministic" as const,
        confidence: 1,
        evidenceIds: [],
        nodeRevision: 1,
      }));
      const committed = yield* repository.applyDeterministicPatch({
        ...patch,
        scope: largeScope,
        nodes,
        fileFingerprints: [],
        changedNodeIds: nodes.map(({ nodeId }) => nodeId),
      });

      const result = yield* repository.query({
        scopeId: largeScope.scopeId,
        query: {
          queries: [
            { id: "target", type: "node", nodeId: "node-300" },
            { id: "search", type: "search", text: "zzzz-target", limit: 10 },
          ],
        },
      });

      assert.deepStrictEqual(
        result.results[0]?.nodes.map(({ nodeId }) => nodeId),
        ["node-300"],
      );
      assert.isTrue(result.results[0]?.truncated === false);
      assert.deepStrictEqual(
        result.results[1]?.nodes.map(({ nodeId }) => nodeId),
        ["node-300"],
      );
      assert.isFalse(result.results[1]?.truncated ?? true);
      assert.strictEqual(committed.delivery, "invalidate");
      assert.deepStrictEqual(
        yield* repository.listPatchesAfter({ scopeId: largeScope.scopeId, afterRevision: 0 }),
        [],
      );
    }),
  );

  it.effect("traverses bounded neighbors and paths beyond the visualization snapshot", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      const traversalScope = {
        ...scope,
        scopeId: "scope-traversal",
        effectiveWorkspaceRoot: "/workspace/traversal",
      };
      const fillerNodes = Array.from({ length: 300 }, (_, index) => ({
        version: 1,
        nodeId: `filler-${String(index).padStart(3, "0")}`,
        scopeId: traversalScope.scopeId,
        kind: "file",
        label: `aaa/${String(index).padStart(3, "0")}.ts`,
        provenance: "deterministic",
        confidence: 1,
        evidenceIds: [],
        nodeRevision: 1,
      }));
      const traversalNodes = [
        ["node-source", "zzzz/source.ts"],
        ["node-middle-one", "zzzz/middle-one.ts"],
        ["node-middle-two", "zzzz/middle-two.ts"],
        ["node-target", "zzzz/target.ts"],
        ["node-incoming", "zzzz/incoming.ts"],
      ].map(([nodeId, label]) => ({
        version: 1,
        nodeId,
        scopeId: traversalScope.scopeId,
        kind: "file",
        label,
        provenance: "deterministic",
        confidence: 1,
        evidenceIds: [],
        nodeRevision: 1,
      }));
      const traversalEdges = [
        ["edge-source-middle-one", "imports", "node-source", "node-middle-one"],
        ["edge-middle-one-middle-two", "depends-on", "node-middle-one", "node-middle-two"],
        ["edge-middle-two-target", "uses", "node-middle-two", "node-target"],
        ["edge-incoming-source", "documents", "node-incoming", "node-source"],
        ["edge-source-middle-one-related", "relates-to", "node-source", "node-middle-one"],
      ].map(([edgeId, kind, sourceNodeId, targetNodeId]) => ({
        version: 1,
        edgeId,
        scopeId: traversalScope.scopeId,
        kind,
        sourceNodeId,
        targetNodeId,
        provenance: "deterministic",
        confidence: 1,
        evidenceIds: [],
        edgeRevision: 1,
      }));
      const traversalPatch = decodeDeterministicPatch({
        ...patch,
        scope: traversalScope,
        nodes: [...fillerNodes, ...traversalNodes],
        edges: traversalEdges,
        fileFingerprints: [],
        changedNodeIds: [...fillerNodes, ...traversalNodes].map(({ nodeId }) => nodeId),
      });
      yield* repository.applyDeterministicPatch(traversalPatch);

      const result = yield* repository.query({
        scopeId: traversalPatch.scope.scopeId,
        query: {
          queries: [
            {
              id: "neighbors",
              type: "neighbors",
              nodeId: "node-source",
              direction: "outgoing",
              depth: 2,
              kinds: ["imports", "depends-on"],
              limit: 10,
            },
            {
              id: "short-path",
              type: "path",
              sourceNodeId: "node-source",
              targetNodeId: "node-target",
              maxDepth: 2,
            },
            {
              id: "parallel-neighbor-relationships",
              type: "neighbors",
              nodeId: "node-source",
              direction: "outgoing",
              depth: 1,
              limit: 10,
            },
            {
              id: "full-path",
              type: "path",
              sourceNodeId: "node-source",
              targetNodeId: "node-target",
              maxDepth: 3,
            },
          ],
        },
      });

      assert.deepStrictEqual(
        result.results[0]?.nodes.map(({ nodeId }) => nodeId),
        ["node-source", "node-middle-one", "node-middle-two"],
      );
      assert.deepStrictEqual(
        result.results[0]?.edges.map(({ edgeId }) => edgeId),
        ["edge-source-middle-one", "edge-middle-one-middle-two"],
      );
      assert.deepStrictEqual(result.results[1]?.nodes, []);
      assert.deepStrictEqual(result.results[1]?.edges, []);
      assert.deepStrictEqual(
        result.results[2]?.edges.map(({ edgeId }) => edgeId),
        ["edge-source-middle-one", "edge-source-middle-one-related"],
      );
      assert.deepStrictEqual(
        result.results[3]?.nodes.map(({ nodeId }) => nodeId),
        ["node-source", "node-middle-one", "node-middle-two", "node-target"],
      );
      assert.deepStrictEqual(
        result.results[3]?.edges.map(({ edgeId }) => edgeId),
        ["edge-source-middle-one", "edge-middle-one-middle-two", "edge-middle-two-target"],
      );
    }),
  );

  it.effect("bounds overview edges to the query contract and reports query truncation", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      const overviewScope = {
        ...scope,
        scopeId: "scope-overview-bounds",
        effectiveWorkspaceRoot: "/workspace/overview-bounds",
      };
      const nodes = Array.from({ length: 26 }, (_, index) => ({
        version: 1,
        nodeId: `overview-node-${String(index).padStart(2, "0")}`,
        scopeId: overviewScope.scopeId,
        kind: "file",
        label: `src/${String(index).padStart(2, "0")}.ts`,
        provenance: "deterministic",
        confidence: 1,
        evidenceIds: [],
        nodeRevision: 1,
      }));
      const edges = nodes
        .flatMap((source) =>
          nodes
            .filter(({ nodeId }) => nodeId !== source.nodeId)
            .map((target) => ({
              version: 1,
              edgeId: `overview-edge:${source.nodeId}:${target.nodeId}`,
              scopeId: overviewScope.scopeId,
              kind: "relates-to",
              sourceNodeId: source.nodeId,
              targetNodeId: target.nodeId,
              provenance: "deterministic",
              confidence: 1,
              evidenceIds: [],
              edgeRevision: 1,
            })),
        )
        .slice(0, 401);
      const overviewPatch = decodeDeterministicPatch({
        ...patch,
        scope: overviewScope,
        nodes,
        edges,
        fileFingerprints: [],
        changedNodeIds: nodes.map(({ nodeId }) => nodeId),
      });
      yield* repository.applyDeterministicPatch(overviewPatch);

      const result = yield* repository.query({
        scopeId: overviewPatch.scope.scopeId,
        query: { queries: [{ id: "overview", type: "overview" }] },
      });

      assert.strictEqual(result.results[0]?.nodes.length, 26);
      assert.strictEqual(result.results[0]?.edges.length, 400);
      assert.isTrue(result.results[0]?.truncated);
    }),
  );

  it.effect("builds a balanced connected overview for repositories larger than the snapshot", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      const overviewScope = {
        ...scope,
        scopeId: "scope-balanced-overview",
        effectiveWorkspaceRoot: "/workspace/balanced-overview",
      };
      const dependencies = Array.from({ length: 120 }, (_, index) => ({
        version: 1 as const,
        nodeId: `dependency-${String(index).padStart(3, "0")}`,
        scopeId: overviewScope.scopeId,
        kind: "dependency" as const,
        label: `dependency-${String(index).padStart(3, "0")}`,
        provenance: "deterministic" as const,
        confidence: 1,
        evidenceIds: [],
        nodeRevision: 1,
      }));
      const structuralNodes = [
        { nodeId: "repository", kind: "repository" as const, label: "project" },
        { nodeId: "package", kind: "package" as const, label: "web" },
        { nodeId: "directory", kind: "directory" as const, label: "src" },
        { nodeId: "file", kind: "file" as const, label: "App.tsx" },
        { nodeId: "technology", kind: "technology" as const, label: "TypeScript" },
      ].map((node) => ({
        version: 1 as const,
        ...node,
        scopeId: overviewScope.scopeId,
        provenance: "deterministic" as const,
        confidence: 1,
        evidenceIds: [],
        nodeRevision: 1,
      }));
      const edges = [
        ["repository-directory", "contains", "repository", "directory"],
        ["directory-package", "contains", "directory", "package"],
        ["directory-file", "contains", "directory", "file"],
        ["package-technology", "uses", "package", "technology"],
        ...dependencies.map((dependency, index) => [
          `file-dependency-${index}`,
          "imports",
          "file",
          dependency.nodeId,
        ]),
      ].map(([edgeId, kind, sourceNodeId, targetNodeId]) => ({
        version: 1 as const,
        edgeId: edgeId!,
        scopeId: overviewScope.scopeId,
        kind: kind as "contains" | "uses" | "imports",
        sourceNodeId: sourceNodeId!,
        targetNodeId: targetNodeId!,
        provenance: "deterministic" as const,
        confidence: 1,
        evidenceIds: [],
        edgeRevision: 1,
      }));
      const nodes = [...dependencies, ...structuralNodes];
      yield* repository.applyDeterministicPatch(
        decodeDeterministicPatch({
          ...patch,
          scope: overviewScope,
          nodes,
          edges,
          fileFingerprints: [],
          changedNodeIds: nodes.map(({ nodeId }) => nodeId),
        }),
      );

      const result = yield* repository.query({
        scopeId: overviewScope.scopeId,
        query: { queries: [{ id: "overview", type: "overview" }] },
      });
      const overview = result.results[0]!;
      const kinds = new Set(overview.nodes.map(({ kind }) => kind));

      assert.isAtMost(overview.nodes.length, 48);
      assert.isAtMost(overview.nodes.filter(({ kind }) => kind === "dependency").length, 6);
      assert.include([...kinds], "repository");
      assert.include([...kinds], "package");
      assert.include([...kinds], "directory");
      assert.include([...kinds], "file");
      assert.include([...kinds], "technology");
      assert.isAbove(overview.edges.length, 0);
      assert.isTrue(overview.truncated);
    }),
  );

  it.effect("retains a bounded contiguous patch replay window", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      const replayScope = {
        ...scope,
        scopeId: "scope-patch-replay-window",
        effectiveWorkspaceRoot: "/workspace/patch-replay-window",
      };

      for (let revision = 1; revision <= 258; revision += 1) {
        const revisionPatch = decodeDeterministicPatch({
          ...patch,
          scope: replayScope,
          baseRevision: revision - 1,
          nodes: [
            {
              ...patch.nodes[0],
              scopeId: replayScope.scopeId,
              label: `src/index-${revision}.ts`,
              nodeRevision: revision,
            },
          ],
          fileFingerprints: [],
          changedNodeIds: [patch.nodes[0]!.nodeId],
        });
        yield* repository.applyDeterministicPatch(revisionPatch);
      }

      const patches = yield* repository.listPatchesAfter({
        scopeId: replayScope.scopeId,
        afterRevision: 0,
      });
      assert.strictEqual(patches.length, 256);
      assert.strictEqual(patches[0]?.revision, 3);
      assert.strictEqual(patches.at(-1)?.revision, 258);
    }),
  );

  it.effect("persists status and node evidence while clearing only the selected environment", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;
      const managedScope = {
        ...scope,
        scopeId: "scope-managed",
        effectiveWorkspaceRoot: "/workspace/managed",
      };
      const managedPatch = {
        ...patch,
        scope: managedScope,
        nodes: patch.nodes.map((node) => ({
          ...node,
          scopeId: managedScope.scopeId,
          evidenceIds: ["evidence-file"],
        })),
        evidence: [
          {
            version: 1 as const,
            evidenceId: "evidence-file",
            scopeId: managedScope.scopeId,
            kind: "source" as const,
            source: { path: "src/index.ts", startLine: 1, endLine: 3 },
            excerpt: "export const value = 1;",
            fingerprint: "sha256:evidence",
            confidence: 1,
            evidenceRevision: 1,
          },
        ],
      };
      yield* repository.applyDeterministicPatch(managedPatch);
      const status = Option.getOrThrow(yield* repository.getStatus(managedScope.scopeId));
      yield* repository.updateStatus({ ...status, state: "paused" });

      const bundle = yield* repository.getNodeBundle({
        scopeId: managedScope.scopeId,
        nodeId: managedPatch.nodes[0]!.nodeId,
      });
      assert.isTrue(Option.isSome(bundle));
      assert.deepStrictEqual(
        Option.getOrThrow(bundle).evidence.map(({ evidenceId }) => evidenceId),
        ["evidence-file"],
      );
      assert.strictEqual(
        Option.getOrThrow(yield* repository.getStatus(managedScope.scopeId)).state,
        "paused",
      );
      assert.isTrue(
        (yield* repository.listScopes(managedScope.environmentId)).some(
          ({ scopeId }) => scopeId === managedScope.scopeId,
        ),
      );

      yield* repository.clearEnvironment(managedScope.environmentId);
      assert.isTrue(Option.isNone(yield* repository.getStatus(managedScope.scopeId)));
    }),
  );

  it.effect("keeps one restart-stable semantic model generation per environment", () =>
    Effect.gen(function* () {
      const repository = yield* KnowledgeGraphRepository;

      const initial = yield* repository.reconcileSemanticModel({
        environmentId: scope.environmentId,
        modelKey: null,
      });
      const selected = yield* repository.reconcileSemanticModel({
        environmentId: scope.environmentId,
        modelKey: "openai:gpt-5.6",
      });
      const restarted = yield* repository.reconcileSemanticModel({
        environmentId: scope.environmentId,
        modelKey: "openai:gpt-5.6",
      });
      const changed = yield* repository.reconcileSemanticModel({
        environmentId: scope.environmentId,
        modelKey: "openai:gpt-5.7",
      });

      assert.deepStrictEqual(initial, { modelGeneration: 0, changed: false });
      assert.deepStrictEqual(selected, { modelGeneration: 1, changed: true });
      assert.deepStrictEqual(restarted, { modelGeneration: 1, changed: false });
      assert.deepStrictEqual(changed, { modelGeneration: 2, changed: true });
    }),
  );
});
