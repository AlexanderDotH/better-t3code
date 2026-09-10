import {
  type AiEndpointDiscoveryEvent,
  type AiEndpointDiscoveryInput,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { runStream } from "../rpc/client.ts";
import { runStreamInEnvironment } from "./runtime.ts";

export function createAiEndpointDiscoveryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  supportedAtom: (environmentId: EnvironmentId) => Atom.Atom<boolean>,
) {
  const inputAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make<AiEndpointDiscoveryInput | null>(null).pipe(
      Atom.setIdleTTL(0),
      Atom.withLabel(`ai-endpoint-discovery:input:${environmentId}`),
    ),
  );
  const aiEndpointDiscovery = Atom.family((environmentId: EnvironmentId) =>
    runtime
      .atom((get) => {
        const input = get(inputAtom(environmentId));
        if (input === null || !get(supportedAtom(environmentId))) {
          return Stream.succeed<AiEndpointDiscoveryEvent | null>(null);
        }
        return runStreamInEnvironment(
          environmentId,
          runStream(WS_METHODS.serverDiscoverAiEndpoints, input),
        );
      })
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`ai-endpoint-discovery:state:${environmentId}`)),
  );

  return {
    aiEndpointDiscovery,
    startAiEndpointDiscovery(
      registry: AtomRegistry.AtomRegistry,
      target: { readonly environmentId: EnvironmentId; readonly input: AiEndpointDiscoveryInput },
    ): void {
      if (!registry.get(supportedAtom(target.environmentId))) return;
      registry.set(inputAtom(target.environmentId), { ...target.input });
    },
    cancelAiEndpointDiscovery(
      registry: AtomRegistry.AtomRegistry,
      environmentId: EnvironmentId,
    ): void {
      registry.set(inputAtom(environmentId), null);
    },
  };
}
