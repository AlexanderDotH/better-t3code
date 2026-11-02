import {
  CommandId,
  MessageId,
  RuntimeRequestId,
  ThreadId,
  type SubagentId,
  type MessageReplyReference,
  type ChatAttachment,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
  type UserInputAttachments,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
type ReplyCommand = {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly replyTopicId: SubagentId;
};
type ThreadReplyStartRequestedPayload = ReplyCommand & {
  readonly message: {
    readonly messageId: MessageId;
    readonly text: string;
    readonly attachments: ReadonlyArray<ChatAttachment>;
  };
  readonly replyTo: MessageReplyReference;
};
type ThreadReplyInterruptRequestedPayload = ReplyCommand;
type ThreadReplyRetryRequestedPayload = ReplyCommand;
type ThreadReplyApprovalResponseRequestedPayload = ReplyCommand & {
  readonly requestId: RuntimeRequestId;
  readonly decision: ProviderApprovalDecision;
};
type ThreadReplyUserInputResponseRequestedPayload = ReplyCommand & {
  readonly requestId: RuntimeRequestId;
  readonly answers: ProviderUserInputAnswers;
  readonly attachmentsByQuestionId?: UserInputAttachments;
};
type ThreadReplyUserInputDismissRequestedPayload = ReplyCommand & {
  readonly requestId: RuntimeRequestId;
};
export class MessageReplyError extends Schema.TaggedError<MessageReplyError>()(
  "MessageReplyError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

export interface MessageReplyCoordinatorShape {
  readonly handleStart: (
    input: ThreadReplyStartRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly interrupt: (
    input: ThreadReplyInterruptRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly retry: (
    input: ThreadReplyRetryRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly respondApproval: (
    input: ThreadReplyApprovalResponseRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly respondUserInput: (
    input: ThreadReplyUserInputResponseRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly dismissUserInput: (
    input: ThreadReplyUserInputDismissRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly cancelThread: (threadId: ThreadId) => Effect.Effect<void, MessageReplyError>;
  readonly recoverThread: (
    threadId: ThreadId,
    throughSequence?: number,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly hasActiveTopic: (threadId: ThreadId) => Effect.Effect<boolean, MessageReplyError>;
  readonly awaitIdle: (threadId: ThreadId) => Effect.Effect<void, MessageReplyError>;
}

export class MessageReplyCoordinator extends Context.Service<
  MessageReplyCoordinator,
  MessageReplyCoordinatorShape
>()("t3/messageReplies/MessageReplyCoordinator") {}

const make = Effect.gen(function* () {
  const orchestration = yield* OrchestratorV2;
  const threads = yield* ThreadManagementService;
  const failure = (cause: unknown) =>
    new MessageReplyError({ detail: cause instanceof Error ? cause.message : String(cause) });
  const findChild = Effect.fn("MessageReplyCoordinator.findChild")(function* (input: {
    readonly threadId: ThreadId;
    readonly replyTopicId: SubagentId;
  }) {
    const snapshot = yield* orchestration
      .getShellSnapshot({ familyOf: input.threadId })
      .pipe(Effect.mapError(failure));
    const child = snapshot.threads.find(
      (thread) =>
        thread.messageReply?.sourceThreadId === input.threadId &&
        thread.messageReply.replyTopicId === input.replyTopicId,
    );
    if (!child) return yield* new MessageReplyError({ detail: "The reply topic was not found." });
    return child;
  });
  const handleStart: MessageReplyCoordinatorShape["handleStart"] = Effect.fn(
    "MessageReplyCoordinator.handleStart",
  )(function* (input) {
    const source = yield* orchestration
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError(failure));
    if (!source)
      return yield* new MessageReplyError({ detail: "The source thread was not found." });
    yield* threads
      .dispatch({
        type: "message.reply.start",
        commandId: input.commandId,
        threadId: input.threadId,
        targetThreadId: ThreadId.make(`reply:${input.threadId}:${input.replyTopicId}`),
        replyTopicId: input.replyTopicId,
        messageId: input.message.messageId,
        text: input.message.text,
        attachments: input.message.attachments,
        replyTo: input.replyTo,
        modelSelection: source.modelSelection,
        runtimeMode: source.runtimeMode,
        interactionMode: source.interactionMode,
        createdBy: "user",
        creationSource: "server",
      })
      .pipe(Effect.mapError(failure));
  });
  const interrupt: MessageReplyCoordinatorShape["interrupt"] = Effect.fn(
    "MessageReplyCoordinator.interrupt",
  )(function* (input) {
    const child = yield* findChild(input);
    yield* threads
      .dispatch({ type: "thread.stop", commandId: input.commandId, threadId: child.id })
      .pipe(Effect.mapError(failure));
  });
  const retry: MessageReplyCoordinatorShape["retry"] = Effect.fn("MessageReplyCoordinator.retry")(
    function* (input) {
      const child = yield* findChild(input);
      yield* threads
        .dispatch({
          type: "message.dispatch",
          commandId: input.commandId,
          threadId: child.id,
          messageId: MessageId.make(`${input.commandId}:message`),
          text: "Continue this reply from the saved conversation and unfinished work.",
          attachments: [],
          createdBy: "user",
          creationSource: "server",
          dispatchMode: { type: "start_immediately" },
          idleGuard: { latestRunId: child.latestRunId },
        })
        .pipe(Effect.mapError(failure));
    },
  );
  const respondApproval: MessageReplyCoordinatorShape["respondApproval"] = Effect.fn(
    "MessageReplyCoordinator.respondApproval",
  )(function* (input) {
    const child = yield* findChild(input);
    yield* threads
      .dispatch({
        type: "runtime-request.respond",
        commandId: input.commandId,
        threadId: child.id,
        requestId: RuntimeRequestId.make(input.requestId),
        decision: input.decision,
      })
      .pipe(Effect.mapError(failure));
  });
  const respondUserInput: MessageReplyCoordinatorShape["respondUserInput"] = Effect.fn(
    "MessageReplyCoordinator.respondUserInput",
  )(function* (input) {
    const child = yield* findChild(input);
    yield* threads
      .dispatch({
        type: "runtime-request.respond",
        commandId: input.commandId,
        threadId: child.id,
        requestId: RuntimeRequestId.make(input.requestId),
        answers: input.answers,
        attachmentsByQuestionId: input.attachmentsByQuestionId,
      })
      .pipe(Effect.mapError(failure));
  });
  const dismissUserInput: MessageReplyCoordinatorShape["dismissUserInput"] = Effect.fn(
    "MessageReplyCoordinator.dismissUserInput",
  )(function* (input) {
    const child = yield* findChild(input);
    yield* threads
      .dispatch({
        type: "thread.user-input.dismiss",
        commandId: input.commandId,
        threadId: child.id,
        requestId: RuntimeRequestId.make(input.requestId),
      })
      .pipe(Effect.mapError(failure));
  });
  const children = (threadId: ThreadId) =>
    orchestration.getShellSnapshot({ familyOf: threadId }).pipe(
      Effect.map((snapshot) =>
        snapshot.threads.filter((thread) => thread.messageReply?.sourceThreadId === threadId),
      ),
      Effect.mapError(failure),
    );
  return MessageReplyCoordinator.of({
    handleStart,
    interrupt,
    retry,
    respondApproval,
    respondUserInput,
    dismissUserInput,
    cancelThread: Effect.fn("MessageReplyCoordinator.cancelThread")(function* (threadId) {
      for (const child of yield* children(threadId))
        yield* threads
          .dispatch({
            type: "thread.stop",
            commandId: CommandId.make(`reply-stop:${threadId}:${child.id}:${child.latestRunId}`),
            threadId: child.id,
          })
          .pipe(Effect.mapError(failure));
    }),
    recoverThread: Effect.fn("MessageReplyCoordinator.recoverThread")(() => Effect.void),
    hasActiveTopic: Effect.fn("MessageReplyCoordinator.hasActiveTopic")((threadId) =>
      children(threadId).pipe(
        Effect.map((topics) => topics.some((topic) => topic.activeRunId !== null)),
      ),
    ),
    awaitIdle: Effect.fn("MessageReplyCoordinator.awaitIdle")(function* (threadId) {
      for (const child of yield* children(threadId))
        yield* threads
          .waitForThread({
            threadId: child.id,
            projectId: child.projectId,
            timeoutMs: 60_000,
            untilDelegatedWorkSettled: true,
          })
          .pipe(Effect.mapError(failure));
    }),
  });
});
export const MessageReplyCoordinatorLive = Layer.effect(MessageReplyCoordinator, make);
