import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";

import type { TurnProcessingQuiescedReceipt } from "../orchestration/Services/RuntimeReceiptBus.ts";

export interface TurnQuiescenceNotifierShape {
  readonly publish: (event: TurnProcessingQuiescedReceipt) => Effect.Effect<void>;
  readonly subscribe: Effect.Effect<
    PubSub.Subscription<TurnProcessingQuiescedReceipt>,
    never,
    Scope.Scope
  >;
}

export class TurnQuiescenceNotifier extends Context.Service<
  TurnQuiescenceNotifier,
  TurnQuiescenceNotifierShape
>()("t3/git-workbench/TurnQuiescenceNotifier") {}

const make = Effect.gen(function* () {
  const events = yield* Effect.acquireRelease(
    PubSub.unbounded<TurnProcessingQuiescedReceipt>(),
    PubSub.shutdown,
  );

  return TurnQuiescenceNotifier.of({
    publish: (event) => PubSub.publish(events, event).pipe(Effect.asVoid),
    subscribe: PubSub.subscribe(events),
  });
});

export const TurnQuiescenceNotifierLive = Layer.effect(TurnQuiescenceNotifier, make);
