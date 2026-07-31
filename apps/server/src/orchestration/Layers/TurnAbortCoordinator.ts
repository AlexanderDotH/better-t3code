import {
  CommandId,
  type OrchestrationSession,
  type RuntimeSessionId,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import type { ProviderForceStopResult } from "../../provider/Services/ProviderAdapter.ts";
import {
  type ProviderAbortTarget,
  ProviderService,
} from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  TurnAbortCoordinator,
  type SettleCooperativeTurnAbortInput,
  type TurnAbortCoordinatorShape,
} from "../Services/TurnAbortCoordinator.ts";

export const TURN_ABORT_FORCE_DELAY = Duration.seconds(5);

interface AbortAttempt {
  readonly target: ProviderAbortTarget;
  readonly phase: "interrupting" | "force-stopping";
  readonly fibers: ReadonlyArray<Fiber.Fiber<void>>;
}

function targetMatches(
  left: ProviderAbortTarget,
  right: {
    readonly threadId: ThreadId;
    readonly runtimeSessionId: RuntimeSessionId;
    readonly turnId: TurnId | null;
  },
): boolean {
  return (
    left.threadId === right.threadId &&
    left.runtimeSessionId === right.runtimeSessionId &&
    left.turnId === right.turnId
  );
}

function sessionHasAbortState(
  session: OrchestrationSession | null,
  attempt: AbortAttempt,
): boolean {
  if (session === null || session.abortState === null) {
    return false;
  }
  return (
    session.runtimeSessionId === attempt.target.runtimeSessionId &&
    session.abortState.runtimeSessionId === attempt.target.runtimeSessionId &&
    session.abortState.targetTurnId === attempt.target.turnId
  );
}

function sessionTargetsActiveAttempt(
  session: OrchestrationSession | null,
  attempt: AbortAttempt,
): boolean {
  return (
    sessionHasAbortState(session, attempt) &&
    (attempt.target.turnId === null || session?.activeTurnId === attempt.target.turnId)
  );
}

function forceOutcome(result: ProviderForceStopResult): {
  readonly outcome: "force-terminated" | "force-detached";
  readonly detail?: string;
} {
  return result.outcome === "terminated"
    ? {
        outcome: "force-terminated",
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      }
    : {
        outcome: "force-detached",
        detail: result.detail,
      };
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const coordinatorScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const lock = yield* Semaphore.make(1);
  const attempts = yield* Ref.make(new Map<ThreadId, AbortAttempt>());

  const commandId = Effect.fn("TurnAbortCoordinator.commandId")(function* (tag: string) {
    return CommandId.make(`server:turn-abort:${tag}:${yield* crypto.randomUUIDv4}`);
  });

  const resolveThread = Effect.fn("TurnAbortCoordinator.resolveThread")(function* (
    threadId: ThreadId,
  ) {
    return Option.getOrUndefined(yield* projectionSnapshotQuery.getThreadDetailById(threadId));
  });

  const resolveSession = Effect.fn("TurnAbortCoordinator.resolveSession")(function* (
    threadId: ThreadId,
  ) {
    return (yield* resolveThread(threadId))?.session ?? null;
  });

  const updateSession = Effect.fn("TurnAbortCoordinator.updateSession")(function* (
    session: OrchestrationSession,
    createdAt: string,
  ) {
    yield* orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: yield* commandId("session-set"),
      threadId: session.threadId,
      session,
      createdAt,
    });
  });

  const dispatchSettlement = Effect.fn("TurnAbortCoordinator.dispatchSettlement")(
    function* (input: {
      readonly target: ProviderAbortTarget;
      readonly outcome: "cooperative" | "force-terminated" | "force-detached" | "force-failed";
      readonly detail?: string;
      readonly settledAt: string;
    }) {
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.abort.settle",
        commandId: yield* commandId("settle"),
        threadId: input.target.threadId,
        runtimeSessionId: input.target.runtimeSessionId,
        turnId: input.target.turnId,
        outcome: input.outcome,
        ...(input.detail !== undefined ? { detail: input.detail } : {}),
        settledAt: input.settledAt,
        createdAt: input.settledAt,
      });
    },
  );

  const cleanupAttempt = Effect.fn("TurnAbortCoordinator.cleanupAttempt")(function* (
    attempt: AbortAttempt | undefined,
  ) {
    if (attempt === undefined) {
      return;
    }
    yield* Effect.forEach(
      attempt.fibers,
      (fiber) => Fiber.interrupt(fiber).pipe(Effect.ignore, Effect.forkIn(coordinatorScope)),
      { discard: true },
    );
  });

  const removeAttempt = Effect.fn("TurnAbortCoordinator.removeAttempt")(function* (
    target: ProviderAbortTarget,
  ) {
    return yield* Ref.modify(attempts, (current) => {
      const existing = current.get(target.threadId);
      if (!existing || !targetMatches(existing.target, target)) {
        return [undefined, current] as const;
      }
      const next = new Map(current);
      next.delete(target.threadId);
      return [existing, next] as const;
    });
  });

  const watchdog = Effect.fn("TurnAbortCoordinator.watchdog")(
    function* (target: ProviderAbortTarget) {
      yield* Effect.sleep(TURN_ABORT_FORCE_DELAY);
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const currentAttempt = (yield* Ref.get(attempts)).get(target.threadId);
          if (
            !currentAttempt ||
            currentAttempt.phase !== "interrupting" ||
            !targetMatches(currentAttempt.target, target)
          ) {
            return;
          }

          const session = yield* resolveSession(target.threadId);
          if (session === null || !sessionTargetsActiveAttempt(session, currentAttempt)) {
            yield* cleanupAttempt(yield* removeAttempt(target));
            return;
          }
          const providerTargetIsCurrent = yield* providerService.isAbortTargetCurrent(target);
          if (!providerTargetIsCurrent) {
            yield* cleanupAttempt(yield* removeAttempt(target));
            return;
          }

          const forceStartedAt = DateTime.formatIso(yield* DateTime.now);
          const abortState = session.abortState;
          if (abortState == null) {
            yield* cleanupAttempt(yield* removeAttempt(target));
            return;
          }
          yield* updateSession(
            {
              ...session,
              abortState: {
                ...abortState,
                phase: "force-stopping",
              },
              updatedAt: forceStartedAt,
            },
            forceStartedAt,
          );
          yield* Ref.update(attempts, (current) => {
            const existing = current.get(target.threadId);
            if (!existing || !targetMatches(existing.target, target)) {
              return current;
            }
            const next = new Map(current);
            next.set(target.threadId, {
              ...existing,
              phase: "force-stopping",
            });
            return next;
          });

          const settled = yield* providerService.forceStopAbortTarget(target).pipe(
            Effect.map(forceOutcome),
            Effect.catchCause((cause) =>
              Effect.succeed({
                outcome: "force-failed" as const,
                detail: Cause.pretty(cause),
              }),
            ),
          );
          const settledAt = DateTime.formatIso(yield* DateTime.now);
          const settlementExit = yield* Effect.exit(
            dispatchSettlement({
              target,
              ...settled,
              settledAt,
            }),
          );
          yield* cleanupAttempt(yield* removeAttempt(target));
          if (Exit.isFailure(settlementExit)) {
            return yield* Effect.failCause(settlementExit.cause);
          }
        }),
      );
    },
    (effect, target) =>
      Effect.catchCause(effect, (cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logError("turn abort watchdog failed", {
              threadId: target.threadId,
              runtimeSessionId: target.runtimeSessionId,
              turnId: target.turnId,
              cause: Cause.pretty(cause),
            }),
      ),
  );

  const requestAbort: TurnAbortCoordinatorShape["requestAbort"] = Effect.fn(
    "TurnAbortCoordinator.requestAbort",
  )(function* (input) {
    const initialThread = yield* resolveThread(input.threadId);
    const targetTurnId = input.turnId ?? initialThread?.session?.activeTurnId ?? undefined;
    const target = yield* providerService.resolveAbortTarget({
      threadId: input.threadId,
      ...(targetTurnId !== undefined && targetTurnId !== null ? { turnId: targetTurnId } : {}),
    });

    const started = yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(attempts);
        const existing = current.get(input.threadId);
        if (existing && targetMatches(existing.target, target)) {
          return false;
        }

        const thread = yield* resolveThread(input.threadId);
        if (thread === undefined) {
          return false;
        }
        const session: OrchestrationSession = thread.session ?? {
          threadId: input.threadId,
          status: "starting",
          providerName: null,
          providerInstanceId: target.providerInstanceId,
          runtimeSessionId: target.runtimeSessionId,
          runtimeMode: thread.runtimeMode,
          activeTurnId: target.turnId,
          abortState: null,
          lastError: null,
          updatedAt: input.requestedAt,
        };
        if (
          session.status === "stopped" ||
          (target.turnId !== null && session.activeTurnId !== target.turnId)
        ) {
          return false;
        }

        const forceAt = DateTime.formatIso(
          DateTime.add(DateTime.makeUnsafe(input.requestedAt), {
            milliseconds: Duration.toMillis(TURN_ABORT_FORCE_DELAY),
          }),
        );
        yield* updateSession(
          {
            ...session,
            runtimeSessionId: target.runtimeSessionId,
            abortState: {
              runtimeSessionId: target.runtimeSessionId,
              targetTurnId: target.turnId,
              phase: "interrupting",
              requestedAt: input.requestedAt,
              forceAt,
            },
            updatedAt: input.requestedAt,
          },
          input.requestedAt,
        );

        const next = new Map(current);
        next.set(input.threadId, {
          target,
          phase: "interrupting",
          fibers: [],
        });
        yield* Ref.set(attempts, next);
        yield* cleanupAttempt(existing);
        return true;
      }),
    );
    if (!started) {
      return;
    }

    const cooperativeFiber = yield* providerService.interruptAbortTarget(target).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("cooperative provider interrupt failed; watchdog remains active", {
              threadId: target.threadId,
              runtimeSessionId: target.runtimeSessionId,
              turnId: target.turnId,
              cause: Cause.pretty(cause),
            }),
      ),
      Effect.forkIn(coordinatorScope),
    );
    const watchdogFiber = yield* watchdog(target).pipe(Effect.forkIn(coordinatorScope));

    const attached = yield* Ref.modify(attempts, (current) => {
      const existing = current.get(target.threadId);
      if (!existing || !targetMatches(existing.target, target)) {
        return [false, current] as const;
      }
      const next = new Map(current);
      next.set(target.threadId, {
        ...existing,
        fibers: [cooperativeFiber, watchdogFiber],
      });
      return [true, next] as const;
    });
    if (!attached) {
      yield* cleanupAttempt({
        target,
        phase: "interrupting",
        fibers: [cooperativeFiber, watchdogFiber],
      });
    }
  });

  const settleCooperative: TurnAbortCoordinatorShape["settleCooperative"] = Effect.fn(
    "TurnAbortCoordinator.settleCooperative",
  )(function* (input: SettleCooperativeTurnAbortInput) {
    const result = yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const existing = (yield* Ref.get(attempts)).get(input.threadId);
        if (!existing || !targetMatches(existing.target, input)) {
          return { removed: undefined, settled: false } as const;
        }
        const session = yield* resolveSession(input.threadId);
        if (!sessionHasAbortState(session, existing)) {
          return {
            removed: yield* removeAttempt(existing.target),
            settled: false,
          } as const;
        }
        const settlementExit = yield* Effect.exit(
          dispatchSettlement({
            target: existing.target,
            outcome: "cooperative",
            settledAt: input.settledAt,
          }),
        );
        return {
          removed: yield* removeAttempt(existing.target),
          settled: true,
          settlementExit,
        } as const;
      }),
    );
    yield* cleanupAttempt(result.removed);
    if ("settlementExit" in result && Exit.isFailure(result.settlementExit)) {
      return yield* Effect.failCause(result.settlementExit.cause);
    }
    return result.settled;
  });

  return {
    requestAbort,
    settleCooperative,
  } satisfies TurnAbortCoordinatorShape;
});

export const TurnAbortCoordinatorLive = Layer.effect(TurnAbortCoordinator, make);
