import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import { TestClock } from "effect/testing";

import {
  makeKeyedDrainableWorker,
  type KeyedDrainableWorker,
  type KeyedWorkerCompletion,
  type KeyedWorkerObservation,
  type KeyedWorkerStart,
} from "./KeyedDrainableWorker.ts";

interface Input {
  readonly key: string;
  readonly value: number;
  readonly bytes: number;
}

const input = (key: string, value: number, bytes = 1): Input => ({ key, value, bytes });
const keyOf = (item: Input) => item.key;
const weightOf = (item: Input) => item.bytes;
const signal = (deferred: Deferred.Deferred<void>): void => {
  Deferred.doneUnsafe(deferred, Effect.void);
};
const idleUsage = {
  queuedItems: 0,
  queuedBytes: 0,
  runningItems: 0,
  runningBytes: 0,
  waitingOffers: 0,
  activeKeys: 0,
  keyCount: 0,
};

describe("makeKeyedDrainableWorker", () => {
  it.effect("lets B, C, and D finish while A is blocked and keeps A serial", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedA = yield* Deferred.make<void>();
        const releaseA = yield* Deferred.make<void>();
        const othersFinished = yield* Deferred.make<void>();
        let completedOthers = 0;
        const processed: string[] = [];
        const worker = yield* makeKeyedDrainableWorker(
          (item: Input) =>
            Effect.gen(function* () {
              if (item.key === "A" && item.value === 1) {
                yield* Deferred.succeed(startedA, undefined);
                yield* Deferred.await(releaseA);
              }
              processed.push(`${item.key}:${item.value}`);
            }),
          {
            keyOf,
            weightOf,
            onComplete: ({ key }) => {
              if (key !== "A" && ++completedOthers === 3) signal(othersFinished);
            },
          },
        );

        yield* worker.enqueue(input("A", 1));
        yield* Deferred.await(startedA);
        yield* worker.enqueue(input("A", 2));
        yield* worker.enqueue(input("B", 1));
        yield* worker.enqueue(input("C", 1));
        yield* worker.enqueue(input("D", 1));
        yield* Deferred.await(othersFinished);

        expect(processed.toSorted()).toEqual(["B:1", "C:1", "D:1"]);
        expect((yield* worker.snapshot).runningItems).toBe(1);

        yield* Deferred.succeed(releaseA, undefined);
        yield* worker.drain;
        expect(processed.slice(-2)).toEqual(["A:1", "A:2"]);
        expect(yield* worker.snapshot).toEqual(idleUsage);
      }),
    ),
  );

  it.effect("gives other ready keys a turn before a hot key's next input", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedA = yield* Deferred.make<void>();
        const releaseA = yield* Deferred.make<void>();
        const processed: string[] = [];
        const worker = yield* makeKeyedDrainableWorker(
          (item: Input) =>
            Effect.gen(function* () {
              processed.push(`${item.key}:${item.value}`);
              if (item.key === "A" && item.value === 1) {
                yield* Deferred.succeed(startedA, undefined);
                yield* Deferred.await(releaseA);
              }
            }),
          { keyOf, weightOf, concurrency: 1 },
        );

        yield* worker.enqueue(input("A", 1));
        yield* Deferred.await(startedA);
        yield* worker.enqueue(input("A", 2));
        yield* worker.enqueue(input("A", 3));
        yield* worker.enqueue(input("B", 1));
        yield* worker.enqueue(input("A", 4));
        yield* Deferred.succeed(releaseA, undefined);
        yield* worker.drain;

        expect(processed).toEqual(["A:1", "B:1", "A:2", "A:3", "A:4"]);
      }),
    ),
  );

  it.effect("runs at most eight keys concurrently", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const eightStarted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const ninthStarted = yield* Deferred.make<void>();
        let active = 0;
        let maximum = 0;
        let started = 0;
        const worker = yield* makeKeyedDrainableWorker(
          (item: Input) =>
            Effect.gen(function* () {
              active++;
              maximum = Math.max(maximum, active);
              started++;
              if (started === 8) yield* Deferred.succeed(eightStarted, undefined);
              if (item.value === 9) yield* Deferred.succeed(ninthStarted, undefined);
              yield* Deferred.await(release);
            }).pipe(Effect.ensuring(Effect.sync(() => active--))),
          { keyOf, weightOf },
        );

        for (let value = 1; value <= 9; value++) {
          yield* worker.enqueue(input(String(value), value));
        }
        yield* Deferred.await(eightStarted);
        expect(yield* Deferred.isDone(ninthStarted)).toBe(false);
        expect(yield* worker.snapshot).toMatchObject({ runningItems: 8, queuedItems: 1 });

        yield* Deferred.succeed(release, undefined);
        yield* worker.drain;
        expect(started).toBe(9);
        expect(maximum).toBe(8);
        expect(active).toBe(0);
      }),
    ),
  );

  it.effect("bounds per-key item counts and preserves FIFO for concurrent blocked offers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const thirdWaiting = yield* Deferred.make<void>();
        const fourthWaiting = yield* Deferred.make<void>();
        const processed: number[] = [];
        const worker = yield* makeKeyedDrainableWorker(
          (item: Input) =>
            Effect.gen(function* () {
              if (item.value === 1) {
                yield* Deferred.succeed(firstStarted, undefined);
                yield* Deferred.await(releaseFirst);
              }
              processed.push(item.value);
            }),
          {
            keyOf,
            weightOf,
            maxItemsPerKey: 2,
            onBackpressureStart: ({ input: item }) => {
              signal(item.value === 3 ? thirdWaiting : fourthWaiting);
            },
          },
        );

        yield* worker.enqueue(input("A", 1));
        yield* Deferred.await(firstStarted);
        yield* worker.enqueue(input("A", 2));
        const third = yield* Effect.forkChild(worker.enqueue(input("A", 3)));
        yield* Deferred.await(thirdWaiting);
        const fourth = yield* Effect.forkChild(worker.enqueue(input("A", 4)));
        yield* Deferred.await(fourthWaiting);

        expect(yield* worker.snapshot).toMatchObject({
          runningItems: 1,
          queuedItems: 1,
          waitingOffers: 2,
        });

        yield* Deferred.succeed(releaseFirst, undefined);
        yield* worker.drain;
        expect(yield* Fiber.join(third)).toBe(true);
        expect(yield* Fiber.join(fourth)).toBe(true);
        expect(processed).toEqual([1, 2, 3, 4]);
        expect(yield* worker.snapshot).toEqual(idleUsage);
      }),
    ),
  );

  it.effect("enforces key and aggregate byte budgets without locking out an eligible key", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedA = yield* Deferred.make<void>();
        const startedB = yield* Deferred.make<void>();
        const releaseA = yield* Deferred.make<void>();
        const releaseB = yield* Deferred.make<void>();
        const waitingA = yield* Deferred.make<void>();
        const waitingC = yield* Deferred.make<void>();
        const acceptedA = yield* Deferred.make<void>();
        const processedC = yield* Deferred.make<void>();
        const worker = yield* makeKeyedDrainableWorker(
          (item: Input) =>
            Effect.gen(function* () {
              if (item.key === "A" && item.value === 1) {
                yield* Deferred.succeed(startedA, undefined);
                yield* Deferred.await(releaseA);
              }
              if (item.key === "B") {
                yield* Deferred.succeed(startedB, undefined);
                yield* Deferred.await(releaseB);
              }
              if (item.key === "C") yield* Deferred.succeed(processedC, undefined);
            }),
          {
            keyOf,
            weightOf,
            maxBytesPerKey: 5,
            maxBytes: 8,
            onBackpressureStart: ({ key }) => signal(key === "A" ? waitingA : waitingC),
          },
        );

        yield* worker.enqueue(input("A", 1, 4));
        yield* Deferred.await(startedA);
        const offerA = yield* Effect.forkChild(
          worker
            .enqueue(input("A", 2, 2))
            .pipe(Effect.tap(() => Deferred.succeed(acceptedA, undefined))),
        );
        yield* Deferred.await(waitingA);
        yield* worker.enqueue(input("B", 1, 4));
        yield* Deferred.await(startedB);
        const offerC = yield* Effect.forkChild(worker.enqueue(input("C", 1, 1)));
        yield* Deferred.await(waitingC);

        expect(yield* worker.snapshot).toMatchObject({
          runningBytes: 8,
          queuedBytes: 0,
          waitingOffers: 2,
        });

        yield* Deferred.succeed(releaseB, undefined);
        yield* Deferred.await(processedC);
        expect(yield* Deferred.isDone(acceptedA)).toBe(false);

        yield* Deferred.succeed(releaseA, undefined);
        expect(yield* Fiber.join(offerA)).toBe(true);
        expect(yield* Fiber.join(offerC)).toBe(true);
        yield* worker.drain;
        expect(yield* worker.snapshot).toEqual(idleUsage);
      }),
    ),
  );

  it.effect("charges an oversized input as one full byte budget instead of dropping it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const waiting = yield* Deferred.make<void>();
        const accepted: KeyedWorkerObservation<string, Input>[] = [];
        const worker = yield* makeKeyedDrainableWorker(
          (item: Input) =>
            item.value === 1
              ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))
              : Effect.void,
          {
            keyOf,
            weightOf,
            maxBytesPerKey: 5,
            maxBytes: 8,
            onAccepted: (event) => accepted.push(event),
            onBackpressureStart: () => signal(waiting),
          },
        );

        yield* worker.enqueue(input("A", 1, 100));
        yield* Deferred.await(started);
        const offer = yield* Effect.forkChild(worker.enqueue(input("A", 2, 1)));
        yield* Deferred.await(waiting);
        expect(accepted[0]).toMatchObject({ bytes: 100, chargedBytes: 5 });
        expect(yield* worker.snapshot).toMatchObject({ runningBytes: 5, waitingOffers: 1 });

        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(offer)).toBe(true);
        yield* worker.drain;
        expect(accepted).toHaveLength(2);
        expect(yield* worker.snapshot).toEqual(idleUsage);
      }),
    ),
  );

  it.effect("interrupted offers release FIFO positions and do not leak outstanding work", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const secondWaiting = yield* Deferred.make<void>();
        const thirdWaiting = yield* Deferred.make<void>();
        const processed: number[] = [];
        const worker = yield* makeKeyedDrainableWorker(
          (item: Input) =>
            Effect.gen(function* () {
              if (item.value === 1) {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
              }
              processed.push(item.value);
            }),
          {
            keyOf,
            weightOf,
            maxItemsPerKey: 1,
            onBackpressureStart: ({ input: item }) =>
              signal(item.value === 2 ? secondWaiting : thirdWaiting),
          },
        );

        yield* worker.enqueue(input("A", 1));
        yield* Deferred.await(started);
        const second = yield* Effect.forkChild(worker.enqueue(input("A", 2, 100)));
        yield* Deferred.await(secondWaiting);
        const third = yield* Effect.forkChild(worker.enqueue(input("A", 3)));
        yield* Deferred.await(thirdWaiting);
        yield* Fiber.interrupt(second);
        expect(yield* worker.snapshot).toMatchObject({
          runningBytes: 1,
          queuedBytes: 0,
          waitingOffers: 1,
        });

        yield* Deferred.succeed(release, undefined);
        yield* worker.drain;
        expect(yield* Fiber.join(third)).toBe(true);
        expect(processed).toEqual([1, 3]);
        expect(yield* worker.snapshot).toEqual(idleUsage);
      }),
    ),
  );

  it.effect(
    "enforces the aggregate item bound and removes keys belonging only to canceled offers",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const waiting = yield* Deferred.make<void>();
          const worker = yield* makeKeyedDrainableWorker(
            (_item: Input) =>
              Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
            {
              keyOf,
              weightOf,
              maxItems: 1,
              onBackpressureStart: () => signal(waiting),
            },
          );

          yield* worker.enqueue(input("A", 1));
          yield* Deferred.await(started);
          const other = yield* Effect.forkChild(worker.enqueue(input("B", 1)));
          yield* Deferred.await(waiting);
          expect(yield* worker.snapshot).toMatchObject({
            runningItems: 1,
            queuedItems: 0,
            waitingOffers: 1,
            keyCount: 2,
          });

          yield* Fiber.interrupt(other);
          expect(yield* worker.snapshot).toMatchObject({ waitingOffers: 0, keyCount: 1 });
          yield* Deferred.succeed(release, undefined);
          yield* worker.drain;
          expect(yield* worker.snapshot).toEqual(idleUsage);
        }),
      ),
  );

  it.effect("drain includes work enqueued by a running handler", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workerReady = yield* Deferred.make<KeyedDrainableWorker<Input>>();
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const releaseSecond = yield* Deferred.make<void>();
        const drained = yield* Deferred.make<void>();
        const processed: number[] = [];
        const worker = yield* makeKeyedDrainableWorker(
          (item: Input) =>
            Effect.gen(function* () {
              if (item.value === 1) {
                yield* Deferred.succeed(firstStarted, undefined);
                yield* Deferred.await(releaseFirst);
                const activeWorker = yield* Deferred.await(workerReady);
                yield* activeWorker.enqueue(input("A", 2));
              } else {
                yield* Deferred.succeed(secondStarted, undefined);
                yield* Deferred.await(releaseSecond);
              }
              processed.push(item.value);
            }),
          { keyOf, weightOf },
        );
        yield* Deferred.succeed(workerReady, worker);
        yield* worker.enqueue(input("A", 1));
        yield* Deferred.await(firstStarted);
        yield* Effect.forkChild(
          worker.drain.pipe(Effect.tap(() => Deferred.succeed(drained, undefined))),
        );
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Deferred.await(secondStarted);
        expect(yield* Deferred.isDone(drained)).toBe(false);

        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Deferred.await(drained);
        expect(processed).toEqual([1, 2]);
        expect(yield* worker.snapshot).toEqual(idleUsage);
      }),
    ),
  );

  it.effect(
    "keeps workers and drains alive after process failures, defects, and observer throws",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const processed: number[] = [];
          const exits: string[] = [];
          const worker = yield* makeKeyedDrainableWorker(
            (item: Input) =>
              Effect.suspend(() => {
                processed.push(item.value);
                if (item.value === 1) return Effect.fail("failed");
                if (item.value === 2) throw new Error("defect");
                return Effect.void;
              }),
            {
              keyOf,
              weightOf,
              onAccepted: () => {
                throw new Error("observer");
              },
              onStart: () => {
                throw new Error("observer");
              },
              onComplete: ({ exit }) => {
                exits.push(exit._tag);
                throw new Error("observer");
              },
            },
          );

          yield* worker.enqueue(input("A", 1));
          yield* worker.enqueue(input("A", 2));
          yield* worker.enqueue(input("A", 3));
          yield* worker.drain;
          expect(processed).toEqual([1, 2, 3]);
          expect(exits).toEqual(["Failure", "Failure", "Success"]);
          expect(yield* worker.snapshot).toEqual(idleUsage);
        }),
      ),
  );

  it.effect("scope closure interrupts handlers, releases waiting offers, and clears keys", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const started = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      const waiting = yield* Deferred.make<void>();
      const worker = yield* makeKeyedDrainableWorker(
        (_item: Input) =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
          ),
        {
          keyOf,
          weightOf,
          maxItems: 1,
          onBackpressureStart: () => signal(waiting),
        },
      ).pipe(Effect.provideService(Scope.Scope, scope));

      yield* worker.enqueue(input("A", 1));
      yield* Deferred.await(started);
      const offer = yield* Effect.forkChild(worker.enqueue(input("B", 1)));
      yield* Deferred.await(waiting);
      yield* Scope.close(scope, Exit.void);

      expect(yield* Deferred.isDone(stopped)).toBe(true);
      expect(yield* Fiber.join(offer)).toBe(false);
      expect(yield* worker.enqueue(input("C", 1))).toBe(false);
      yield* worker.drain;
      expect(yield* worker.snapshot).toEqual(idleUsage);
    }),
  );

  it.effect("reports immutable usage plus queue, processing, and backpressure timings", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const secondWaiting = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const releaseSecond = yield* Deferred.make<void>();
        const secondFinished = yield* Deferred.make<void>();
        const accepted: KeyedWorkerObservation<string, Input>[] = [];
        const starts: KeyedWorkerStart<string, Input>[] = [];
        const completions: KeyedWorkerCompletion<string, Input>[] = [];
        const blocked: number[] = [];
        const worker = yield* makeKeyedDrainableWorker(
          (item: Input) =>
            item.value === 1
              ? Deferred.succeed(firstStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseFirst)),
                )
              : Deferred.succeed(secondStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseSecond)),
                ),
          {
            keyOf,
            weightOf,
            maxItemsPerKey: 1,
            now: () => clock.currentTimeMillisUnsafe(),
            onAccepted: (event) => accepted.push(event),
            onStart: (event) => starts.push(event),
            onComplete: (event) => {
              completions.push(event);
              if (event.input.value === 2) signal(secondFinished);
            },
            onBackpressureStart: () => signal(secondWaiting),
            onBackpressure: ({ blockedMs }) => blocked.push(blockedMs),
          },
        );

        yield* worker.enqueue(input("A", 1));
        yield* Deferred.await(firstStarted);
        yield* TestClock.setTime(10);
        const offer = yield* Effect.forkChild(worker.enqueue(input("A", 2)));
        yield* Deferred.await(secondWaiting);
        yield* TestClock.setTime(30);
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Deferred.await(secondStarted);
        yield* TestClock.setTime(50);
        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Deferred.await(secondFinished);
        yield* worker.drain;

        expect(yield* Fiber.join(offer)).toBe(true);
        expect(blocked).toEqual([20]);
        expect(starts.map(({ waitMs }) => waitMs)).toEqual([0, 20]);
        expect(completions.map(({ processMs }) => processMs)).toEqual([30, 20]);
        expect(accepted[0]?.usage.queuedItems).toBe(1);
        expect(completions[1]?.usage).toEqual(idleUsage);
      }),
    ),
  );
});
