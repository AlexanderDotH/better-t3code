import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH,
  KnowledgeGraphNodeId,
  KnowledgeGraphScopeId,
  ProjectId,
  ThreadId,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphPatchV1,
  type KnowledgeGraphQueryResultV1,
  type KnowledgeGraphScopeV1,
  type KnowledgeGraphSnapshotV1,
  type KnowledgeGraphStatusV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import type * as KnowledgeGraphRepository from "../persistence/KnowledgeGraphRepository.ts";
import type * as KnowledgeGraphEventHub from "./KnowledgeGraphEventHub.ts";
import { makeKnowledgeGraphRuntimeQueries } from "./KnowledgeGraphRuntimeQueries.ts";
import type * as KnowledgeGraphScopeCatalog from "./KnowledgeGraphScopeCatalog.ts";

const environmentId = EnvironmentId.make("environment-queries");
const projectId = ProjectId.make("project-queries");
const threadId = ThreadId.make("thread-queries");
const scope: KnowledgeGraphScopeV1 = {
  version: 1,
  scopeId: KnowledgeGraphScopeId.make("scope-queries"),
  environmentId,
  projectId,
  effectiveWorkspaceRoot: "/workspace/queries",
  isWorktree: false,
};
const status: KnowledgeGraphStatusV1 = {
  version: 1,
  scopeId: scope.scopeId,
  state: "ready",
  revision: 2,
  indexedFileCount: 1,
  nodeCount: 0,
  edgeCount: 0,
  evidenceCount: 0,
  semanticQueueDepth: 0,
  truncated: {
    eligibleFiles: false,
    nodes: false,
    visibleNodes: false,
    omittedFileCount: 0,
    omittedNodeCount: 0,
  },
};
const snapshot: KnowledgeGraphSnapshotV1 = {
  version: 1,
  type: "snapshot",
  scope,
  revision: 2,
  nodes: [],
  edges: [],
  evidence: [],
  status,
  generatedAt: "2026-08-30T00:00:00.000Z",
};

function patch(baseRevision: number, revision: number): KnowledgeGraphPatchV1 {
  return {
    version: 1,
    type: "patch",
    scopeId: scope.scopeId,
    baseRevision,
    revision,
    upsertedNodes: [],
    removedNodeIds: [],
    upsertedEdges: [],
    removedEdgeIds: [],
    upsertedEvidence: [],
    removedEvidenceIds: [],
    changedNodeIds: [],
    status: { ...status, revision },
  };
}

function serviceStub<T extends object>(overrides: Partial<T>): T {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      throw new Error(`Unexpected Knowledge Graph query test access: ${String(property)}`);
    },
  }) as T;
}

function makeQueries(patches: ReadonlyArray<KnowledgeGraphPatchV1>) {
  const repository = serviceStub<KnowledgeGraphRepository.KnowledgeGraphRepository["Service"]>({
    ensureScope: (resolved) => Effect.succeed(resolved),
    getSnapshot: () => Effect.succeed(Option.some(snapshot)),
    listPatchesAfter: () => Effect.succeed(patches),
  });
  const catalog = serviceStub<KnowledgeGraphScopeCatalog.KnowledgeGraphScopeCatalog["Service"]>({
    resolveThread: (resolvedThreadId) => {
      assert.strictEqual(resolvedThreadId, threadId);
      return Effect.succeed({ projectId, scope });
    },
  });
  const eventHub = serviceStub<KnowledgeGraphEventHub.KnowledgeGraphEventHub["Service"]>({
    subscribe: () => Effect.succeed(Stream.never),
  });
  const workspaceFiles = serviceStub<WorkspaceFileSystem.WorkspaceFileSystem["Service"]>({
    readFile: () => Effect.die("node content is not used by this query fixture"),
  });
  return makeKnowledgeGraphRuntimeQueries({
    repository,
    catalog,
    eventHub,
    workspaceFiles,
    resolveScope: () => Effect.succeed(scope),
    requireEnabled: () => Effect.void,
  });
}

it.effect("replays contiguous patches and falls back to invalidate plus snapshot for a gap", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const contiguous = makeQueries([patch(0, 1), patch(1, 2)]);
      const contiguousStream = yield* contiguous.subscribe({
        scope: { projectId },
        afterRevision: 0,
      });
      const replay = yield* contiguousStream.pipe(Stream.take(2), Stream.runCollect);
      assert.deepStrictEqual(
        Array.from(replay, ({ type, ...event }) => ({ type, revision: event.revision })),
        [
          { type: "patch", revision: 1 },
          { type: "patch", revision: 2 },
        ],
      );

      const withGap = makeQueries([patch(1, 2)]);
      const gapStream = yield* withGap.subscribe({
        scope: { projectId },
        afterRevision: 0,
      });
      const fallback = yield* gapStream.pipe(Stream.take(2), Stream.runCollect);
      assert.deepStrictEqual(
        Array.from(fallback, ({ type }) => type),
        ["invalidate", "snapshot"],
      );
    }),
  ),
);

it.effect(
  "routes project and authenticated-thread queries through the canonical resolved scope",
  () =>
    Effect.gen(function* () {
      const query = { queries: [{ id: "overview", type: "overview" as const }] };
      const result: KnowledgeGraphQueryResultV1 = {
        version: 1,
        scope,
        revision: snapshot.revision,
        results: [
          {
            id: "overview",
            type: "overview",
            nodes: [],
            edges: [],
            evidence: [],
            truncated: false,
          },
        ],
      };
      const operations = yield* Ref.make<ReadonlyArray<string>>([]);
      const repository = serviceStub<KnowledgeGraphRepository.KnowledgeGraphRepository["Service"]>({
        ensureScope: (resolved) => {
          assert.deepStrictEqual(resolved, scope);
          return Effect.succeed(resolved);
        },
        query: (input) => {
          assert.deepStrictEqual(input, { scopeId: scope.scopeId, query });
          return Effect.succeed(result);
        },
      });
      const queries = makeKnowledgeGraphRuntimeQueries({
        repository,
        catalog: serviceStub<KnowledgeGraphScopeCatalog.KnowledgeGraphScopeCatalog["Service"]>({
          resolveThread: (resolvedThreadId) => {
            assert.strictEqual(resolvedThreadId, threadId);
            return Effect.succeed({ projectId, scope });
          },
        }),
        eventHub: serviceStub<KnowledgeGraphEventHub.KnowledgeGraphEventHub["Service"]>({}),
        workspaceFiles: serviceStub<WorkspaceFileSystem.WorkspaceFileSystem["Service"]>({}),
        resolveScope: (input) => {
          assert.deepStrictEqual(input, { projectId, threadId });
          return Effect.succeed(scope);
        },
        requireEnabled: (operation) => Ref.update(operations, (current) => [...current, operation]),
      });

      assert.deepStrictEqual(
        yield* queries.query({ scope: { projectId, threadId }, ...query }),
        result,
      );
      assert.deepStrictEqual(yield* queries.queryForThread({ threadId, query }), result);
      assert.deepStrictEqual(yield* Ref.get(operations), ["query", "query"]);
    }),
);

it.effect("reads only a bounded source excerpt inside the resolved project scope", () =>
  Effect.gen(function* () {
    const sourceText = "x".repeat(KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH + 20);
    const node: KnowledgeGraphNodeV1 = {
      version: 1,
      nodeId: KnowledgeGraphNodeId.make("node-source"),
      scopeId: scope.scopeId,
      kind: "file",
      label: "src/index.ts",
      source: { path: "src/index.ts" },
      provenance: "deterministic",
      confidence: 1,
      evidenceIds: [],
      nodeRevision: 2,
    };
    const repository = serviceStub<KnowledgeGraphRepository.KnowledgeGraphRepository["Service"]>({
      getNodeBundle: () => Effect.succeed(Option.some({ node, evidence: [] })),
      getSnapshot: () => Effect.succeed(Option.some(snapshot)),
    });
    const queries = makeKnowledgeGraphRuntimeQueries({
      repository,
      catalog: serviceStub<KnowledgeGraphScopeCatalog.KnowledgeGraphScopeCatalog["Service"]>({}),
      eventHub: serviceStub<KnowledgeGraphEventHub.KnowledgeGraphEventHub["Service"]>({}),
      workspaceFiles: serviceStub<WorkspaceFileSystem.WorkspaceFileSystem["Service"]>({
        readFile: (input) => {
          assert.deepStrictEqual(input, {
            cwd: scope.effectiveWorkspaceRoot,
            relativePath: "src/index.ts",
          });
          return Effect.succeed({
            relativePath: "src/index.ts",
            contents: sourceText,
            byteLength: sourceText.length,
            truncated: false,
            revision: "sha256:source",
          });
        },
      }),
      resolveScope: () => Effect.succeed(scope),
      requireEnabled: () => Effect.void,
    });

    const content = yield* queries.nodeContent({
      scope: { projectId, threadId },
      nodeId: node.nodeId,
    });

    assert.strictEqual(
      content.excerpts[0]?.excerpt.length,
      KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH,
    );
    assert.isTrue(content.excerpts[0]?.truncated);
  }),
);
