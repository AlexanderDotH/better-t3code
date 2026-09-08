import type { ProviderRuntimeEvent, RuntimeSessionId } from "@t3tools/contracts";

/**
 * Captures a provider runtime lease at session creation so delayed callbacks
 * cannot be relabeled with a replacement session's identity.
 */
export function bindProviderRuntimeEventOrigin<A>(
  runtimeSessionId: RuntimeSessionId,
  publish: (event: ProviderRuntimeEvent) => A,
): (event: ProviderRuntimeEvent) => A {
  return (event) => publish(stampProviderRuntimeEventOrigin(runtimeSessionId, event));
}

export function stampProviderRuntimeEventOrigin(
  runtimeSessionId: RuntimeSessionId,
  event: ProviderRuntimeEvent,
): ProviderRuntimeEvent {
  return {
    ...event,
    runtimeSessionId,
  };
}
