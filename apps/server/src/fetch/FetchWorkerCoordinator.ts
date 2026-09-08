import { ThreadId, type ModelSelection } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import type { OrchestrationDispatchError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadBackgroundLivenessService } from "../orchestration/ThreadBackgroundLiveness.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { planFetchExploration } from "./FetchExplorationPlanner.ts";
import { buildFetchContext } from "./FetchContext.ts";
import { makeFetchWorkerLifecycle } from "./FetchWorkerLifecycle.ts";
import { makeFetchWorkerProjection } from "./FetchWorkerProjection.ts";
import {
  type ActiveFetchRun,
  type ActiveFetchWorker,
  type FetchHandoffInput,
  type FetchInterruptInput,
  type FetchRunInput,
  type FetchRunResult,
} from "./FetchWorkerState.ts";
import { FETCH_ABORT_FORCE_DELAY, makeFetchWorkerTransport } from "./FetchWorkerTransport.ts";

export {
  buildFetchContext,
  FETCH_CONTEXT_MAX_CHARS,
  FETCH_WORKER_FINDINGS_MAX_CHARS,
} from "./FetchContext.ts";
export { buildFetchWorkerPrompt, fetchApprovalAction } from "./FetchWorkerPolicy.ts";
export type { FetchApprovalAction } from "./FetchWorkerPolicy.ts";
export type {
  FetchHandoffInput,
  FetchInterruptInput,
  FetchRunInput,
  FetchRunResult,
  FetchWorkerAssignment,
  FetchWorkerOutcome,
  FetchWorkerOutcomeStatus,
} from "./FetchWorkerState.ts";
export { FETCH_WORKER_TIMEOUT } from "./FetchWorkerLifecycle.ts";
export { FETCH_ABORT_FORCE_DELAY } from "./FetchWorkerTransport.ts";

export type FetchWorkerCoordinatorError =
  | OrchestrationDispatchError
  | ProjectionRepositoryError
  | PlatformError.PlatformError;

export interface FetchWorkerCoordinatorShape {
  readonly run: (
    input: FetchRunInput,
  ) => Effect.Effect<FetchRunResult, FetchWorkerCoordinatorError>;
  readonly handoffToMain: <A, E, R>(
    input: FetchHandoffInput,
    sendMainEffect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<boolean, E, R>;
  readonly requestInterrupt: (
    input: FetchInterruptInput,
  ) => Effect.Effect<boolean, FetchWorkerCoordinatorError>;
  readonly hasActiveRun: (threadId: ThreadId) => Effect.Effect<boolean>;
}

export class FetchWorkerCoordinator extends Context.Service<
  FetchWorkerCoordinator,
  FetchWorkerCoordinatorShape
>()("t3/fetch/FetchWorkerCoordinator") {}

interface RunResultCounts {
  readonly plannedWorkers: number;
  readonly completedWorkers: number;
  readonly successfulWorkers: number;
}

function resultFor(
  run: ActiveFetchRun,
  status: FetchRunResult["status"],
  warnings: ReadonlyArray<string>,
  counts: RunResultCounts,
  context?: string,
): FetchRunResult {
  return {
    runId: run.runId,
    status,
    ...(context === undefined ? {} : { context }),
    warnings,
    ...counts,
    providerInstanceId: run.selection.instanceId,
    providerDriver: run.providerDriver,
    modelSelection: run.selection,
  };
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const providerService = yield* ProviderService;
  const resourceGovernor = Option.getOrUndefined(
    yield* Effect.serviceOption(ResourceProtection.SubagentResourceGovernor),
  );
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const threadBackgroundLiveness = yield* ThreadBackgroundLivenessService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const coordinatorScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const activeRuns = new Map<ThreadId, ActiveFetchRun>();
  const workersByThread = new Map<ThreadId, ActiveFetchWorker>();
  const projection = makeFetchWorkerProjection({
    crypto,
    orchestrationEngine,
    projectionSnapshotQuery,
    threadBackgroundLiveness,
  });
  const transport = makeFetchWorkerTransport({ providerService, resourceGovernor });
  const workerLifecycle = yield* makeFetchWorkerLifecycle({
    coordinatorScope,
    workersByThread,
    projection,
    transport,
  });

  const runPlanner = Effect.fn("FetchWorkerCoordinator.runPlanner")(function* (
    run: ActiveFetchRun,
  ) {
    const execute = (selection: ModelSelection) =>
      planFetchExploration({
        cwd: run.input.cwd,
        userRequest: run.input.userRequest,
        maxRecommendedWorkers: run.maxRecommendedWorkers,
        modelSelection: selection,
      }).pipe(Effect.provideService(TextGeneration.TextGeneration, textGeneration));
    const firstFiber = yield* execute(run.selection).pipe(Effect.forkIn(coordinatorScope));
    run.plannerFiber = firstFiber;
    const firstExit = yield* Fiber.await(firstFiber);
    if (Exit.isFailure(firstExit)) return null;
    const typedReason = firstExit.value.fallbackReason;
    if (
      typedReason !== "model-unavailable" &&
      typedReason !== "entitlement" &&
      typedReason !== "rate-limited"
    ) {
      return firstExit.value;
    }
    if (!run.input.lunaFallback) return firstExit.value;
    run.selection = run.input.lunaFallback.modelSelection;
    run.providerDriver = run.input.lunaFallback.providerDriver;
    run.maxRecommendedWorkers = run.input.lunaFallback.maxRecommendedWorkers;
    const fallbackFiber = yield* execute(run.selection).pipe(Effect.forkIn(coordinatorScope));
    run.plannerFiber = fallbackFiber;
    const fallbackExit = yield* Fiber.await(fallbackFiber);
    return Exit.isSuccess(fallbackExit) ? fallbackExit.value : null;
  });

  const runCore: FetchWorkerCoordinatorShape["run"] = Effect.fn("FetchWorkerCoordinator.runCore")(
    function* (input) {
      const runId = yield* crypto.randomUUIDv4;
      const lock = yield* Semaphore.make(1);
      const active: ActiveFetchRun = {
        runId,
        input,
        lock,
        selection: input.modelSelection,
        providerDriver: input.providerDriver,
        maxRecommendedWorkers: input.maxRecommendedWorkers,
        phase: "planning",
        cancelled: false,
        forceRequested: false,
        abortProjected: false,
        abortRuntimeSessionId: null,
        originalMainRuntimeSessionId: null,
        plannerFiber: null,
        watchdogFiber: null,
        workers: [],
      };
      activeRuns.set(input.threadId, active);
      const warnings: string[] = [];
      const emptyCounts = { plannedWorkers: 0, completedWorkers: 0, successfulWorkers: 0 };

      if (input.commandExecutionPolicy !== "deny") {
        active.phase = "settled";
        warnings.push(
          "The selected Fetch provider does not enforce command denial; the main turn will continue.",
        );
        return resultFor(active, "unavailable", warnings, emptyCounts);
      }

      const planning = yield* runPlanner(active);
      active.plannerFiber = null;
      if (active.cancelled || planning === null) {
        active.phase = "settled";
        yield* projection.restoreMainSessionReady(active);
        return resultFor(active, "cancelled", warnings, emptyCounts);
      }
      const typedReason = planning.fallbackReason;
      if (
        typedReason === "model-unavailable" ||
        typedReason === "entitlement" ||
        typedReason === "rate-limited"
      ) {
        active.phase = "settled";
        warnings.push("The selected Fetch model is unavailable; the main turn will continue.");
        return resultFor(active, "unavailable", warnings, emptyCounts);
      }
      if (planning.fallbackReason === "planner-failed") {
        warnings.push(
          "Fetch planning failed; the main agent continued without repository workers.",
        );
      }
      if (planning.fallbackReason === "invalid-plan") {
        warnings.push(
          "Fetch returned an invalid plan; the main agent continued without repository workers.",
        );
      }
      if (planning.plan.decision === "skip") {
        active.phase = "settled";
        return resultFor(active, "skipped", warnings, emptyCounts);
      }

      active.phase = "workers";
      active.workers = Array.from(
        yield* Effect.forEach(planning.plan.workers, (assignment, index) =>
          workerLifecycle.makeWorker(active, assignment, index),
        ),
      );
      const outcomes = Array.from(
        yield* Effect.forEach(active.workers, workerLifecycle.runWorker, { concurrency: 1 }),
      );
      active.phase = "settled";
      const completedWorkers = outcomes.filter(({ status }) => status === "completed").length;
      if (active.cancelled) {
        yield* projection.restoreMainSessionReady(active);
        return resultFor(active, "cancelled", warnings, {
          plannedWorkers: active.workers.length,
          completedWorkers,
          successfulWorkers: 0,
        });
      }
      const successfulWorkers = outcomes.filter(
        (outcome) => outcome.status === "completed" && outcome.findings.trim().length > 0,
      ).length;
      const context = buildFetchContext({
        plannedWorkers: active.workers.length,
        modelSelection: active.selection,
        providerDriver: active.providerDriver,
        outcomes,
        ...(input.contextMaxChars === undefined ? {} : { maxChars: input.contextMaxChars }),
      });
      if (successfulWorkers === 0) {
        warnings.push(
          "Every Fetch worker failed or returned no findings; the main turn will continue.",
        );
      } else if (successfulWorkers < active.workers.length) {
        warnings.push("Fetch completed with partial results; failed workers were not retried.");
      }
      return resultFor(
        active,
        "completed",
        warnings,
        { plannedWorkers: active.workers.length, completedWorkers, successfulWorkers },
        context,
      );
    },
  );

  const run: FetchWorkerCoordinatorShape["run"] = (input) =>
    Effect.uninterruptibleMask((restore) =>
      restore(runCore(input)).pipe(
        Effect.catchCause((cause) => {
          const active = activeRuns.get(input.threadId);
          if (active === undefined) return Effect.failCause(cause);
          const registeredWorkers = [...workersByThread.values()].filter(
            (worker) => worker.run === active,
          );
          const interrupted = Cause.hasInterruptsOnly(cause);
          const cleanup = Effect.uninterruptible(
            Effect.forEach(
              registeredWorkers,
              (worker) =>
                workerLifecycle.forceStopWorker(worker).pipe(
                  Effect.andThen(
                    workerLifecycle
                      .finalizeWorker(worker, {
                        index: worker.index,
                        scope: worker.assignment.scope,
                        status: interrupted ? "interrupted" : "error",
                        findings: worker.findings,
                        detail: interrupted
                          ? "Fetch coordination was interrupted."
                          : `Fetch coordination failed internally. ${Cause.pretty(cause).slice(0, 1_000)}`,
                      })
                      .pipe(
                        Effect.catchCause((projectionCause) =>
                          Effect.logWarning(
                            "Failed to terminalize a Fetch worker after run failure",
                            {
                              threadId: worker.syntheticThreadId,
                              runtimeSessionId: worker.runtimeSessionId,
                              cause: Cause.pretty(projectionCause),
                            },
                          ),
                        ),
                      ),
                  ),
                ),
              { concurrency: "unbounded", discard: true },
            ).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  active.workers = [];
                  active.phase = "settled";
                }),
              ),
            ),
          );
          if (interrupted) return cleanup.pipe(Effect.andThen(Effect.failCause(cause)));
          return cleanup.pipe(
            Effect.as(
              resultFor(
                active,
                "completed",
                [
                  `Fetch coordination failed internally; the main turn will continue without findings. ${Cause.pretty(cause).slice(0, 1_000)}`,
                ],
                {
                  plannedWorkers: registeredWorkers.length,
                  completedWorkers: 0,
                  successfulWorkers: 0,
                },
              ),
            ),
          );
        }),
      ),
    );

  const forceRun = Effect.fn("FetchWorkerCoordinator.forceRun")(function* (run: ActiveFetchRun) {
    run.forceRequested = true;
    yield* Effect.forEach(run.workers, workerLifecycle.forceStopWorker, {
      concurrency: "unbounded",
      discard: true,
    });
    yield* Effect.forEach(
      run.workers,
      (worker) => workerLifecycle.settleWorker(worker, "interrupted", "Fetch was force-stopped."),
      { concurrency: "unbounded", discard: true },
    );
  });

  const requestInterrupt: FetchWorkerCoordinatorShape["requestInterrupt"] = Effect.fn(
    "FetchWorkerCoordinator.requestInterrupt",
  )(function* (input) {
    const run = activeRuns.get(input.threadId);
    if (run === undefined) return false;
    if (
      input.turnId !== undefined &&
      run.input.parentTurnId !== undefined &&
      input.turnId !== run.input.parentTurnId
    ) {
      return false;
    }
    return yield* run.lock.withPermits(1)(
      Effect.gen(function* () {
        if (run.phase === "handoff") return false;
        if (run.cancelled) {
          if (!run.forceRequested) {
            yield* projection.projectAbortPhaseBestEffort(run, input, "force-stopping");
            yield* forceRun(run);
          }
          return true;
        }
        run.cancelled = true;
        run.phase = "cancelling";
        yield* projection.projectAbortPhaseBestEffort(run, input, "interrupting");
        if (run.plannerFiber !== null) {
          yield* Fiber.interrupt(run.plannerFiber).pipe(
            Effect.ignore,
            Effect.forkIn(coordinatorScope),
          );
        }
        yield* Effect.forEach(run.workers, workerLifecycle.interruptWorker, {
          concurrency: "unbounded",
          discard: true,
        }).pipe(
          Effect.catchCause(() => Effect.void),
          Effect.forkIn(coordinatorScope),
        );
        yield* Effect.forEach(
          run.workers,
          (worker) => workerLifecycle.settleWorker(worker, "interrupted", "Fetch was cancelled."),
          { concurrency: "unbounded", discard: true },
        );
        const watchdog = yield* Effect.sleep(FETCH_ABORT_FORCE_DELAY).pipe(
          Effect.flatMap(() =>
            run.lock.withPermits(1)(
              run.forceRequested || activeRuns.get(input.threadId) !== run
                ? Effect.void
                : projection
                    .projectAbortPhaseBestEffort(run, input, "force-stopping")
                    .pipe(Effect.andThen(forceRun(run))),
            ),
          ),
          Effect.forkIn(coordinatorScope),
        );
        run.watchdogFiber = watchdog;
        return true;
      }),
    );
  });

  const handoffToMain: FetchWorkerCoordinatorShape["handoffToMain"] = (input, sendMainEffect) => {
    const run = activeRuns.get(input.threadId);
    if (run === undefined || run.runId !== input.runId) return Effect.succeed(false);
    return run.lock.withPermits(1)(
      Effect.gen(function* () {
        if (run.runId !== input.runId || activeRuns.get(input.threadId) !== run) return false;
        if (run.cancelled) {
          yield* projection.restoreMainSessionReady(run).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to restore the main session after Fetch cancellation", {
                threadId: input.threadId,
                cause: Cause.pretty(cause),
              }),
            ),
          );
          activeRuns.delete(input.threadId);
          if (run.watchdogFiber !== null) {
            yield* Fiber.interrupt(run.watchdogFiber).pipe(Effect.ignore);
          }
          return false;
        }
        run.phase = "handoff";
        if (run.watchdogFiber !== null) {
          yield* Fiber.interrupt(run.watchdogFiber).pipe(Effect.ignore);
        }
        yield* sendMainEffect.pipe(Effect.forkIn(coordinatorScope));
        if (activeRuns.get(input.threadId) === run) activeRuns.delete(input.threadId);
        return true;
      }),
    );
  };

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const run of activeRuns.values()) run.cancelled = true;
    }).pipe(
      Effect.andThen(workerLifecycle.drain()),
      Effect.catchCause((cause) =>
        Effect.logWarning("Fetch coordinator shutdown cleanup failed", {
          cause: Cause.pretty(cause),
        }),
      ),
    ),
  );

  return {
    run,
    handoffToMain,
    requestInterrupt,
    hasActiveRun: (threadId) => Effect.sync(() => activeRuns.has(threadId)),
  } satisfies FetchWorkerCoordinatorShape;
});

export const FetchWorkerCoordinatorLive = Layer.effect(FetchWorkerCoordinator, make);
