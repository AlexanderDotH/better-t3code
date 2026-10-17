import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";

import {
  ProviderEventOverflow,
  makeBoundedProviderEventBroadcast,
  makeBoundedProviderEventQueue,
} from "./boundedEventQueue.ts";

describe("makeBoundedProviderEventQueue", () => {
  it.effect("cancels a byte-blocked offer without reserving capacity or reordering survivors", () =>
    Effect.gen(function* () {
      const queue = yield* makeBoundedProviderEventQueue<string>({
        capacity: 3,
        byteCapacity: 6,
        sizeOf: (value) => value.length,
      });
      yield* queue.offer("123456");
      const cancelled = yield* queue.offer("xxxx").pipe(Effect.forkChild);
      const survivor = yield* queue.offer("yy").pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(cancelled);
      expect(yield* queue.take).toBe("123456");
      expect(yield* Fiber.join(survivor)).toBe(true);
      expect(yield* queue.takeAll).toEqual(["yy"]);
      yield* queue.shutdown;
    }),
  );

  it.effect("releases every item-blocked producer on shutdown", () =>
    Effect.gen(function* () {
      const queue = yield* makeBoundedProviderEventQueue<number>({
        capacity: 1,
        byteCapacity: 10,
        sizeOf: () => 1,
      });
      yield* queue.offer(1);
      const offers = yield* Effect.forEach([2, 3, 4], (value) =>
        queue.offer(value).pipe(Effect.forkChild),
      );
      yield* Effect.yieldNow;
      yield* queue.shutdown;
      expect(yield* Effect.forEach(offers, Fiber.join)).toEqual([false, false, false]);
    }),
  );

  it.effect("a saturated session cannot block another session's lossless consumer", () =>
    Effect.gen(function* () {
      const bus = yield* makeBoundedProviderEventBroadcast<{ session: string; sequence: number }>({
        capacity: 6,
        byteCapacity: 12,
        maxItemsPerKey: 2,
        maxBytesPerKey: 4,
        sizeOf: () => 2,
        keyOf: (event) => event.session,
      });
      const releaseA = yield* Deferred.make<void>();
      const startedA = yield* Deferred.make<void>();
      const doneA = yield* Deferred.make<void>();
      const doneB = yield* Deferred.make<void>();
      const seen: string[] = [];
      yield* bus.consume(
        (event) =>
          Effect.gen(function* () {
            if (event.session === "A" && event.sequence === 1) {
              yield* Deferred.succeed(startedA, undefined);
              yield* Deferred.await(releaseA);
            }
            seen.push(`${event.session}${event.sequence}`);
            if (event.session === "B") yield* Deferred.succeed(doneB, undefined);
            if (event.session === "A" && event.sequence === 3)
              yield* Deferred.succeed(doneA, undefined);
          }),
        { delivery: "lossless" },
      );
      yield* bus.publish({ session: "A", sequence: 1 });
      yield* Deferred.await(startedA);
      yield* bus.publish({ session: "A", sequence: 2 });
      const blockedA = yield* bus.publish({ session: "A", sequence: 3 }).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(blockedA.pollUnsafe()).toBeUndefined();
      yield* bus.publish({ session: "B", sequence: 1 });
      yield* Deferred.await(doneB);
      expect(seen).toEqual(["B1"]);
      expect(blockedA.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(releaseA, undefined);
      expect(yield* Fiber.join(blockedA)).toBe(true);
      yield* Deferred.await(doneA);
      expect(seen).toEqual(["B1", "A1", "A2", "A3"]);
      yield* bus.shutdown;
    }),
  );

  it.effect("filters before admission so unrelated traffic consumes no subscriber bytes", () =>
    Effect.gen(function* () {
      const bus = yield* makeBoundedProviderEventBroadcast<{ session: string; type: string }>({
        capacity: 1,
        byteCapacity: 1,
        sizeOf: () => 1,
        keyOf: (event) => event.session,
      });
      const events = yield* bus.subscribeFiltered({
        delivery: "lossless",
        filter: (event) => event.session === "B" && event.type === "completed",
      });
      for (let index = 0; index < 10; index += 1) {
        yield* bus.publish({ session: "A", type: "completed" });
        yield* bus.publish({ session: "B", type: "progress" });
      }
      yield* bus.publish({ session: "B", type: "completed" });
      expect(yield* events.pipe(Stream.take(1), Stream.runCollect)).toEqual([
        { session: "B", type: "completed" },
      ]);
      yield* bus.shutdown;
    }),
  );

  it.effect(
    "terminates a replayable subscriber explicitly without blocking critical delivery",
    () =>
      Effect.gen(function* () {
        const bus = yield* makeBoundedProviderEventBroadcast<number>({
          capacity: 1,
          byteCapacity: 1,
          sizeOf: () => 1,
        });
        const observer = yield* bus.subscribeFiltered({ delivery: "replayable" });
        const done = yield* Deferred.make<void>();
        const seen: number[] = [];
        yield* bus.consume(
          (value) =>
            Effect.sync(() => {
              seen.push(value);
            }).pipe(Effect.andThen(value === 3 ? Deferred.succeed(done, undefined) : Effect.void)),
          { delivery: "lossless" },
        );
        yield* bus.publish(1);
        yield* bus.publish(2);
        yield* bus.publish(3);
        yield* Deferred.await(done);
        const failure = yield* observer.pipe(Stream.runDrain, Effect.flip);
        expect(failure).toBeInstanceOf(ProviderEventOverflow);
        expect(seen).toEqual([1, 2, 3]);
        yield* bus.shutdown;
      }),
  );

  it.effect("closing a consumer scope releases its blocked publisher", () =>
    Effect.gen(function* () {
      const bus = yield* makeBoundedProviderEventBroadcast<number>({
        capacity: 1,
        byteCapacity: 1,
        sizeOf: () => 1,
      });
      const scope = yield* Scope.make();
      const started = yield* Deferred.make<void>();
      yield* bus
        .consume(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)), {
          delivery: "lossless",
        })
        .pipe(Effect.provideService(Scope.Scope, scope));
      yield* bus.publish(1);
      yield* Deferred.await(started);
      const blocked = yield* bus.publish(2).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(blocked.pollUnsafe()).toBeUndefined();
      yield* Scope.close(scope, Exit.void);
      expect(yield* Fiber.join(blocked)).toBe(false);
      expect(yield* bus.publish(3)).toBe(true);
      yield* bus.shutdown;
    }),
  );

  it.effect("backpressures the producer until the consumer releases capacity", () =>
    Effect.gen(function* () {
      const queue = yield* makeBoundedProviderEventQueue<number>({
        capacity: 2,
        byteCapacity: 2,
        sizeOf: () => 1,
      });
      yield* queue.offerAll([1, 2]);
      const thirdOffer = yield* queue.offer(3).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      expect(thirdOffer.pollUnsafe()).toBeUndefined();
      const first = yield* queue.take;
      expect(first).toBe(1);
      const offered = yield* Fiber.join(thirdOffer);
      expect(offered).toBe(true);
      const remaining = yield* queue.takeAll;
      expect(remaining).toEqual([2, 3]);
    }),
  );

  it.effect("backpressures by encoded bytes even while item capacity remains", () =>
    Effect.gen(function* () {
      const queue = yield* makeBoundedProviderEventQueue<string>({
        capacity: 10,
        byteCapacity: 8,
        sizeOf: (value) => value.length,
      });
      yield* queue.offer("123456");
      const blocked = yield* queue.offer("abcd").pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      expect(blocked.pollUnsafe()).toBeUndefined();
      expect(yield* queue.take).toBe("123456");
      expect(yield* Fiber.join(blocked)).toBe(true);
      expect(yield* queue.take).toBe("abcd");
    }),
  );

  it.effect("broadcasts in order and applies byte pressure from the slowest subscriber", () =>
    Effect.gen(function* () {
      const broadcast = yield* makeBoundedProviderEventBroadcast<string>({
        capacity: 4,
        byteCapacity: 4,
        sizeOf: (value) => value.length,
      });
      const first = yield* broadcast.subscribe;
      const second = yield* broadcast.subscribe;

      yield* broadcast.publish("1234");
      const blocked = yield* broadcast.publish("x").pipe(Effect.forkChild);
      expect(yield* first.take).toBe("1234");
      yield* Effect.yieldNow;
      expect(blocked.pollUnsafe()).toBeUndefined();
      expect(yield* second.take).toBe("1234");
      expect(yield* Fiber.join(blocked)).toBe(true);
      expect(yield* first.take).toBe("x");
      expect(yield* second.take).toBe("x");
    }),
  );

  it.effect("deterministically releases a byte-blocked producer on shutdown", () =>
    Effect.gen(function* () {
      const queue = yield* makeBoundedProviderEventQueue<string>({
        capacity: 2,
        byteCapacity: 4,
        sizeOf: (value) => value.length,
      });
      yield* queue.offer("1234");
      const blocked = yield* queue.offer("x").pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(blocked.pollUnsafe()).toBeUndefined();

      yield* queue.shutdown;
      const exit = yield* Fiber.await(blocked);
      expect(Exit.isSuccess(exit) ? exit.value : false).toBe(false);
      expect(yield* queue.offer("after-close")).toBe(false);
    }),
  );

  it.effect("unblocks a broadcast publisher when subscribers shut down", () =>
    Effect.gen(function* () {
      const broadcast = yield* makeBoundedProviderEventBroadcast<string>({
        capacity: 1,
        byteCapacity: 1,
        sizeOf: () => 1,
      });
      yield* broadcast.subscribe;
      yield* broadcast.publish("first");
      const blocked = yield* broadcast.publish("second").pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(blocked.pollUnsafe()).toBeUndefined();

      yield* broadcast.shutdown;
      const exit = yield* Fiber.await(blocked);
      expect(Exit.isSuccess(exit) ? exit.value : false).toBe(false);
      expect(yield* broadcast.publish("after-close")).toBe(false);
    }),
  );
});
