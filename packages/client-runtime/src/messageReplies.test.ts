import { MessageId, SubagentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  classifyMessageReplyPointerIntent,
  createMessageReplyReference,
  getMessageReplyPreview,
  hasMessageReplyHorizontalIntent,
  shouldTriggerMessageReply,
} from "./messageReplies.ts";

describe("message reply gestures", () => {
  it.each([
    ["user", -1],
    ["assistant", 1],
  ] as const)("requires release at the threshold for %s messages", (role, direction) => {
    expect(shouldTriggerMessageReply(direction * 15, 0, role)).toBe(false);
    expect(shouldTriggerMessageReply(direction * 16, 0, role)).toBe(true);
    expect(shouldTriggerMessageReply(direction * 75, 10, role)).toBe(true);
    expect(shouldTriggerMessageReply(-direction * 100, 0, role)).toBe(false);
  });

  it("leaves scrolling, diagonal motion, and pointer jitter unclaimed", () => {
    expect(hasMessageReplyHorizontalIntent(7, 0)).toBe(false);
    expect(hasMessageReplyHorizontalIntent(20, 1)).toBe(true);
    expect(shouldTriggerMessageReply(65, 100, "assistant")).toBe(false);
    expect(shouldTriggerMessageReply(65, 60, "assistant")).toBe(false);
    expect(shouldTriggerMessageReply(Infinity, 0, "assistant")).toBe(false);
    expect(shouldTriggerMessageReply(100, NaN, "assistant")).toBe(false);
  });
});

describe.each([
  ["user", -1],
  ["assistant", 1],
] as const)("reply versus text selection for %s messages", (role, direction) => {
  const classify = (movement: {
    deltaX: number;
    deltaY?: number;
    elapsedMs: number;
    pathLength?: number;
    canSelectText?: boolean;
    selectionActive?: boolean;
  }) =>
    classifyMessageReplyPointerIntent({
      role,
      deltaX: direction * movement.deltaX,
      deltaY: movement.deltaY ?? 0,
      elapsedMs: movement.elapsedMs,
      pathLength: movement.pathLength ?? Math.hypot(movement.deltaX, movement.deltaY ?? 0),
      canSelectText: movement.canSelectText ?? true,
      selectionActive: movement.selectionActive ?? true,
    });

  it("waits for evidence before taking a quick straight text swipe", () => {
    expect(classify({ deltaX: 12, elapsedMs: 20 })).toBe("wait");
    expect(classify({ deltaX: 16, elapsedMs: 25 })).toBe("reply");
    expect(classify({ deltaX: 20, elapsedMs: 35 })).toBe("reply");
    expect(classify({ deltaX: 28, elapsedMs: 55 })).toBe("reply");
    expect(classify({ deltaX: 56, deltaY: 2, elapsedMs: 70 })).toBe("reply");
  });

  it("accepts a short stroke and a more relaxed text swipe", () => {
    expect(classify({ deltaX: 16, elapsedMs: 50 })).toBe("reply");
    expect(classify({ deltaX: 28, deltaY: 3, elapsedMs: 80 })).toBe("reply");
  });

  it("keeps slow marking, holding and multi-line selection native", () => {
    expect(classify({ deltaX: 12, elapsedMs: 70 })).toBe("cancel");
    expect(classify({ deltaX: 56, elapsedMs: 210 })).toBe("cancel");
    expect(classify({ deltaX: 90, elapsedMs: 280 })).toBe("cancel");
    expect(classify({ deltaX: 60, deltaY: 24, elapsedMs: 60 })).toBe("cancel");
    expect(classify({ deltaX: 15, pathLength: 30, elapsedMs: 20 })).toBe("cancel");
    expect(classify({ deltaX: -60, elapsedMs: 60 })).toBe("cancel");
  });

  it("tolerates early diagonal jitter and a small curve in a deliberate drag", () => {
    expect(classify({ deltaX: 9, deltaY: 8, elapsedMs: 15 })).toBe("wait");
    expect(classify({ deltaX: 12, deltaY: 10, elapsedMs: 20 })).toBe("wait");
    expect(classify({ deltaX: 40, deltaY: 10, pathLength: 46, elapsedMs: 65 })).toBe("reply");
  });

  it("still allows ordinary swipes without text-selection competition", () => {
    expect(
      classify({ deltaX: 18, elapsedMs: 130, canSelectText: false, selectionActive: false }),
    ).toBe("reply");
    expect(classify({ deltaX: 18, elapsedMs: 130, canSelectText: false })).toBe("cancel");
  });
});

describe("message reply preview", () => {
  it("captures a complete immutable quote while keeping the preview compact", () => {
    const message = {
      id: MessageId.make("source"),
      role: "assistant" as const,
      text: "  **Full explanation**\n\n" + "context ".repeat(60),
    };
    const reference = createMessageReplyReference(message, " Codex ");
    expect(reference?.text).toBe(message.text);
    expect(reference?.authorLabel).toBe("Codex");
    expect(Object.isFrozen(reference)).toBe(true);
    const preview = getMessageReplyPreview(message);
    expect(preview.length).toBeLessThanOrEqual(120);
    expect(preview).toMatch(/^Full explanation context/);
    expect(preview.endsWith("…")).toBe(true);
    message.text = "edited";
    expect(reference?.text).not.toBe(message.text);
  });

  it("keeps source identity scoped when different topics reuse a message id", () => {
    const source = { id: MessageId.make("shared-id"), role: "assistant" as const, text: "Answer" };
    const rootReference = createMessageReplyReference(source);
    const topicReference = createMessageReplyReference({
      ...source,
      replyTopicId: SubagentId.make("topic"),
    });
    expect(rootReference).not.toHaveProperty("replyTopicId");
    expect(topicReference).toMatchObject({ messageId: source.id, replyTopicId: "topic" });
  });

  it("keeps code identifiers and link labels readable", () => {
    expect(
      getMessageReplyPreview({
        text: "# Heading\n> **Bold** and _emphasis_ with [a link](https://example.test)\n\n```ts\nget_user_id()\n```\n- [x] complete",
      }),
    ).toBe("Heading Bold and emphasis with a link get_user_id() complete");
  });

  it("keeps attachment-only quotes useful after the source is unavailable", () => {
    const reference = createMessageReplyReference({
      id: MessageId.make("attachment-source"),
      role: "user",
      text: " ",
      attachments: [{ name: "report.pdf" }, { name: "chart.png" }],
    });
    expect(reference?.text).toBe("report.pdf, chart.png");
    expect(
      getMessageReplyPreview({ text: "", attachments: [] }, { attachmentLabel: "Anhang" }),
    ).toBe("Anhang");
  });

  it("does not split surrogate pairs or exceed tiny preview bounds", () => {
    expect(getMessageReplyPreview({ text: "😀😀😀" }, { maxLength: 2 })).toBe("😀…");
    expect(getMessageReplyPreview({ text: "answer" }, { maxLength: 1 })).toBe("…");
    expect(getMessageReplyPreview({ text: "answer" }, { maxLength: 0 })).toBe("");
  });

  it.each(["system", "reasoning"] as const)("does not quote %s rows", (role) => {
    expect(
      createMessageReplyReference({ id: MessageId.make("source"), role, text: "Internal" }),
    ).toBeNull();
  });
});
