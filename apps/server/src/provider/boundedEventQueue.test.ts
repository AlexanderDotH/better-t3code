import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";

import {
  makeBoundedProviderEventBroadcast,
  makeBoundedProviderEventQueue,
} from "./boundedEventQueue.ts";

describe("makeBoundedProviderEventQueue", () => {
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
