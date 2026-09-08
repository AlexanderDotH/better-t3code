import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  KnowledgeGraphModelGeneration,
  KnowledgeGraphNodeId,
  KnowledgeGraphScopeId,
  ProjectId,
  ProviderInstanceId,
  type KnowledgeGraphScopeV1,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

import { makeKnowledgeGraphSemanticRuntime } from "./KnowledgeGraphSemanticRuntime.ts";

const environmentId = EnvironmentId.make("environment-semantic-runtime");
const scope: KnowledgeGraphScopeV1 = {
  version: 1,
  scopeId: KnowledgeGraphScopeId.make("scope-semantic-runtime"),
  environmentId,
  projectId: ProjectId.make("project-semantic-runtime"),
  effectiveWorkspaceRoot: "/workspace/semantic-runtime",
  isWorktree: false,
};
const modelSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("openai"),
  model: "gpt-5.6",
  options: [],
};

it.effect("re-enqueues every deterministic node only when the semantic model changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const enqueued: Array<{
        readonly generation: number;
        readonly nodeIds: ReadonlyArray<string>;
      }> = [];
      const cancelled: Array<string> = [];
      let persistedModelKey: string | null = null;
      let persistedGeneration = 0;
      const runtime = yield* makeKnowledgeGraphSemanticRuntime({
        repository: {
          reconcileSemanticModel: ({ modelKey }) =>
            Effect.sync(() => {
              if (modelKey === persistedModelKey) {
                return {
                  modelGeneration: KnowledgeGraphModelGeneration.make(persistedGeneration),
                  changed: false,
                };
              }
              persistedModelKey = modelKey;
              persistedGeneration += 1;
              return {
                modelGeneration: KnowledgeGraphModelGeneration.make(persistedGeneration),
                changed: true,
              };
            }),
          getDeterministicState: () =>
            Effect.succeed(
              Option.some({
                scope,
                revision: 1,
                nodes: [
                  {
                    version: 1,
                    nodeId: KnowledgeGraphNodeId.make("node-source"),
                    scopeId: scope.scopeId,
                    kind: "file" as const,
                    label: "src/source.ts",
                    source: { path: "src/source.ts" },
                    provenance: "deterministic" as const,
                    confidence: 1,
                    evidenceIds: [],
                    nodeRevision: 1,
                  },
                ],
                edges: [],
                evidence: [],
                fileFingerprints: [],
                truncation: {
                  eligibleFiles: false,
                  nodes: false,
                  visibleNodes: false,
                  omittedFileCount: 0,
                  omittedNodeCount: 0,
                },
              }),
            ),
          getStatus: () => Effect.succeed(Option.none()),
          updateStatus: () => Effect.void,
        },
        semanticQueue: {
          enqueueChangedNodes: (input) =>
            Effect.sync(() => {
              enqueued.push({
                generation: input.modelGeneration,
                nodeIds: input.nodes.map(({ nodeId }) => nodeId),
              });
            }),
          cancelScope: (scopeId) =>
            Effect.sync(() => {
              cancelled.push(scopeId);
            }),
        },
        semanticWorker: {
          recover: Effect.void,
          recoverEnvironment: () => Effect.void,
          pauseEnvironment: () => Effect.void,
          resumeEnvironment: () => Effect.void,
          runNextBatch: () => Effect.succeed({ status: "idle", environmentId }),
        },
        publish: () => Effect.void,
        enrich: () => Effect.die("unused"),
      });

      yield* runtime.reconcileSelection({ environmentId, modelSelection, scopes: [scope] });
      yield* runtime.reconcileSelection({ environmentId, modelSelection, scopes: [scope] });

      assert.deepStrictEqual(cancelled, [scope.scopeId]);
      assert.deepStrictEqual(enqueued, [{ generation: 1, nodeIds: ["node-source"] }]);

      yield* runtime.reconcileSelection({ environmentId, modelSelection: null, scopes: [scope] });
      assert.deepStrictEqual(cancelled, [scope.scopeId, scope.scopeId]);
      yield* runtime.stopAll;
    }),
  ),
);

it.effect("interrupts active semantic work before pause, recovery, and shutdown complete", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* Queue.unbounded<string>();
      const runtime = yield* makeKnowledgeGraphSemanticRuntime({
        repository: {
          reconcileSemanticModel: () =>
            Effect.succeed({
              modelGeneration: KnowledgeGraphModelGeneration.make(1),
              changed: false,
            }),
          getDeterministicState: () => Effect.succeed(Option.none()),
          getStatus: () => Effect.succeed(Option.none()),
          updateStatus: () => Effect.void,
        },
        semanticQueue: {
          enqueueChangedNodes: () => Effect.void,
          cancelScope: () => Effect.void,
        },
        semanticWorker: {
          recover: Queue.offer(lifecycle, "recover-all").pipe(Effect.asVoid),
          recoverEnvironment: () =>
            Queue.offer(lifecycle, "recover-environment").pipe(Effect.asVoid),
          pauseEnvironment: () => Queue.offer(lifecycle, "pause").pipe(Effect.asVoid),
          resumeEnvironment: () => Queue.offer(lifecycle, "resume").pipe(Effect.asVoid),
          runNextBatch: () =>
            Queue.offer(lifecycle, "started").pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Queue.offer(lifecycle, "interrupted")),
            ),
        },
        publish: () => Effect.void,
        enrich: () => Effect.die("unused"),
      });

      yield* runtime.reconcileSelection({ environmentId, modelSelection, scopes: [scope] });
      assert.strictEqual(yield* Queue.take(lifecycle), "recover-environment");
      assert.strictEqual(yield* Queue.take(lifecycle), "resume");
      assert.strictEqual(yield* Queue.take(lifecycle), "started");

      yield* runtime.pauseEnvironment(environmentId);
      assert.strictEqual(yield* Queue.take(lifecycle), "interrupted");
      assert.strictEqual(yield* Queue.take(lifecycle), "pause");

      yield* runtime.resumeEnvironment(environmentId);
      assert.strictEqual(yield* Queue.take(lifecycle), "resume");
      assert.strictEqual(yield* Queue.take(lifecycle), "started");

      yield* runtime.stopEnvironment(environmentId);
      assert.strictEqual(yield* Queue.take(lifecycle), "interrupted");
      assert.strictEqual(yield* Queue.take(lifecycle), "recover-environment");

      yield* runtime.startEnvironment(environmentId);
      assert.strictEqual(yield* Queue.take(lifecycle), "started");
      yield* runtime.stopAll;
      assert.strictEqual(yield* Queue.take(lifecycle), "interrupted");
      assert.strictEqual(yield* Queue.take(lifecycle), "recover-all");
    }),
  ),
);
