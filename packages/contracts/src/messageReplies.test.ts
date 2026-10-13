import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { MessageReplyReference } from "./messageReplies.ts";
import {
  ClientOrchestrationCommand,
  MessageReplyTopic,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationEventType,
  OrchestrationMessage,
  ThreadReplyStartCommand,
} from "./orchestration.ts";

const createdAt = "2026-10-13T10:00:00.000Z";
const replyTo = { messageId: "source", role: "assistant", text: "**Full** quoted context" };
const commandMetadata = {
  commandId: "reply-command",
  threadId: "thread",
  replyTopicId: "reply-topic",
  createdAt,
};
const attachment = {
  type: "file",
  id: "file_1",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 24,
};
const message = {
  messageId: "reply-message",
  role: "user",
  text: "Explain this part",
  attachments: [attachment],
  context: {
    version: 1,
    records: [
      {
        version: 1,
        contextId: "file_context",
        kind: "file",
        label: "Notes",
        attachmentId: "file_1",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 24,
      },
    ],
  },
};
const start = { type: "thread.reply.start", ...commandMetadata, message, replyTo };
const decodeCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);
const decodeReference = Schema.decodeUnknownSync(MessageReplyReference);
const decodeReplyStart = Schema.decodeUnknownSync(ThreadReplyStartCommand);
const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);
const decodeEventType = Schema.decodeUnknownSync(OrchestrationEventType);
const encodeEvent = Schema.encodeSync(OrchestrationEvent);
const decodeTopic = Schema.decodeUnknownSync(MessageReplyTopic);
const encodeTopic = Schema.encodeSync(MessageReplyTopic);
const decodeMessage = Schema.decodeUnknownSync(OrchestrationMessage);
const decodeInternalCommand = Schema.decodeUnknownSync(OrchestrationCommand);

describe("message reply contracts", () => {
  it("accepts user and assistant quotes and rejects other source roles", () => {
    for (const role of ["user", "assistant"]) {
      expect(decodeReference({ ...replyTo, role }).role).toBe(role);
    }
    for (const role of ["system", "reasoning"]) {
      expect(() => decodeReference({ ...replyTo, role })).toThrow();
    }
  });

  it("preserves an optional source topic across quote persistence", () => {
    const reference = { ...replyTo, replyTopicId: "source-topic" };
    expect(decodeReference(reference)).toEqual(reference);
    expect(decodeReference(replyTo)).not.toHaveProperty("replyTopicId");
    expect(decodeCommand({ ...start, replyTo: reference })).toMatchObject({ replyTo: reference });
  });

  it("preserves attachment bindings and full quote context without client model overrides", () => {
    const decoded = decodeCommand({
      ...start,
      modelSelection: { instanceId: "unrelated", model: "other-model" },
      runtimeMode: "full-access",
    });
    expect(decoded).toEqual(start);
    expect(decodeReplyStart(decoded)).toEqual(start);
    expect(() => decodeCommand({ ...start, replyTopicId: "" })).toThrow();
  });

  it("retains image uploads in client commands until the server resolves them", () => {
    const upload = {
      type: "image",
      id: "image_1",
      name: "screen.png",
      mimeType: "image/png",
      sizeBytes: 2,
      dataUrl: "data:image/png;base64,eA==",
    };
    const decoded = decodeCommand({
      ...start,
      message: { ...message, attachments: [upload] },
    });
    if (decoded.type !== "thread.reply.start") throw new Error("Expected a reply command");
    expect(decoded.message.attachments).toEqual([upload]);
  });

  it("preserves reply question image uploads for attachment normalization", () => {
    const upload = {
      type: "image",
      id: "answer_image",
      name: "answer.png",
      mimeType: "image/png",
      sizeBytes: 2,
      dataUrl: "data:image/png;base64,eA==",
    };
    const command = {
      type: "thread.reply.user-input.respond",
      ...commandMetadata,
      requestId: "question",
      answers: { screenshot: "See image" },
      attachmentsByQuestionId: { screenshot: [upload, attachment] },
    };
    expect(decodeCommand(command)).toEqual(command);
  });

  it("keeps every reply action addressed to its topic", () => {
    for (const command of [
      start,
      { type: "thread.reply.interrupt", ...commandMetadata },
      { type: "thread.reply.retry", ...commandMetadata },
      {
        type: "thread.reply.approval.respond",
        ...commandMetadata,
        requestId: "approval",
        decision: "accept",
      },
      {
        type: "thread.reply.user-input.respond",
        ...commandMetadata,
        requestId: "question",
        answers: { choice: ["Yes"] },
        attachmentsByQuestionId: { choice: [attachment] },
      },
      { type: "thread.reply.user-input.dismiss", ...commandMetadata, requestId: "question" },
    ]) {
      expect(decodeCommand(command)).toEqual(command);
      expect(() => decodeCommand({ ...command, replyTopicId: undefined })).toThrow();
    }
  });

  it.each([
    ["thread.reply-start-requested", { message, replyTo }],
    ["thread.reply-interrupt-requested", {}],
    ["thread.reply-retry-requested", {}],
    ["thread.reply-approval-response-requested", { requestId: "approval", decision: "accept" }],
    [
      "thread.reply-user-input-response-requested",
      { requestId: "question", answers: { choice: "Yes" } },
    ],
    ["thread.reply-user-input-dismiss-requested", { requestId: "question" }],
  ])("persists %s with its storage discriminator and replay identity", (type, extraPayload) => {
    const event = {
      sequence: 3,
      eventId: "event",
      aggregateKind: "thread",
      aggregateId: "thread",
      occurredAt: createdAt,
      commandId: "reply-command",
      causationEventId: null,
      correlationId: "reply-command",
      metadata: {},
      type,
      payload: { ...commandMetadata, ...extraPayload },
    };
    const decoded = decodeEvent(event);
    expect(decodeEventType(decoded.type)).toBe(type);
    expect(encodeEvent(decoded)).toEqual(event);
  });

  it("persists the inherited model options, runtime permissions, workspace, and delivery fence", () => {
    const topic = {
      rootMessageId: "source",
      replyTo,
      modelSelection: {
        instanceId: "codex-work",
        model: "gpt-6",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "priority" },
          { id: "fastMode", value: false },
        ],
      },
      runtimeMode: "approval-required",
      interactionMode: "plan",
      workspacePath: "/workspace/current",
      lastCommandId: "reply-command",
      lastUserMessageId: "reply-message",
    };
    const decoded = decodeTopic(topic);
    expect(encodeTopic(decoded)).toEqual(topic);
  });

  it("keeps legacy messages readable and reply metadata on streaming commands", () => {
    const legacyMessage = {
      id: "message",
      role: "assistant",
      text: "answer",
      turnId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    };
    expect(decodeMessage(legacyMessage)).toEqual(legacyMessage);
    const replyMessage = { ...legacyMessage, replyTo, replyTopicId: "reply-topic" };
    expect(decodeMessage(replyMessage)).toEqual(replyMessage);
    for (const role of ["assistant", "reasoning"]) {
      for (const phase of ["delta", "complete"]) {
        const command = {
          type: `thread.message.${role}.${phase}`,
          commandId: "stream-command",
          threadId: "thread",
          subagentId: "reply-topic",
          replyTopicId: "reply-topic",
          replyTo,
          messageId: "message",
          ...(phase === "delta" ? { delta: "answer" } : {}),
          createdAt,
        };
        expect(decodeInternalCommand(command)).toEqual(command);
      }
    }
  });
});
