import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

const MEBIBYTE = 1024 * 1024;

/**
 * Provider protocol callbacks must not accumulate an unlimited number of
 * decoded events when orchestration or a client is slower than the provider.
 * Bounded queues preserve every event and propagate pressure to the producer.
 */
export const PROVIDER_SESSION_EVENT_QUEUE_CAPACITY = 256;
export const PROVIDER_SESSION_EVENT_QUEUE_BYTE_CAPACITY = 32 * MEBIBYTE;
export const PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY = 512;
export const PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY = 64 * MEBIBYTE;

interface WeightedValue<A> {
  readonly value: A;
  readonly weight: number;
}

export interface BoundedProviderEventQueue<A> {
  readonly offer: (value: A) => Effect.Effect<boolean>;
  readonly offerAll: (values: Iterable<A>) => Effect.Effect<boolean>;
  readonly take: Effect.Effect<A>;
  readonly takeAll: Effect.Effect<ReadonlyArray<A>>;
  readonly stream: Stream.Stream<A>;
  readonly shutdown: Effect.Effect<void>;
}

export interface BoundedProviderEventQueueOptions<A> {
  readonly capacity: number;
  readonly byteCapacity: number;
  readonly sizeOf: (value: A) => number;
}

export interface BoundedProviderEventBroadcast<A> {
  readonly subscribe: Effect.Effect<BoundedProviderEventQueue<A>>;
  readonly stream: Stream.Stream<A>;
  readonly publish: (value: A) => Effect.Effect<boolean>;
  readonly shutdown: Effect.Effect<void>;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function providerEventEncodedBytes(value: unknown): number {
  try {
    const encoded = JSON.stringify(value);
    return Buffer.byteLength(encoded ?? "null", "utf8");
  } catch {
    return 1;
  }
}

export const makeBoundedProviderEventQueue = Effect.fnUntraced(function* <A>(
  options: BoundedProviderEventQueueOptions<A>,
) {
  const capacity = positiveInteger(options.capacity, 1);
  const byteCapacity = positiveInteger(options.byteCapacity, 1);
  const queue = yield* Queue.bounded<WeightedValue<A>>(capacity);
  const bytes = yield* Semaphore.make(byteCapacity);

  const weightOf = (value: A) =>
    Math.min(byteCapacity, positiveInteger(Math.ceil(options.sizeOf(value)), 1));

  const offer = Effect.fnUntraced(function* (value: A) {
    const weight = weightOf(value);
    yield* bytes.take(weight);
    return yield* Queue.offer(queue, { value, weight }).pipe(
      Effect.tap((accepted) => (accepted ? Effect.void : bytes.release(weight))),
      Effect.onInterrupt(() => bytes.release(weight)),
    );
  });

  const take = Effect.uninterruptibleMask((restore) =>
    restore(Queue.take(queue)).pipe(
      Effect.flatMap((entry) => bytes.release(entry.weight).pipe(Effect.as(entry.value))),
    ),
  );

  const takeAll = Queue.takeAll(queue).pipe(
    Effect.flatMap((entries) => {
      const released = entries.reduce((total, entry) => total + entry.weight, 0);
      const values = entries.map((entry) => entry.value);
      return released === 0
        ? Effect.succeed(values)
        : bytes.release(released).pipe(Effect.as(values));
    }),
  );

  const offerAll = (values: Iterable<A>) =>
    Effect.forEach(values, offer).pipe(Effect.map((accepted) => accepted.every(Boolean)));

  return {
    offer,
    offerAll,
    take,
    takeAll,
    stream: Stream.fromQueue(queue).pipe(
      Stream.mapEffect((entry) => bytes.release(entry.weight).pipe(Effect.as(entry.value))),
    ),
    shutdown: Queue.shutdown(queue).pipe(Effect.andThen(bytes.release(byteCapacity))),
  } satisfies BoundedProviderEventQueue<A>;
});

export const makeBoundedProviderEventBroadcast = Effect.fnUntraced(function* <A>(
  options: BoundedProviderEventQueueOptions<A>,
) {
  const state = yield* Ref.make({
    closed: false,
    subscribers: new Set<BoundedProviderEventQueue<A>>(),
  });
  const publishMutex = yield* Semaphore.make(1);

  const subscribe = Effect.gen(function* () {
    const subscriber = yield* makeBoundedProviderEventQueue(options);
    const registered = yield* Ref.modify(state, (current) =>
      current.closed
        ? [false, current]
        : [true, { ...current, subscribers: new Set(current.subscribers).add(subscriber) }],
    );
    if (!registered) yield* subscriber.shutdown;
    return subscriber;
  });

  const unsubscribe = (subscriber: BoundedProviderEventQueue<A>) =>
    Ref.update(state, (current) => {
      const next = new Set(current.subscribers);
      next.delete(subscriber);
      return { ...current, subscribers: next };
    }).pipe(Effect.andThen(subscriber.shutdown));

  const publish = (value: A) =>
    publishMutex.withPermits(1)(
      Ref.get(state).pipe(
        Effect.flatMap((current) =>
          current.closed
            ? Effect.succeed([false])
            : Effect.forEach(current.subscribers, (subscriber) => subscriber.offer(value)),
        ),
        Effect.map((accepted) => accepted.every(Boolean)),
      ),
    );

  const stream = Stream.unwrap(
    Effect.gen(function* () {
      const subscriber = yield* subscribe;
      yield* Effect.acquireRelease(Effect.void, () => unsubscribe(subscriber).pipe(Effect.ignore));
      return subscriber.stream;
    }),
  );

  const shutdown = Ref.getAndUpdate(state, () => ({
    closed: true,
    subscribers: new Set<BoundedProviderEventQueue<A>>(),
  })).pipe(
    Effect.flatMap((current) =>
      Effect.forEach(current.subscribers, (subscriber) => subscriber.shutdown, { discard: true }),
    ),
  );

  return { subscribe, stream, publish, shutdown } satisfies BoundedProviderEventBroadcast<A>;
});
