import {
  KnowledgeGraphScopeId,
  KnowledgeGraphEdgeId,
  KnowledgeGraphEdgeV1,
  ProjectId,
  type KnowledgeGraphProgressV1,
} from "@t3tools/contracts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import { KnowledgeGraphScopeV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import Migration0059 from "../../persistence/Migrations/059_KnowledgeGraphDerivedData.ts";
import {
  KnowledgeGraphRepository,
  KnowledgeGraphRepositoryLive,
} from "../persistence/KnowledgeGraphRepository.ts";
import { KnowledgeGraphIndexer, layer } from "./KnowledgeGraphIndexer.ts";

const decodeScope = Schema.decodeUnknownSync(KnowledgeGraphScopeV1);
const encodeEdgeJson = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphEdgeV1));

const migratedSqlite = Layer.effectDiscard(Migration0059).pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
);
const repositoryTestLayer = KnowledgeGraphRepositoryLive.pipe(Layer.provideMerge(migratedSqlite));
const testLayer = layer.pipe(Layer.provideMerge(repositoryTestLayer));

it.effect("persists only incremental changes across repeated external edits", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-kg-indexer-"))),
    (temporaryRoot) =>
      Effect.gen(function* () {
        const workspaceRoot = yield* Effect.promise(() => NodeFSP.realpath(temporaryRoot));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(workspaceRoot, "index.ts"), "export const first = 1;\n"),
        );
        const scope = decodeScope({
          version: 1,
          scopeId: KnowledgeGraphScopeId.make("scope-indexer"),
          environmentId: "environment-1",
          projectId: ProjectId.make("project-1"),
          effectiveWorkspaceRoot: workspaceRoot,
          isWorktree: false,
        });
        const indexer = yield* KnowledgeGraphIndexer;
        const repository = yield* KnowledgeGraphRepository;

        const first = yield* indexer.indexScope(scope);
        const firstStatus = Option.getOrThrow(yield* repository.getStatus(scope.scopeId));
        yield* repository.updateStatus({
          ...firstStatus,
          state: "error",
          errorMessage: "stale indexing failure",
          retryAt: 123,
        });
        yield* Effect.promise(() => NodeFSP.utimes(NodePath.join(workspaceRoot, "index.ts"), 1, 2));
        const unchanged = yield* indexer.indexScope(scope);
        const recoveredStatus = Option.getOrThrow(yield* repository.getStatus(scope.scopeId));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(workspaceRoot, "index.ts"),
            "export const first = 1;\nexport const second = 2;\n",
          ),
        );
        const changed = yield* indexer.indexScope(scope);
        const snapshot = Option.getOrThrow(yield* repository.getSnapshot(scope.scopeId));

        assert.isTrue(Option.isSome(first));
        assert.isTrue(Option.isNone(unchanged));
        assert.isTrue(Option.isSome(changed));
        assert.strictEqual(recoveredStatus.state, "ready");
        assert.isUndefined(recoveredStatus.errorMessage);
        assert.isUndefined(recoveredStatus.retryAt);
        assert.strictEqual(snapshot.revision, 2);
        assert.isTrue(snapshot.nodes.some(({ label }) => label === "second"));
      }).pipe(Effect.provide(testLayer)),
    (workspaceRoot) =>
      Effect.promise(() => NodeFSP.rm(workspaceRoot, { recursive: true, force: true })),
  ),
);

it.effect("publishes a new static revision to retire stored model relationships", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-kg-legacy-"))),
    (temporaryRoot) =>
      Effect.gen(function* () {
        const workspaceRoot = yield* Effect.promise(() => NodeFSP.realpath(temporaryRoot));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(workspaceRoot, "index.ts"), "export const first = 1;\n"),
        );
        const scope = decodeScope({
          version: 1,
          scopeId: KnowledgeGraphScopeId.make("scope-indexer-legacy"),
          environmentId: "environment-1",
          projectId: ProjectId.make("project-indexer-legacy"),
          effectiveWorkspaceRoot: workspaceRoot,
          isWorktree: false,
        });
        const repository = yield* KnowledgeGraphRepository;
        const indexer = yield* KnowledgeGraphIndexer;
        const sql = yield* SqlClient.SqlClient;
        yield* indexer.indexScope(scope);
        const firstSnapshot = Option.getOrThrow(yield* repository.getSnapshot(scope.scopeId));
        const nodeId = firstSnapshot.nodes[0]?.nodeId;
        assert.isDefined(nodeId);
        const edge: KnowledgeGraphEdgeV1 = {
          version: 1,
          edgeId: KnowledgeGraphEdgeId.make("semantic:legacy"),
          scopeId: scope.scopeId,
          kind: "relates-to",
          sourceNodeId: nodeId!,
          targetNodeId: nodeId!,
          summary: "Old model claim",
          provenance: "semantic",
          confidence: 0.5,
          evidenceIds: [],
          edgeRevision: 1,
        };
        yield* sql`
          INSERT INTO knowledge_graph_edges (
            scope_id, edge_id, kind, source_node_id, target_node_id,
            provenance, confidence, edge_revision, edge_json
          ) VALUES (
            ${scope.scopeId}, ${edge.edgeId}, ${edge.kind},
            ${edge.sourceNodeId}, ${edge.targetNodeId},
            ${edge.provenance}, ${edge.confidence}, ${edge.edgeRevision},
            ${encodeEdgeJson(edge)}
          )
        `;
        yield* sql`
          INSERT INTO knowledge_graph_semantic_queue (
            job_id, environment_id, scope_id, node_id, desired_node_revision,
            model_generation, status, available_at, candidates_json,
            created_at, updated_at
          ) VALUES (
            ${"legacy-job"}, ${scope.environmentId}, ${scope.scopeId}, ${nodeId},
            1, 1, ${"queued"}, 0, ${"[]"}, 0, 0
          )
        `;
        yield* sql`
          INSERT INTO knowledge_graph_semantic_environments (
            environment_id, paused, semantic_model_key, model_generation, updated_at
          ) VALUES (${scope.environmentId}, 0, ${"openai:old-model"}, 1, 0)
        `;

        const rebuilt = Option.getOrThrow(yield* indexer.indexScope(scope));
        const snapshot = Option.getOrThrow(yield* repository.getSnapshot(scope.scopeId));

        assert.equal(rebuilt.delivery, "invalidate");
        assert.equal(snapshot.revision, firstSnapshot.revision + 1);
        assert.deepStrictEqual(
          snapshot.edges.map(({ edgeId }) => edgeId),
          firstSnapshot.edges.map(({ edgeId }) => edgeId),
        );
        assert.isFalse(
          Option.getOrThrow(yield* repository.getDeterministicState(scope.scopeId))
            .hasLegacySemanticData,
        );
        const queued = yield* sql<{ readonly count: number }>`
          SELECT count(*) AS count FROM knowledge_graph_semantic_queue
          WHERE scope_id = ${scope.scopeId}
        `;
        assert.equal(queued[0]?.count, 0);
        const modelSettings = yield* sql<{ readonly count: number }>`
          SELECT count(*) AS count FROM knowledge_graph_semantic_environments
          WHERE environment_id = ${scope.environmentId}
        `;
        assert.equal(modelSettings[0]?.count, 0);
      }).pipe(Effect.provide(testLayer)),
    (workspaceRoot) =>
      Effect.promise(() => NodeFSP.rm(workspaceRoot, { recursive: true, force: true })),
  ),
);

it.effect("publishes accurate persisting progress before committing", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-kg-indexer-"))),
    (temporaryRoot) =>
      Effect.gen(function* () {
        const workspaceRoot = yield* Effect.promise(() => NodeFSP.realpath(temporaryRoot));
        yield* Effect.promise(() =>
          Promise.all([
            NodeFSP.writeFile(
              NodePath.join(workspaceRoot, "first.ts"),
              "export const first = 1;\n",
            ),
            NodeFSP.writeFile(
              NodePath.join(workspaceRoot, "second.ts"),
              "export const second = 2;\n",
            ),
          ]),
        );
        const scope = decodeScope({
          version: 1,
          scopeId: KnowledgeGraphScopeId.make("scope-indexer-progress"),
          environmentId: "environment-1",
          projectId: ProjectId.make("project-progress"),
          effectiveWorkspaceRoot: workspaceRoot,
          isWorktree: false,
        });
        const repository = yield* KnowledgeGraphRepository;
        const events: string[] = [];
        let persistingProgress: KnowledgeGraphProgressV1 | undefined;
        const observedRepository = KnowledgeGraphRepository.of({
          ...repository,
          updateStatus: (status) =>
            Effect.sync(() => {
              events.push(`status:${status.progress?.phase ?? status.state}`);
              if (status.progress?.phase === "persisting") persistingProgress = status.progress;
            }).pipe(Effect.andThen(repository.updateStatus(status))),
          applyDeterministicPatch: (patch) =>
            Effect.sync(() => events.push("commit")).pipe(
              Effect.andThen(repository.applyDeterministicPatch(patch)),
            ),
        });
        const indexer = yield* KnowledgeGraphIndexer.pipe(
          Effect.provide(
            layer.pipe(Layer.provide(Layer.succeed(KnowledgeGraphRepository, observedRepository))),
          ),
        );

        const result = yield* indexer.indexScope(scope);

        assert.isTrue(Option.isSome(result));
        assert.deepStrictEqual(events, ["status:discovering", "status:persisting", "commit"]);
        assert.deepStrictEqual(persistingProgress, {
          version: 1,
          phase: "persisting",
          discoveredFileCount: 2,
          processedFileCount: 2,
          totalFileCount: 2,
          queuedSemanticNodeCount: 0,
        });
      }).pipe(Effect.provide(repositoryTestLayer)),
    (workspaceRoot) =>
      Effect.promise(() => NodeFSP.rm(workspaceRoot, { recursive: true, force: true })),
  ),
);

it.effect("clears stale retry metadata before a recovered indexing attempt", () =>
  Effect.gen(function* () {
    const scope = decodeScope({
      version: 1,
      scopeId: KnowledgeGraphScopeId.make("scope-indexer-retry"),
      environmentId: "environment-1",
      projectId: ProjectId.make("project-retry"),
      effectiveWorkspaceRoot: NodePath.join(NodeOS.tmpdir(), "t3-kg-missing-indexer-root"),
      isWorktree: false,
    });
    const indexer = yield* KnowledgeGraphIndexer;
    const repository = yield* KnowledgeGraphRepository;
    yield* repository.ensureScope(scope);
    const initialStatus = Option.getOrThrow(yield* repository.getStatus(scope.scopeId));
    yield* repository.updateStatus({
      ...initialStatus,
      state: "error",
      errorMessage: "stale indexing failure",
      retryAt: 456,
    });

    const result = yield* Effect.exit(indexer.indexScope(scope));
    const indexingStatus = Option.getOrThrow(yield* repository.getStatus(scope.scopeId));

    assert.isTrue(Exit.isFailure(result));
    assert.strictEqual(indexingStatus.state, "indexing");
    assert.isUndefined(indexingStatus.errorMessage);
    assert.isUndefined(indexingStatus.retryAt);
  }).pipe(Effect.provide(testLayer)),
);
