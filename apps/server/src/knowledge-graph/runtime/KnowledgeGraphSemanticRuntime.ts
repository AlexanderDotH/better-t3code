import { stableStringify } from "@t3tools/shared/relaySigning";
import type {
  EnvironmentId,
  KnowledgeGraphOperationError,
  KnowledgeGraphModelGeneration,
  KnowledgeGraphNodeId,
  KnowledgeGraphScopeV1,
  KnowledgeGraphSemanticModelRequestV1,
  KnowledgeGraphSemanticModelResultV1,
  KnowledgeGraphStreamEvent,
  ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";

import { buildKnowledgeGraphSemanticEnqueueNodes } from "../semantic/KnowledgeGraphSemanticCandidates.ts";
import type {
  KnowledgeGraphSemanticModelError,
  KnowledgeGraphSemanticWorker,
  KnowledgeGraphSemanticWorkerOutcome,
} from "../semantic/KnowledgeGraphSemanticWorker.ts";
import type { KnowledgeGraphRepository } from "../persistence/KnowledgeGraphRepository.ts";
import type { KnowledgeGraphSemanticQueueRepository } from "../persistence/KnowledgeGraphSemanticQueueRepository.ts";
import {
  makeKnowledgeGraphSemanticScheduler,
  type KnowledgeGraphSemanticScheduler,
} from "./KnowledgeGraphSemanticScheduler.ts";
import { graphError } from "./KnowledgeGraphRuntimeService.ts";

interface SemanticModelState {
  readonly selection: ModelSelection | null;
  readonly generation: KnowledgeGraphModelGeneration;
}

export interface KnowledgeGraphSemanticRuntimeDependencies {
  readonly repository: Pick<
    KnowledgeGraphRepository["Service"],
    "reconcileSemanticModel" | "getDeterministicState" | "getStatus" | "updateStatus"
  >;
  readonly semanticQueue: Pick<
    KnowledgeGraphSemanticQueueRepository["Service"],
    "enqueueChangedNodes" | "cancelScope"
  >;
  readonly semanticWorker: Pick<
    KnowledgeGraphSemanticWorker["Service"],
    "recover" | "recoverEnvironment" | "pauseEnvironment" | "resumeEnvironment" | "runNextBatch"
  >;
  readonly publish: (event: KnowledgeGraphStreamEvent) => Effect.Effect<void>;
  readonly enrich: (
    request: KnowledgeGraphSemanticModelRequestV1,
    modelSelection: ModelSelection,
  ) => Effect.Effect<KnowledgeGraphSemanticModelResultV1, KnowledgeGraphSemanticModelError>;
}

export interface KnowledgeGraphSemanticRuntime {
  readonly reconcileSelection: (input: {
    readonly environmentId: EnvironmentId;
    readonly modelSelection: ModelSelection | null;
    readonly scopes: ReadonlyArray<KnowledgeGraphScopeV1>;
  }) => Effect.Effect<void, KnowledgeGraphOperationError>;
  readonly enqueueChangedNodes: (input: {
    readonly scope: KnowledgeGraphScopeV1;
    readonly changedNodeIds: ReadonlyArray<KnowledgeGraphNodeId>;
  }) => Effect.Effect<void, KnowledgeGraphOperationError>;
  readonly rebuildScope: (input: {
    readonly scope: KnowledgeGraphScopeV1;
    readonly start: boolean;
  }) => Effect.Effect<void, KnowledgeGraphOperationError>;
  readonly startEnvironment: (environmentId: EnvironmentId) => Effect.Effect<void>;
  readonly pauseEnvironment: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<void, KnowledgeGraphOperationError>;
  readonly resumeEnvironment: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<void, KnowledgeGraphOperationError>;
  readonly stopEnvironment: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<void, KnowledgeGraphOperationError>;
  readonly stopAll: Effect.Effect<void, KnowledgeGraphOperationError>;
}

function semanticModelKey(selection: ModelSelection | null): string | null {
  return selection === null ? null : stableStringify(selection);
}

export const makeKnowledgeGraphSemanticRuntime = Effect.fn("KnowledgeGraphSemanticRuntime.make")(
  function* (
    dependencies: KnowledgeGraphSemanticRuntimeDependencies,
  ): Effect.fn.Return<KnowledgeGraphSemanticRuntime, never, Scope.Scope> {
    const models = yield* Ref.make(new Map<EnvironmentId, SemanticModelState>());

    const publishOutcome = (outcome: KnowledgeGraphSemanticWorkerOutcome) => {
      if (outcome.status === "idle") return Effect.void;
      const updateStatus = dependencies.repository.getStatus(outcome.scopeId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (status) => {
              if (outcome.status === "committed") {
                const { progress: _progress, retryAt: _retryAt, ...settled } = status;
                const semanticQueueDepth = Math.max(
                  0,
                  status.semanticQueueDepth - outcome.processedJobCount,
                );
                return dependencies.repository.updateStatus({
                  ...settled,
                  state: semanticQueueDepth === 0 ? "ready" : "semantic",
                  semanticQueueDepth,
                });
              }
              const { progress: _progress, ...pending } = status;
              return dependencies.repository.updateStatus({
                ...pending,
                state:
                  outcome.status === "rate-limited" || !outcome.paused
                    ? outcome.status === "rate-limited"
                      ? "rate-limited"
                      : "semantic"
                    : "paused",
                retryAt: outcome.retryAt,
              });
            },
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("Knowledge Graph semantic status update failed", {
            scopeId: outcome.scopeId,
            cause,
          }),
        ),
      );
      if (outcome.status !== "committed") return updateStatus;
      return updateStatus.pipe(
        Effect.andThen(
          dependencies.publish({
            version: 1,
            type: "invalidate",
            scopeId: outcome.scopeId,
            reason: "revision-gap",
            expectedRevision: Math.max(0, outcome.revision - 1),
            availableRevision: outcome.revision,
          }),
        ),
      );
    };

    const scheduler: KnowledgeGraphSemanticScheduler = yield* makeKnowledgeGraphSemanticScheduler({
      runNextBatch: (environmentId) =>
        Ref.get(models).pipe(
          Effect.flatMap((current) => {
            const selection = current.get(environmentId)?.selection;
            if (selection === undefined || selection === null) {
              return Effect.succeed({ status: "idle" as const, environmentId });
            }
            return dependencies.semanticWorker.runNextBatch({
              environmentId,
              enrich: (request) => dependencies.enrich(request, selection),
            });
          }),
          Effect.tap(publishOutcome),
        ),
    });

    const semanticLifecycleError = (operation: string, detail: string) =>
      Effect.mapError(() =>
        graphError({
          operation,
          code: "persistence",
          retryable: true,
          detail,
        }),
      );

    const stopEnvironment = (environmentId: EnvironmentId) =>
      scheduler
        .stop(environmentId)
        .pipe(
          Effect.andThen(dependencies.semanticWorker.recoverEnvironment(environmentId)),
          semanticLifecycleError(
            "semantic-recover",
            "Interrupted semantic work could not be recovered after the environment stopped.",
          ),
        );

    const stopAll = scheduler.stopAll.pipe(
      Effect.andThen(dependencies.semanticWorker.recover),
      semanticLifecycleError(
        "semantic-recover",
        "Interrupted semantic work could not be recovered after semantic processing stopped.",
      ),
    );

    const enqueue = Effect.fn("KnowledgeGraphSemanticRuntime.enqueue")(function* (input: {
      readonly scope: KnowledgeGraphScopeV1;
      readonly changedNodeIds: ReadonlyArray<KnowledgeGraphNodeId>;
      readonly generation: KnowledgeGraphModelGeneration;
      readonly wake: boolean;
    }) {
      const state = yield* dependencies.repository.getDeterministicState(input.scope.scopeId).pipe(
        Effect.mapError(() =>
          graphError({
            operation: "semantic-enqueue",
            code: "persistence",
            retryable: true,
            detail: "The deterministic graph could not be prepared for semantic enrichment.",
            scopeId: input.scope.scopeId,
          }),
        ),
      );
      if (Option.isNone(state)) return;
      const nodes = buildKnowledgeGraphSemanticEnqueueNodes({
        changedNodeIds: input.changedNodeIds,
        nodes: state.value.nodes,
        edges: state.value.edges,
        evidence: state.value.evidence,
      });
      if (nodes.length === 0) return;
      yield* dependencies.semanticQueue
        .enqueueChangedNodes({
          version: 1,
          environmentId: input.scope.environmentId,
          scopeId: input.scope.scopeId,
          modelGeneration: input.generation,
          nodes,
        })
        .pipe(
          Effect.mapError(() =>
            graphError({
              operation: "semantic-enqueue",
              code: "persistence",
              retryable: true,
              detail: "Changed graph nodes could not be queued for semantic enrichment.",
              scopeId: input.scope.scopeId,
            }),
          ),
        );
      if (input.wake) yield* scheduler.wake(input.scope.environmentId);
    });

    const reconcileSelection: KnowledgeGraphSemanticRuntime["reconcileSelection"] = Effect.fn(
      "KnowledgeGraphSemanticRuntime.reconcileSelection",
    )(function* (input) {
      const currentModel = (yield* Ref.get(models)).get(input.environmentId);
      if (
        currentModel !== undefined &&
        semanticModelKey(currentModel.selection) === semanticModelKey(input.modelSelection)
      ) {
        if (input.modelSelection !== null) yield* scheduler.start(input.environmentId);
        return;
      }
      yield* stopEnvironment(input.environmentId);
      const reconciled = yield* dependencies.repository
        .reconcileSemanticModel({
          environmentId: input.environmentId,
          modelKey: semanticModelKey(input.modelSelection),
        })
        .pipe(
          Effect.mapError(() =>
            graphError({
              operation: "semantic-model",
              code: "persistence",
              retryable: true,
              detail: "The Knowledge Graph model generation could not be persisted.",
            }),
          ),
        );
      yield* Ref.update(models, (current) => {
        const next = new Map(current);
        next.set(input.environmentId, {
          selection: input.modelSelection,
          generation: reconciled.modelGeneration,
        });
        return next;
      });
      if (reconciled.changed) {
        yield* Effect.forEach(
          input.scopes,
          (scope) =>
            dependencies.semanticQueue.cancelScope(scope.scopeId).pipe(
              Effect.mapError(() =>
                graphError({
                  operation: "semantic-model",
                  code: "persistence",
                  retryable: true,
                  detail: "Stale semantic work could not be fenced after a model change.",
                  scopeId: scope.scopeId,
                }),
              ),
            ),
          { discard: true },
        );
      }
      if (input.modelSelection === null) return;
      if (reconciled.changed) {
        yield* Effect.forEach(
          input.scopes,
          (scope) =>
            dependencies.repository.getDeterministicState(scope.scopeId).pipe(
              Effect.mapError(() =>
                graphError({
                  operation: "semantic-model",
                  code: "persistence",
                  retryable: true,
                  detail: "The deterministic graph could not be read after a model change.",
                  scopeId: scope.scopeId,
                }),
              ),
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.void,
                  onSome: (state) =>
                    enqueue({
                      scope,
                      changedNodeIds: state.nodes.map(({ nodeId }) => nodeId),
                      generation: reconciled.modelGeneration,
                      wake: false,
                    }),
                }),
              ),
            ),
          { discard: true },
        );
      }
      yield* dependencies.semanticWorker.resumeEnvironment(input.environmentId).pipe(
        Effect.mapError(() =>
          graphError({
            operation: "semantic-model",
            code: "persistence",
            retryable: true,
            detail: "The semantic worker could not resume after model reconciliation.",
          }),
        ),
      );
      yield* scheduler.start(input.environmentId);
    });

    const enqueueChangedNodes: KnowledgeGraphSemanticRuntime["enqueueChangedNodes"] = (input) =>
      Ref.get(models).pipe(
        Effect.flatMap((current) => {
          const model = current.get(input.scope.environmentId);
          if (model === undefined || model.selection === null) return Effect.void;
          return enqueue({ ...input, generation: model.generation, wake: true });
        }),
      );

    const startEnvironment = (environmentId: EnvironmentId) =>
      Ref.get(models).pipe(
        Effect.flatMap((current) =>
          current.get(environmentId)?.selection === null || !current.has(environmentId)
            ? Effect.void
            : scheduler.start(environmentId),
        ),
      );

    const pauseEnvironment = (environmentId: EnvironmentId) =>
      scheduler
        .stop(environmentId)
        .pipe(
          Effect.andThen(dependencies.semanticWorker.pauseEnvironment(environmentId)),
          semanticLifecycleError(
            "semantic-pause",
            "Interrupted semantic work could not be retained while the environment paused.",
          ),
        );

    const resumeEnvironment = (environmentId: EnvironmentId) =>
      dependencies.semanticWorker
        .resumeEnvironment(environmentId)
        .pipe(
          semanticLifecycleError(
            "semantic-resume",
            "The semantic queue could not resume for the environment.",
          ),
          Effect.andThen(startEnvironment(environmentId)),
        );

    const rebuildScope = Effect.fn("KnowledgeGraphSemanticRuntime.rebuildScope")(function* (input: {
      readonly scope: KnowledgeGraphScopeV1;
      readonly start: boolean;
    }) {
      const { scope } = input;
      yield* stopEnvironment(scope.environmentId);
      yield* dependencies.semanticQueue.cancelScope(scope.scopeId).pipe(
        Effect.mapError(() =>
          graphError({
            operation: "semantic-rebuild",
            code: "persistence",
            retryable: true,
            detail: "Existing semantic work could not be cleared for rebuild.",
            scopeId: scope.scopeId,
          }),
        ),
      );
      const model = (yield* Ref.get(models)).get(scope.environmentId);
      if (model === undefined || model.selection === null) return;
      const state = yield* dependencies.repository.getDeterministicState(scope.scopeId).pipe(
        Effect.mapError(() =>
          graphError({
            operation: "semantic-rebuild",
            code: "persistence",
            retryable: true,
            detail: "The deterministic graph could not be read for semantic rebuild.",
            scopeId: scope.scopeId,
          }),
        ),
      );
      if (Option.isSome(state)) {
        yield* enqueue({
          scope,
          changedNodeIds: state.value.nodes.map(({ nodeId }) => nodeId),
          generation: model.generation,
          wake: false,
        });
      }
      if (!input.start) return;
      yield* dependencies.semanticWorker.resumeEnvironment(scope.environmentId).pipe(
        Effect.mapError(() =>
          graphError({
            operation: "semantic-rebuild",
            code: "persistence",
            retryable: true,
            detail: "The semantic worker could not resume after rebuild.",
            scopeId: scope.scopeId,
          }),
        ),
      );
      yield* scheduler.start(scope.environmentId);
    });

    return {
      reconcileSelection,
      enqueueChangedNodes,
      rebuildScope,
      startEnvironment,
      pauseEnvironment,
      resumeEnvironment,
      stopEnvironment,
      stopAll,
    };
  },
);
