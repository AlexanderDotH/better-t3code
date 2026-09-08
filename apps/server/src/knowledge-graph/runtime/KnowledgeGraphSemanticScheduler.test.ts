import { assert, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { makeKnowledgeGraphSemanticScheduler } from "./KnowledgeGraphSemanticScheduler.ts";

const environmentId = EnvironmentId.make("environment-semantic-scheduler");

it.effect("drains committed batches and then sleeps until an explicit wake", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const calls = yield* Queue.unbounded<number>();
      const callCount = yield* Ref.make(0);
      const scheduler = yield* makeKnowledgeGraphSemanticScheduler({
        runNextBatch: () =>
          Ref.updateAndGet(callCount, (count) => count + 1).pipe(
            Effect.tap((count) => Queue.offer(calls, count)),
            Effect.map((count) =>
              count === 1
                ? {
                    status: "committed" as const,
                    environmentId,
                    scopeId: "scope-semantic" as never,
                    revision: 1,
                    processedJobCount: 2,
                  }
                : { status: "idle" as const, environmentId },
            ),
          ),
      });

      yield* scheduler.start(environmentId);
      assert.strictEqual(yield* Queue.take(calls), 1);
      assert.strictEqual(yield* Queue.take(calls), 2);
      assert.strictEqual(yield* Queue.size(calls), 0);

      yield* scheduler.wake(environmentId);
      assert.strictEqual(yield* Queue.take(calls), 3);
      yield* scheduler.stop(environmentId);
    }),
  ),
);

it.effect("waits until the exact retry time without polling", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const calls = yield* Queue.unbounded<number>();
      const callCount = yield* Ref.make(0);
      const scheduler = yield* makeKnowledgeGraphSemanticScheduler({
        runNextBatch: () =>
          Ref.updateAndGet(callCount, (count) => count + 1).pipe(
            Effect.tap((count) => Queue.offer(calls, count)),
            Effect.map((count) =>
              count === 1
                ? {
                    status: "rate-limited" as const,
                    environmentId,
                    scopeId: "scope-semantic" as never,
                    retryAt: 1_000,
                  }
                : { status: "idle" as const, environmentId },
            ),
          ),
      });

      yield* scheduler.start(environmentId);
      assert.strictEqual(yield* Queue.take(calls), 1);
      yield* TestClock.adjust("999 millis");
      assert.strictEqual(yield* Queue.size(calls), 0);
      yield* TestClock.adjust("1 millis");
      assert.strictEqual(yield* Queue.take(calls), 2);
      yield* scheduler.stop(environmentId);
    }),
  ),
);

it.effect("keeps the exact retry deadline when new work wakes a rate-limited environment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const calls = yield* Queue.unbounded<number>();
      const callCount = yield* Ref.make(0);
      const scheduler = yield* makeKnowledgeGraphSemanticScheduler({
        runNextBatch: () =>
          Ref.updateAndGet(callCount, (count) => count + 1).pipe(
            Effect.tap((count) => Queue.offer(calls, count)),
            Effect.map((count) =>
              count === 1
                ? {
                    status: "rate-limited" as const,
                    environmentId,
                    scopeId: "scope-semantic" as never,
                    retryAt: 1_000,
                  }
                : { status: "idle" as const, environmentId },
            ),
          ),
      });

      yield* scheduler.start(environmentId);
      assert.strictEqual(yield* Queue.take(calls), 1);
      yield* scheduler.wake(environmentId);
      yield* Effect.yieldNow;
      assert.strictEqual(yield* Queue.size(calls), 0);

      yield* TestClock.adjust("999 millis");
      assert.strictEqual(yield* Queue.size(calls), 0);
      yield* TestClock.adjust("1 millis");
      assert.strictEqual(yield* Queue.take(calls), 2);
      yield* scheduler.stop(environmentId);
    }),
  ),
);

it.effect("interrupts an active provider batch before stop completes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      const scheduler = yield* makeKnowledgeGraphSemanticScheduler({
        runNextBatch: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(interrupted, undefined)),
          ),
      });

      yield* scheduler.start(environmentId);
      yield* Deferred.await(started);
      yield* scheduler.stop(environmentId);
      yield* Deferred.await(interrupted);
    }),
  ),
);
