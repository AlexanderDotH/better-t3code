import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { MessageReplyReference } from "./messageReplies.ts";
import {
  OrchestrationV2Command,
  OrchestrationV2ConversationMessageJson,
  OrchestrationV2MessageReply,
} from "./orchestrationV2.ts";

const replyTo = { messageId: "source", role: "assistant", text: "**Full** quoted context" };
const attachment = {
  type: "file",
  id: "file_1",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 24,
};
const context = {
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
};
const decodeReplyReference = Schema.decodeUnknownSync(MessageReplyReference);
const decodeReplyTopic = Schema.decodeSync(OrchestrationV2MessageReply);
const encodeMessage = Schema.encodeSync(OrchestrationV2ConversationMessageJson);
const decodeCommand = Schema.decodeUnknownSync(OrchestrationV2Command);
const decodeMessage = Schema.decodeUnknownSync(OrchestrationV2ConversationMessageJson);

describe("message replies", () => {
  it("preserves captured quote context and attachment bindings in a V2 reply launch", () => {
    const command = decodeCommand({
      type: "message.reply.start",
      createdBy: "user",
      creationSource: "web",
      commandId: "reply-command",
      threadId: "thread",
      messageId: "reply-message",
      replyTopicId: "reply-topic",
      targetThreadId: "reply-thread",
      replyTo,
      text: "Explain this part",
      attachments: [attachment],
      context,
      modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    expect(command).toMatchObject({ replyTo, attachments: [attachment], context });
    expect(() => decodeReplyReference({ ...replyTo, messageId: "" })).toThrow();
    expect(
      decodeReplyTopic({
        replyTopicId: "reply-topic",
        sourceThreadId: "thread",
        messageId: "source",
      }),
    ).toMatchObject({ sourceThreadId: "thread", replyTopicId: "reply-topic" });
  });

  it("round-trips reply message metadata while accepting older V2 messages", () => {
    const base = {
      createdBy: "user",
      creationSource: "web",
      id: "message",
      threadId: "thread",
      runId: null,
      nodeId: null,
      role: "user",
      text: "A reply",
      attachments: [attachment],
      streaming: false,
      createdAt: "2026-10-13T10:00:00.000Z",
      updatedAt: "2026-10-13T10:00:00.000Z",
    };
    expect(encodeMessage(decodeMessage(base))).toEqual(base);
    const reply = { ...base, replyTo, replyTopicId: "reply-topic" };
    expect(encodeMessage(decodeMessage(reply))).toEqual(reply);
  });

  it("requires the expected text for V2 message edits", () => {
    const command = {
      type: "message.edit",
      commandId: "edit",
      threadId: "thread",
      messageId: "message",
      expectedText: "Old text",
      text: "New text",
    };
    expect(decodeCommand(command)).toMatchObject(command);
    expect(() => decodeCommand({ ...command, expectedText: undefined })).toThrow();
  });
});
