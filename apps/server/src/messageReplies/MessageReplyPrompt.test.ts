import { describe, expect, it } from "@effect/vitest";
import {
  ComposerContextId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ChatAttachment,
  type OrchestrationMessage,
} from "@t3tools/contracts";

import { buildMessageReplyHandoff, formatMessageReplyAnswers } from "./MessageReplyPrompt.ts";

const createdAt = "2026-10-13T10:00:00.000Z";
const message = (id: string, text: string): OrchestrationMessage => ({
  id: MessageId.make(id),
  role: "user",
  text,
  turnId: null,
  streaming: false,
  createdAt,
  updatedAt: createdAt,
});
const reference = {
  messageId: MessageId.make("source"),
  role: "assistant" as const,
  text: "Original quoted text.",
};
const attachment = (id: string): ChatAttachment => ({
  type: "image",
  id,
  name: `${id}.png`,
  mimeType: "image/png",
  sizeBytes: 10,
});
const handoffInput = {
  replyTo: reference,
  rootReplyTo: reference,
  sourceMessages: [],
  currentMessage: message("current", "Current user message"),
  mainMessages: [],
  topicMessages: [],
};

describe("message reply context", () => {
  it("keeps the selected quote immutable while bounding optional history", () => {
    const handoff = buildMessageReplyHandoff({
      ...handoffInput,
      sourceMessages: [message("source", "Edited source text.")],
      mainMessages: [message("main", "main ".repeat(30_000))],
      topicMessages: [message("topic", "topic ".repeat(30_000))],
    });
    expect(handoff.text).toContain("Original quoted text.");
    expect(handoff.text).not.toContain("Edited source text.");
    expect(handoff.text).toContain("[Earlier content omitted]");
    expect(handoff.text.length).toBeLessThan(70_000);
    expect(handoff.text).not.toContain("Current user message");
  });

  it("carries source and earlier topic attachments without displacing current attachments", () => {
    const currentAttachments = Array.from(
      { length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1 },
      (_, index) => attachment(`current-${index}`),
    );
    const historical = attachment("source-image");
    const omitted = attachment("earlier-topic-image");
    const current = { ...message("current", "Use all of these."), attachments: currentAttachments };
    const handoff = buildMessageReplyHandoff({
      ...handoffInput,
      currentMessage: current,
      sourceMessages: [{ ...message("source", ""), attachments: [historical] }],
      topicMessages: [{ ...message("old", ""), attachments: [omitted] }],
    });
    expect(handoff.attachments).toEqual([historical]);
    expect(current.attachments).toEqual(currentAttachments);
  });

  it("expands inherited composer references with their captured content", () => {
    const contextMessage: OrchestrationMessage = {
      ...message("earlier", "[Output](t3-context://v1/terminal/ctx_terminal)"),
      context: {
        version: 1,
        records: [
          {
            version: 1,
            kind: "terminal",
            contextId: ComposerContextId.make("ctx_terminal"),
            label: "Output",
            terminalId: "terminal",
            terminalLabel: "Shell",
            lineStart: 1,
            lineEnd: 1,
            text: "Relevant command failure.",
          },
        ],
      },
    };
    const handoff = buildMessageReplyHandoff({ ...handoffInput, topicMessages: [contextMessage] });
    expect(handoff.text).toContain("Relevant command failure.");
  });

  it("preserves question wording and all selected answers as conversational text", () => {
    expect(
      formatMessageReplyAnswers({ q: { answers: ["First", "Additional detail"] } }, [
        { id: "q", header: "Choice", question: "Which implementation?", options: [] },
      ]),
    ).toBe("Which implementation?\nFirst\nAdditional detail");
  });
});
