import {
  isImportedAgentSessionMessageId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationSubagentSummary,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { requireProject, requireThreadNotArchived } from "./commandInvariants.ts";
import { makeMessageReplySummary } from "../messageReplies/MessageReplySummary.ts";

export type MessageReplyCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | "thread.reply.start"
      | "thread.reply.interrupt"
      | "thread.reply.retry"
      | "thread.reply.approval.respond"
      | "thread.reply.user-input.respond"
      | "thread.reply.user-input.dismiss";
  }
>;

export function hasActiveMessageReplies(thread: Pick<OrchestrationThread, "subagents">): boolean {
  return thread.subagents.some(
    (topic) =>
      topic.messageReply !== undefined &&
      (topic.status === "starting" || topic.status === "running" || topic.status === "waiting"),
  );
}

export const validateMessageReplyCommand = Effect.fn("validateMessageReplyCommand")(function* (
  readModel: OrchestrationReadModel,
  command: MessageReplyCommand,
) {
  const thread = yield* requireThreadNotArchived({
    readModel,
    command,
    threadId: command.threadId,
  });
  const reject = (detail: string) =>
    new OrchestrationCommandInvariantError({ commandType: command.type, detail });
  const topic = thread.subagents.find((entry) => entry.id === command.replyTopicId);
  if (topic !== undefined && topic.messageReply === undefined) {
    return yield* reject("The selected agent is not a message reply topic.");
  }
  if (command.type === "thread.reply.start") {
    if (
      command.replyTo.replyTopicId !== undefined &&
      (topic === undefined || command.replyTo.replyTopicId !== command.replyTopicId)
    ) {
      return yield* reject("Continue the conversation that owns the selected reply message.");
    }
    if (isImportedAgentSessionMessageId(command.message.messageId)) {
      return yield* reject("This message id is reserved for imported conversations.");
    }
    if (command.message.text.trim().length === 0 && command.message.attachments.length === 0) {
      return yield* reject("Write a reply or attach a file before sending.");
    }
    const source = topic
      ? thread.replyMessages?.find(
          (message) =>
            message.id === command.replyTo.messageId &&
            message.replyTopicId === command.replyTopicId,
        )
      : thread.messages.find((message) => message.id === command.replyTo.messageId);
    if (!source || source.role !== command.replyTo.role) {
      return yield* reject(
        "The message being replied to is no longer available in this conversation.",
      );
    }
    const existingMessage = [...thread.messages, ...(thread.replyMessages ?? [])].find(
      (message) => message.id === command.message.messageId,
    );
    if (existingMessage !== undefined) {
      return yield* reject("This reply has already been sent.");
    }
    return thread;
  }
  if (topic?.messageReply === undefined) {
    return yield* reject("The selected reply topic is no longer available.");
  }
  if (
    command.type === "thread.reply.retry" &&
    topic.status !== "interrupted" &&
    topic.status !== "error" &&
    topic.status !== "unavailable"
  ) {
    return yield* reject("Only an interrupted or failed reply can be retried.");
  }
  return thread;
});

export const prepareMessageReplySummary = Effect.fn("prepareMessageReplySummary")(function* (
  readModel: OrchestrationReadModel,
  thread: OrchestrationThread,
  command: Extract<MessageReplyCommand, { type: "thread.reply.start" | "thread.reply.retry" }>,
) {
  const topic = thread.subagents.find((entry) => entry.id === command.replyTopicId);
  if (topic !== undefined) {
    const active =
      topic.status === "starting" || topic.status === "running" || topic.status === "waiting";
    return {
      ...topic,
      status: active ? topic.status : "starting",
      latestTurn: active ? topic.latestTurn : null,
      statusMessage: active ? topic.statusMessage : null,
      completedAt: null,
      updatedAt: command.createdAt,
    } satisfies OrchestrationSubagentSummary;
  }
  if (command.type !== "thread.reply.start") {
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "The selected reply topic is no longer available.",
    });
  }
  const project = yield* requireProject({ readModel, command, projectId: thread.projectId });
  return makeMessageReplySummary({
    thread,
    workspacePath: thread.worktreePath ?? project.workspaceRoot,
    input: command,
    providerDriver: null,
  });
});

type EventBase = Omit<OrchestrationEvent, "sequence" | "type" | "payload">;

export function messageReplyRequestedEvent(command: MessageReplyCommand, base: EventBase) {
  switch (command.type) {
    case "thread.reply.start": {
      const { type: _type, ...payload } = command;
      return { ...base, type: "thread.reply-start-requested" as const, payload };
    }
    case "thread.reply.interrupt": {
      const { type: _type, ...payload } = command;
      return { ...base, type: "thread.reply-interrupt-requested" as const, payload };
    }
    case "thread.reply.retry": {
      const { type: _type, ...payload } = command;
      return { ...base, type: "thread.reply-retry-requested" as const, payload };
    }
    case "thread.reply.approval.respond": {
      const { type: _type, ...payload } = command;
      return { ...base, type: "thread.reply-approval-response-requested" as const, payload };
    }
    case "thread.reply.user-input.respond": {
      const { type: _type, ...payload } = command;
      return { ...base, type: "thread.reply-user-input-response-requested" as const, payload };
    }
    case "thread.reply.user-input.dismiss": {
      const { type: _type, ...payload } = command;
      return { ...base, type: "thread.reply-user-input-dismiss-requested" as const, payload };
    }
  }
}
