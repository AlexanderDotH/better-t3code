import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  KnowledgeGraphNodeId,
  KnowledgeGraphOperationError,
  KnowledgeGraphScopeId,
  type KnowledgeGraphScopeV1,
  type KnowledgeGraphStatusV1,
  type KnowledgeGraphStreamEvent,
  makeBetterT3SettingsV1,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as OrchestrationEngine from "../../orchestration/Services/OrchestrationEngine.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import * as KnowledgeGraphRepository from "../persistence/KnowledgeGraphRepository.ts";
import * as KnowledgeGraphEventHub from "./KnowledgeGraphEventHub.ts";
import * as KnowledgeGraphIndexer from "./KnowledgeGraphIndexer.ts";
import { makeKnowledgeGraphRuntime } from "./KnowledgeGraphRuntime.ts";
import * as KnowledgeGraphScopeCatalog from "./KnowledgeGraphScopeCatalog.ts";
import * as KnowledgeGraphWatcherMultiplexer from "./KnowledgeGraphWatcherMultiplexer.ts";

const environmentId = EnvironmentId.make("environment-runtime");
const projectId = ProjectId.make("project-runtime");
const threadId = ThreadId.make("thread-runtime");
const scope: KnowledgeGraphScopeV1 = {
  version: 1,
  scopeId: KnowledgeGraphScopeId.make("scope-runtime"),
  environmentId,
  projectId,
  effectiveWorkspaceRoot: "/workspace/runtime",
  isWorktree: false,
};
const worktreeScope: KnowledgeGraphScopeV1 = {
  ...scope,
  scopeId: KnowledgeGraphScopeId.make("scope-runtime-worktree"),
  effectiveWorkspaceRoot: "/workspace/runtime-worktree",
  isWorktree: true,
};

function status(state: KnowledgeGraphStatusV1["state"]): KnowledgeGraphStatusV1 {
  return {
    version: 1,
    scopeId: scope.scopeId,
    state,
    revision: 0,
    indexedFileCount: 0,
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
}

function serviceStub<T extends object>(overrides: Partial<T>): T {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      throw new Error(`Unexpected Knowledge Graph test service access: ${String(property)}`);
    },
  }) as T;
}

const makeRuntimeHarness = (
  knownScopes: ReadonlyArray<KnowledgeGraphScopeV1> = [scope],
  initiallyPersistedScopes: ReadonlyArray<KnowledgeGraphScopeV1> = knownScopes,
  indexScopeOverride?: KnowledgeGraphIndexer.KnowledgeGraphIndexerShape["indexScope"],
  initialStatusState: KnowledgeGraphStatusV1["state"] = "ready",
) =>
  Effect.gen(function* () {
    const settingsChanges = yield* Queue.unbounded<typeof DEFAULT_SERVER_SETTINGS>();
    const idleStatuses = yield* Queue.unbounded<void>();
    const indexed = yield* Ref.make(0);
    const indexedScopeIds = yield* Ref.make<ReadonlyArray<string>>([]);
    const clearedGraphScopes = yield* Ref.make<ReadonlyArray<string>>([]);
    const clearedEnvironments = yield* Ref.make<ReadonlyArray<string>>([]);
    const watcherClears = yield* Ref.make(0);
    const watcherReconciles = yield* Ref.make(0);
    const publishedEvents = yield* Ref.make<ReadonlyArray<KnowledgeGraphStreamEvent>>([]);
    const disabledCount = yield* Ref.make(0);
    const disabled = yield* Deferred.make<void>();
    const initialIndexed = yield* Deferred.make<void>();
    const initialIndexSettled = yield* Deferred.make<void>();
    const indexFailed = yield* Deferred.make<void>();
    const reindexed = yield* Deferred.make<void>();
    const reindexedSettled = yield* Deferred.make<void>();
    const incrementalIndexed = yield* Deferred.make<void>();
    const currentStatus = yield* Ref.make(status(initialStatusState));
    const persistedScopes =
      yield* Ref.make<ReadonlyArray<KnowledgeGraphScopeV1>>(initiallyPersistedScopes);
    const failNextStatusRead = yield* Ref.make(false);
    type WatchChangeHandler = Parameters<
      KnowledgeGraphWatcherMultiplexer.KnowledgeGraphWatcherMultiplexerShape["reconcile"]
    >[1];
    const watcherChangeHandler = yield* Ref.make<WatchChangeHandler | null>(null);
    const enabledSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      betterT3Environment: makeBetterT3SettingsV1("clean-install", {
        "knowledge.graph": true,
      }),
    };
    const disabledSettings = {
      ...enabledSettings,
      betterT3Environment: makeBetterT3SettingsV1("clean-install", {
        "knowledge.graph": false,
      }),
    };

    const repository = serviceStub<KnowledgeGraphRepository.KnowledgeGraphRepository["Service"]>({
      ensureScope: (nextScope) => Effect.succeed(nextScope),
      getStatus: (scopeId) =>
        Ref.getAndSet(failNextStatusRead, false).pipe(
          Effect.flatMap((shouldFail) =>
            shouldFail
              ? Effect.fail(
                  new KnowledgeGraphRepository.KnowledgeGraphRepositoryError({
                    operation: "get-status",
                    reason: "query-failed",
                  }),
                )
              : Ref.get(currentStatus).pipe(
                  Effect.map((current) => Option.some({ ...current, scopeId })),
                ),
          ),
        ),
      listScopes: () => Ref.get(persistedScopes),
      clearEnvironment: (nextEnvironmentId) =>
        Ref.update(clearedEnvironments, (current) => [...current, String(nextEnvironmentId)]),
      clearScope: (scopeId) =>
        Ref.update(clearedGraphScopes, (current) => [...current, String(scopeId)]),
      updateStatus: (next) =>
        Ref.set(currentStatus, next).pipe(
          Effect.andThen(
            next.state === "idle" ? Queue.offer(idleStatuses, undefined) : Effect.void,
          ),
          Effect.andThen(
            next.state === "disabled"
              ? Ref.updateAndGet(disabledCount, (count) => count + 1).pipe(
                  Effect.flatMap((count) =>
                    count >= initiallyPersistedScopes.length
                      ? Deferred.succeed(disabled, undefined)
                      : Effect.void,
                  ),
                )
              : Effect.void,
          ),
          Effect.andThen(
            next.state === "error" ? Deferred.succeed(indexFailed, undefined) : Effect.void,
          ),
          Effect.andThen(
            next.state !== "indexing"
              ? Ref.get(indexed).pipe(
                  Effect.flatMap((count) =>
                    Effect.all(
                      [
                        count >= knownScopes.length
                          ? Deferred.succeed(initialIndexSettled, undefined)
                          : Effect.void,
                        count >= knownScopes.length * 2
                          ? Deferred.succeed(reindexedSettled, undefined)
                          : Effect.void,
                      ],
                      { discard: true },
                    ),
                  ),
                )
              : Effect.void,
          ),
          Effect.asVoid,
        ),
    });
    const catalog = KnowledgeGraphScopeCatalog.KnowledgeGraphScopeCatalog.of({
      getEnvironmentId: Effect.succeed(environmentId),
      resolveScope: () => Effect.succeed(scope),
      resolveThread: () => Effect.succeed({ projectId, scope }),
      listKnownScopes: () => Effect.succeed(knownScopes),
    });
    const watcher = KnowledgeGraphWatcherMultiplexer.KnowledgeGraphWatcherMultiplexer.of({
      reconcile: (_scopes, onChange) =>
        Ref.set(watcherChangeHandler, onChange).pipe(
          Effect.andThen(Ref.update(watcherReconciles, (count) => count + 1)),
        ),
      clear: Ref.update(watcherClears, (count) => count + 1),
      watchedRoots: Effect.succeed([scope.effectiveWorkspaceRoot]),
    });
    const indexer = KnowledgeGraphIndexer.KnowledgeGraphIndexer.of({
      indexScope:
        indexScopeOverride ??
        ((indexedScope) =>
          Ref.update(indexedScopeIds, (current) => [...current, String(indexedScope.scopeId)]).pipe(
            Effect.andThen(Ref.updateAndGet(indexed, (count) => count + 1)),
            Effect.tap((count) =>
              Effect.all(
                [
                  count >= knownScopes.length
                    ? Deferred.succeed(initialIndexed, undefined)
                    : Effect.void,
                  count >= knownScopes.length * 2
                    ? Deferred.succeed(reindexed, undefined)
                    : Effect.void,
                  count >= knownScopes.length + 1
                    ? Deferred.succeed(incrementalIndexed, undefined)
                    : Effect.void,
                ],
                { discard: true },
              ),
            ),
            Effect.as(Option.none()),
          )),
    });
    const eventHub = KnowledgeGraphEventHub.KnowledgeGraphEventHub.of({
      publish: (event) => Ref.update(publishedEvents, (current) => [...current, event]),
      subscribe: () => Effect.succeed(Stream.never),
    });
    const settings = ServerSettings.ServerSettingsService.of(
      serviceStub<ServerSettings.ServerSettingsService["Service"]>({
        getSettings: Effect.succeed(enabledSettings),
        streamChanges: Stream.fromQueue(settingsChanges),
      }),
    );
    const workspaceFiles = WorkspaceFileSystem.WorkspaceFileSystem.of(
      serviceStub<WorkspaceFileSystem.WorkspaceFileSystem["Service"]>({
        readFile: () => Effect.die("node content is not used in this test"),
      }),
    );
    const orchestration = OrchestrationEngine.OrchestrationEngineService.of(
      serviceStub<OrchestrationEngine.OrchestrationEngineService["Service"]>({
        streamDomainEvents: Stream.never,
      }),
    );

    const runtime = yield* makeKnowledgeGraphRuntime.pipe(
      Effect.provideService(KnowledgeGraphRepository.KnowledgeGraphRepository, repository),
      Effect.provideService(KnowledgeGraphScopeCatalog.KnowledgeGraphScopeCatalog, catalog),
      Effect.provideService(
        KnowledgeGraphWatcherMultiplexer.KnowledgeGraphWatcherMultiplexer,
        watcher,
      ),
      Effect.provideService(KnowledgeGraphIndexer.KnowledgeGraphIndexer, indexer),
      Effect.provideService(KnowledgeGraphEventHub.KnowledgeGraphEventHub, eventHub),
      Effect.provideService(ServerSettings.ServerSettingsService, settings),
      Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, workspaceFiles),
      Effect.provideService(OrchestrationEngine.OrchestrationEngineService, orchestration),
    );

    return {
      runtime,
      settingsChanges,
      idleStatuses,
      enabledSettings,
      disabledSettings,
      currentStatus,
      indexedScopeIds,
      persistedScopes,
      failNextStatusRead,
      clearedGraphScopes,
      clearedEnvironments,
      watcherClears,
      watcherReconciles,
      watcherChangeHandler,
      publishedEvents,
      disabled,
      initialIndexed,
      initialIndexSettled,
      indexFailed,
      reindexed,
      reindexedSettled,
      incrementalIndexed,
    };
  });

it.effect("feature-off stops indexing and re-enables all registered scopes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeRuntimeHarness([scope, worktreeScope]);
      yield* Deferred.await(harness.initialIndexed);
      assert.deepStrictEqual(yield* Ref.get(harness.indexedScopeIds), [
        String(scope.scopeId),
        String(worktreeScope.scopeId),
      ]);

      yield* Queue.offer(harness.settingsChanges, harness.disabledSettings);
      yield* Deferred.await(harness.disabled);

      assert.strictEqual(yield* Ref.get(harness.watcherClears), 1);

      yield* Queue.offer(harness.settingsChanges, harness.enabledSettings);
      yield* Deferred.await(harness.reindexed);
      yield* Deferred.await(harness.reindexedSettled);
      assert.strictEqual((yield* Ref.get(harness.currentStatus)).state, "idle");
      assert.deepStrictEqual(yield* Ref.get(harness.indexedScopeIds), [
        String(scope.scopeId),
        String(worktreeScope.scopeId),
        String(scope.scopeId),
        String(worktreeScope.scopeId),
      ]);
    }),
  ),
);

it.effect("blocks every activating RPC while disabled but leaves destructive clear available", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeRuntimeHarness();
      yield* Deferred.await(harness.initialIndexed);
      yield* Queue.offer(harness.settingsChanges, harness.disabledSettings);
      yield* Deferred.await(harness.disabled);
      const scopeInput = { projectId, threadId };
      const attempts = [
        ["subscribe", harness.runtime.subscribe({ scope: scopeInput })],
        [
          "query",
          harness.runtime.query({
            scope: scopeInput,
            queries: [{ id: "overview", type: "overview" }],
          }),
        ],
        [
          "node-content",
          harness.runtime.nodeContent({
            scope: scopeInput,
            nodeId: KnowledgeGraphNodeId.make("node-disabled"),
          }),
        ],
        ["rebuild", harness.runtime.rebuild({ scope: scopeInput, mode: "incremental" })],
        ["cancel", harness.runtime.cancel(scopeInput)],
        ["pause", harness.runtime.pause({ scope: scopeInput, paused: true })],
      ] as const;

      for (const [operation, attempt] of attempts) {
        const error = yield* Effect.asVoid<unknown, KnowledgeGraphOperationError, Scope.Scope>(
          attempt,
        ).pipe(Effect.flip);
        assert.instanceOf(error, KnowledgeGraphOperationError);
        assert.strictEqual(error.operation, operation);
        assert.strictEqual(error.code, "disabled");
        assert.strictEqual(error.scopeId, scope.scopeId);
      }

      const cleared = yield* harness.runtime.clear({ target: "scope", scope: scopeInput });
      assert.isTrue(cleared.accepted);
      assert.deepStrictEqual(yield* Ref.get(harness.clearedGraphScopes), [String(scope.scopeId)]);
    }),
  ),
);

it.effect("clears stale failure metadata when a disabled scope is re-enabled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeRuntimeHarness();
      yield* Ref.set(harness.currentStatus, {
        ...status("error"),
        errorMessage: "Previous extraction failed.",
        retryAt: 1_788_000_000_000,
      });

      yield* Queue.offer(harness.settingsChanges, harness.disabledSettings);
      yield* Deferred.await(harness.disabled);
      yield* Queue.offer(harness.settingsChanges, harness.enabledSettings);
      yield* Deferred.await(harness.reindexed);
      yield* Deferred.await(harness.reindexedSettled);

      const reenabled = yield* Ref.get(harness.currentStatus);
      assert.strictEqual(reenabled.state, "idle");
      assert.notProperty(reenabled, "errorMessage");
      assert.notProperty(reenabled, "retryAt");
    }),
  ),
);

it.effect("manual pause stops indexing and explicit cancellation settles only that scope", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeRuntimeHarness();
      const scopeInput = { projectId, threadId };
      yield* Ref.set(harness.currentStatus, {
        ...status("indexing"),
        errorMessage: "Interrupted extraction.",
        retryAt: 1_788_000_000_000,
        progress: {
          version: 1,
          phase: "extracting",
          discoveredFileCount: 12,
          processedFileCount: 4,
          queuedSemanticNodeCount: 0,
        },
      });

      yield* harness.runtime.pause({ scope: scopeInput, paused: true });
      assert.strictEqual((yield* Ref.get(harness.currentStatus)).state, "paused");
      assert.strictEqual(yield* Ref.get(harness.watcherClears), 1);

      yield* harness.runtime.pause({ scope: scopeInput, paused: false });
      const resumedStatus = yield* Ref.get(harness.currentStatus);
      assert.strictEqual(resumedStatus.state, "idle");
      assert.notProperty(resumedStatus, "errorMessage");
      assert.notProperty(resumedStatus, "progress");
      assert.notProperty(resumedStatus, "retryAt");

      yield* Ref.set(harness.currentStatus, {
        ...status("error"),
        errorMessage: "Cancelled source extraction.",
        retryAt: 1_788_000_000_000,
      });
      yield* harness.runtime.cancel(scopeInput);
      const cancelledStatus = yield* Ref.get(harness.currentStatus);
      assert.strictEqual(cancelledStatus.state, "idle");
      assert.notProperty(cancelledStatus, "errorMessage");
      assert.notProperty(cancelledStatus, "retryAt");
    }),
  ),
);

it.effect("all rebuild modes reindex without clearing the published revision", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const scopeInput = { projectId, threadId };

      const incremental = yield* makeRuntimeHarness();
      yield* Deferred.await(incremental.initialIndexed);
      const incrementalResult = yield* incremental.runtime.rebuild({
        scope: scopeInput,
        mode: "incremental",
      });
      yield* Deferred.await(incremental.reindexed);
      assert.isTrue(incrementalResult.accepted);
      assert.deepStrictEqual(yield* Ref.get(incremental.indexedScopeIds), [
        String(scope.scopeId),
        String(scope.scopeId),
      ]);
      assert.deepStrictEqual(yield* Ref.get(incremental.clearedGraphScopes), []);

      const semantic = yield* makeRuntimeHarness();
      yield* Deferred.await(semantic.initialIndexed);
      const semanticResult = yield* semantic.runtime.rebuild({
        scope: scopeInput,
        mode: "semantic",
      });
      assert.isTrue(semanticResult.accepted);
      yield* Deferred.await(semantic.reindexed);
      assert.deepStrictEqual(yield* Ref.get(semantic.indexedScopeIds), [
        String(scope.scopeId),
        String(scope.scopeId),
      ]);
      assert.deepStrictEqual(yield* Ref.get(semantic.clearedGraphScopes), []);

      const full = yield* makeRuntimeHarness();
      yield* Deferred.await(full.initialIndexed);
      yield* Ref.set(full.currentStatus, { ...status("ready"), revision: 7 });
      const fullResult = yield* full.runtime.rebuild({ scope: scopeInput, mode: "full" });
      yield* Deferred.await(full.reindexed);
      assert.isTrue(fullResult.accepted);
      assert.deepStrictEqual(yield* Ref.get(full.clearedGraphScopes), []);
      assert.strictEqual((yield* Ref.get(full.currentStatus)).revision, 7);
      assert.isUndefined(
        (yield* Ref.get(full.publishedEvents)).find(
          (event) => event.type === "invalidate" && event.reason === "rebuild",
        ),
      );
    }),
  ),
);

it.effect("maps an activation status-read failure at the pause RPC boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeRuntimeHarness();
      const scopeInput = { projectId, threadId };

      yield* harness.runtime.pause({ scope: scopeInput, paused: true });
      yield* Ref.set(harness.persistedScopes, []);
      yield* Ref.set(harness.failNextStatusRead, true);
      const error = yield* harness.runtime
        .pause({ scope: scopeInput, paused: false })
        .pipe(Effect.flip);

      assert.instanceOf(error, KnowledgeGraphOperationError);
      assert.strictEqual(error.operation, "activate");
      assert.strictEqual(error.code, "persistence");
      assert.strictEqual(error.scopeId, scope.scopeId);
    }),
  ),
);

it.effect("indexes every registered project scope and only the externally changed worktree", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeRuntimeHarness([scope, worktreeScope]);
      yield* Deferred.await(harness.initialIndexed);

      assert.deepStrictEqual(yield* Ref.get(harness.indexedScopeIds), [
        String(scope.scopeId),
        String(worktreeScope.scopeId),
      ]);
      const onChange = yield* Ref.get(harness.watcherChangeHandler);
      assert.isNotNull(onChange);
      yield* onChange?.([worktreeScope]);
      yield* Deferred.await(harness.incrementalIndexed);

      assert.deepStrictEqual(yield* Ref.get(harness.indexedScopeIds), [
        String(scope.scopeId),
        String(worktreeScope.scopeId),
        String(worktreeScope.scopeId),
      ]);
    }),
  ),
);

it.effect("coalesces watcher bursts into one pending rerun without interrupting owned work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const releaseSecond = yield* Deferred.make<void>();
      const starts = yield* Ref.make(0);
      const interruptions = yield* Ref.make(0);
      const harness = yield* makeRuntimeHarness([scope], [scope], () =>
        Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(starts, (current) => current + 1);
          yield* Deferred.succeed(count === 1 ? firstStarted : secondStarted, undefined);
          yield* Deferred.await(count === 1 ? releaseFirst : releaseSecond);
          return Option.none();
        }).pipe(Effect.onInterrupt(() => Ref.update(interruptions, (current) => current + 1))),
      );

      yield* Deferred.await(firstStarted);
      const onChange = yield* Ref.get(harness.watcherChangeHandler);
      assert.isNotNull(onChange);
      yield* onChange?.([scope]);
      yield* onChange?.([scope]);
      yield* onChange?.([scope]);

      assert.strictEqual(yield* Ref.get(starts), 1);
      assert.strictEqual(yield* Ref.get(interruptions), 0);
      assert.strictEqual((yield* Ref.get(harness.currentStatus)).state, "indexing");

      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Deferred.await(secondStarted);
      assert.strictEqual(yield* Ref.get(starts), 2);
      assert.strictEqual(yield* Ref.get(interruptions), 0);

      yield* Deferred.succeed(releaseSecond, undefined);
      yield* Queue.take(harness.idleStatuses);
      assert.strictEqual((yield* Ref.get(harness.currentStatus)).state, "idle");
      assert.strictEqual(yield* Ref.get(interruptions), 0);
    }),
  ),
);

it.effect("interrupts owned indexing for an explicit pause and settles paused", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      const harness = yield* makeRuntimeHarness([scope], [scope], () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
      );

      yield* Deferred.await(started);
      yield* harness.runtime.pause({ scope: { projectId, threadId }, paused: true });
      yield* Deferred.await(interrupted);

      assert.strictEqual((yield* Ref.get(harness.currentStatus)).state, "paused");
    }),
  ),
);

it.effect("repairs orphan indexing and cancelling states before startup indexing", () =>
  Effect.forEach(
    ["indexing", "cancelling"] as const,
    (orphanState) =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeRuntimeHarness([scope], [scope], undefined, orphanState);
          yield* Deferred.await(harness.initialIndexSettled);

          const statusEvents = (yield* Ref.get(harness.publishedEvents)).filter(
            (event) => event.type === "status",
          );
          assert.isNotEmpty(statusEvents);
          assert.strictEqual(statusEvents[0]?.status.state, "idle");
          assert.strictEqual((yield* Ref.get(harness.currentStatus)).state, "idle");
        }),
      ),
    { discard: true },
  ),
);

it.effect("clears persisted environment data after its last registered project is removed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeRuntimeHarness([], [scope]);
      yield* Ref.set(harness.currentStatus, { ...status("ready"), revision: 5 });

      yield* harness.runtime.clear({ target: "environment" });

      assert.deepStrictEqual(yield* Ref.get(harness.clearedEnvironments), [String(environmentId)]);
      const invalidation = (yield* Ref.get(harness.publishedEvents)).find(
        (event) => event.type === "invalidate",
      );
      assert.deepStrictEqual(invalidation, {
        version: 1,
        type: "invalidate",
        scopeId: scope.scopeId,
        reason: "cleared",
        expectedRevision: 5,
        availableRevision: 0,
      });
    }),
  ),
);

it.effect("bounds initial deterministic indexing to one project at a time", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const starts = yield* Ref.make(0);
      yield* makeRuntimeHarness([scope, worktreeScope], [scope, worktreeScope], () =>
        Ref.updateAndGet(starts, (count) => count + 1).pipe(
          Effect.tap((count) =>
            Deferred.succeed(count === 1 ? firstStarted : secondStarted, undefined),
          ),
          Effect.flatMap((count) => (count === 1 ? Deferred.await(releaseFirst) : Effect.void)),
          Effect.as(Option.none()),
        ),
      );

      yield* Deferred.await(firstStarted);
      yield* Effect.yieldNow;
      assert.isFalse(yield* Deferred.isDone(secondStarted));

      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Deferred.await(secondStarted);
      assert.strictEqual(yield* Ref.get(starts), 2);
    }),
  ),
);

it.effect("publishes a recoverable error state when deterministic indexing fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const attempted = yield* Deferred.make<void>();
      const harness = yield* makeRuntimeHarness([scope], [scope], () =>
        Deferred.succeed(attempted, undefined).pipe(
          Effect.andThen(
            Effect.fail(
              new KnowledgeGraphOperationError({
                operation: "index",
                code: "internal",
                retryable: true,
                detail: "The deterministic extractor failed.",
                scopeId: scope.scopeId,
              }),
            ),
          ),
        ),
      );

      yield* Deferred.await(attempted);
      yield* Deferred.await(harness.indexFailed);

      const failedStatus = yield* Ref.get(harness.currentStatus);
      assert.strictEqual(failedStatus.state, "error");
      assert.strictEqual(failedStatus.errorMessage, "The deterministic extractor failed.");
    }),
  ),
);

it.effect("keeps a persisted pause across restart without resuming indexing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeRuntimeHarness([scope], [scope], undefined, "paused");

      assert.strictEqual((yield* Ref.get(harness.currentStatus)).state, "paused");
      assert.deepStrictEqual(yield* Ref.get(harness.indexedScopeIds), []);
    }),
  ),
);
