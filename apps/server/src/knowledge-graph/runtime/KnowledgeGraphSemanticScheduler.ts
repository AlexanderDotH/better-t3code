import type { EnvironmentId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import type {
  KnowledgeGraphSemanticWorkerError,
  KnowledgeGraphSemanticWorkerOutcome,
} from "../semantic/KnowledgeGraphSemanticWorker.ts";

interface SchedulerRegistration {
  readonly wakeQueue: Queue.Queue<void>;
  readonly fiber: Fiber.Fiber<void, never>;
}

export interface KnowledgeGraphSemanticSchedulerDependencies {
  readonly runNextBatch: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<KnowledgeGraphSemanticWorkerOutcome, KnowledgeGraphSemanticWorkerError>;
}

export interface KnowledgeGraphSemanticScheduler {
  readonly start: (environmentId: EnvironmentId) => Effect.Effect<void>;
  readonly wake: (environmentId: EnvironmentId) => Effect.Effect<void>;
  readonly stop: (environmentId: EnvironmentId) => Effect.Effect<void>;
  readonly stopAll: Effect.Effect<void>;
}

export const makeKnowledgeGraphSemanticScheduler = Effect.fn(
  "KnowledgeGraphSemanticScheduler.make",
)(function* (
  dependencies: KnowledgeGraphSemanticSchedulerDependencies,
): Effect.fn.Return<KnowledgeGraphSemanticScheduler, never, Scope.Scope> {
  const parentScope = yield* Scope.Scope;
  const registrations = yield* Ref.make(new Map<EnvironmentId, SchedulerRegistration>());
  const registrationLock = yield* Semaphore.make(1);

  const waitForWakeOrRetry = (wakeQueue: Queue.Queue<void>, retryAt: number): Effect.Effect<void> =>
    Effect.suspend(() =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) => {
          if (retryAt <= now) return Effect.void;
          return Effect.raceFirst(
            Queue.take(wakeQueue).pipe(Effect.andThen(waitForWakeOrRetry(wakeQueue, retryAt))),
            Effect.sleep(Duration.millis(retryAt - now)),
          ).pipe(Effect.asVoid);
        }),
      ),
    );

  const runLoop = (environmentId: EnvironmentId, wakeQueue: Queue.Queue<void>) =>
    Effect.forever(
      dependencies.runNextBatch(environmentId).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Effect.logWarning("Knowledge Graph semantic batch failed", {
              environmentId,
              cause,
            }).pipe(Effect.andThen(Queue.take(wakeQueue))),
          onSuccess: (outcome) => {
            switch (outcome.status) {
              case "committed":
                return Effect.void;
              case "idle":
                return Queue.take(wakeQueue);
              case "rate-limited":
                return waitForWakeOrRetry(wakeQueue, outcome.retryAt);
              case "requeued":
                return outcome.paused
                  ? Queue.take(wakeQueue)
                  : waitForWakeOrRetry(wakeQueue, outcome.retryAt);
            }
          },
        }),
      ),
    );

  const start = (environmentId: EnvironmentId) =>
    registrationLock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(registrations);
        const existing = current.get(environmentId);
        if (existing !== undefined) {
          yield* Queue.offer(existing.wakeQueue, undefined);
          return;
        }
        const wakeQueue = yield* Queue.sliding<void>(1);
        const fiber = yield* runLoop(environmentId, wakeQueue).pipe(Effect.forkIn(parentScope));
        const next = new Map(current);
        next.set(environmentId, { wakeQueue, fiber });
        yield* Ref.set(registrations, next);
      }),
    );

  const wake = (environmentId: EnvironmentId) =>
    Ref.get(registrations).pipe(
      Effect.flatMap((current) => {
        const registration = current.get(environmentId);
        return registration === undefined
          ? start(environmentId)
          : Queue.offer(registration.wakeQueue, undefined).pipe(Effect.asVoid);
      }),
    );

  const stop = (environmentId: EnvironmentId) =>
    registrationLock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(registrations);
        const registration = current.get(environmentId);
        if (registration === undefined) return;
        const next = new Map(current);
        next.delete(environmentId);
        yield* Ref.set(registrations, next);
        yield* Fiber.interrupt(registration.fiber);
      }),
    );

  const stopAll = registrationLock.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.getAndSet(
        registrations,
        new Map<EnvironmentId, SchedulerRegistration>(),
      );
      yield* Effect.forEach(current.values(), ({ fiber }) => Fiber.interrupt(fiber), {
        discard: true,
      });
    }),
  );

  return { start, wake, stop, stopAll };
});
