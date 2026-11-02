import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";

import type { RunId, TurnId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Stream from "effect/Stream";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { isRunQuiesced } from "./GitWorkbenchRuntime.ts";

interface ProcessingQuiescedReceipt {
  readonly type: "turn.processing.quiesced";
  readonly threadId: ThreadId;
  readonly checkpointTurnCount: number;
  readonly createdAt: string;
}
export type TurnProcessingQuiescedReceipt = ProcessingQuiescedReceipt &
  (
    | { readonly runId: RunId; readonly turnId?: never }
    | { readonly turnId: TurnId; readonly runId?: never }
  );

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
    publish: Effect.fn("TurnQuiescenceNotifier.publish")((event) =>
      PubSub.publish(events, event).pipe(Effect.asVoid),
    ),
    subscribe: PubSub.subscribe(events),
  });
});

export const TurnQuiescenceNotifierLive = Layer.effect(TurnQuiescenceNotifier, make);

export const workerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const projection = yield* ProjectionStore.ProjectionStoreV2;
    const notifier = yield* TurnQuiescenceNotifier;
    const afterSequence = yield* sink.latestSequence();
    yield* sink.stream({ afterSequence, bounded: false }).pipe(
      Stream.map((stored) => stored.event),
      Stream.filter(
        (event) => event.type === "run.updated" || event.type === "checkpoint.captured",
      ),
      Stream.runForEach(
        Effect.fn("GitWorkbench.notifyQuiescence")(function* (event) {
          const runId =
            event.type === "run.updated"
              ? event.payload.id
              : event.type === "checkpoint.captured"
                ? event.payload.runId
                : null;
          if (runId === null) return;
          const current = yield* projection.getThreadRecords(event.threadId, [
            "runs",
            "checkpoints",
          ]);
          if (!isRunQuiesced(current, runId)) return;
          yield* notifier.publish({
            type: "turn.processing.quiesced",
            threadId: event.threadId,
            runId,
            checkpointTurnCount: current.checkpoints.length,
            createdAt: DateTime.formatIso(event.occurredAt),
          });
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Git workbench quiescence subscription failed", { cause }),
      ),
      Effect.forkScoped,
    );
  }),
);
