import { assert, it } from "@effect/vitest";
import {
  KnowledgeGraphRepository,
  KnowledgeGraphRepositoryLive,
} from "./KnowledgeGraphRepository.ts";
import {
  KnowledgeGraphNodeId,
  KnowledgeGraphSemanticEnqueueV1,
  KnowledgeGraphScopeV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import Migration0059 from "../../persistence/Migrations/059_KnowledgeGraphDerivedData.ts";
import {
  KnowledgeGraphSemanticQueueRepository,
  KnowledgeGraphSemanticQueueRepositoryLive,
} from "./KnowledgeGraphSemanticQueueRepository.ts";

const migratedSqlite = Layer.effectDiscard(Migration0059).pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
);
const layer = Layer.merge(
  KnowledgeGraphRepositoryLive,
  KnowledgeGraphSemanticQueueRepositoryLive,
).pipe(Layer.provideMerge(migratedSqlite));

const scope = Schema.decodeUnknownSync(KnowledgeGraphScopeV1)({
  version: 1,
  scopeId: "scope-main",
  environmentId: "environment-1",
  projectId: "project-1",
  effectiveWorkspaceRoot: "/workspace/project",
  isWorktree: false,
});

const enqueue = Schema.decodeUnknownSync(KnowledgeGraphSemanticEnqueueV1)({
  version: 1,
  environmentId: scope.environmentId,
  scopeId: scope.scopeId,
  modelGeneration: 1,
  nodes: [{ nodeId: "node-1", nodeRevision: 1, candidates: [] }],
});
const decodeScope = Schema.decodeUnknownSync(KnowledgeGraphScopeV1);
const decodeEnqueue = Schema.decodeUnknownSync(KnowledgeGraphSemanticEnqueueV1);

const makeScope = (suffix: string) =>
  decodeScope({
    version: 1,
    scopeId: `scope-${suffix}`,
    environmentId: `environment-${suffix}`,
    projectId: `project-${suffix}`,
    effectiveWorkspaceRoot: `/workspace/${suffix}`,
    isWorktree: false,
  });

const makeEnqueue = (input: {
  readonly scope: typeof scope;
  readonly modelGeneration?: number;
  readonly nodeIds: ReadonlyArray<string>;
}) =>
  decodeEnqueue({
    version: 1,
    environmentId: input.scope.environmentId,
    scopeId: input.scope.scopeId,
    modelGeneration: input.modelGeneration ?? 1,
    nodes: input.nodeIds.map((nodeId, index) => ({
      nodeId,
      nodeRevision: index + 1,
      candidates: [],
    })),
  });

it.layer(layer)("KnowledgeGraphSemanticQueueRepository", (it) => {
  it.effect("claims at most one environment batch and fences stale model generations", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      yield* graph.ensureScope(scope);
      yield* queue.enqueueChangedNodes(enqueue);

      const claim = yield* queue.claimNextBatch({
        environmentId: scope.environmentId,
        limit: 4,
        now: 1_788_000_000_000,
      });
      assert.isTrue(Option.isSome(claim));
      const active = Option.getOrThrow(claim);
      assert.equal(active.items.length, 1);

      yield* queue.enqueueChangedNodes({
        ...enqueue,
        modelGeneration: 2,
        nodes: [{ nodeId: "node-1", nodeRevision: 2, candidates: [] }],
      });
      const completion = yield* queue.completeClaimExpected({
        version: 1,
        claim: active,
        semanticPatch: {
          version: 1,
          scopeId: scope.scopeId,
          baseRevision: 0,
          modelGeneration: 1,
          nodes: [],
          edges: [],
          evidence: [],
          changedNodeIds: [],
          committedAt: "2026-08-29T10:00:00.000Z",
        },
      });

      assert.equal(completion, "stale");
      assert.equal((yield* queue.getStatus(scope.environmentId)).queuedCount, 1);
    }),
  );

  it.effect("retains a claim when completion names a different graph scope", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      const claimScope = makeScope("completion-scope");
      yield* graph.ensureScope(claimScope);
      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: claimScope, nodeIds: ["node-completion-scope"] }),
      );
      const claim = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: claimScope.environmentId,
          limit: 1,
          now: 1_788_000_000_000,
        }),
      );

      const completion = yield* queue.completeClaimExpected({
        version: 1,
        claim,
        semanticPatch: {
          version: 1,
          scopeId: scope.scopeId,
          baseRevision: 0,
          modelGeneration: claim.items[0].modelGeneration,
          nodes: [],
          edges: [],
          evidence: [],
          changedNodeIds: [],
          committedAt: "2026-08-29T10:00:00.000Z",
        },
      });

      assert.equal(completion, "stale");
      assert.equal((yield* queue.getStatus(claimScope.environmentId)).runningCount, 1);
    }),
  );

  it.effect("pauses and resumes an environment without dropping queued work", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      const pausedScope = {
        ...scope,
        scopeId: "scope-paused",
        effectiveWorkspaceRoot: "/workspace/paused",
      };
      yield* graph.ensureScope(pausedScope);
      yield* queue.enqueueChangedNodes({ ...enqueue, scopeId: pausedScope.scopeId });
      yield* queue.pauseEnvironment(scope.environmentId);
      assert.isTrue(
        Option.isNone(
          yield* queue.claimNextBatch({
            environmentId: scope.environmentId,
            limit: 1,
            now: 1_788_000_000_000,
          }),
        ),
      );

      yield* queue.resumeEnvironment(scope.environmentId);
      assert.isTrue(
        Option.isSome(
          yield* queue.claimNextBatch({
            environmentId: scope.environmentId,
            limit: 1,
            now: 1_788_000_000_000,
          }),
        ),
      );
    }),
  );

  it.effect("pauses one environment by requeueing only its running claim", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      const pausedScope = makeScope("pause-running");
      const otherScope = makeScope("pause-running-other");
      yield* graph.ensureScope(pausedScope);
      yield* graph.ensureScope(otherScope);
      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: pausedScope, nodeIds: ["node-paused-running"] }),
      );
      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: otherScope, nodeIds: ["node-other-running"] }),
      );
      const pausedClaim = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: pausedScope.environmentId,
          limit: 1,
          now: 1_788_000_000_000,
        }),
      );
      yield* queue.claimNextBatch({
        environmentId: otherScope.environmentId,
        limit: 1,
        now: 1_788_000_000_000,
      });

      yield* queue.pauseEnvironment(pausedScope.environmentId);

      assert.deepStrictEqual(yield* queue.getStatus(pausedScope.environmentId), {
        environmentId: pausedScope.environmentId,
        queuedCount: 1,
        runningCount: 0,
        paused: true,
        rateLimitedUntil: null,
      });
      assert.equal((yield* queue.getStatus(otherScope.environmentId)).runningCount, 1);

      yield* queue.resumeEnvironment(pausedScope.environmentId);
      const resumedClaim = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: pausedScope.environmentId,
          limit: 1,
          now: 1_788_000_000_001,
        }),
      );
      assert.equal(resumedClaim.items[0].jobId, pausedClaim.items[0].jobId);
      assert.equal(resumedClaim.items[0].attemptCount, pausedClaim.items[0].attemptCount);
    }),
  );

  it.effect("claims one scope and model generation per serialized environment batch", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      const firstScope = makeScope("grouped-first");
      const secondScope = {
        ...firstScope,
        scopeId: "scope-grouped-second",
        projectId: "project-grouped-second",
        effectiveWorkspaceRoot: "/workspace/grouped-second",
      };
      yield* graph.ensureScope(firstScope);
      yield* graph.ensureScope(secondScope);
      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: firstScope, nodeIds: ["node-a", "node-b"] }),
      );
      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: secondScope, modelGeneration: 2, nodeIds: ["node-c"] }),
      );

      const firstClaim = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: firstScope.environmentId,
          limit: 8,
          now: 1_788_000_000_000,
        }),
      );
      const concurrentClaim = yield* queue.claimNextBatch({
        environmentId: firstScope.environmentId,
        limit: 8,
        now: 1_788_000_000_000,
      });

      assert.deepStrictEqual(
        [...new Set(firstClaim.items.map(({ scopeId }) => scopeId))],
        [firstClaim.items[0].scopeId],
      );
      assert.deepStrictEqual(
        [...new Set(firstClaim.items.map(({ modelGeneration }) => modelGeneration))],
        [firstClaim.items[0].modelGeneration],
      );
      assert.isTrue(Option.isNone(concurrentClaim));
      assert.equal((yield* queue.getStatus(firstScope.environmentId)).queuedCount, 1);
    }),
  );

  it.effect("rate limits and resumes a new model generation without dropping work", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      const rateScope = makeScope("rate-limit");
      const now = 1_788_000_000_000;
      const retryAt = now + 60_000;
      yield* graph.ensureScope(rateScope);
      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: rateScope, nodeIds: ["node-rate-limited"] }),
      );
      const claim = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: rateScope.environmentId,
          limit: 1,
          now,
        }),
      );
      yield* queue.releaseClaim({
        claim,
        availableAt: retryAt,
        failure: {
          category: "rate-limited",
          retryable: true,
          retryAt,
          detail: "Provider requested a retry.",
        },
      });

      assert.isTrue(
        Option.isNone(
          yield* queue.claimNextBatch({
            environmentId: rateScope.environmentId,
            limit: 1,
            now: now + 1,
          }),
        ),
      );
      assert.equal((yield* queue.getStatus(rateScope.environmentId)).queuedCount, 1);

      yield* queue.enqueueChangedNodes(
        makeEnqueue({
          scope: rateScope,
          modelGeneration: 2,
          nodeIds: ["node-rate-limited"],
        }),
      );
      yield* queue.resumeEnvironment(rateScope.environmentId);
      const resumed = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: rateScope.environmentId,
          limit: 1,
          now: now + 1,
        }),
      );

      assert.equal(resumed.items[0].modelGeneration, 2);
      assert.isNull((yield* queue.getStatus(rateScope.environmentId)).rateLimitedUntil);
    }),
  );

  it.effect("automatically clears an expired rate limit when work becomes claimable", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      const rateScope = makeScope("rate-limit-expiry");
      const now = 1_788_000_000_000;
      const retryAt = now + 60_000;
      yield* graph.ensureScope(rateScope);
      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: rateScope, nodeIds: ["node-rate-limit-expiry"] }),
      );
      const claim = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: rateScope.environmentId,
          limit: 1,
          now,
        }),
      );
      yield* queue.releaseClaim({
        claim,
        availableAt: retryAt,
        failure: {
          category: "rate-limited",
          retryable: true,
          retryAt,
          detail: "Provider requested a retry.",
        },
      });

      assert.isTrue(
        Option.isSome(
          yield* queue.claimNextBatch({
            environmentId: rateScope.environmentId,
            limit: 1,
            now: retryAt,
          }),
        ),
      );
      assert.isNull((yield* queue.getStatus(rateScope.environmentId)).rateLimitedUntil);
    }),
  );

  it.effect("keeps one running environment claim while a newer model generation queues", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      const modelScope = makeScope("running-model-change");
      const now = 1_788_000_000_000;
      yield* graph.ensureScope(modelScope);
      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: modelScope, modelGeneration: 1, nodeIds: ["node-model-change"] }),
      );
      const running = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: modelScope.environmentId,
          limit: 1,
          now,
        }),
      );

      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: modelScope, modelGeneration: 2, nodeIds: ["node-model-change"] }),
      );

      assert.isTrue(
        Option.isNone(
          yield* queue.claimNextBatch({
            environmentId: modelScope.environmentId,
            limit: 1,
            now,
          }),
        ),
      );
      yield* queue.releaseClaim({ claim: running, availableAt: now + 1 });
      const replacement = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: modelScope.environmentId,
          limit: 1,
          now: now + 1,
        }),
      );
      assert.equal(replacement.items[0].modelGeneration, 2);
      assert.equal(replacement.items[0].attemptCount, 1);
    }),
  );

  it.effect("recovers an interrupted running claim after repository restart", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      const recoveryScope = makeScope("recovery");
      yield* graph.ensureScope(recoveryScope);
      yield* queue.enqueueChangedNodes(
        makeEnqueue({ scope: recoveryScope, nodeIds: ["node-recovery"] }),
      );
      const interrupted = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: recoveryScope.environmentId,
          limit: 1,
          now: 1_788_000_000_000,
        }),
      );

      yield* queue.recoverClaims();
      const recovered = Option.getOrThrow(
        yield* queue.claimNextBatch({
          environmentId: recoveryScope.environmentId,
          limit: 1,
          now: 1_788_000_000_001,
        }),
      );

      assert.equal(recovered.items[0].jobId, interrupted.items[0].jobId);
      assert.equal(recovered.items[0].attemptCount, interrupted.items[0].attemptCount);
    }),
  );

  it.effect("persists more than two thousand queued nodes without an application ceiling", () =>
    Effect.gen(function* () {
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const graph = yield* KnowledgeGraphRepository;
      const capacityScope = makeScope("capacity");
      const nodeIds = Array.from({ length: 2_048 }, (_, index) =>
        KnowledgeGraphNodeId.make(`node-capacity-${index}`),
      );
      yield* graph.ensureScope(capacityScope);
      yield* queue.enqueueChangedNodes({
        version: 1,
        environmentId: capacityScope.environmentId,
        scopeId: capacityScope.scopeId,
        modelGeneration: 1,
        nodes: nodeIds.map((nodeId, index) => ({
          nodeId,
          nodeRevision: index + 1,
          candidates: [],
        })),
      });

      assert.equal((yield* queue.getStatus(capacityScope.environmentId)).queuedCount, 2_048);
    }),
  );
});
