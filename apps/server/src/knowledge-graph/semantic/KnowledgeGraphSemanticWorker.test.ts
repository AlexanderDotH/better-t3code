import { assert, it } from "@effect/vitest";
import {
  KnowledgeGraphDeterministicPatchV1,
  KnowledgeGraphScopeV1,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import Migration0059 from "../../persistence/Migrations/059_KnowledgeGraphDerivedData.ts";
import {
  KnowledgeGraphRepository,
  KnowledgeGraphRepositoryLive,
} from "../persistence/KnowledgeGraphRepository.ts";
import {
  KnowledgeGraphSemanticQueueRepository,
  KnowledgeGraphSemanticQueueRepositoryLive,
} from "../persistence/KnowledgeGraphSemanticQueueRepository.ts";
import {
  KnowledgeGraphSemanticModelError,
  KnowledgeGraphSemanticWorker,
  KnowledgeGraphSemanticWorkerLive,
  knowledgeGraphSemanticModelErrorFromTextGeneration,
} from "./KnowledgeGraphSemanticWorker.ts";

const migratedSqlite = Layer.effectDiscard(Migration0059).pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
);
const persistence = Layer.merge(
  KnowledgeGraphRepositoryLive,
  KnowledgeGraphSemanticQueueRepositoryLive,
).pipe(Layer.provideMerge(migratedSqlite));
const layer = KnowledgeGraphSemanticWorkerLive.pipe(Layer.provideMerge(persistence));
const decodeScope = Schema.decodeUnknownSync(KnowledgeGraphScopeV1);
const decodeDeterministicPatch = Schema.decodeUnknownSync(KnowledgeGraphDeterministicPatchV1);

const makeScope = (suffix: string) =>
  decodeScope({
    version: 1,
    scopeId: `scope-worker-${suffix}`,
    environmentId: `environment-worker-${suffix}`,
    projectId: `project-worker-${suffix}`,
    effectiveWorkspaceRoot: `/workspace/worker-${suffix}`,
    isWorktree: false,
  });

const prepareScope = Effect.fnUntraced(function* (suffix: string) {
  const graph = yield* KnowledgeGraphRepository;
  const queue = yield* KnowledgeGraphSemanticQueueRepository;
  const scope = makeScope(suffix);
  const patch = decodeDeterministicPatch({
    version: 1,
    scope,
    baseRevision: 0,
    nodes: [
      {
        version: 1,
        nodeId: `node-source-${suffix}`,
        scopeId: scope.scopeId,
        kind: "file",
        label: "source.ts",
        source: { path: "src/source.ts" },
        provenance: "deterministic",
        confidence: 1,
        evidenceIds: [`evidence-source-${suffix}`],
        nodeRevision: 1,
      },
      {
        version: 1,
        nodeId: `node-target-${suffix}`,
        scopeId: scope.scopeId,
        kind: "file",
        label: "target.ts",
        source: { path: "src/target.ts" },
        provenance: "deterministic",
        confidence: 1,
        evidenceIds: [`evidence-target-${suffix}`],
        nodeRevision: 1,
      },
    ],
    edges: [],
    evidence: [
      {
        version: 1,
        evidenceId: `evidence-source-${suffix}`,
        scopeId: scope.scopeId,
        kind: "source",
        source: { path: "src/source.ts" },
        excerpt: "export const source = target;",
        fingerprint: `sha256:source-${suffix}`,
        confidence: 1,
        evidenceRevision: 1,
      },
      {
        version: 1,
        evidenceId: `evidence-target-${suffix}`,
        scopeId: scope.scopeId,
        kind: "source",
        source: { path: "src/target.ts" },
        excerpt: "export const target = true;",
        fingerprint: `sha256:target-${suffix}`,
        confidence: 1,
        evidenceRevision: 1,
      },
    ],
    removals: { nodeIds: [], edgeIds: [], evidenceIds: [], fingerprintPaths: [] },
    fileFingerprints: [],
    changedNodeIds: [`node-source-${suffix}`, `node-target-${suffix}`],
    truncation: {
      eligibleFiles: false,
      nodes: false,
      visibleNodes: false,
      omittedFileCount: 0,
      omittedNodeCount: 0,
    },
    committedAt: "2026-08-29T12:00:00.000Z",
  });
  yield* graph.ensureScope(scope);
  yield* graph.applyDeterministicPatch(patch);
  yield* queue.enqueueChangedNodes({
    version: 1,
    environmentId: scope.environmentId,
    scopeId: scope.scopeId,
    modelGeneration: 3,
    nodes: [
      {
        nodeId: patch.nodes[0].nodeId,
        nodeRevision: patch.nodes[0].nodeRevision,
        candidates: [
          {
            sourceNodeId: patch.nodes[0].nodeId,
            candidateNodeId: patch.nodes[1].nodeId,
            evidenceIds: patch.evidence.map(({ evidenceId }) => evidenceId),
            score: 0.9,
          },
        ],
      },
    ],
  });
  return { scope, patch };
});

const semanticOutput = (suffix: string) => ({
  version: 1 as const,
  edges: [
    {
      kind: "relates-to" as const,
      sourceNodeId: `node-source-${suffix}`,
      targetNodeId: `node-target-${suffix}`,
      confidence: 0.8,
      summary: "Source and target collaborate.",
      evidenceIds: [`evidence-source-${suffix}`, `evidence-target-${suffix}`],
    },
  ],
});

it("maps provider-neutral text-generation failures into semantic queue policy", () => {
  const rateLimited = knowledgeGraphSemanticModelErrorFromTextGeneration(
    new TextGenerationError({
      operation: "enrichKnowledgeGraph",
      detail: "Retry after the provider window resets.",
      reason: "rate-limited",
      retryAt: 1_788_000_060_000,
    }),
  );
  const unavailable = knowledgeGraphSemanticModelErrorFromTextGeneration(
    new TextGenerationError({
      operation: "enrichKnowledgeGraph",
      detail: "The model is no longer available.",
      reason: "model-unavailable",
    }),
  );
  const internal = knowledgeGraphSemanticModelErrorFromTextGeneration(
    new TextGenerationError({
      operation: "enrichKnowledgeGraph",
      detail: "The response transport failed.",
    }),
  );

  assert.deepStrictEqual(
    {
      category: rateLimited.category,
      retryable: rateLimited.retryable,
      retryAt: rateLimited.retryAt,
    },
    { category: "rate-limited", retryable: true, retryAt: 1_788_000_060_000 },
  );
  assert.deepStrictEqual(
    { category: unavailable.category, retryable: unavailable.retryable },
    { category: "model-unavailable", retryable: false },
  );
  assert.deepStrictEqual(
    { category: internal.category, retryable: internal.retryable },
    { category: "internal", retryable: true },
  );
});

it.layer(layer)("KnowledgeGraphSemanticWorker", (it) => {
  it.effect("commits one strictly validated semantic patch and empties its durable claim", () =>
    Effect.gen(function* () {
      const worker = yield* KnowledgeGraphSemanticWorker;
      const graph = yield* KnowledgeGraphRepository;
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const { scope } = yield* prepareScope("commit");
      const outcome = yield* worker.runNextBatch({
        environmentId: scope.environmentId,
        now: 1_788_000_000_000,
        enrich: (request) => {
          assert.equal(request.items.length, 1);
          assert.equal(request.items[0].sourceNode.nodeId, "node-source-commit");
          assert.equal(request.items[0].candidates.length, 1);
          assert.isAtMost(request.evidence.length, 256);
          return Effect.succeed(semanticOutput("commit"));
        },
      });
      const snapshot = Option.getOrThrow(yield* graph.getSnapshot(scope.scopeId));

      assert.deepStrictEqual(outcome, {
        status: "committed",
        environmentId: scope.environmentId,
        scopeId: scope.scopeId,
        revision: 2,
        processedJobCount: 1,
      });
      assert.equal(snapshot.edges[0]?.provenance, "semantic");
      assert.equal((yield* queue.getStatus(scope.environmentId)).queuedCount, 0);
      assert.equal(
        (yield* worker.runNextBatch({
          environmentId: scope.environmentId,
          now: 1_788_000_000_001,
          enrich: () => Effect.succeed(semanticOutput("commit")),
        })).status,
        "idle",
      );
    }),
  );

  it.effect("serializes concurrent model batches per environment", () =>
    Effect.gen(function* () {
      const worker = yield* KnowledgeGraphSemanticWorker;
      const { scope } = yield* prepareScope("serialized");
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let calls = 0;
      const first = yield* worker
        .runNextBatch({
          environmentId: scope.environmentId,
          now: 1_788_000_000_000,
          enrich: () =>
            Effect.gen(function* () {
              calls += 1;
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              return semanticOutput("serialized");
            }),
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);

      const concurrent = yield* worker.runNextBatch({
        environmentId: scope.environmentId,
        now: 1_788_000_000_000,
        enrich: () => Effect.succeed(semanticOutput("serialized")),
      });
      assert.equal(concurrent.status, "idle");
      assert.equal(calls, 1);

      yield* Deferred.succeed(release, undefined);
      assert.equal((yield* Fiber.join(first)).status, "committed");
    }),
  );

  it.effect("discards a running model result superseded by a newer model generation", () =>
    Effect.gen(function* () {
      const worker = yield* KnowledgeGraphSemanticWorker;
      const graph = yield* KnowledgeGraphRepository;
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const { scope, patch } = yield* prepareScope("superseded-model");
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const first = yield* worker
        .runNextBatch({
          environmentId: scope.environmentId,
          now: 1_788_000_000_000,
          enrich: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              return semanticOutput("superseded-model");
            }),
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);

      yield* queue.enqueueChangedNodes({
        version: 1,
        environmentId: scope.environmentId,
        scopeId: scope.scopeId,
        modelGeneration: 4,
        nodes: [
          {
            nodeId: patch.nodes[0].nodeId,
            nodeRevision: patch.nodes[0].nodeRevision,
            candidates: [
              {
                sourceNodeId: patch.nodes[0].nodeId,
                candidateNodeId: patch.nodes[1].nodeId,
                evidenceIds: patch.evidence.map(({ evidenceId }) => evidenceId),
                score: 0.9,
              },
            ],
          },
        ],
      });
      const concurrent = yield* worker.runNextBatch({
        environmentId: scope.environmentId,
        now: 1_788_000_000_001,
        enrich: () => Effect.succeed(semanticOutput("superseded-model")),
      });
      assert.equal(concurrent.status, "idle");

      yield* Deferred.succeed(release, undefined);
      const superseded = yield* Fiber.join(first);
      const beforeReplacement = Option.getOrThrow(yield* graph.getSnapshot(scope.scopeId));
      assert.equal(superseded.status, "requeued");
      assert.equal(beforeReplacement.revision, 1);
      assert.equal(beforeReplacement.edges.length, 0);

      const replacement = yield* worker.runNextBatch({
        environmentId: scope.environmentId,
        now: 1_788_000_000_002,
        enrich: () => Effect.succeed(semanticOutput("superseded-model")),
      });
      assert.equal(replacement.status, "committed");
      assert.equal((yield* queue.getStatus(scope.environmentId)).queuedCount, 0);
    }),
  );

  it.effect("retains a rate-limited claim and publishes its absolute retry time", () =>
    Effect.gen(function* () {
      const worker = yield* KnowledgeGraphSemanticWorker;
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const { scope } = yield* prepareScope("rate-limit");
      const retryAt = 1_788_000_060_000;
      const outcome = yield* worker.runNextBatch({
        environmentId: scope.environmentId,
        now: 1_788_000_000_000,
        enrich: () =>
          Effect.fail(
            new KnowledgeGraphSemanticModelError({
              category: "rate-limited",
              retryable: true,
              retryAt,
              detail: "Provider requested a retry.",
            }),
          ),
      });
      const status = yield* queue.getStatus(scope.environmentId);

      assert.equal(outcome.status, "rate-limited");
      if (outcome.status === "rate-limited") assert.equal(outcome.retryAt, retryAt);
      assert.equal(status.queuedCount, 1);
      assert.equal(status.runningCount, 0);
      assert.equal(status.rateLimitedUntil, retryAt);
    }),
  );

  it.effect("requeues invalid model output without persisting a graph revision", () =>
    Effect.gen(function* () {
      const worker = yield* KnowledgeGraphSemanticWorker;
      const graph = yield* KnowledgeGraphRepository;
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const { scope } = yield* prepareScope("invalid-output");
      const outcome = yield* worker.runNextBatch({
        environmentId: scope.environmentId,
        now: 1_788_000_000_000,
        enrich: () =>
          Effect.succeed({ ...semanticOutput("invalid-output"), explanation: "extra field" }),
      });
      const snapshot = Option.getOrThrow(yield* graph.getSnapshot(scope.scopeId));

      assert.equal(outcome.status, "requeued");
      if (outcome.status === "requeued") assert.equal(outcome.category, "invalid-output");
      assert.equal(snapshot.revision, 1);
      assert.equal((yield* queue.getStatus(scope.environmentId)).queuedCount, 1);
    }),
  );

  it.effect(
    "pauses unavailable models and resumes queued work after a model generation change",
    () =>
      Effect.gen(function* () {
        const worker = yield* KnowledgeGraphSemanticWorker;
        const queue = yield* KnowledgeGraphSemanticQueueRepository;
        const { scope, patch } = yield* prepareScope("model-change");
        const unavailable = yield* worker.runNextBatch({
          environmentId: scope.environmentId,
          now: 1_788_000_000_000,
          enrich: () =>
            Effect.fail(
              new KnowledgeGraphSemanticModelError({
                category: "model-unavailable",
                retryable: false,
                detail: "The configured model left the catalog.",
              }),
            ),
        });

        assert.equal(unavailable.status, "requeued");
        if (unavailable.status === "requeued") assert.isTrue(unavailable.paused);
        assert.isTrue((yield* queue.getStatus(scope.environmentId)).paused);

        yield* queue.enqueueChangedNodes({
          version: 1,
          environmentId: scope.environmentId,
          scopeId: scope.scopeId,
          modelGeneration: 4,
          nodes: [
            {
              nodeId: patch.nodes[0].nodeId,
              nodeRevision: patch.nodes[0].nodeRevision,
              candidates: [
                {
                  sourceNodeId: patch.nodes[0].nodeId,
                  candidateNodeId: patch.nodes[1].nodeId,
                  evidenceIds: patch.evidence.map(({ evidenceId }) => evidenceId),
                  score: 0.9,
                },
              ],
            },
          ],
        });
        yield* worker.resumeEnvironment(scope.environmentId);
        const committed = yield* worker.runNextBatch({
          environmentId: scope.environmentId,
          now: 1_788_000_000_001,
          enrich: () => Effect.succeed(semanticOutput("model-change")),
        });

        assert.equal(committed.status, "committed");
        assert.isFalse((yield* queue.getStatus(scope.environmentId)).paused);
      }),
  );

  it.effect("recovers claims left running by a previous server process", () =>
    Effect.gen(function* () {
      const worker = yield* KnowledgeGraphSemanticWorker;
      const queue = yield* KnowledgeGraphSemanticQueueRepository;
      const { scope } = yield* prepareScope("restart");
      assert.isTrue(
        Option.isSome(
          yield* queue.claimNextBatch({
            environmentId: scope.environmentId,
            limit: 1,
            now: 1_788_000_000_000,
          }),
        ),
      );

      yield* worker.recover;
      const outcome = yield* worker.runNextBatch({
        environmentId: scope.environmentId,
        now: 1_788_000_000_001,
        enrich: () => Effect.succeed(semanticOutput("restart")),
      });

      assert.equal(outcome.status, "committed");
    }),
  );
});
