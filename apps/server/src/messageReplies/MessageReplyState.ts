import {
  MessageId,
  RuntimeSessionId,
  ThreadId,
  type ApprovalRequestId,
  type CommandId,
  type IsoDateTime,
  type MessageReplyTopic,
  type MessageReplyReference,
  type OrchestrationMessage,
  type OrchestrationSubagentSummary,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  type SubagentId,
  type TurnId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

export type MessageReplySummary = OrchestrationSubagentSummary & {
  readonly messageReply: MessageReplyTopic;
};

export interface MessageReplyJob {
  readonly commandId: CommandId;
  readonly message: OrchestrationMessage;
}

export interface MessageReplyTopicState {
  readonly parentThreadId: ThreadId;
  readonly id: SubagentId;
  providerDriver: ProviderDriverKind | null;
  summary: MessageReplySummary;
  readonly messages: OrchestrationMessage[];
  readonly jobs: MessageReplyJob[];
  readonly commands: Set<CommandId>;
  active: ActiveMessageReply | null;
  draining: boolean;
  cancelled: boolean;
}

export interface MessageReplyOutcome {
  readonly status: "completed" | "interrupted" | "error";
  readonly detail?: string;
}

export interface ActiveMessageReply {
  readonly topic: MessageReplyTopicState;
  readonly job: MessageReplyJob;
  readonly syntheticThreadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly assistantMessageId: MessageId;
  readonly replyTo: MessageReplyReference;
  readonly startedAt: IsoDateTime;
  readonly terminal: Deferred.Deferred<MessageReplyOutcome>;
  readonly abort: Deferred.Deferred<MessageReplyOutcome>;
  readonly finished: Deferred.Deferred<void>;
  readonly approvals: Set<ApprovalRequestId>;
  readonly userInputs: Map<
    ApprovalRequestId,
    Extract<ProviderRuntimeEvent, { type: "user-input.requested" }>
  >;
  readonly itemText: Map<string, string>;
  readonly flushLock: Semaphore.Semaphore;
  flushScheduled: boolean;
  turnId: TurnId | null;
  sessionStarted: boolean;
  cancelled: boolean;
  settled: boolean;
  assistantText: string;
  transcriptBuffer: string;
  assistantProjected: boolean;
}

export const makeActiveMessageReply = Effect.fn("MessageReplyState.makeActive")(function* (
  topic: MessageReplyTopicState,
  job: MessageReplyJob,
  uuid: string,
  startedAt: IsoDateTime,
) {
  return {
    topic,
    job,
    syntheticThreadId: ThreadId.make(`reply:${topic.id}:${uuid}`),
    runtimeSessionId: RuntimeSessionId.make(`runtime:reply:${uuid}`),
    assistantMessageId: MessageId.make(`reply:${topic.id}:${job.commandId}:assistant`),
    replyTo: {
      messageId: job.message.id,
      replyTopicId: topic.id,
      role: "user",
      text: job.message.text.trim()
        ? job.message.text
        : (job.message.attachments
            ?.map(({ name }) => name.trim())
            .filter(Boolean)
            .join(", ") ?? ""),
    },
    startedAt,
    terminal: yield* Deferred.make<MessageReplyOutcome>(),
    abort: yield* Deferred.make<MessageReplyOutcome>(),
    finished: yield* Deferred.make<void>(),
    approvals: new Set<ApprovalRequestId>(),
    userInputs: new Map(),
    itemText: new Map<string, string>(),
    flushLock: yield* Semaphore.make(1),
    flushScheduled: false,
    turnId: null,
    sessionStarted: false,
    cancelled: false,
    settled: false,
    assistantText: "",
    transcriptBuffer: "",
    assistantProjected: false,
  } satisfies ActiveMessageReply;
});
