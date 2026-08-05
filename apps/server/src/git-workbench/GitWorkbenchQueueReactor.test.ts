import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { GitWorkbenchQueue, type GitWorkbenchQueueShape } from "./GitWorkbenchQueueService.ts";
import {
  GitWorkbenchQueueReactor,
  GitWorkbenchQueueReactorLive,
} from "./GitWorkbenchQueueReactor.ts";
import { TurnQuiescenceNotifier, TurnQuiescenceNotifierLive } from "./TurnQuiescenceNotifier.ts";

it.effect("recovers persisted workflows before consuming production quiescence events", () =>
  Effect.gen(function* () {
    const consumed = yield* Deferred.make<string>();
    const calls: Array<string> = [];
    const queue: GitWorkbenchQueueShape = {
      createOrReplace: () => Effect.die("not used"),
      edit: () => Effect.die("not used"),
      cancel: () => Effect.die("not used"),
      get: () => Effect.succeed(Option.none()),
      subscribe: () => Effect.die("not used"),
      drain: () => Effect.die("not used"),
      recover: () => Effect.sync(() => calls.push("recover")).pipe(Effect.asVoid),
      handleQuiescence: (event) =>
        Effect.sync(() => calls.push(`turn:${event.turnId}`)).pipe(
          Effect.andThen(Deferred.succeed(consumed, event.turnId)),
          Effect.asVoid,
        ),
    };
    const layer = GitWorkbenchQueueReactorLive.pipe(
      Layer.provideMerge(TurnQuiescenceNotifierLive),
      Layer.provide(Layer.succeed(GitWorkbenchQueue, queue)),
    );

    yield* Effect.gen(function* () {
      const reactor = yield* GitWorkbenchQueueReactor;
      const notifier = yield* TurnQuiescenceNotifier;
      yield* reactor.start;
      yield* notifier.publish({
        type: "turn.processing.quiesced",
        threadId: "thread-1",
        turnId: "turn-1",
        checkpointTurnCount: 1,
        createdAt: "2026-08-02T10:00:00.000Z",
      });
      yield* Deferred.await(consumed);
    }).pipe(Effect.provide(layer));

    expect(calls).toEqual(["recover", "turn:turn-1"]);
  }),
);
