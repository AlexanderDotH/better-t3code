import {
  CommandId,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import { EventSinkV2 } from "./EventSink.ts";
import { EventStoreV2 } from "./EventStore.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import { ProjectionStoreV2 } from "./ProjectionStore.ts";
import {
  findReplySourceClosure,
  ReplySourceUnavailableError,
  type ReplySourceClosure,
  type ReplyThreadState,
} from "./ReplyThreadScope.ts";

export class ReplyThreadLifecycleError extends Schema.TaggedError<ReplyThreadLifecycleError>()(
  "ReplyThreadLifecycleError",
  { cause: Schema.Defect() },
) {}

export class ReplyThreadLifecycle extends Context.Service<
  ReplyThreadLifecycle,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly recover: Effect.Effect<void, ReplyThreadLifecycleError>;
    readonly handle: (
      event: OrchestrationV2StoredEvent,
    ) => Effect.Effect<void, ReplyThreadLifecycleError>;
    readonly drain: Effect.Effect<void, ReplyThreadLifecycleError>;
  }
>()("t3/orchestration-v2/ReplyThreadLifecycle") {}

type Work =
  | { readonly type: "recover" }
  | { readonly type: "event"; readonly event: OrchestrationV2StoredEvent };
const lifecycleError = (cause: unknown) => new ReplyThreadLifecycleError({ cause });

const make = Effect.gen(function* () {
  const orchestration = yield* OrchestratorV2;
  const projections = yield* ProjectionStoreV2;
  const eventStore = yield* EventStoreV2;
  const eventSink = yield* EventSinkV2;
  const mutex = yield* Semaphore.make(1);
  const started = yield* Ref.make(false);

  const readThread = Effect.fn("ReplyThreadLifecycle.readThread")((threadId: ThreadId) =>
    projections
      .getThread(threadId)
      .pipe(Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) })),
  );
  const close = Effect.fn("ReplyThreadLifecycle.close")(function* (
    threadId: ThreadId,
    action: "stop" | "delete",
    token: string,
  ) {
    yield* orchestration.dispatch({
      type: action === "delete" ? "thread.delete" : "thread.stop",
      threadId,
      commandId: CommandId.make(`reply-lifecycle:${action}:${token}:${threadId}`),
    });
  });
  const closureToken = Effect.fn("ReplyThreadLifecycle.closureToken")(function* (
    closure: ReplySourceClosure,
  ) {
    const latest = yield* eventStore
      .read({
        threadId: closure.sourceThreadId,
        eventType: closure.action === "delete" ? "thread.deleted" : "thread.archived",
      })
      .pipe(Stream.runLast);
    return Option.isSome(latest)
      ? String(latest.value.sequence)
      : `${closure.sourceThreadId}:${closure.closedAt === null ? "missing" : DateTime.toEpochMillis(closure.closedAt)}`;
  });

  const reconcileReply = Effect.fn("ReplyThreadLifecycle.reconcileReply")(function* (
    reply: ReplyThreadState,
  ) {
    const closure = yield* findReplySourceClosure(reply, readThread);
    if (closure === undefined) return;
    if (closure.reason === "cycle" || closure.reason === "project-mismatch")
      return yield* new ReplySourceUnavailableError({
        threadId: reply.id,
        sourceThreadId: closure.sourceThreadId,
        reason: closure.reason,
      });
    yield* close(reply.id, closure.action, yield* closureToken(closure));
  });
  const recover = mutex
    .withPermits(1)(
      Effect.gen(function* () {
        const snapshot = yield* projections.getShellSnapshot();
        for (const reply of [...snapshot.threads, ...snapshot.archivedThreads]) {
          if (reply.messageReply !== undefined) yield* reconcileReply(reply);
        }
      }),
    )
    .pipe(Effect.mapError(lifecycleError));

  const handle = Effect.fn("ReplyThreadLifecycle.handle")(function* (
    stored: OrchestrationV2StoredEvent,
  ) {
    const event = stored.event;
    if (event.type === "thread.created") {
      if (event.payload.messageReply !== undefined)
        yield* mutex.withPermits(1)(reconcileReply(event.payload));
      return;
    }
    if (event.type !== "thread.archived" && event.type !== "thread.deleted") return;
    yield* mutex.withPermits(1)(
      Effect.gen(function* () {
        const snapshot = yield* projections.getShellSnapshot({ familyOf: event.threadId });
        const remaining = new Map(
          [...snapshot.threads, ...snapshot.archivedThreads]
            .filter(
              (thread) =>
                thread.messageReply !== undefined && thread.projectId === event.payload.projectId,
            )
            .map((thread) => [thread.id, thread]),
        );
        const closed = new Set<ThreadId>([event.threadId]);
        let replies: OrchestrationV2ThreadShell[];
        do {
          replies = [...remaining.values()].filter((thread) =>
            closed.has(thread.messageReply!.sourceThreadId),
          );
          for (const reply of replies) {
            remaining.delete(reply.id);
            closed.add(reply.id);
            yield* close(
              reply.id,
              event.type === "thread.deleted" ? "delete" : "stop",
              String(stored.sequence),
            );
          }
        } while (replies.length > 0);
      }),
    );
  }, Effect.mapError(lifecycleError));

  const worker = yield* makeDrainableWorker((work: Work) =>
    work.type === "recover" ? recover : handle(work.event),
  );
  const start = Effect.fn("ReplyThreadLifecycle.start")(function* () {
    if (yield* Ref.getAndSet(started, true)) return;
    const afterSequence = yield* eventSink.latestSequence().pipe(Effect.orDie);
    yield* forkParked(
      Effect.gen(function* () {
        yield* worker.enqueue({ type: "recover" });
        yield* eventSink.stream({ afterSequence }).pipe(
          Stream.runForEach((event) => worker.enqueue({ type: "event", event })),
          Effect.catchCause((cause) =>
            Effect.logError("Reply lifecycle event stream failed", cause),
          ),
        );
      }),
    );
  });
  return ReplyThreadLifecycle.of({
    start,
    recover,
    handle,
    drain: recover.pipe(Effect.andThen(worker.drain)),
  });
});

export const layerService = Layer.effect(ReplyThreadLifecycle, make);
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* (yield* ReplyThreadLifecycle).start();
  }),
).pipe(Layer.provideMerge(layerService));
