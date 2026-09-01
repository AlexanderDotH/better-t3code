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

import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import Migration0059 from "../../persistence/Migrations/059_KnowledgeGraphDerivedData.ts";
import {
  KnowledgeGraphRepository,
  KnowledgeGraphRepositoryLive,
} from "../persistence/KnowledgeGraphRepository.ts";
import { KnowledgeGraphIndexer, layer } from "./KnowledgeGraphIndexer.ts";

const decodeScope = Schema.decodeUnknownSync(KnowledgeGraphScopeV1);

const migratedSqlite = Layer.effectDiscard(Migration0059).pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
);
const testLayer = layer.pipe(
  Layer.provideMerge(KnowledgeGraphRepositoryLive),
  Layer.provideMerge(migratedSqlite),
);

it.effect("persists only incremental changes across repeated external edits", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-kg-indexer-"))),
    (workspaceRoot) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(workspaceRoot, "index.ts"), "export const first = 1;\n"),
        );
        const scope = decodeScope({
          version: 1,
          scopeId: "scope-indexer",
          environmentId: "environment-1",
          projectId: "project-1",
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

it.effect("clears stale retry metadata before a recovered indexing attempt", () =>
  Effect.gen(function* () {
    const scope = decodeScope({
      version: 1,
      scopeId: "scope-indexer-retry",
      environmentId: "environment-1",
      projectId: "project-retry",
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
