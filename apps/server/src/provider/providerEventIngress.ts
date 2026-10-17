import * as Effect from "effect/Effect";
import {
  CurrentProviderEvent,
  stampProviderIngress,
} from "../observability/ProviderPipelineMetrics.ts";

/** Keeps native ingress time through canonical events that omit or sanitize raw payloads. */
export function withProviderEventIngress<A, E, R>(
  source: object,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  stampProviderIngress(source);
  return effect.pipe(Effect.provideService(CurrentProviderEvent, source));
}
