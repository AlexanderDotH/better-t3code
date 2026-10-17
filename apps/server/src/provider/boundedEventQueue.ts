import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import { makeKeyedDrainableWorker } from "@t3tools/shared/KeyedDrainableWorker";
import {
  CurrentProviderEvent,
  transferProviderIngress,
  recordProviderPipelineDuration,
  recordProviderPipelineQueue,
  releaseProviderPipelineQueue,
  stampProviderIngress,
} from "../observability/ProviderPipelineMetrics.ts";

const MEBIBYTE = 1024 * 1024;
export const PROVIDER_SESSION_EVENT_QUEUE_CAPACITY = 256;
export const PROVIDER_SESSION_EVENT_QUEUE_BYTE_CAPACITY = 32 * MEBIBYTE;
export const PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY = 512;
export const PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY = 64 * MEBIBYTE;

export class ProviderEventOverflow extends Error {
  readonly _tag = "ProviderEventOverflow";
  constructor() {
    super("Provider event subscription overflowed; resubscribe and resync its state.");
  }
}

interface WeightedValue<A> {
  readonly value: A;
  readonly weight: number;
  readonly enqueuedAt: number;
}

export interface BoundedProviderEventQueue<A, E = never> {
  readonly offer: (value: A) => Effect.Effect<boolean>;
  readonly offerAll: (values: Iterable<A>) => Effect.Effect<boolean>;
  readonly tryOffer: (value: A) => boolean;
  readonly take: Effect.Effect<A, E>;
  readonly takeAll: Effect.Effect<ReadonlyArray<A>, E>;
  readonly stream: Stream.Stream<A, E>;
  readonly shutdown: Effect.Effect<void>;
  readonly fail: (error: E) => Effect.Effect<void>;
}

export interface BoundedProviderEventQueueOptions<A> {
  readonly capacity: number;
  readonly byteCapacity: number;
  readonly sizeOf: (value: A) => number;
}

export interface ProviderEventSubscriptionOptions<A> {
  readonly filter?: (value: A) => boolean;
  readonly delivery: "lossless" | "replayable";
}

export interface BoundedProviderEventBroadcast<A> {
  readonly subscribe: Effect.Effect<BoundedProviderEventQueue<A>>;
  readonly subscribeScoped: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>;
  readonly subscribeFiltered: (
    options: ProviderEventSubscriptionOptions<A>,
  ) => Effect.Effect<Stream.Stream<A, ProviderEventOverflow>, never, Scope.Scope>;
  readonly consume: (
    handler: (value: A) => Effect.Effect<unknown>,
    options: ProviderEventSubscriptionOptions<A> & { readonly delivery: "lossless" },
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly stream: Stream.Stream<A>;
  readonly publish: (value: A) => Effect.Effect<boolean>;
  readonly shutdown: Effect.Effect<void>;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function providerEventEncodedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
  } catch {
    return 1;
  }
}

export const makeBoundedProviderEventQueue = Effect.fnUntraced(function* <A, E = never>(
  options: BoundedProviderEventQueueOptions<A>,
) {
  const capacity = positiveInteger(options.capacity, 1);
  const byteCapacity = positiveInteger(options.byteCapacity, 1);
  // Waiting offers keep their payload at the producer and cannot reserve bytes
  // ahead of an earlier offer.
  const queue = yield* Queue.unbounded<WeightedValue<A>, E>();
  const waiters: Array<{ readonly admit: () => void; readonly cancel: () => void }> = [];
  let closed = false;
  let items = 0;
  let bytes = 0;
  const metricsOwner = {};
  const observe = () => {
    if (closed) return;
    recordProviderPipelineQueue(
      "provider",
      {
        queuedItems: items,
        queuedBytes: bytes,
        runningItems: 0,
        runningBytes: 0,
        waitingOffers: waiters.length,
        activeKeys: 0,
        keyCount: items > 0 ? 1 : 0,
      },
      metricsOwner,
    );
  };
  const weightOf = (value: A) => {
    if (typeof value === "object" && value !== null) stampProviderIngress(value);
    return Math.min(byteCapacity, positiveInteger(Math.ceil(options.sizeOf(value)), 1));
  };
  const hasCapacity = (weight: number) => items < capacity && bytes + weight <= byteCapacity;
  const append = (value: A, weight: number) => {
    if (closed || !hasCapacity(weight)) return false;
    items += 1;
    bytes += weight;
    if (Queue.offerUnsafe(queue, { value, weight, enqueuedAt: performance.now() })) {
      observe();
      return true;
    }
    items -= 1;
    bytes -= weight;
    return false;
  };
  const wake = () => {
    waiters[0]?.admit();
  };
  const release = (entries: ReadonlyArray<WeightedValue<A>>) => {
    for (const entry of entries) {
      items -= 1;
      bytes -= entry.weight;
      recordProviderPipelineDuration("provider_queue_wait", performance.now() - entry.enqueuedAt);
    }
    wake();
    observe();
  };
  const tryOffer = (value: A) => waiters.length === 0 && append(value, weightOf(value));
  const offer = Effect.fnUntraced(function* (value: A) {
    const source = yield* CurrentProviderEvent;
    if (source && typeof value === "object" && value !== null)
      transferProviderIngress(source, value);
    return yield* Effect.callback<boolean>((resume) => {
      if (closed) {
        resume(Effect.succeed(false));
        return;
      }
      const weight = weightOf(value);
      if (waiters.length === 0 && append(value, weight)) {
        resume(Effect.succeed(true));
        return;
      }
      const waiter = {
        admit: () => {
          if (!closed && !hasCapacity(weight)) return;
          const accepted = append(value, weight);
          waiters.shift();
          resume(Effect.succeed(accepted));
          wake();
        },
        cancel: () => resume(Effect.succeed(false)),
      };
      waiters.push(waiter);
      observe();
      return Effect.sync(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) {
          waiters.splice(index, 1);
          wake();
          observe();
        }
      });
    });
  });
  const take = Effect.uninterruptibleMask((restore) =>
    restore(Queue.take(queue)).pipe(
      Effect.tap((entry) => Effect.sync(() => release([entry]))),
      Effect.map((entry) => entry.value),
    ),
  );
  const takeAll = Queue.takeAll(queue).pipe(
    Effect.tap((entries) => Effect.sync(() => release(entries))),
    Effect.map((entries) => entries.map((entry) => entry.value)),
  );
  const stopWaiting = () => {
    closed = true;
    for (const waiter of waiters.splice(0)) waiter.cancel();
    releaseProviderPipelineQueue("provider", metricsOwner);
  };
  return {
    offer,
    offerAll: (values: Iterable<A>) =>
      Effect.forEach(values, offer).pipe(Effect.map((accepted) => accepted.every(Boolean))),
    tryOffer,
    take,
    takeAll,
    stream: Stream.fromQueue(queue).pipe(
      Stream.mapEffect((entry) =>
        Effect.sync(() => {
          release([entry]);
          return entry.value;
        }),
      ),
    ),
    shutdown: Effect.sync(stopWaiting).pipe(Effect.andThen(Queue.shutdown(queue))),
    fail: (error: E) =>
      Effect.sync(stopWaiting).pipe(Effect.andThen(Queue.fail(queue, error)), Effect.asVoid),
  } satisfies BoundedProviderEventQueue<A, E>;
});

interface EventSubscriber<A> {
  readonly filter: (value: A) => boolean;
  readonly deliver: (value: A) => Effect.Effect<boolean>;
  readonly shutdown: Effect.Effect<void>;
}

export const makeBoundedProviderEventBroadcast = Effect.fnUntraced(function* <A>(
  options: BoundedProviderEventQueueOptions<A> & {
    readonly keyOf?: (value: A) => string;
    readonly bufferUntilSubscribed?: boolean;
    readonly maxItemsPerKey?: number;
    readonly maxBytesPerKey?: number;
  },
) {
  let closed = false;
  const subscribers = new Set<EventSubscriber<A>>();
  const locks = new Map<string, { readonly mutex: Semaphore.Semaphore; users: number }>();
  const keyOf = options.keyOf ?? (() => "");
  const registerQueue = Effect.fnUntraced(function* (
    subscription: ProviderEventSubscriptionOptions<A>,
  ) {
    const queue = yield* makeBoundedProviderEventQueue<A, ProviderEventOverflow>(options);
    const subscriber: EventSubscriber<A> = {
      filter: subscription.filter ?? (() => true),
      deliver:
        subscription.delivery === "lossless"
          ? queue.offer
          : (value) =>
              Effect.sync(() => queue.tryOffer(value)).pipe(
                Effect.flatMap((accepted) =>
                  accepted
                    ? Effect.succeed(true)
                    : queue.fail(new ProviderEventOverflow()).pipe(
                        Effect.tap(() =>
                          Effect.sync(() => {
                            subscribers.delete(subscriber);
                          }),
                        ),
                        Effect.as(true),
                      ),
                ),
              ),
      shutdown: queue.shutdown,
    };
    if (closed) yield* queue.shutdown;
    else subscribers.add(subscriber);
    return { queue, subscriber };
  });
  const unregister = (subscriber: EventSubscriber<A>) =>
    Effect.sync(() => {
      subscribers.delete(subscriber);
    }).pipe(Effect.andThen(subscriber.shutdown));

  const subscribe = registerQueue({ delivery: "lossless" }).pipe(
    Effect.map(({ queue }) => ({
      ...queue,
      take: queue.take.pipe(Effect.orDie),
      takeAll: queue.takeAll.pipe(Effect.orDie),
      stream: queue.stream.pipe(Stream.orDie),
    })),
  );
  const subscribeFiltered = (subscription: ProviderEventSubscriptionOptions<A>) =>
    Effect.acquireRelease(registerQueue(subscription), ({ subscriber }) =>
      unregister(subscriber),
    ).pipe(Effect.map(({ queue }) => queue.stream));
  const subscribeScoped = subscribeFiltered({ delivery: "lossless" }).pipe(
    Effect.map((stream) => stream.pipe(Stream.orDie)),
  );
  // Queue-backed adapters previously buffered startup events for legacy readers.
  // Durable consumers register their own lossless lanes before starting a session.
  const startup = options.bufferUntilSubscribed
    ? yield* registerQueue({ delivery: "replayable" })
    : undefined;
  const stream = startup
    ? startup.queue.stream.pipe(Stream.orDie)
    : Stream.unwrap(subscribeFiltered({ delivery: "replayable" })).pipe(Stream.orDie);

  const consume = Effect.fnUntraced(function* (
    handler: (value: A) => Effect.Effect<unknown>,
    subscription: ProviderEventSubscriptionOptions<A> & { readonly delivery: "lossless" },
  ) {
    const metricsOwner = {};
    const workerScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void).pipe(
        Effect.tap(() => Effect.sync(() => releaseProviderPipelineQueue("provider", metricsOwner))),
      ),
    );
    const worker = yield* makeKeyedDrainableWorker(
      (value: A) =>
        handler(value).pipe(
          Effect.asVoid,
          Effect.onError((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Provider event consumer failed", { cause }),
          ),
        ),
      {
        keyOf,
        weightOf: options.sizeOf,
        maxItemsPerKey: Math.min(
          options.capacity,
          options.maxItemsPerKey ?? PROVIDER_SESSION_EVENT_QUEUE_CAPACITY,
        ),
        maxBytesPerKey: Math.min(
          options.byteCapacity,
          options.maxBytesPerKey ?? PROVIDER_SESSION_EVENT_QUEUE_BYTE_CAPACITY,
        ),
        maxItems: options.capacity,
        maxBytes: options.byteCapacity,
        onAccepted: (event) => recordProviderPipelineQueue("provider", event.usage, metricsOwner),
        onStart: (event) => {
          recordProviderPipelineQueue("provider", event.usage, metricsOwner);
          recordProviderPipelineDuration("provider_queue_wait", event.waitMs);
        },
        onComplete: (event) => recordProviderPipelineQueue("provider", event.usage, metricsOwner),
        onBackpressureStart: (event) =>
          recordProviderPipelineQueue("provider", event.usage, metricsOwner),
        onBackpressure: (event) =>
          recordProviderPipelineQueue("provider", event.usage, metricsOwner),
      },
    ).pipe(Effect.provideService(Scope.Scope, workerScope));
    const subscriber: EventSubscriber<A> = {
      filter: subscription.filter ?? (() => true),
      deliver: worker.enqueue,
      shutdown: Scope.close(workerScope, Exit.void).pipe(
        Effect.tap(() => Effect.sync(() => releaseProviderPipelineQueue("provider", metricsOwner))),
      ),
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        if (!closed) subscribers.add(subscriber);
      }),
      () => unregister(subscriber),
    );
  });
  const publish = (value: A) =>
    Effect.suspend(() => {
      if (closed) return Effect.succeed(false);
      const key = keyOf(value);
      let lock = locks.get(key);
      if (!lock) {
        lock = { mutex: Semaphore.makeUnsafe(1), users: 0 };
        locks.set(key, lock);
      }
      lock.users += 1;
      const currentLock = lock;
      return currentLock.mutex
        .withPermit(
          Effect.suspend(() =>
            closed
              ? Effect.succeed(false)
              : Effect.forEach(
                  Array.from(subscribers).filter((subscriber) => subscriber.filter(value)),
                  (subscriber) => subscriber.deliver(value),
                ).pipe(Effect.map((accepted) => accepted.every(Boolean))),
          ),
        )
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              currentLock.users -= 1;
              if (currentLock.users === 0) locks.delete(key);
            }),
          ),
        );
    });
  const shutdown = Effect.suspend(() => {
    closed = true;
    const current = Array.from(subscribers);
    subscribers.clear();
    return Effect.forEach(current, (subscriber) => subscriber.shutdown, { discard: true });
  });
  return {
    subscribe,
    subscribeScoped,
    subscribeFiltered,
    consume,
    stream,
    publish,
    shutdown,
  } satisfies BoundedProviderEventBroadcast<A>;
});
