import * as NodeCrypto from "node:crypto";

import {
  ProjectIndexOperationError,
  resolveProjectIndexSettings,
  type ProjectIndexActivityV1,
  type ProjectIndexDefaults,
  type ProjectIndexScopeInput,
  type ProjectIndexState,
  type ProjectIndexStreamEvent,
  type ProjectIndexStatusV1,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as References from "effect/References";

import { type KnowledgeStore, type WriterLease } from "../persistence/KnowledgeStore.ts";
import {
  openExistingKnowledgeKvStore,
  openKnowledgeKvStore,
} from "../persistence/KnowledgeStoreKv.ts";
import { projectIndexContextBudget } from "../semantic/ProjectIndexContextBudget.ts";
import { queryProjectContext } from "../query/ProjectContextQuery.ts";
import { reviewProjectIndexDiff } from "../review/ProjectIndexDiffReview.ts";
import {
  ProjectIndexingBridge,
  type ProjectIndexingBridgeShape,
  type ResolvedProjectIndexScope,
} from "./ProjectIndexingBridge.ts";
import {
  decodeProjectIndexGenerationMetadata,
  initialProjectIndexGenerationMetadata,
  type ProjectIndexGenerationMetadata,
} from "./ProjectIndexingMetadata.ts";
import {
  runProjectIndexingPipeline,
  type ProjectIndexExtractionBridge,
} from "./ProjectIndexingPipeline.ts";
import {
  ProjectIndexingRuntime,
  type ProjectIndexingRuntimeShape,
} from "./ProjectIndexingRuntimeService.ts";
import {
  asProjectIndexRuntimeError,
  encodeProjectIndexJson,
  ProjectIndexRuntimeError,
} from "./ProjectIndexingErrors.ts";
import { emptyProjectIndexStatus, readProjectIndexStatus } from "./ProjectIndexingStatus.ts";
import { liveProjectIndexExtraction } from "./ProjectIndexingExtraction.ts";
import { hasProjectIndexSourceChanges } from "./ProjectIndexSourceChanges.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { projectIndexDefaultsFromSettings } from "../integration/ProjectIndexDefaults.ts";
import {
  withProjectIndexDefaults,
  type ProjectIndexingDefaultsSource,
} from "./ProjectIndexingDefaults.ts";

export { ProjectIndexingRuntime } from "./ProjectIndexingRuntimeService.ts";

const isProjectIndexOperationError = Schema.is(ProjectIndexOperationError);

const LEASE_TTL_MS = 45_000;
const LEASE_RENEWAL = "15 seconds";

export interface ProjectIndexingRuntimeDependencies {
  readonly bridge: ProjectIndexingBridgeShape;
  readonly defaults?: ProjectIndexingDefaultsSource;
  readonly extraction?: ProjectIndexExtractionBridge;
  readonly openStore?: (
    resolved: ResolvedProjectIndexScope,
  ) => Effect.Effect<KnowledgeStore, Error, Scope.Scope>;
  readonly openExisting?: (
    resolved: ResolvedProjectIndexScope,
  ) => Effect.Effect<KnowledgeStore | null, Error, Scope.Scope>;
}

interface RuntimeWorkspace {
  readonly resolved: ResolvedProjectIndexScope;
  readonly store: KnowledgeStore;
  epoch: number;
  fiber: Fiber.Fiber<void, never> | null;
  liveState: ProjectIndexState | undefined;
  metadata: ProjectIndexGenerationMetadata | null;
  watcherError: string | null;
  pendingInvalidation: { readonly invalidateAll: boolean } | null;
}

function operationError(cause: unknown): ProjectIndexOperationError {
  if (isProjectIndexOperationError(cause)) return cause;
  const detail = cause instanceof Error ? cause.message : String(cause);
  const storeCode = cause instanceof Error && "code" in cause ? cause.code : undefined;
  return new ProjectIndexOperationError({
    code:
      storeCode === "lease-conflict"
        ? "busy"
        : storeCode === "revision-conflict" || storeCode === "stale-source"
          ? "stale-revision"
          : "store-unavailable",
    message: detail.slice(0, 16_000),
    retryable: true,
  });
}

function statusForSelector(
  status: ProjectIndexStatusV1,
  selector: ProjectIndexScopeInput,
): ProjectIndexStatusV1 {
  const { threadId: _resolvedThread, ...scope } = status.scope;
  return {
    ...status,
    scope: {
      ...scope,
      ...(selector.threadId === undefined ? {} : { threadId: selector.threadId }),
    },
  };
}

function withStatusSelector<Input extends ProjectIndexScopeInput>(
  operation: (input: Input) => Effect.Effect<ProjectIndexStatusV1, ProjectIndexOperationError>,
) {
  return (input: Input) =>
    operation(input).pipe(Effect.map((status) => statusForSelector(status, input)));
}

function projectIndexActivity(status: ProjectIndexStatusV1): ProjectIndexActivityV1 {
  return {
    scope: status.scope,
    state: status.state,
    settings: { enabled: status.settings.enabled },
    ...(status.defaults === undefined ? {} : { defaults: { enabled: status.defaults.enabled } }),
    coverage: {
      indexedFiles: status.coverage.indexedFiles,
      eligibleFiles: status.coverage.eligibleFiles,
    },
    job: status.job === null ? null : { phase: status.job.phase, units: status.job.units },
    updatedAt: status.updatedAt,
  };
}

export const makeProjectIndexingRuntime = Effect.fn("makeProjectIndexingRuntime")(function* (
  dependencies: ProjectIndexingRuntimeDependencies,
): Effect.fn.Return<ProjectIndexingRuntimeShape, never, Scope.Scope> {
  const lifetime = yield* Scope.Scope;
  const lock = yield* Semaphore.make(1);
  const workerPermit = yield* Semaphore.make(1);
  const events = yield* PubSub.sliding<ProjectIndexStreamEvent>(64);
  const workspaces = new Map<string, RuntimeWorkspace>();
  const activeReviews = new Set<{
    readonly cancel: Deferred.Deferred<void>;
    readonly done: Deferred.Deferred<void>;
  }>();
  const owner = `project-index:${NodeCrypto.randomUUID()}`;
  const { bridge } = dependencies;
  const getDefaults = dependencies.defaults?.get ?? Effect.succeed(undefined);
  const assertGloballyEnabled = Effect.gen(function* () {
    if ((yield* getDefaults)?.enabled === false)
      return yield* new ProjectIndexOperationError({
        code: "disabled",
        message: "Enable Project Indexing in server settings before indexing this project.",
        retryable: false,
      });
  });
  const extraction = dependencies.extraction ?? liveProjectIndexExtraction;
  const openStore: NonNullable<ProjectIndexingRuntimeDependencies["openStore"]> =
    dependencies.openStore ??
    ((resolved) => openKnowledgeKvStore({ workspaceRoot: resolved.workspaceRoot }));
  const openExisting: NonNullable<ProjectIndexingRuntimeDependencies["openExisting"]> =
    dependencies.openExisting ??
    ((resolved) => openExistingKnowledgeKvStore({ workspaceRoot: resolved.workspaceRoot }));

  const hasStaticGeneration = Effect.fn("ProjectIndexRuntime.hasStaticGeneration")(function* (
    store: KnowledgeStore,
    revision: number | null,
  ) {
    if (revision === null) return false;
    const json = yield* store.getGenerationMetadata(revision);
    if (json === null) return false;
    const metadata = yield* decodeProjectIndexGenerationMetadata(json).pipe(
      Effect.orElseSucceed(() => null),
    );
    return metadata?.knowledgeFormat === "static-v1";
  });

  const resolve = (input: ProjectIndexScopeInput) =>
    bridge.resolveScope(input).pipe(Effect.mapError(operationError));
  const workspace = Effect.fn("ProjectIndexRuntime.workspace")(function* (
    resolved: ResolvedProjectIndexScope,
  ) {
    const existing = workspaces.get(resolved.scope.scopeId);
    if (existing !== undefined) {
      if (
        existing.resolved.workspaceRoot !== resolved.workspaceRoot ||
        existing.resolved.scope.workspaceFingerprint !== resolved.scope.workspaceFingerprint
      )
        return yield* new ProjectIndexOperationError({
          code: "scope-mismatch",
          message: "The workspace changed; reopen the project before indexing.",
          retryable: true,
        });
      return existing;
    }
    const store = yield* openStore(resolved).pipe(Effect.provideService(Scope.Scope, lifetime));
    const entry: RuntimeWorkspace = {
      resolved,
      store,
      epoch: 0,
      fiber: null,
      liveState: undefined,
      metadata: null,
      watcherError: null,
      pendingInvalidation: null,
    };
    workspaces.set(resolved.scope.scopeId, entry);
    return entry;
  });
  const status = (entry: RuntimeWorkspace) =>
    Effect.gen(function* () {
      const current = withProjectIndexDefaults(
        yield* readProjectIndexStatus(entry.store, entry.resolved.scope, entry.liveState),
        yield* getDefaults,
      );
      return (
        entry.watcherError === null
          ? current
          : {
              ...current,
              state: current.state === "disabled" ? "disabled" : "failed",
              lastError: entry.watcherError,
              gaps: [
                {
                  id: "runtime:watcher",
                  kind: "incomplete-analysis" as const,
                  message: entry.watcherError,
                  retryable: true,
                },
                ...current.gaps,
              ].slice(0, 200),
            }
      ) satisfies ProjectIndexStatusV1;
    });
  const publish = Effect.fn("ProjectIndexRuntime.publish")(function* (entry: RuntimeWorkspace) {
    const current = yield* status(entry);
    yield* PubSub.publish(events, { type: "status", status: current });
    return current;
  });
  const invalidateEvent = (
    entry: RuntimeWorkspace,
    revision: number,
    reason: "source-changed" | "cleared" | "revision-gap",
  ) =>
    PubSub.publish(events, {
      type: "invalidate",
      scopeId: entry.resolved.scope.scopeId,
      revision,
      reason,
    }).pipe(Effect.asVoid);
  const getStatus: ProjectIndexingRuntimeShape["getStatus"] = Effect.fn(
    "ProjectIndexRuntime.getStatus",
  )(function* (input) {
    const resolved = yield* resolve(input);
    const entry = workspaces.get(resolved.scope.scopeId);
    if (entry !== undefined) return yield* status(entry);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const store = yield* openExisting(resolved);
        const current =
          store === null
            ? emptyProjectIndexStatus(resolved.scope, DateTime.formatIso(yield* DateTime.now))
            : yield* readProjectIndexStatus(store, resolved.scope);
        return withProjectIndexDefaults(current, yield* getDefaults);
      }),
    );
  }, Effect.mapError(operationError));
  const getSettings: ProjectIndexingRuntimeShape["getSettings"] = (input) =>
    getStatus(input).pipe(Effect.map((current) => current.settings));
  const checkModel: ProjectIndexingRuntimeShape["checkModel"] = Effect.fn(
    "ProjectIndexRuntime.checkModel",
  )(function* (input) {
    if (input.projectId === undefined && input.threadId !== undefined)
      return yield* new ProjectIndexOperationError({
        code: "invalid-request",
        message: "A thread-scoped model check requires a project.",
        retryable: false,
      });
    if (input.projectId !== undefined)
      yield* resolve({
        projectId: input.projectId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      });
    return yield* bridge.capabilities(input.modelSelection).pipe(
      Effect.flatMap((capabilities) =>
        Effect.try({
          try: () => {
            projectIndexContextBudget(capabilities);
            return { supported: true, ...capabilities };
          },
          catch: asProjectIndexRuntimeError,
        }),
      ),
      Effect.catch((error) =>
        Effect.succeed({ supported: false, reason: error.message.slice(0, 16_000) }),
      ),
    );
  }, Effect.mapError(operationError));

  const stopWorker = Effect.fn("ProjectIndexRuntime.stopWorker")(function* (
    entry: RuntimeWorkspace,
  ) {
    entry.epoch++;
    entry.pendingInvalidation = null;
    const fiber = entry.fiber;
    entry.fiber = null;
    if (fiber !== null) yield* Fiber.interrupt(fiber);
    entry.liveState = undefined;
  });

  const schedule = Effect.fn("ProjectIndexRuntime.schedule")(function* (
    entry: RuntimeWorkspace,
    lease: WriterLease,
    revision: number,
    metadata: ProjectIndexGenerationMetadata,
  ): Effect.fn.Return<void, Error> {
    const epoch = ++entry.epoch;
    entry.metadata = metadata;
    entry.liveState = "queued";
    const started = yield* Deferred.make<void>();
    const assertCurrent = Effect.gen(function* () {
      if (entry.epoch !== epoch)
        return yield* new ProjectIndexRuntimeError({
          detail: "This indexing generation has been superseded.",
        });
      yield* assertGloballyEnabled;
    });
    const run = Effect.scoped(
      Effect.gen(function* () {
        yield* entry.store.renewLease(lease, LEASE_TTL_MS).pipe(
          Effect.repeat(Schedule.spaced(LEASE_RENEWAL)),
          Effect.catch(() =>
            Effect.logWarning("Project indexing lease renewal failed", {
              category: "lease-renewal",
            }),
          ),
          Effect.forkScoped,
        );
        const completed = yield* workerPermit.withPermits(1)(
          runProjectIndexingPipeline({
            resolved: entry.resolved,
            store: entry.store,
            lease,
            revision,
            metadata,
            extraction,
            assertCurrent,
            progress: (liveState, nextMetadata) =>
              Effect.gen(function* () {
                yield* assertCurrent;
                entry.liveState = liveState;
                entry.metadata = nextMetadata;
                yield* publish(entry);
              }),
          }),
        );
        if (completed.sourceChangesPending) entry.pendingInvalidation ??= { invalidateAll: false };
        entry.liveState = undefined;
        yield* invalidateEvent(entry, revision, "revision-gap");
        yield* publish(entry);
      }),
    ).pipe(Effect.provideService(References.TracerEnabled, false));
    const task = Deferred.await(started).pipe(
      Effect.andThen(run),
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (entry.epoch !== epoch) return;
          entry.liveState = "failed";
          const state = yield* entry.store.getState();
          if (state.activeRevision === revision && state.status === "running") {
            const failedMetadata = {
              ...(entry.metadata ?? metadata),
              lastError: error.message.slice(0, 16_000),
            };
            yield* entry.store
              .setGenerationMetadata({
                lease,
                revision,
                metadataJson: encodeProjectIndexJson(failedMetadata),
              })
              .pipe(Effect.ignore);
            yield* entry.store.pauseGeneration(revision).pipe(Effect.ignore);
          }
          yield* publish(entry).pipe(Effect.ignore);
        }),
      ),
      Effect.catchCause(() =>
        Effect.logWarning("Project indexing worker stopped", {
          scopeId: entry.resolved.scope.scopeId,
          category: "worker-stopped",
        }),
      ),
      Effect.ensuring(entry.store.releaseLease(lease).pipe(Effect.ignore)),
      Effect.andThen(
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (entry.epoch !== epoch) return;
            entry.fiber = null;
            const pending = entry.pendingInvalidation;
            entry.pendingInvalidation = null;
            const settings = resolveProjectIndexSettings(
              (yield* entry.store.getState()).settings,
              yield* getDefaults,
            );
            if (
              pending !== null &&
              entry.liveState !== "failed" &&
              settings.enabled &&
              settings.autoRefresh
            )
              yield* scheduleRefresh(entry, pending.invalidateAll);
          }),
        ),
      ),
      Effect.catchCause(() =>
        Effect.logWarning("Project indexing follow-up could not start", {
          scopeId: entry.resolved.scope.scopeId,
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (entry.epoch === epoch) entry.fiber = null;
        }),
      ),
    );
    entry.fiber = yield* task.pipe(Effect.forkIn(lifetime));
    yield* publish(entry);
    yield* Deferred.succeed(started, undefined);
  });

  const begin = Effect.fn("ProjectIndexRuntime.begin")(function* (
    entry: RuntimeWorkspace,
    options: {
      readonly manual: boolean;
      readonly rebuild: boolean;
      readonly invalidateAll?: boolean;
      readonly idempotencyKey?: string;
    },
  ) {
    yield* assertGloballyEnabled;
    const state = yield* entry.store.getState();
    const settings = resolveProjectIndexSettings(state.settings, yield* getDefaults);
    if (!settings.enabled)
      return yield* new ProjectIndexOperationError({
        code: "disabled",
        message: "Enable Project Indexing for this workspace before indexing.",
        retryable: false,
      });
    const replacingLegacy =
      (state.publishedRevision !== null &&
        !(yield* hasStaticGeneration(entry.store, state.publishedRevision))) ||
      (state.activeRevision !== null &&
        !(yield* hasStaticGeneration(entry.store, state.activeRevision)));
    const rebuild = options.rebuild || replacingLegacy;
    yield* assertGloballyEnabled;
    yield* stopWorker(entry);
    const lease = yield* entry.store.acquireLease(owner, LEASE_TTL_MS);
    const generation = yield* entry.store
      .beginGeneration({
        lease,
        expectedRevision: state.revision,
        idempotencyKey: replacingLegacy
          ? NodeCrypto.randomUUID()
          : (options.idempotencyKey ?? NodeCrypto.randomUUID()),
        copyPublished: !rebuild,
      })
      .pipe(Effect.tapError(() => entry.store.releaseLease(lease).pipe(Effect.ignore)));
    if (generation.status !== "running") {
      yield* entry.store.releaseLease(lease);
      return;
    }
    const existingMetadata = yield* entry.store.getGenerationMetadata(generation.revision);
    const metadata =
      existingMetadata === null
        ? initialProjectIndexGenerationMetadata({
            kind: rebuild ? "rebuild" : state.publishedRevision === null ? "initial" : "refresh",
            manual: options.manual,
            invalidateAll: rebuild || options.invalidateAll === true,
            startedAt: DateTime.formatIso(yield* DateTime.now),
          })
        : yield* decodeProjectIndexGenerationMetadata(existingMetadata);
    yield* entry.store.setGenerationMetadata({
      lease,
      revision: generation.revision,
      metadataJson: encodeProjectIndexJson(metadata),
    });
    yield* invalidateEvent(entry, generation.revision, "source-changed");
    yield* schedule(entry, lease, generation.revision, metadata);
  });

  const scheduleRefresh = Effect.fn("ProjectIndexRuntime.scheduleRefresh")(function* (
    entry: RuntimeWorkspace,
    invalidateAll: boolean,
  ): Effect.fn.Return<void, Error> {
    const epoch = ++entry.epoch;
    const started = yield* Deferred.make<void>();
    // Inspect outside the mutation lock so pause, disable and manual rebuild remain responsive.
    const task = Deferred.await(started).pipe(
      Effect.andThen(
        invalidateAll
          ? Effect.succeed(true)
          : hasProjectIndexSourceChanges(entry.store, extraction, entry.resolved.workspaceRoot),
      ),
      Effect.flatMap((changed) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (entry.epoch !== epoch) return;
            entry.fiber = null;
            const pending = entry.pendingInvalidation;
            entry.pendingInvalidation = null;
            const hadError = entry.watcherError !== null;
            entry.watcherError = null;
            if (changed) {
              yield* begin(entry, { manual: false, rebuild: false, invalidateAll });
              entry.pendingInvalidation = pending;
            } else if (pending !== null) {
              yield* scheduleRefresh(entry, pending.invalidateAll);
            } else if (hadError) {
              yield* publish(entry);
            }
          }),
        ),
      ),
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (entry.epoch !== epoch) return;
          entry.watcherError = `Could not check project changes: ${error.message}`.slice(0, 16_000);
          yield* publish(entry).pipe(Effect.ignore);
        }),
      ),
      Effect.catchCause(() =>
        Effect.logWarning("Project indexing change inspection stopped", {
          scopeId: entry.resolved.scope.scopeId,
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (entry.epoch === epoch) entry.fiber = null;
        }),
      ),
    );
    entry.fiber = yield* task.pipe(Effect.forkIn(lifetime));
    yield* Deferred.succeed(started, undefined);
  });

  const reconcileWatchers = Effect.fn("ProjectIndexRuntime.reconcileWatchers")(function* () {
    const enabled: ResolvedProjectIndexScope[] = [];
    const defaults = yield* getDefaults;
    for (const entry of workspaces.values()) {
      const state = yield* entry.store.getState();
      const settings = resolveProjectIndexSettings(state.settings, defaults);
      if (state.status !== "paused" && settings.enabled && settings.autoRefresh)
        enabled.push(entry.resolved);
    }
    yield* bridge
      .reconcileWatchers(enabled, (changed) =>
        Effect.forEach(
          changed,
          (resolved) =>
            invalidate({
              scope: {
                projectId: resolved.scope.projectId,
                ...(resolved.scope.threadId === undefined
                  ? {}
                  : { threadId: resolved.scope.threadId }),
              },
              reason: "source",
            }),
          { discard: true },
        ),
      )
      .pipe(
        Effect.tapError((error) =>
          Effect.forEach(
            workspaces.values(),
            (entry) =>
              Effect.gen(function* () {
                entry.watcherError =
                  `Workspace change tracking is unavailable: ${error.message}`.slice(0, 16_000);
                yield* publish(entry).pipe(Effect.ignore);
              }),
            { discard: true },
          ),
        ),
      );
    for (const entry of workspaces.values()) entry.watcherError = null;
  });
  const updateSettings: ProjectIndexingRuntimeShape["updateSettings"] = (input) =>
    lock
      .withPermits(1)(
        Effect.gen(function* () {
          const entry = yield* workspace(yield* resolve(input));
          const previous = yield* entry.store.getState();
          const next = { ...previous.settings, ...input.patch };
          const defaults = yield* getDefaults;
          const effective = resolveProjectIndexSettings(next, defaults);
          if (!next.enabled) yield* stopWorker(entry);
          yield* entry.store.setSettings(next);
          if (
            previous.activeRevision !== null &&
            previous.status === "running" &&
            entry.fiber === null &&
            !next.enabled
          )
            yield* entry.store.pauseGeneration(previous.activeRevision);
          if (
            effective.enabled &&
            !previous.settings.enabled &&
            previous.publishedRevision !== null &&
            entry.fiber === null
          ) {
            if (!(yield* hasStaticGeneration(entry.store, previous.publishedRevision)))
              yield* begin(entry, { manual: false, rebuild: true });
          }
          yield* reconcileWatchers();
          return yield* publish(entry);
        }),
      )
      .pipe(Effect.mapError(operationError));
  const start: ProjectIndexingRuntimeShape["start"] = (input) =>
    lock
      .withPermits(1)(
        Effect.gen(function* () {
          const entry = yield* workspace(yield* resolve(input));
          if (entry.fiber !== null && input.rebuild !== true) return yield* status(entry);
          yield* begin(entry, {
            manual: true,
            rebuild: input.rebuild ?? false,
            ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
          });
          yield* reconcileWatchers();
          return yield* status(entry);
        }),
      )
      .pipe(Effect.mapError(operationError));

  const sourceChangedWhileStopped = Effect.fn("ProjectIndexRuntime.sourceChangedWhileStopped")(
    function* (entry: RuntimeWorkspace, revision: number) {
      const seen = new Set<string>();
      let cursor: unknown | null = null;
      while (true) {
        const page = yield* extraction.scan(entry.resolved.workspaceRoot, cursor);
        for (const file of page.files) {
          seen.add(file.path);
          const indexed = yield* entry.store.getRecord("files", file.path, revision);
          if (
            indexed === null ||
            indexed.contentHash !== file.contentHash ||
            indexed.classification !== file.classification ||
            indexed.skipReason !== file.skipReason ||
            encodeProjectIndexJson(indexed.configDependencies) !==
              encodeProjectIndexJson(file.configDependencies)
          )
            return true;
        }
        if (page.done) break;
        cursor = page.nextCursor;
      }
      let afterId: string | undefined;
      while (true) {
        const page = yield* entry.store.listRecords({
          kind: "files",
          revision,
          limit: 128,
          ...(afterId === undefined ? {} : { afterId }),
        });
        if (page.items.some((file) => !seen.has(file.path))) return true;
        if (page.nextCursor === null) return false;
        afterId = page.nextCursor;
      }
    },
  );

  const resume = Effect.fn("ProjectIndexRuntime.resume")(function* (entry: RuntimeWorkspace) {
    yield* assertGloballyEnabled;
    const state = yield* entry.store.getState();
    if (entry.fiber !== null || state.activeRevision === null || state.status === "cancelled")
      return;
    if (!state.settings.enabled)
      return yield* new ProjectIndexOperationError({
        code: "disabled",
        message: "Enable Project Indexing before resuming this job.",
        retryable: false,
      });
    const json = yield* entry.store.getGenerationMetadata(state.activeRevision);
    const metadata =
      json === null
        ? null
        : yield* decodeProjectIndexGenerationMetadata(json).pipe(Effect.orElseSucceed(() => null));
    if (metadata?.knowledgeFormat !== "static-v1") {
      yield* begin(entry, { manual: true, rebuild: true });
      return;
    }
    if (yield* sourceChangedWhileStopped(entry, state.activeRevision)) {
      yield* begin(entry, { manual: metadata.manual, rebuild: false });
      return;
    }
    if (
      metadata.resolutionComplete &&
      (yield* entry.store.listRecords({
        kind: "files",
        revision: state.activeRevision,
        fileStatuses: ["stale"],
        limit: 1,
      })).items.length > 0
    ) {
      yield* begin(entry, { manual: metadata.manual, rebuild: false });
      return;
    }
    const lease = yield* entry.store.acquireLease(owner, LEASE_TTL_MS);
    yield* Effect.gen(function* () {
      yield* entry.store.resumeGeneration({ lease, revision: state.activeRevision! });
      yield* entry.store.recoverJobs({ lease, revision: state.activeRevision! });
      yield* schedule(entry, lease, state.activeRevision!, metadata);
    }).pipe(Effect.tapError(() => entry.store.releaseLease(lease).pipe(Effect.ignore)));
  });
  const control: ProjectIndexingRuntimeShape["control"] = (input) =>
    lock
      .withPermits(1)(
        Effect.gen(function* () {
          const entry = yield* workspace(yield* resolve(input));
          if (input.action === "resume") yield* resume(entry);
          else {
            yield* stopWorker(entry);
            const state = yield* entry.store.getState();
            if (state.activeRevision !== null && state.status !== "cancelled") {
              if (input.action === "pause" && state.status !== "paused")
                yield* entry.store.pauseGeneration(state.activeRevision);
              else if (input.action !== "pause")
                yield* entry.store.cancelGeneration(state.activeRevision);
            }
            if (
              input.action === "clear" &&
              (state.publishedRevision !== null ||
                state.activeRevision !== null ||
                state.status !== "cleared")
            ) {
              yield* entry.store.clear();
              entry.metadata = null;
              yield* invalidateEvent(entry, (yield* entry.store.getState()).revision, "cleared");
            }
          }
          yield* reconcileWatchers();
          return yield* publish(entry);
        }),
      )
      .pipe(Effect.mapError(operationError));

  const invalidate: ProjectIndexingRuntimeShape["invalidate"] = (input) =>
    lock
      .withPermits(1)(
        Effect.gen(function* () {
          const entry = yield* workspace(yield* resolve(input.scope));
          const state = yield* entry.store.getState();
          const settings = resolveProjectIndexSettings(state.settings, yield* getDefaults);
          if (
            !settings.enabled ||
            !settings.autoRefresh ||
            (state.publishedRevision === null &&
              (state.activeRevision === null || state.status === "cancelled"))
          )
            return;
          if (state.status === "paused") return;
          const invalidateAll = input.reason === "rules" || input.reason === "configuration";
          if (entry.fiber !== null) {
            entry.pendingInvalidation = {
              invalidateAll: invalidateAll || entry.pendingInvalidation?.invalidateAll === true,
            };
            return;
          }
          yield* scheduleRefresh(entry, invalidateAll);
        }),
      )
      .pipe(Effect.mapError(operationError));

  const drain: ProjectIndexingRuntimeShape["drain"] = Effect.fn("ProjectIndexRuntime.drain")(
    function* (input) {
      const resolved = yield* resolve(input);
      while (true) {
        const fiber = yield* lock.withPermits(1)(
          Effect.sync(() => workspaces.get(resolved.scope.scopeId)?.fiber),
        );
        if (fiber === null || fiber === undefined) break;
        yield* Fiber.await(fiber);
      }
      return yield* getStatus(input);
    },
    Effect.mapError(operationError),
  );
  const runReview: ProjectIndexingRuntimeShape["review"] = Effect.fn("ProjectIndexRuntime.review")(
    function* (input) {
      yield* assertGloballyEnabled;
      const resolved = yield* resolve(input);
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const reader = yield* openExisting(resolved);
          const state = reader === null ? null : yield* reader.getState();
          if (reader === null || state === null || state.publishedRevision === null)
            return yield* new ProjectIndexOperationError({
              code: "not-found",
              message:
                "Index this workspace before reviewing changes against its project knowledge.",
              retryable: false,
            });
          if (!(yield* hasStaticGeneration(reader, state.publishedRevision)))
            return yield* new ProjectIndexOperationError({
              code: "not-found",
              message:
                "Index this workspace before reviewing changes against its project knowledge.",
              retryable: false,
            });
          const settings = resolveProjectIndexSettings(state.settings, yield* getDefaults);
          if (!settings.enabled || !settings.reviewEnabled)
            return yield* new ProjectIndexOperationError({
              code: "disabled",
              message: "Enable project indexing and code review for this workspace first.",
              retryable: false,
            });
          const selection = settings.modelSelection;
          if (selection === null)
            return yield* new ProjectIndexOperationError({
              code: "model-required",
              message: "Select the provider and model for code review.",
              retryable: false,
            });
          const diffSelection = input.selection ?? "workingtree";
          const diff = yield* bridge.readDiff({
            resolvedScope: resolved,
            selection: diffSelection,
          });
          const changedPaths = diff.files.map((file) => file.filePath);
          const contextPaths: string[] = [];
          for (const filePath of changedPaths) {
            if (contextPaths.length === 16 || [...contextPaths, filePath].join(" ").length > 8_000)
              break;
            contextPaths.push(filePath);
          }
          const capabilities = yield* bridge.capabilities(selection);
          const reviewBudget = yield* Effect.try({
            try: () => projectIndexContextBudget(capabilities),
            catch: asProjectIndexRuntimeError,
          });
          const context = yield* queryProjectContext({
            scope: resolved.scope,
            workspaceRoot: resolved.workspaceRoot,
            reader,
            input: {
              operation: "task",
              text: contextPaths.join(" ") || "project",
              scopes: contextPaths,
              maxTokens: Math.min(
                24_000,
                Math.max(1_024, Math.floor(reviewBudget.maximumPromptTokens / 3)),
              ),
              limit: 100,
              includeStale: true,
            },
          });
          const assertCurrent = Effect.gen(function* () {
            yield* assertGloballyEnabled;
            const current = yield* reader.getState();
            if (
              !current.settings.enabled ||
              !current.settings.reviewEnabled ||
              current.publishedRevision !== state.publishedRevision ||
              encodeProjectIndexJson(current.settings.modelSelection) !==
                encodeProjectIndexJson(state.settings.modelSelection)
            )
              return yield* new ProjectIndexOperationError({
                code: "cancelled",
                message: "The review settings or published knowledge changed during review.",
                retryable: true,
              });
          });
          return yield* reviewProjectIndexDiff({
            bridge,
            resolved,
            revision: state.publishedRevision,
            selection: diffSelection,
            modelSelection: selection,
            assertCurrent,
            context: {
              text: encodeProjectIndexJson(context),
              evidence: context.evidence,
              gaps: [
                ...context.gaps,
                ...(changedPaths.length > contextPaths.length
                  ? [
                      {
                        id: "review:context-files",
                        kind: "limit" as const,
                        message: `Retrieved context covers ${contextPaths.length} changed files; all diff parts are reviewed. Review smaller change sets for fuller project context.`,
                        retryable: true,
                      },
                    ]
                  : []),
              ],
            },
          });
        }),
      );
    },
    Effect.mapError(operationError),
    Effect.provideService(References.TracerEnabled, false),
  );
  const review: ProjectIndexingRuntimeShape["review"] = (input) =>
    Effect.gen(function* () {
      const active = {
        cancel: yield* Deferred.make<void>(),
        done: yield* Deferred.make<void>(),
      };
      activeReviews.add(active);
      return yield* Effect.raceFirst(
        runReview(input),
        Deferred.await(active.cancel).pipe(
          Effect.andThen(
            Effect.fail(
              new ProjectIndexOperationError({
                code: "cancelled",
                message: "Project Indexing was disabled while code review was running.",
                retryable: true,
              }),
            ),
          ),
        ),
      ).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            activeReviews.delete(active);
            yield* Deferred.succeed(active.done, undefined);
          }),
        ),
      );
    });
  const subscribe: ProjectIndexingRuntimeShape["subscribe"] = Effect.fn(
    "ProjectIndexRuntime.subscribe",
  )(function* (input) {
    const resolved = yield* resolve(input);
    const subscription = yield* PubSub.subscribe(events);
    const current = statusForSelector(yield* getStatus(input), input);
    const initial: ProjectIndexStreamEvent[] =
      input.afterRevision !== undefined && input.afterRevision !== current.revision
        ? [
            {
              type: "invalidate",
              scopeId: resolved.scope.scopeId,
              revision: current.revision,
              reason: "revision-gap",
            },
            { type: "status", status: current },
          ]
        : [{ type: "status", status: current }];
    return Stream.concat(
      Stream.fromIterable(initial),
      Stream.fromSubscription(subscription).pipe(
        Stream.filter(
          (event) =>
            (event.type === "status" ? event.status.scope.scopeId : event.scopeId) ===
            resolved.scope.scopeId,
        ),
        Stream.map((event) =>
          event.type === "status"
            ? { ...event, status: statusForSelector(event.status, input) }
            : event,
        ),
      ),
    );
  }, Effect.mapError(operationError));
  const subscribeActivity: ProjectIndexingRuntimeShape["subscribeActivity"] = Effect.fn(
    "ProjectIndexRuntime.subscribeActivity",
  )(function* () {
    const subscription = yield* PubSub.subscribe(events);
    const current = yield* Effect.forEach([...workspaces.values()], status);
    return Stream.concat(
      Stream.succeed({
        type: "snapshot" as const,
        activities: current.filter((item) => item.settings.enabled).map(projectIndexActivity),
      }),
      Stream.fromSubscription(subscription).pipe(
        Stream.flatMap((event) =>
          event.type === "status"
            ? Stream.succeed({
                type: "status" as const,
                activity: projectIndexActivity(event.status),
              })
            : Stream.empty,
        ),
      ),
    );
  }, Effect.mapError(operationError));
  const recover = lock
    .withPermits(1)(
      Effect.gen(function* () {
        const defaults = yield* getDefaults;
        for (const resolved of yield* bridge.listScopes()) {
          const saved = yield* Effect.scoped(
            Effect.gen(function* () {
              const reader = yield* openExisting(resolved);
              return reader === null ? null : yield* reader.getState();
            }),
          ).pipe(
            Effect.catch(() =>
              Effect.logWarning("Project indexing saved state is unavailable", {
                scopeId: resolved.scope.scopeId,
                category: "saved-state-unavailable",
              }).pipe(Effect.as(null)),
            ),
          );
          if (saved === null || !saved.settings.enabled) continue;
          const entry = yield* workspace(resolved);
          if (saved.status === "running" && saved.activeRevision !== null) {
            if (!resolveProjectIndexSettings(saved.settings, defaults).enabled)
              yield* entry.store.pauseGeneration(saved.activeRevision);
            else
              yield* resume(entry).pipe(
                Effect.catch(() =>
                  Effect.logWarning("Project indexing checkpoint could not resume", {
                    scopeId: resolved.scope.scopeId,
                    category: "checkpoint-resume",
                  }),
                ),
              );
          } else if (
            saved.status !== "paused" &&
            resolveProjectIndexSettings(saved.settings, defaults).enabled &&
            saved.publishedRevision !== null &&
            !(yield* hasStaticGeneration(entry.store, saved.publishedRevision))
          ) {
            yield* begin(entry, { manual: false, rebuild: true }).pipe(
              Effect.catch(() =>
                Effect.logWarning("Legacy project knowledge could not be rebuilt", {
                  scopeId: resolved.scope.scopeId,
                  category: "legacy-rebuild",
                }),
              ),
            );
          } else if (
            saved.status !== "paused" &&
            saved.status !== "cancelled" &&
            saved.publishedRevision !== null &&
            resolveProjectIndexSettings(saved.settings, defaults).enabled &&
            saved.settings.autoRefresh &&
            entry.fiber === null
          ) {
            // Watchers cannot report edits made while the environment was offline.
            yield* scheduleRefresh(entry, false);
          }
        }
        yield* reconcileWatchers();
      }),
    )
    .pipe(Effect.mapError(operationError));

  if (dependencies.defaults !== undefined) {
    const changes = yield* dependencies.defaults.subscribe;
    yield* changes.pipe(
      Stream.changesWith(
        (previous, next) => encodeProjectIndexJson(previous) === encodeProjectIndexJson(next),
      ),
      Stream.runForEach((defaults: ProjectIndexDefaults) =>
        lock
          .withPermits(1)(
            Effect.gen(function* () {
              if (!defaults.enabled) {
                const reviews = [...activeReviews];
                for (const review of reviews) yield* Deferred.succeed(review.cancel, undefined);
                for (const entry of workspaces.values()) yield* stopWorker(entry);
                for (const entry of workspaces.values()) {
                  const state = yield* entry.store.getState();
                  if (state.activeRevision !== null && state.status === "running")
                    yield* entry.store.pauseGeneration(state.activeRevision);
                }
                for (const review of reviews) yield* Deferred.await(review.done);
              } else {
                for (const entry of workspaces.values()) {
                  const state = yield* entry.store.getState();
                  if (
                    state.settings.enabled &&
                    state.status !== "paused" &&
                    state.publishedRevision !== null &&
                    entry.fiber === null &&
                    !(yield* hasStaticGeneration(entry.store, state.publishedRevision))
                  )
                    yield* begin(entry, { manual: false, rebuild: true });
                }
              }
              yield* reconcileWatchers();
              for (const entry of workspaces.values()) yield* publish(entry);
            }),
          )
          .pipe(
            Effect.catch(() =>
              Effect.logWarning("Project indexing defaults could not be applied", {
                category: "defaults-change",
              }),
            ),
          ),
      ),
      Effect.forkScoped,
    );
  }

  yield* Effect.addFinalizer(() =>
    Effect.forEach(workspaces.values(), (entry) => stopWorker(entry), { discard: true }),
  );
  return {
    getSettings,
    getStatus: withStatusSelector(getStatus),
    checkModel,
    updateSettings: withStatusSelector(updateSettings),
    start: withStatusSelector(start),
    control: withStatusSelector(control),
    review,
    subscribe,
    subscribeActivity,
    invalidate,
    drain: withStatusSelector(drain),
    recover,
  };
});

export const layer = Layer.effect(
  ProjectIndexingRuntime,
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    return yield* makeProjectIndexingRuntime({
      bridge: yield* ProjectIndexingBridge,
      defaults: {
        get: settings.getSettings.pipe(Effect.map(projectIndexDefaultsFromSettings)),
        subscribe: settings.subscribeChanges.pipe(
          Effect.map(Stream.map(projectIndexDefaultsFromSettings)),
        ),
      },
    });
  }),
);
