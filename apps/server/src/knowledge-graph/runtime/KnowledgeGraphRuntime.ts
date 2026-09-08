import {
  type EnvironmentId,
  KnowledgeGraphOperationError,
  type KnowledgeGraphScopeId,
  type KnowledgeGraphScopeV1,
  type ModelSelection,
  resolveBetterT3FeatureFlag,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import * as OrchestrationEngine from "../../orchestration/Services/OrchestrationEngine.ts";
import * as KnowledgeGraphRepository from "../persistence/KnowledgeGraphRepository.ts";
import * as KnowledgeGraphSemanticQueueRepository from "../persistence/KnowledgeGraphSemanticQueueRepository.ts";
import * as KnowledgeGraphSemanticWorker from "../semantic/KnowledgeGraphSemanticWorker.ts";
import * as KnowledgeGraphEventHub from "./KnowledgeGraphEventHub.ts";
import * as KnowledgeGraphIndexer from "./KnowledgeGraphIndexer.ts";
import { makeKnowledgeGraphRuntimeQueries } from "./KnowledgeGraphRuntimeQueries.ts";
import * as KnowledgeGraphScopeCatalog from "./KnowledgeGraphScopeCatalog.ts";
import { makeKnowledgeGraphSemanticRuntime } from "./KnowledgeGraphSemanticRuntime.ts";
import * as KnowledgeGraphWatcherMultiplexer from "./KnowledgeGraphWatcherMultiplexer.ts";
import { graphError, KnowledgeGraphRuntime } from "./KnowledgeGraphRuntimeService.ts";

export { KnowledgeGraphRuntime } from "./KnowledgeGraphRuntimeService.ts";

interface IndexRegistration {
  readonly generation: number;
  readonly fiber: Fiber.Fiber<void, never>;
  readonly pending: KnowledgeGraphScopeV1 | null;
}

function isScopeCatalogEvent(type: string): boolean {
  return (
    type === "project.created" ||
    type === "project.meta-updated" ||
    type === "project.deleted" ||
    type === "thread.created" ||
    type === "thread.forked" ||
    type === "thread.fork-workspace-updated" ||
    type === "thread.deleted"
  );
}

export const makeKnowledgeGraphRuntime = Effect.gen(function* () {
  const parentScope = yield* Scope.Scope;
  const repository = yield* KnowledgeGraphRepository.KnowledgeGraphRepository;
  const semanticQueue =
    yield* KnowledgeGraphSemanticQueueRepository.KnowledgeGraphSemanticQueueRepository;
  const semanticWorker = yield* KnowledgeGraphSemanticWorker.KnowledgeGraphSemanticWorker;
  const catalog = yield* KnowledgeGraphScopeCatalog.KnowledgeGraphScopeCatalog;
  const watcher = yield* KnowledgeGraphWatcherMultiplexer.KnowledgeGraphWatcherMultiplexer;
  const indexer = yield* KnowledgeGraphIndexer.KnowledgeGraphIndexer;
  const eventHub = yield* KnowledgeGraphEventHub.KnowledgeGraphEventHub;
  const settings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const workspaceFiles = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const orchestration = yield* OrchestrationEngine.OrchestrationEngineService;
  const enabled = yield* Ref.make(false);
  const paused = yield* Ref.make(false);
  const generation = yield* Ref.make(0);
  const indexes = yield* Ref.make(new Map<KnowledgeGraphScopeId, IndexRegistration>());
  const indexRegistrationSemaphore = yield* Semaphore.make(1);
  const indexingSemaphore = yield* Semaphore.make(1);
  const semanticRuntime = yield* makeKnowledgeGraphSemanticRuntime({
    repository,
    semanticQueue,
    semanticWorker,
    publish: eventHub.publish,
    enrich: (request, modelSelection) =>
      textGeneration
        .enrichKnowledgeGraph({ request, modelSelection })
        .pipe(
          Effect.mapError(
            KnowledgeGraphSemanticWorker.knowledgeGraphSemanticModelErrorFromTextGeneration,
          ),
        ),
  });

  const mapPersistenceError = (operation: string, scopeId?: KnowledgeGraphScopeId) =>
    Effect.mapError(() =>
      graphError({
        operation,
        code: "persistence",
        retryable: true,
        detail: "The Knowledge Graph derived-data store is unavailable.",
        ...(scopeId === undefined ? {} : { scopeId }),
      }),
    );

  const resolveScope = (input: Parameters<KnowledgeGraphRuntime["Service"]["cancel"]>[0]) =>
    catalog.resolveScope(input).pipe(
      Effect.mapError(() =>
        graphError({
          operation: "resolve-scope",
          code: "scope-not-found",
          retryable: false,
          detail: "The requested project or worktree is not available in this environment.",
        }),
      ),
    );

  const resolveEnvironmentId = (operation: string) =>
    catalog.getEnvironmentId.pipe(
      Effect.mapError(() =>
        graphError({
          operation,
          code: "scope-not-found",
          retryable: true,
          detail: "The Knowledge Graph environment is not available.",
        }),
      ),
    );

  const requireEnabled = Effect.fn("KnowledgeGraphRuntime.requireEnabled")(function* (
    operation: string,
    scopeId?: KnowledgeGraphScopeId,
  ) {
    if (!(yield* Ref.get(enabled))) {
      return yield* graphError({
        operation,
        code: "disabled",
        retryable: false,
        detail: "Enable the Knowledge Graph in Better T3 settings before using it.",
        ...(scopeId === undefined ? {} : { scopeId }),
      });
    }
  });

  const publishStatus = Effect.fn("KnowledgeGraphRuntime.publishStatus")(function* (
    scopeId: KnowledgeGraphScopeId,
  ) {
    const status = yield* repository
      .getStatus(scopeId)
      .pipe(mapPersistenceError("status", scopeId));
    if (Option.isNone(status)) return;
    yield* eventHub.publish({
      version: 1,
      type: "status",
      scopeId,
      revision: status.value.revision,
      status: status.value,
    });
  });

  const publishIndexFailure = Effect.fn("KnowledgeGraphRuntime.publishIndexFailure")(function* (
    scope: KnowledgeGraphScopeV1,
    error: KnowledgeGraphOperationError,
  ) {
    const current = yield* repository
      .getStatus(scope.scopeId)
      .pipe(mapPersistenceError("index-failure", scope.scopeId));
    if (Option.isNone(current)) return;
    const { progress: _progress, retryAt: _retryAt, ...failed } = current.value;
    yield* repository
      .updateStatus({
        ...failed,
        state: "error",
        errorMessage: error.detail,
      })
      .pipe(mapPersistenceError("index-failure", scope.scopeId));
    yield* publishStatus(scope.scopeId);
  });

  const runIndex = Effect.fn("KnowledgeGraphRuntime.runIndex")(function* (
    scope: KnowledgeGraphScopeV1,
  ) {
    const committed = yield* indexer.indexScope(scope);
    if (Option.isNone(committed)) {
      yield* publishStatus(scope.scopeId);
      return;
    }
    const value = committed.value;
    yield* semanticRuntime.enqueueChangedNodes({
      scope,
      changedNodeIds: value.changedNodes.map(({ node }) => node.nodeId),
    });
    if (value.delivery === "patch") {
      yield* eventHub.publish(value.patch);
      return;
    }
    yield* eventHub.publish({
      version: 1,
      type: "invalidate",
      scopeId: scope.scopeId,
      reason: "revision-gap",
      expectedRevision: value.baseRevision,
      availableRevision: value.revision,
    });
  });

  const setIndexingStatus = Effect.fn("KnowledgeGraphRuntime.setIndexingStatus")(function* (
    scopeId: KnowledgeGraphScopeId,
  ) {
    const current = yield* repository
      .getStatus(scopeId)
      .pipe(mapPersistenceError("index", scopeId));
    if (Option.isNone(current)) return;
    const {
      errorMessage: _errorMessage,
      progress: _progress,
      retryAt: _retryAt,
      ...indexing
    } = current.value;
    yield* repository
      .updateStatus({ ...indexing, state: "indexing" })
      .pipe(mapPersistenceError("index", scopeId));
    yield* publishStatus(scopeId);
  });

  const releaseIndexOwnership = Effect.fn("KnowledgeGraphRuntime.releaseIndexOwnership")(function* (
    scopeId: KnowledgeGraphScopeId,
    ownedGeneration: number,
  ) {
    yield* indexRegistrationSemaphore.withPermits(1)(
      Ref.update(indexes, (registrations) => {
        if (registrations.get(scopeId)?.generation !== ownedGeneration) {
          return registrations;
        }
        const next = new Map(registrations);
        next.delete(scopeId);
        return next;
      }),
    );
  });

  const repairUnownedIndexStatus = Effect.fn("KnowledgeGraphRuntime.repairUnownedIndexStatus")(
    function* (scopeId: KnowledgeGraphScopeId, operation: string) {
      yield* indexRegistrationSemaphore.withPermits(1)(
        Effect.gen(function* () {
          if ((yield* Ref.get(indexes)).has(scopeId)) return;
          const current = yield* repository
            .getStatus(scopeId)
            .pipe(mapPersistenceError(operation, scopeId));
          if (
            Option.isNone(current) ||
            (current.value.state !== "indexing" && current.value.state !== "cancelling")
          ) {
            return;
          }
          const {
            errorMessage: _errorMessage,
            progress: _progress,
            retryAt: _retryAt,
            ...settled
          } = current.value;
          yield* repository
            .updateStatus({ ...settled, state: "idle" })
            .pipe(mapPersistenceError(operation, scopeId));
          yield* publishStatus(scopeId);
        }),
      );
    },
  );

  const publishOwnedIndexFailure = Effect.fn("KnowledgeGraphRuntime.publishOwnedIndexFailure")(
    function* (
      scope: KnowledgeGraphScopeV1,
      ownedGeneration: number,
      error: KnowledgeGraphOperationError,
    ) {
      yield* indexRegistrationSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(indexes);
          if (current.get(scope.scopeId)?.generation !== ownedGeneration) return;
          const next = new Map(current);
          next.delete(scope.scopeId);
          yield* Ref.set(indexes, next);
          yield* publishIndexFailure(scope, error);
        }),
      );
    },
  );

  const takePendingIndex = Effect.fn("KnowledgeGraphRuntime.takePendingIndex")(function* (
    scopeId: KnowledgeGraphScopeId,
    ownedGeneration: number,
  ) {
    return yield* indexRegistrationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(indexes);
        const registration = current.get(scopeId);
        if (registration?.generation !== ownedGeneration) {
          return Option.none<KnowledgeGraphScopeV1>();
        }
        const next = new Map(current);
        if (registration.pending === null) {
          next.delete(scopeId);
          yield* Ref.set(indexes, next);
          return Option.none<KnowledgeGraphScopeV1>();
        }
        next.set(scopeId, { ...registration, pending: null });
        yield* Ref.set(indexes, next);
        return Option.some(registration.pending);
      }),
    );
  });

  const runOwnedIndex = Effect.fn("KnowledgeGraphRuntime.runOwnedIndex")(function* (
    initialScope: KnowledgeGraphScopeV1,
    ownedGeneration: number,
  ) {
    let nextScope: KnowledgeGraphScopeV1 | null = initialScope;
    while (nextScope !== null) {
      const activeScope: KnowledgeGraphScopeV1 = nextScope;
      const outcome = yield* setIndexingStatus(activeScope.scopeId).pipe(
        Effect.andThen(indexingSemaphore.withPermits(1)(runIndex(activeScope))),
        Effect.result,
      );
      if (Result.isFailure(outcome)) {
        yield* publishOwnedIndexFailure(activeScope, ownedGeneration, outcome.failure).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Knowledge Graph index failure status could not be persisted", {
              scopeId: activeScope.scopeId,
              cause,
            }),
          ),
          Effect.andThen(
            Effect.logWarning("Knowledge Graph indexing failed", {
              scopeId: activeScope.scopeId,
              error: outcome.failure.message,
            }),
          ),
        );
        return;
      }
      const pending: Option.Option<KnowledgeGraphScopeV1> = yield* takePendingIndex(
        activeScope.scopeId,
        ownedGeneration,
      );
      if (Option.isNone(pending)) {
        yield* repairUnownedIndexStatus(activeScope.scopeId, "index-complete");
        return;
      }
      nextScope = pending.value;
    }
  });

  const scheduleIndex = Effect.fn("KnowledgeGraphRuntime.scheduleIndex")(function* (
    scope: KnowledgeGraphScopeV1,
  ) {
    yield* indexRegistrationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        if (!(yield* Ref.get(enabled)) || (yield* Ref.get(paused))) return;
        const current = yield* Ref.get(indexes);
        const existing = current.get(scope.scopeId);
        if (existing !== undefined) {
          const next = new Map(current);
          next.set(scope.scopeId, { ...existing, pending: scope });
          yield* Ref.set(indexes, next);
          return;
        }
        const nextGeneration = yield* Ref.updateAndGet(generation, (value) => value + 1);
        const start = yield* Deferred.make<void>();
        const task = Deferred.await(start).pipe(
          Effect.andThen(runOwnedIndex(scope, nextGeneration)),
          Effect.catch((error) =>
            Effect.logWarning("Knowledge Graph index completion could not be settled", {
              scopeId: scope.scopeId,
              error: error.message,
            }),
          ),
          Effect.ensuring(releaseIndexOwnership(scope.scopeId, nextGeneration)),
        );
        const fiber = yield* task.pipe(Effect.forkIn(parentScope));
        const next = new Map(yield* Ref.get(indexes));
        next.set(scope.scopeId, { generation: nextGeneration, fiber, pending: null });
        yield* Ref.set(indexes, next);
        yield* Deferred.succeed(start, undefined);
      }),
    );
  });

  const cancelIndex = Effect.fn("KnowledgeGraphRuntime.cancelIndex")(function* (
    scopeId: KnowledgeGraphScopeId,
  ) {
    const registration = yield* indexRegistrationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(indexes);
        const registration = current.get(scopeId);
        if (registration === undefined) return Option.none<IndexRegistration>();
        const next = new Map(current);
        next.delete(scopeId);
        yield* Ref.set(indexes, next);
        return Option.some(registration);
      }),
    );
    if (Option.isSome(registration)) yield* Fiber.interrupt(registration.value.fiber);
  });

  const cancelAllIndexes = Effect.gen(function* () {
    const current = yield* indexRegistrationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.getAndSet(indexes, new Map());
        return [...current.values()];
      }),
    );
    yield* Effect.forEach(current, ({ fiber }) => Fiber.interrupt(fiber), {
      discard: true,
    });
  });

  const reconcileKnownScopes = Effect.fn("KnowledgeGraphRuntime.reconcileKnownScopes")(function* (
    indexAll: boolean,
  ) {
    if (!(yield* Ref.get(enabled)) || (yield* Ref.get(paused))) return;
    const scopes = yield* catalog.listKnownScopes().pipe(
      Effect.mapError(() =>
        graphError({
          operation: "activate",
          code: "scope-not-found",
          retryable: true,
          detail: "Registered projects could not be resolved for indexing.",
        }),
      ),
    );
    const environmentId = yield* resolveEnvironmentId("activate");
    const persisted = yield* repository
      .listScopes(environmentId)
      .pipe(mapPersistenceError("activate"));
    const persistedIds = new Set(persisted.map(({ scopeId }) => scopeId));
    yield* watcher.reconcile(scopes, (changedScopes) =>
      Effect.forEach(changedScopes, scheduleIndex, { discard: true }),
    );
    yield* Effect.forEach(
      scopes,
      (scope) =>
        repository.ensureScope(scope).pipe(
          mapPersistenceError("activate", scope.scopeId),
          Effect.andThen(repairUnownedIndexStatus(scope.scopeId, "activate")),
          Effect.andThen(
            repository
              .getStatus(scope.scopeId)
              .pipe(mapPersistenceError("activate", scope.scopeId)),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (status) => {
                if (status.state !== "disabled") return Effect.void;
                const {
                  errorMessage: _errorMessage,
                  progress: _progress,
                  retryAt: _retryAt,
                  ...reenabled
                } = status;
                return repository
                  .updateStatus({ ...reenabled, state: "idle" })
                  .pipe(
                    mapPersistenceError("activate", scope.scopeId),
                    Effect.andThen(publishStatus(scope.scopeId)),
                  );
              },
            }),
          ),
          Effect.andThen(
            indexAll || !persistedIds.has(scope.scopeId) ? scheduleIndex(scope) : Effect.void,
          ),
        ),
      { discard: true },
    );
    const currentSettings = yield* settings.getSettings.pipe(
      Effect.mapError(() =>
        graphError({
          operation: "semantic-model",
          code: "persistence",
          retryable: true,
          detail: "Knowledge Graph model settings could not be read.",
        }),
      ),
    );
    yield* semanticRuntime.reconcileSelection({
      environmentId,
      modelSelection: currentSettings.knowledgeGraphModelSelection,
      scopes,
    });
  });

  const deactivate = Effect.gen(function* () {
    yield* Ref.set(enabled, false);
    yield* watcher.clear;
    yield* cancelAllIndexes;
    yield* semanticRuntime.stopAll;
    const environmentId = yield* resolveEnvironmentId("deactivate");
    const scopes = yield* repository.listScopes(environmentId);
    yield* Effect.forEach(
      scopes,
      (scope) =>
        repository.getStatus(scope.scopeId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (status) =>
                repository
                  .updateStatus({ ...status, state: "disabled" })
                  .pipe(Effect.andThen(publishStatus(scope.scopeId))),
            }),
          ),
        ),
      { discard: true },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Knowledge Graph deactivation failed", { cause }),
    ),
  );

  const applyEnabledSetting = Effect.fn("KnowledgeGraphRuntime.applyEnabledSetting")(function* (
    nextEnabled: boolean,
  ) {
    const wasEnabled = yield* Ref.get(enabled);
    if (nextEnabled === wasEnabled) return;
    if (!nextEnabled) return yield* deactivate;
    yield* Ref.set(enabled, true);
    yield* reconcileKnownScopes(true);
  });

  const { subscribe, query, queryForThread, nodeContent } = makeKnowledgeGraphRuntimeQueries({
    repository,
    catalog,
    eventHub,
    workspaceFiles,
    resolveScope,
    requireEnabled,
  });

  const rebuild: KnowledgeGraphRuntime["Service"]["rebuild"] = Effect.fn(
    "KnowledgeGraphRuntime.rebuild",
  )(function* (input) {
    const scope = yield* resolveScope(input.scope);
    yield* requireEnabled("rebuild", scope.scopeId);
    if (input.mode === "semantic") {
      yield* semanticRuntime.rebuildScope({
        scope,
        start: !(yield* Ref.get(paused)),
      });
      const status = yield* repository
        .getStatus(scope.scopeId)
        .pipe(mapPersistenceError("rebuild", scope.scopeId));
      return {
        version: 1,
        accepted: true,
        ...(Option.isSome(status) ? { status: status.value } : {}),
      };
    }
    if (input.mode === "full") {
      const previous = yield* repository
        .getStatus(scope.scopeId)
        .pipe(mapPersistenceError("rebuild", scope.scopeId));
      yield* cancelIndex(scope.scopeId);
      yield* semanticRuntime.stopEnvironment(scope.environmentId);
      yield* semanticQueue.clearScope(scope.scopeId).pipe(
        Effect.mapError(() =>
          graphError({
            operation: "rebuild",
            code: "persistence",
            retryable: true,
            detail: "The semantic queue could not be cleared.",
            scopeId: scope.scopeId,
          }),
        ),
      );
      yield* repository
        .clearScope(scope.scopeId)
        .pipe(mapPersistenceError("rebuild", scope.scopeId));
      yield* repository.ensureScope(scope).pipe(mapPersistenceError("rebuild", scope.scopeId));
      yield* eventHub.publish({
        version: 1,
        type: "invalidate",
        scopeId: scope.scopeId,
        reason: "rebuild",
        expectedRevision: Option.isSome(previous) ? previous.value.revision : 0,
        availableRevision: 0,
      });
    }
    yield* scheduleIndex(scope);
    if (!(yield* Ref.get(paused))) {
      yield* semanticRuntime.startEnvironment(scope.environmentId);
    }
    const status = yield* repository
      .getStatus(scope.scopeId)
      .pipe(mapPersistenceError("rebuild", scope.scopeId));
    return {
      version: 1,
      accepted: true,
      ...(Option.isSome(status) ? { status: status.value } : {}),
    };
  });

  const cancel: KnowledgeGraphRuntime["Service"]["cancel"] = Effect.fn(
    "KnowledgeGraphRuntime.cancel",
  )(function* (input) {
    const scope = yield* resolveScope(input);
    yield* requireEnabled("cancel", scope.scopeId);
    yield* cancelIndex(scope.scopeId);
    yield* semanticRuntime.stopEnvironment(scope.environmentId);
    yield* semanticQueue.cancelScope(scope.scopeId).pipe(
      Effect.mapError(() =>
        graphError({
          operation: "cancel",
          code: "persistence",
          retryable: true,
          detail: "Owned semantic work could not be cancelled.",
          scopeId: scope.scopeId,
        }),
      ),
    );
    const status = yield* repository
      .getStatus(scope.scopeId)
      .pipe(mapPersistenceError("cancel", scope.scopeId));
    if (Option.isSome(status)) {
      const {
        errorMessage: _errorMessage,
        progress: _progress,
        retryAt: _retryAt,
        ...settled
      } = status.value;
      yield* repository
        .updateStatus({ ...settled, state: "idle" })
        .pipe(mapPersistenceError("cancel", scope.scopeId));
      yield* publishStatus(scope.scopeId);
    }
    if (!(yield* Ref.get(paused))) {
      yield* semanticRuntime.startEnvironment(scope.environmentId);
    }
    const current = yield* repository
      .getStatus(scope.scopeId)
      .pipe(mapPersistenceError("cancel", scope.scopeId));
    return {
      version: 1,
      accepted: true,
      ...(Option.isSome(current) ? { status: current.value } : {}),
    };
  });

  const setScopesState = Effect.fn("KnowledgeGraphRuntime.setScopesState")(function* (
    environmentId: EnvironmentId,
    state: "paused" | "idle",
  ): Effect.fn.Return<void, KnowledgeGraphOperationError> {
    const scopes = yield* repository.listScopes(environmentId).pipe(mapPersistenceError("pause"));
    yield* Effect.forEach(
      scopes,
      (scope) =>
        repository.getStatus(scope.scopeId).pipe(
          mapPersistenceError("pause", scope.scopeId),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (status) => {
                if (state === "paused") {
                  return repository
                    .updateStatus({ ...status, state })
                    .pipe(
                      mapPersistenceError("pause", scope.scopeId),
                      Effect.andThen(publishStatus(scope.scopeId)),
                    );
                }
                const {
                  errorMessage: _errorMessage,
                  progress: _progress,
                  retryAt: _retryAt,
                  ...resumed
                } = status;
                return repository
                  .updateStatus({ ...resumed, state })
                  .pipe(
                    mapPersistenceError("pause", scope.scopeId),
                    Effect.andThen(publishStatus(scope.scopeId)),
                  );
              },
            }),
          ),
        ),
      { discard: true },
    );
  });

  const pause: KnowledgeGraphRuntime["Service"]["pause"] = Effect.fn("KnowledgeGraphRuntime.pause")(
    function* (input) {
      const scope = yield* resolveScope(input.scope);
      yield* requireEnabled("pause", scope.scopeId);
      if (input.paused) {
        yield* Ref.set(paused, true);
        yield* watcher.clear;
        yield* cancelAllIndexes;
        yield* semanticRuntime.pauseEnvironment(scope.environmentId);
        yield* setScopesState(scope.environmentId, "paused");
      } else {
        yield* semanticRuntime.resumeEnvironment(scope.environmentId);
        yield* Ref.set(paused, false);
        yield* setScopesState(scope.environmentId, "idle");
        yield* reconcileKnownScopes(true);
      }
      const status = yield* repository
        .getStatus(scope.scopeId)
        .pipe(mapPersistenceError("pause", scope.scopeId));
      return {
        version: 1,
        accepted: true,
        ...(Option.isSome(status) ? { status: status.value } : {}),
      };
    },
  );

  const clear: KnowledgeGraphRuntime["Service"]["clear"] = Effect.fn("KnowledgeGraphRuntime.clear")(
    function* (input) {
      if (input.target === "scope") {
        const scope = yield* resolveScope(input.scope);
        const previous = yield* repository
          .getStatus(scope.scopeId)
          .pipe(mapPersistenceError("clear", scope.scopeId));
        yield* cancelIndex(scope.scopeId);
        yield* semanticRuntime.stopEnvironment(scope.environmentId);
        yield* semanticQueue.clearScope(scope.scopeId).pipe(
          Effect.mapError(() =>
            graphError({
              operation: "clear",
              code: "persistence",
              retryable: true,
              detail: "The semantic queue could not be cleared.",
              scopeId: scope.scopeId,
            }),
          ),
        );
        yield* repository
          .clearScope(scope.scopeId)
          .pipe(mapPersistenceError("clear", scope.scopeId));
        yield* eventHub.publish({
          version: 1,
          type: "invalidate",
          scopeId: scope.scopeId,
          reason: "cleared",
          expectedRevision: Option.isSome(previous) ? previous.value.revision : 0,
          availableRevision: 0,
        });
        if ((yield* Ref.get(enabled)) && !(yield* Ref.get(paused))) {
          yield* semanticRuntime.startEnvironment(scope.environmentId);
        }
        return { version: 1, accepted: true };
      }
      const environmentId = yield* resolveEnvironmentId("clear");
      const persisted = yield* repository
        .listScopes(environmentId)
        .pipe(mapPersistenceError("clear"));
      const invalidations = yield* Effect.forEach(persisted, (scope) =>
        repository.getStatus(scope.scopeId).pipe(
          mapPersistenceError("clear", scope.scopeId),
          Effect.map((current) => ({
            scopeId: scope.scopeId,
            expectedRevision: Option.isSome(current) ? current.value.revision : 0,
          })),
        ),
      );
      yield* cancelAllIndexes;
      yield* semanticRuntime.stopEnvironment(environmentId);
      yield* Effect.forEach(
        persisted,
        (scope) =>
          semanticQueue.clearScope(scope.scopeId).pipe(
            Effect.mapError(() =>
              graphError({
                operation: "clear",
                code: "persistence",
                retryable: true,
                detail: "The semantic queue could not be cleared.",
                scopeId: scope.scopeId,
              }),
            ),
          ),
        { discard: true },
      );
      yield* repository.clearEnvironment(environmentId).pipe(mapPersistenceError("clear"));
      yield* Effect.forEach(
        invalidations,
        (invalidation) =>
          eventHub.publish({
            version: 1,
            type: "invalidate",
            scopeId: invalidation.scopeId,
            reason: "cleared",
            expectedRevision: invalidation.expectedRevision,
            availableRevision: 0,
          }),
        { discard: true },
      );
      return { version: 1, accepted: true };
    },
  );

  const reconcileSemanticSettings = Effect.fn("KnowledgeGraphRuntime.reconcileSemanticSettings")(
    function* (next: { readonly knowledgeGraphModelSelection: ModelSelection | null }) {
      if (!(yield* Ref.get(enabled)) || (yield* Ref.get(paused))) return;
      const scopes = yield* catalog.listKnownScopes().pipe(
        Effect.mapError(() =>
          graphError({
            operation: "semantic-model",
            code: "scope-not-found",
            retryable: true,
            detail: "Registered graph scopes could not be resolved after a model change.",
          }),
        ),
      );
      const environmentId = yield* resolveEnvironmentId("semantic-model");
      yield* semanticRuntime.reconcileSelection({
        environmentId,
        modelSelection: next.knowledgeGraphModelSelection,
        scopes,
      });
    },
  );

  yield* Effect.addFinalizer(() =>
    Ref.set(enabled, false).pipe(
      Effect.andThen(watcher.clear),
      Effect.andThen(cancelAllIndexes),
      Effect.andThen(semanticRuntime.stopAll),
      Effect.catchCause((cause) =>
        Effect.logWarning("Knowledge Graph shutdown recovery failed", { cause }),
      ),
    ),
  );
  yield* semanticWorker.recover.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Knowledge Graph semantic recovery failed", { cause }),
    ),
  );
  const initialSettings = yield* settings.getSettings;
  const initialEnabled = resolveBetterT3FeatureFlag(
    initialSettings.betterT3Environment,
    "knowledge.graph",
  );
  yield* Ref.set(enabled, initialEnabled);
  if (initialEnabled) {
    const environmentId = yield* resolveEnvironmentId("startup");
    const queueStatus = yield* semanticQueue.getStatus(environmentId).pipe(
      Effect.orElseSucceed(() => ({
        environmentId,
        queuedCount: 0,
        runningCount: 0,
        paused: false,
        rateLimitedUntil: null,
      })),
    );
    yield* Ref.set(paused, queueStatus.paused);
    if (queueStatus.paused) {
      yield* setScopesState(environmentId, "paused").pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Knowledge Graph paused status recovery failed", { cause }),
        ),
      );
    } else {
      yield* reconcileKnownScopes(true).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Knowledge Graph startup indexing failed", { cause }),
        ),
      );
    }
  }
  yield* settings.streamChanges.pipe(
    Stream.runForEach((next) =>
      applyEnabledSetting(
        resolveBetterT3FeatureFlag(next.betterT3Environment, "knowledge.graph"),
      ).pipe(
        Effect.andThen(reconcileSemanticSettings(next)),
        Effect.catchCause((cause) =>
          Effect.logWarning("Knowledge Graph setting reconciliation failed", { cause }),
        ),
      ),
    ),
    Effect.forkIn(parentScope),
  );
  yield* orchestration.streamDomainEvents.pipe(
    Stream.filter((event) => isScopeCatalogEvent(event.type)),
    Stream.debounce("100 millis"),
    Stream.runForEach(() =>
      reconcileKnownScopes(false).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Knowledge Graph project reconciliation failed", { cause }),
        ),
      ),
    ),
    Effect.forkIn(parentScope),
  );

  return KnowledgeGraphRuntime.of({
    subscribe,
    query,
    queryForThread,
    nodeContent,
    rebuild,
    cancel,
    pause,
    clear,
  });
});

export const layer = Layer.effect(KnowledgeGraphRuntime, makeKnowledgeGraphRuntime);
