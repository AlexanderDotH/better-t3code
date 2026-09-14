import { EnvironmentId, WS_METHODS, type AiEndpointDiscoveryEvent } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createAiEndpointDiscoveryAtoms } from "./aiEndpoints.ts";

it.effect(
  "isolates discovery, refreshes on request, and cancels closed or unsupported environments",
  () =>
    Effect.gen(function* () {
      const firstEnvironment = EnvironmentId.make("first");
      const secondEnvironment = EnvironmentId.make("second");
      const oldEnvironment = EnvironmentId.make("old-server");
      const started = yield* Queue.unbounded<{ environmentId: EnvironmentId; refresh?: boolean }>();
      const cancelled = yield* Queue.unbounded<EnvironmentId>();
      const calls: EnvironmentId[] = [];
      const supervisors = new Map<EnvironmentId, EnvironmentSupervisor["Service"]>();

      for (const environmentId of [firstEnvironment, secondEnvironment, oldEnvironment]) {
        const event: AiEndpointDiscoveryEvent = {
          status: "scanning",
          endpoints: [
            {
              baseUrl: `http://${environmentId}.test/v1`,
              kind: "openaiCompatible",
              verified: true,
              requiresApiKey: false,
              models: [],
            },
          ],
          scanned: 1,
          total: 2,
          limited: false,
        };
        const client = {
          [WS_METHODS.serverDiscoverAiEndpoints]: (input: { refresh?: boolean }) => {
            calls.push(environmentId);
            return Stream.succeed(event).pipe(
              Stream.concat(Stream.never),
              Stream.onStart(Queue.offer(started, { environmentId, ...input })),
              Stream.ensuring(Queue.offer(cancelled, environmentId)),
            );
          },
        } as unknown as WsRpcProtocolClient;
        const session: RpcSession = {
          client,
          initialConfig: Effect.never,
          subscribeServerConfig: () => Stream.never,
          ready: Effect.void,
          probe: Effect.void,
          closed: Effect.never,
        };
        supervisors.set(
          environmentId,
          EnvironmentSupervisor.of({
            session: yield* SubscriptionRef.make(Option.some(session)),
          } as unknown as EnvironmentSupervisor["Service"]),
        );
      }

      const environmentRegistry = EnvironmentRegistry.of({
        runStream: (environmentId, stream) =>
          Stream.provideService(stream, EnvironmentSupervisor, supervisors.get(environmentId)!),
      } as EnvironmentRegistry["Service"]);
      const runtime = Atom.runtime(Layer.succeed(EnvironmentRegistry, environmentRegistry));
      const supportedAtom = Atom.family((environmentId: EnvironmentId) =>
        Atom.make(environmentId !== oldEnvironment),
      );
      const discovery = createAiEndpointDiscoveryAtoms(runtime, supportedAtom);
      const registry = AtomRegistry.make();
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const firstState = discovery.aiEndpointDiscovery(firstEnvironment);
      const secondState = discovery.aiEndpointDiscovery(secondEnvironment);
      const oldState = discovery.aiEndpointDiscovery(oldEnvironment);
      registry.mount(firstState);
      const unmountSecond = registry.mount(secondState);
      registry.mount(oldState);

      discovery.startAiEndpointDiscovery(registry, { environmentId: oldEnvironment, input: {} });
      discovery.startAiEndpointDiscovery(registry, { environmentId: firstEnvironment, input: {} });
      expect(yield* Queue.take(started)).toEqual({ environmentId: firstEnvironment });
      discovery.startAiEndpointDiscovery(registry, { environmentId: secondEnvironment, input: {} });
      expect(yield* Queue.take(started)).toEqual({ environmentId: secondEnvironment });

      const firstEvent = yield* AtomRegistry.toStream(registry, firstState).pipe(
        Stream.filter(AsyncResult.isSuccess),
        Stream.map((result) => result.value),
        Stream.filter((event) => event !== null),
        Stream.runHead,
      );
      expect(Option.getOrThrow(firstEvent)?.endpoints[0]?.baseUrl).toBe("http://first.test/v1");
      discovery.startAiEndpointDiscovery(registry, {
        environmentId: firstEnvironment,
        input: { refresh: true },
      });
      expect(yield* Queue.take(cancelled)).toBe(firstEnvironment);
      expect(yield* Queue.take(started)).toEqual({
        environmentId: firstEnvironment,
        refresh: true,
      });
      discovery.cancelAiEndpointDiscovery(registry, firstEnvironment);
      expect(yield* Queue.take(cancelled)).toBe(firstEnvironment);

      discovery.startAiEndpointDiscovery(registry, { environmentId: firstEnvironment, input: {} });
      expect(yield* Queue.take(started)).toEqual({ environmentId: firstEnvironment });
      registry.set(supportedAtom(firstEnvironment), false);
      expect(yield* Queue.take(cancelled)).toBe(firstEnvironment);
      const unsupportedState = yield* AtomRegistry.toStream(registry, firstState).pipe(
        Stream.filter(AsyncResult.isSuccess),
        Stream.filter((result) => result.value === null),
        Stream.runHead,
      );
      expect(Option.getOrThrow(unsupportedState).value).toBeNull();
      discovery.startAiEndpointDiscovery(registry, { environmentId: firstEnvironment, input: {} });

      unmountSecond();
      expect(yield* Queue.take(cancelled)).toBe(secondEnvironment);
      expect(calls).toEqual([
        firstEnvironment,
        secondEnvironment,
        firstEnvironment,
        firstEnvironment,
      ]);
      expect(firstState.idleTTL).toBe(0);
    }).pipe(Effect.scoped),
);
