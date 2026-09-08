import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";

import { GitWorkbenchQueue, type GitWorkbenchQueueError } from "./GitWorkbenchQueueService.ts";
import { TurnQuiescenceNotifier } from "./TurnQuiescenceNotifier.ts";

export interface GitWorkbenchQueueReactorShape {
  readonly start: Effect.Effect<void, GitWorkbenchQueueError, Scope.Scope>;
}

export class GitWorkbenchQueueReactor extends Context.Service<
  GitWorkbenchQueueReactor,
  GitWorkbenchQueueReactorShape
>()("t3/git-workbench/GitWorkbenchQueueReactor") {}

const make = Effect.gen(function* () {
  const queue = yield* GitWorkbenchQueue;
  const notifier = yield* TurnQuiescenceNotifier;
  const started = yield* Ref.make(false);

  const start = Effect.gen(function* () {
    const alreadyStarted = yield* Ref.getAndSet(started, true);
    if (alreadyStarted) return;

    const subscription = yield* notifier.subscribe;
    yield* queue.recover();
    yield* Effect.forkScoped(
      Effect.forever(
        PubSub.take(subscription).pipe(
          Effect.flatMap(queue.handleQuiescence),
          Effect.catchCause((cause) =>
            Effect.logError("Git workbench queued workflow failed after turn quiescence.").pipe(
              Effect.annotateLogs({ cause }),
            ),
          ),
        ),
      ),
    );
  });

  return GitWorkbenchQueueReactor.of({ start });
});

export const GitWorkbenchQueueReactorLive = Layer.effect(GitWorkbenchQueueReactor, make);

export const GitWorkbenchQueueReactorWorkerLive = Layer.effectDiscard(
  Effect.service(GitWorkbenchQueueReactor).pipe(Effect.flatMap((reactor) => reactor.start)),
);
