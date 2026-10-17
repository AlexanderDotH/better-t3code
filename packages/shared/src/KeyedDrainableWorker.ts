import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TxQueue from "effect/TxQueue";
import * as TxRef from "effect/TxRef";

export const KEYED_DRAINABLE_WORKER_DEFAULTS = {
  concurrency: 8,
  maxItemsPerKey: 256,
  maxBytesPerKey: 32 * 1024 * 1024,
  maxItems: 512,
  maxBytes: 64 * 1024 * 1024,
} as const;

export interface KeyedWorkerUsage {
  readonly queuedItems: number;
  readonly queuedBytes: number;
  readonly runningItems: number;
  readonly runningBytes: number;
  readonly waitingOffers: number;
  readonly activeKeys: number;
  readonly keyCount: number;
}

export interface KeyedWorkerObservation<K, A> {
  readonly key: K;
  readonly input: A;
  readonly bytes: number;
  readonly chargedBytes: number;
  readonly enqueuedAt: number;
  readonly acceptedAt: number;
  readonly usage: KeyedWorkerUsage;
}

export interface KeyedWorkerStart<K, A> extends KeyedWorkerObservation<K, A> {
  readonly startedAt: number;
  readonly waitMs: number;
}

export interface KeyedWorkerCompletion<K, A> extends KeyedWorkerStart<K, A> {
  readonly completedAt: number;
  readonly processMs: number;
  readonly exit: Exit.Exit<void, unknown>;
}

export interface KeyedDrainableWorkerOptions<K, A> {
  readonly keyOf: (input: A) => K;
  readonly weightOf: (input: A) => number;
  readonly concurrency?: number;
  readonly maxItemsPerKey?: number;
  readonly maxBytesPerKey?: number;
  readonly maxItems?: number;
  readonly maxBytes?: number;
  readonly now?: () => number;
  readonly onAccepted?: (event: KeyedWorkerObservation<K, A>) => void;
  readonly onStart?: (event: KeyedWorkerStart<K, A>) => void;
  readonly onComplete?: (event: KeyedWorkerCompletion<K, A>) => void;
  readonly onBackpressureStart?: (event: {
    readonly key: K;
    readonly input: A;
    readonly bytes: number;
    readonly enqueuedAt: number;
    readonly usage: KeyedWorkerUsage;
  }) => void;
  readonly onBackpressure?: (
    event: KeyedWorkerObservation<K, A> & { readonly blockedMs: number },
  ) => void;
}

export interface KeyedDrainableWorker<A> {
  /** Waits for capacity without preventing other keys from accepting or processing work. */
  readonly enqueue: (input: A) => Effect.Effect<boolean>;
  /** Includes accepted work and pending offers, including work enqueued by a handler. */
  readonly drain: Effect.Effect<void>;
  readonly snapshot: Effect.Effect<KeyedWorkerUsage>;
}

interface Entry<A> {
  readonly input: A;
  readonly bytes: number;
  readonly chargedBytes: number;
  readonly enqueuedAt: number;
  readonly acceptedAt: number;
}

interface KeyState<A> {
  readonly queue: ReadonlyArray<Entry<A>>;
  readonly waiting: ReadonlyArray<object>;
  readonly running: boolean;
  readonly items: number;
  readonly bytes: number;
}

interface State<K, A> {
  readonly keys: ReadonlyMap<K, KeyState<A>>;
  readonly queuedItems: number;
  readonly queuedBytes: number;
  readonly runningItems: number;
  readonly runningBytes: number;
  readonly waitingOffers: number;
  readonly closed: boolean;
}

const emptyState = <K, A>(closed = false): State<K, A> => ({
  keys: new Map(),
  queuedItems: 0,
  queuedBytes: 0,
  runningItems: 0,
  runningBytes: 0,
  waitingOffers: 0,
  closed,
});

const emptyKey = <A>(): KeyState<A> => ({
  queue: [],
  waiting: [],
  running: false,
  items: 0,
  bytes: 0,
});

const usageOf = <K, A>(state: State<K, A>): KeyedWorkerUsage => ({
  queuedItems: state.queuedItems,
  queuedBytes: state.queuedBytes,
  runningItems: state.runningItems,
  runningBytes: state.runningBytes,
  waitingOffers: state.waitingOffers,
  activeKeys: state.runningItems,
  keyCount: state.keys.size,
});

const withKey = <K, A>(state: State<K, A>, key: K, value: KeyState<A>): State<K, A> => {
  const keys = new Map(state.keys);
  if (value.items === 0 && value.waiting.length === 0) {
    keys.delete(key);
  } else {
    keys.set(key, value);
  }
  return { ...state, keys };
};

const notify = <A>(hook: ((event: A) => void) | undefined, event: A): void => {
  try {
    hook?.(event);
  } catch {
    // Observers cannot change delivery, accounting, or worker lifetime.
  }
};

const capacity = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
};

/**
 * Processes one input per ready-key turn, serially per key and concurrently across keys.
 * Bounds include running inputs. Oversized inputs occupy the entire byte budget as one
 * item; callers must also bound their source buffers and concurrent pending offers.
 * Inputs are retained by reference and should remain immutable until processing finishes.
 */
export const makeKeyedDrainableWorker = <A, K, E, R>(
  process: (input: A) => Effect.Effect<void, E, R>,
  options: KeyedDrainableWorkerOptions<K, A>,
): Effect.Effect<KeyedDrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const limits = {
      concurrency: capacity(
        options.concurrency ?? KEYED_DRAINABLE_WORKER_DEFAULTS.concurrency,
        "concurrency",
      ),
      maxItemsPerKey: capacity(
        options.maxItemsPerKey ?? KEYED_DRAINABLE_WORKER_DEFAULTS.maxItemsPerKey,
        "maxItemsPerKey",
      ),
      maxBytesPerKey: capacity(
        options.maxBytesPerKey ?? KEYED_DRAINABLE_WORKER_DEFAULTS.maxBytesPerKey,
        "maxBytesPerKey",
      ),
      maxItems: capacity(options.maxItems ?? KEYED_DRAINABLE_WORKER_DEFAULTS.maxItems, "maxItems"),
      maxBytes: capacity(options.maxBytes ?? KEYED_DRAINABLE_WORKER_DEFAULTS.maxBytes, "maxBytes"),
    };
    const now = options.now ?? (() => performance.now());
    const ready = yield* Effect.acquireRelease(TxQueue.unbounded<K>(), TxQueue.shutdown);
    const stateRef = yield* TxRef.make(emptyState<K, A>());

    const fits = (state: State<K, A>, key: KeyState<A>, bytes: number): boolean =>
      key.items < limits.maxItemsPerKey &&
      key.bytes + bytes <= limits.maxBytesPerKey &&
      state.queuedItems + state.runningItems < limits.maxItems &&
      state.queuedBytes + state.runningBytes + bytes <= limits.maxBytes;

    const accept = Effect.fnUntraced(function* (
      state: State<K, A>,
      key: K,
      keyState: KeyState<A>,
      entry: Entry<A>,
      wasWaiting: boolean,
    ) {
      const next = withKey(
        {
          ...state,
          queuedItems: state.queuedItems + 1,
          queuedBytes: state.queuedBytes + entry.chargedBytes,
          waitingOffers: state.waitingOffers - Number(wasWaiting),
        },
        key,
        {
          ...keyState,
          queue: [...keyState.queue, entry],
          waiting: wasWaiting ? keyState.waiting.slice(1) : keyState.waiting,
          items: keyState.items + 1,
          bytes: keyState.bytes + entry.chargedBytes,
        },
      );
      yield* TxRef.set(stateRef, next);
      if (!keyState.running && keyState.queue.length === 0) {
        yield* TxQueue.offer(ready, key);
      }
      return { ...entry, key, usage: usageOf(next) };
    });

    const cancelOffer = (key: K, ticket: object) =>
      TxRef.update(stateRef, (state) => {
        const keyState = state.keys.get(key);
        if (!keyState?.waiting.includes(ticket)) return state;
        return withKey({ ...state, waitingOffers: state.waitingOffers - 1 }, key, {
          ...keyState,
          waiting: keyState.waiting.filter((pending) => pending !== ticket),
        });
      });

    const enqueue = (input: A): Effect.Effect<boolean> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const key = options.keyOf(input);
          const bytes = options.weightOf(input);
          if (!Number.isFinite(bytes) || bytes < 0) {
            return yield* Effect.die(new RangeError("Input weight must be finite and nonnegative"));
          }
          const chargedBytes = Math.min(Math.ceil(bytes), limits.maxBytesPerKey, limits.maxBytes);
          const enqueuedAt = now();
          const ticket = {};
          const registration = yield* Effect.gen(function* () {
            const state = yield* TxRef.get(stateRef);
            if (state.closed) return { kind: "closed" } as const;
            const keyState = state.keys.get(key) ?? emptyKey<A>();
            if (keyState.waiting.length === 0 && fits(state, keyState, chargedBytes)) {
              const event = yield* accept(
                state,
                key,
                keyState,
                { input, bytes, chargedBytes, enqueuedAt, acceptedAt: now() },
                false,
              );
              return { kind: "accepted", event } as const;
            }
            const next = withKey({ ...state, waitingOffers: state.waitingOffers + 1 }, key, {
              ...keyState,
              waiting: [...keyState.waiting, ticket],
            });
            yield* TxRef.set(stateRef, next);
            return { kind: "waiting", usage: usageOf(next) } as const;
          }).pipe(Effect.tx);

          if (registration.kind === "closed") return false;
          if (registration.kind === "accepted") {
            notify(options.onAccepted, registration.event);
            return true;
          }

          notify(options.onBackpressureStart, {
            key,
            input,
            bytes,
            enqueuedAt,
            usage: registration.usage,
          });

          const event = yield* restore(
            Effect.gen(function* () {
              const state = yield* TxRef.get(stateRef);
              if (state.closed) return undefined;
              const keyState = state.keys.get(key);
              if (keyState?.waiting[0] !== ticket || !fits(state, keyState, chargedBytes)) {
                return yield* Effect.txRetry;
              }
              return yield* accept(
                state,
                key,
                keyState,
                { input, bytes, chargedBytes, enqueuedAt, acceptedAt: now() },
                true,
              );
            }).pipe(Effect.tx),
          ).pipe(Effect.ensuring(cancelOffer(key, ticket)));

          if (event === undefined) return false;
          notify(options.onBackpressure, {
            ...event,
            blockedMs: Math.max(0, event.acceptedAt - enqueuedAt),
          });
          notify(options.onAccepted, event);
          return true;
        }),
      );

    const take = Effect.gen(function* () {
      const key = yield* TxQueue.take(ready);
      const state = yield* TxRef.get(stateRef);
      if (state.closed) return yield* Effect.interrupt;
      const keyState = state.keys.get(key);
      const entry = keyState?.queue[0];
      if (keyState === undefined || entry === undefined) {
        return yield* Effect.die("Ready key has no queued input");
      }
      const next = withKey(
        {
          ...state,
          queuedItems: state.queuedItems - 1,
          queuedBytes: state.queuedBytes - entry.chargedBytes,
          runningItems: state.runningItems + 1,
          runningBytes: state.runningBytes + entry.chargedBytes,
        },
        key,
        { ...keyState, queue: keyState.queue.slice(1), running: true },
      );
      yield* TxRef.set(stateRef, next);
      return { ...entry, key, usage: usageOf(next) };
    }).pipe(Effect.tx);

    const finish = Effect.fnUntraced(function* (
      event: KeyedWorkerStart<K, A>,
      exit: Exit.Exit<void, E>,
    ) {
      const usage = yield* Effect.gen(function* () {
        const state = yield* TxRef.get(stateRef);
        const keyState = state.keys.get(event.key);
        if (state.closed || keyState === undefined) return usageOf(state);
        const next = withKey(
          {
            ...state,
            runningItems: state.runningItems - 1,
            runningBytes: state.runningBytes - event.chargedBytes,
          },
          event.key,
          {
            ...keyState,
            running: false,
            items: keyState.items - 1,
            bytes: keyState.bytes - event.chargedBytes,
          },
        );
        yield* TxRef.set(stateRef, next);
        if (keyState.queue.length > 0) yield* TxQueue.offer(ready, event.key);
        return usageOf(next);
      }).pipe(Effect.tx);
      const completedAt = now();
      notify(options.onComplete, {
        ...event,
        usage,
        completedAt,
        processMs: Math.max(0, completedAt - event.startedAt),
        exit,
      });
    });

    const workOne = Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const item = yield* restore(take);
        const startedAt = now();
        const event = {
          ...item,
          startedAt,
          waitMs: Math.max(0, startedAt - item.enqueuedAt),
        };
        notify(options.onStart, event);
        const exit = yield* Effect.exit(restore(Effect.suspend(() => process(item.input))));
        yield* finish(event, exit);
      }),
    );

    for (let index = 0; index < limits.concurrency; index++) {
      yield* workOne.pipe(Effect.forever, Effect.forkScoped);
    }
    yield* Effect.addFinalizer(() => TxRef.set(stateRef, emptyState<K, A>(true)));

    const drain = TxRef.get(stateRef).pipe(
      Effect.tap((state) =>
        state.queuedItems + state.runningItems + state.waitingOffers > 0
          ? Effect.txRetry
          : Effect.void,
      ),
      Effect.asVoid,
      Effect.tx,
    );

    return { enqueue, drain, snapshot: TxRef.get(stateRef).pipe(Effect.map(usageOf)) };
  });
