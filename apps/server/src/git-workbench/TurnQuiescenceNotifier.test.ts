import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";

import { TurnQuiescenceNotifier, TurnQuiescenceNotifierLive } from "./TurnQuiescenceNotifier.ts";

it.layer(TurnQuiescenceNotifierLive)("TurnQuiescenceNotifier", (it) => {
  it.effect("broadcasts production quiescence events to every current subscriber", () =>
    Effect.gen(function* () {
      const notifier = yield* TurnQuiescenceNotifier;
      const first = yield* notifier.subscribe;
      const second = yield* notifier.subscribe;
      const event = {
        type: "turn.processing.quiesced",
        threadId: "thread-1",
        turnId: "turn-1",
        checkpointTurnCount: 3,
        createdAt: "2026-08-02T10:00:00.000Z",
      } as const;

      yield* notifier.publish(event);

      expect(yield* PubSub.take(first)).toEqual(event);
      expect(yield* PubSub.take(second)).toEqual(event);
    }),
  );
});
