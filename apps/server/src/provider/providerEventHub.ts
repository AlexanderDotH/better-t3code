import type { ProviderRuntimeEvent, RuntimeSessionId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  makeBoundedProviderEventBroadcast,
  providerEventEncodedBytes,
  PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
  PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
  type ProviderEventOverflow,
} from "./boundedEventQueue.ts";
import {
  CurrentProviderEvent,
  recordProviderPipelineDuration,
  stampProviderIngress,
  transferProviderIngress,
} from "../observability/ProviderPipelineMetrics.ts";

export interface ProviderEventFilter {
  readonly threadId?: ThreadId;
  readonly runtimeSessionId?: RuntimeSessionId;
  readonly types?: ReadonlyArray<ProviderRuntimeEvent["type"]>;
}

export interface ProviderEventStreamOptions {
  readonly delivery: "lossless" | "replayable";
  readonly filter?: ProviderEventFilter;
}

export interface ProviderEventConsumerOptions {
  readonly delivery: "lossless";
  readonly filter?: ProviderEventFilter;
}

export type ConsumeProviderEvents = (
  handler: (event: ProviderRuntimeEvent) => Effect.Effect<unknown>,
  options: ProviderEventConsumerOptions,
) => Effect.Effect<void, never, Scope.Scope>;

export type SubscribeProviderEventStream = (
  options: ProviderEventStreamOptions,
) => Effect.Effect<Stream.Stream<ProviderRuntimeEvent, ProviderEventOverflow>, never, Scope.Scope>;

export function providerEventMatchesFilter(
  event: ProviderRuntimeEvent,
  filter?: ProviderEventFilter,
): boolean {
  return (
    (!filter?.threadId || event.threadId === filter.threadId) &&
    (!filter?.runtimeSessionId || event.runtimeSessionId === filter.runtimeSessionId) &&
    (!filter?.types || filter.types.includes(event.type))
  );
}

export function providerEventSessionKey(event: ProviderRuntimeEvent): string {
  return `${event.providerInstanceId ?? event.provider}\u0000${event.threadId}\u0000${event.runtimeSessionId ?? ""}`;
}

interface ProviderEventSource {
  readonly consumeEvents?: ConsumeProviderEvents;
  readonly subscribeEvents?: Effect.Effect<Stream.Stream<ProviderRuntimeEvent>, never, Scope.Scope>;
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}

/** Registers before returning, including when an older test adapter supplies a stream. */
export const consumeProviderEvents = Effect.fnUntraced(function* (
  source: ProviderEventSource,
  handler: (event: ProviderRuntimeEvent) => Effect.Effect<unknown>,
  options: ProviderEventConsumerOptions,
) {
  if (Object.hasOwn(source, "consumeEvents") && source.consumeEvents) {
    yield* source.consumeEvents(handler, options);
    return;
  }
  const events =
    Object.hasOwn(source, "subscribeEvents") && source.subscribeEvents
      ? yield* source.subscribeEvents
      : source.streamEvents;
  yield* events.pipe(
    Stream.filter((event) => providerEventMatchesFilter(event, options.filter)),
    Stream.runForEach(handler),
    Effect.forkScoped({ startImmediately: true }),
  );
});

export const makeProviderEventHub = Effect.fnUntraced(function* (options?: {
  readonly bufferUntilSubscribed?: boolean;
}) {
  const broadcast = yield* makeBoundedProviderEventBroadcast<ProviderRuntimeEvent>({
    capacity: PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
    byteCapacity: PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
    sizeOf: providerEventEncodedBytes,
    keyOf: providerEventSessionKey,
    ...options,
  });
  const publish = Effect.fnUntraced(function* (event: ProviderRuntimeEvent) {
    const source = (yield* CurrentProviderEvent) ?? event.raw?.payload;
    if (typeof source === "object" && source !== null) transferProviderIngress(source, event);
    stampProviderIngress(event);
    const startedAt = performance.now();
    return yield* broadcast.publish(event).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          recordProviderPipelineDuration(
            "blocked_publication",
            performance.now() - startedAt,
            event.provider,
            event,
          );
        }),
      ),
    );
  });
  const consumeEvents: ConsumeProviderEvents = (handler, options) =>
    broadcast.consume(
      (event) => handler(event).pipe(Effect.provideService(CurrentProviderEvent, event)),
      {
        delivery: options.delivery,
        filter: (event) => providerEventMatchesFilter(event, options.filter),
      },
    );
  const subscribeEventStream: SubscribeProviderEventStream = (options) =>
    broadcast.subscribeFiltered({
      delivery: options.delivery,
      filter: (event) => providerEventMatchesFilter(event, options.filter),
    });
  return {
    publish,
    publishAll: (events: Iterable<ProviderRuntimeEvent>) =>
      Effect.forEach(events, publish, { discard: true }),
    consumeEvents,
    subscribeEventStream,
    subscribeEvents: broadcast.subscribeScoped,
    stream: broadcast.stream,
    shutdown: broadcast.shutdown,
  };
});
