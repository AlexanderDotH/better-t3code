import { CommandId, EventId, type OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { MessageReplyCoordinator } from "../../messageReplies/MessageReplyCoordinator.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

export class MessageReplyReactor extends Context.Service<
  MessageReplyReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration/Layers/MessageReplyReactor") {}

type ReplyReactorEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.reply-start-requested"
      | "thread.reply-interrupt-requested"
      | "thread.reply-retry-requested"
      | "thread.reply-approval-response-requested"
      | "thread.reply-user-input-response-requested"
      | "thread.reply-user-input-dismiss-requested"
      | "thread.archived"
      | "thread.deleted";
  }
>;

function isReplyReactorEvent(event: OrchestrationEvent): event is ReplyReactorEvent {
  switch (event.type) {
    case "thread.reply-start-requested":
    case "thread.reply-interrupt-requested":
    case "thread.reply-retry-requested":
    case "thread.reply-approval-response-requested":
    case "thread.reply-user-input-response-requested":
    case "thread.reply-user-input-dismiss-requested":
    case "thread.archived":
    case "thread.deleted":
      return true;
    default:
      return false;
  }
}

export const makeMessageReplyReactor = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const query = yield* ProjectionSnapshotQuery;
  const coordinator = yield* MessageReplyCoordinator;

  const handleEvent = (event: ReplyReactorEvent) => {
    switch (event.type) {
      case "thread.reply-start-requested":
        return coordinator.handleStart(event.payload);
      case "thread.reply-interrupt-requested":
        return coordinator.interrupt(event.payload);
      case "thread.reply-retry-requested":
        return coordinator.retry(event.payload);
      case "thread.reply-approval-response-requested":
        return coordinator.respondApproval(event.payload);
      case "thread.reply-user-input-response-requested":
        return coordinator.respondUserInput(event.payload);
      case "thread.reply-user-input-dismiss-requested":
        return coordinator.dismissUserInput(event.payload);
      case "thread.archived":
      case "thread.deleted":
        return coordinator.cancelThread(event.payload.threadId);
      default:
        return Effect.void;
    }
  };

  const worker = yield* makeDrainableWorker((event: ReplyReactorEvent) =>
    handleEvent(event).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          yield* Effect.logWarning("Message reply request failed", {
            eventId: event.eventId,
            cause: Cause.pretty(cause),
          });
          if (!("replyTopicId" in event.payload) || !("threadId" in event.payload)) return;
          const error = Cause.squash(cause);
          const detail = error instanceof Error ? error.message : String(error);
          yield* engine
            .dispatch({
              type: "thread.activity.append",
              commandId: CommandId.make(`reply-error:${event.eventId}`),
              threadId: event.payload.threadId,
              subagentId: event.payload.replyTopicId,
              activity: {
                id: EventId.make(`reply-error:${event.eventId}`),
                kind:
                  event.type === "thread.reply-approval-response-requested"
                    ? "provider.approval.respond.failed"
                    : "requestId" in event.payload
                      ? "provider.user-input.respond.failed"
                      : "message-reply.failed",
                summary: detail,
                tone: "error",
                turnId: null,
                replyTopicId: event.payload.replyTopicId,
                createdAt: event.occurredAt,
                payload: {
                  detail,
                  ...("requestId" in event.payload ? { requestId: event.payload.requestId } : {}),
                },
              },
              createdAt: event.occurredAt,
            })
            .pipe(
              Effect.catchCause((dispatchCause) =>
                Effect.logWarning("Could not record message reply failure", {
                  eventId: event.eventId,
                  cause: Cause.pretty(dispatchCause),
                }),
              ),
            );
        }),
      ),
    ),
  );

  let started = false;
  const start = Effect.fn("MessageReplyReactor.start")(function* () {
    if (started) return;
    started = true;
    // Subscribe before recovering so a client command arriving during recovery is retained.
    const events = yield* engine.subscribeDomainEvents;
    const recoverySequence = yield* engine.latestSequence;
    yield* forkParked(
      Effect.gen(function* () {
        const threadIds = yield* query.getMessageReplyRecoveryThreadIds().pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not load reply recovery threads", {
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(null)),
          ),
        );
        if (threadIds) {
          yield* Effect.forEach(
            threadIds,
            (threadId) =>
              coordinator.recoverThread(threadId, recoverySequence).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("Could not recover reply topics", {
                    threadId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              ),
            { concurrency: 1, discard: true },
          );
        }
        yield* events.pipe(
          Stream.filter((event) => event.sequence > recoverySequence),
          Stream.filter(isReplyReactorEvent),
          Stream.runForEach(worker.enqueue),
        );
      }),
    );
  });

  return { start, drain: worker.drain };
});

export const MessageReplyReactorLive = Layer.effect(MessageReplyReactor, makeMessageReplyReactor);
