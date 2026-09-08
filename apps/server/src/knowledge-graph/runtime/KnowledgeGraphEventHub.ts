import type { KnowledgeGraphScopeId, KnowledgeGraphStreamEvent } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

function eventScopeId(event: KnowledgeGraphStreamEvent): KnowledgeGraphScopeId {
  return event.type === "snapshot" ? event.scope.scopeId : event.scopeId;
}

export class KnowledgeGraphEventHub extends Context.Service<
  KnowledgeGraphEventHub,
  {
    readonly publish: (event: KnowledgeGraphStreamEvent) => Effect.Effect<void>;
    readonly subscribe: (
      scopeId: KnowledgeGraphScopeId,
    ) => Effect.Effect<Stream.Stream<KnowledgeGraphStreamEvent>, never, Scope.Scope>;
  }
>()("t3/knowledge-graph/runtime/KnowledgeGraphEventHub") {}

const make = Effect.gen(function* () {
  const events = yield* PubSub.unbounded<KnowledgeGraphStreamEvent>();
  return KnowledgeGraphEventHub.of({
    publish: (event) => PubSub.publish(events, event).pipe(Effect.asVoid),
    subscribe: (scopeId) =>
      PubSub.subscribe(events).pipe(
        Effect.map((subscription) =>
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => eventScopeId(event) === scopeId),
          ),
        ),
      ),
  });
});

export const layer = Layer.effect(KnowledgeGraphEventHub, make);
