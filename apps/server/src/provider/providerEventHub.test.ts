import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import {
  getProviderIngressTime,
  stampProviderIngress,
} from "../observability/ProviderPipelineMetrics.ts";
import { consumeProviderEvents, makeProviderEventHub } from "./providerEventHub.ts";
import { withProviderEventIngress } from "./providerEventIngress.ts";
import { stampProviderRuntimeEventOrigin } from "./runtimeEventOrigin.ts";

function runtimeEvent(
  sequence: number,
  runtimeSessionId = RuntimeSessionId.make("runtime-current"),
): ProviderRuntimeEvent {
  return {
    type: "runtime.error",
    eventId: EventId.make(`event-${sequence}`),
    provider: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    threadId: ThreadId.make("thread"),
    runtimeSessionId,
    createdAt: "2026-10-16T00:00:00.000Z",
    payload: { message: "Test event" },
  };
}

describe("provider event hub", () => {
  it.effect("filters the runtime generation before delivery", () =>
    Effect.gen(function* () {
      const hub = yield* makeProviderEventHub();
      const current = RuntimeSessionId.make("runtime-current");
      const events = yield* hub.subscribeEventStream({
        delivery: "lossless",
        filter: {
          threadId: ThreadId.make("thread"),
          runtimeSessionId: current,
          types: ["runtime.error"],
        },
      });
      yield* hub.publish(runtimeEvent(1, RuntimeSessionId.make("runtime-retired")));
      yield* hub.publish(runtimeEvent(2, current));
      const observed = yield* events.pipe(Stream.take(1), Stream.runCollect);
      expect(observed.map((event) => event.eventId)).toEqual(["event-2"]);
      yield* hub.shutdown;
    }),
  );

  it.effect("keeps native ingress through sanitized events, routing, and lease clones", () =>
    Effect.gen(function* () {
      const hub = yield* makeProviderEventHub();
      const native = stampProviderIngress({ delta: "native" }, 123);
      const observed = yield* Deferred.make<ProviderRuntimeEvent>();
      yield* hub.consumeEvents((event) => Deferred.succeed(observed, event), {
        delivery: "lossless",
      });
      const canonical = runtimeEvent(1);
      yield* withProviderEventIngress(native, hub.publish(canonical));
      const received = yield* Deferred.await(observed);
      const leaseStamped = stampProviderRuntimeEventOrigin(
        RuntimeSessionId.make("replacement"),
        received,
      );
      expect(getProviderIngressTime(received)).toBe(123);
      expect(getProviderIngressTime(leaseStamped)).toBe(123);
      yield* hub.shutdown;
    }),
  );

  it.effect(
    "registers legacy mock streams before returning without touching absent proxy methods",
    () =>
      Effect.gen(function* () {
        const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
        const target = { streamEvents: Stream.fromPubSub(events) };
        // Layer.mock reports every property through its has trap and synthesizes
        // unimplemented optional methods through its get trap.
        const source = new Proxy(target, {
          has: () => true,
          get: (value, property) => {
            if (!Object.hasOwn(value, property)) throw new Error("Missing optional mock method");
            return Reflect.get(value, property);
          },
        });
        const observed = yield* Deferred.make<ProviderRuntimeEvent>();
        yield* consumeProviderEvents(source, (event) => Deferred.succeed(observed, event), {
          delivery: "lossless",
          filter: { types: ["runtime.error"] },
        });
        yield* PubSub.publish(events, runtimeEvent(1));
        expect((yield* Deferred.await(observed)).eventId).toBe("event-1");
        yield* PubSub.shutdown(events);
      }),
  );
});
