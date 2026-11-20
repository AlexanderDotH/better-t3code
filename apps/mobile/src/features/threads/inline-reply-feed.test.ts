import { MessageId, SubagentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import type { ThreadFeedEntry } from "../../lib/threadActivity";
import {
  findMessageJumpEntry,
  mergeReplyFeed,
  replySourceThreadId,
  withInlineReplyEntryId,
} from "./inline-reply-feed";

const parent = ThreadId.make("parent");
const child = ThreadId.make("child");
const topic = SubagentId.make("topic");
const source = MessageId.make("source");
const reply = { sourceThreadId: parent, replyTopicId: topic, messageId: source };

function message(id: string, second: number, sourceThreadId: ThreadId): ThreadFeedEntry {
  const createdAt = `2026-01-01T00:00:0${second}.000Z`;
  return {
    type: "message",
    id,
    createdAt,
    message: {
      id: MessageId.make(id),
      role: "user",
      text: id,
      createdAt,
      updatedAt: createdAt,
      sourceThreadId,
      visibility: "local",
      attachments: [],
      runId: null,
      streaming: false,
    },
  };
}

describe("mobile inline reply timeline", () => {
  it("keeps the parent presentation in order while inserting reply messages", () => {
    const first = message("first", 2, parent);
    const second = message("second", 1, parent);
    const last = message("last", 4, parent);
    const inline = message("inline", 3, child);
    expect(mergeReplyFeed([first, second, last], [inline])).toEqual([first, second, inline, last]);
  });

  it("opens an older quote in its owning thread from a parent or child timeline", () => {
    const topicThreads = [{ id: child, messageReply: reply }];
    const reference = { messageId: source, role: "assistant", text: "Earlier answer" } as const;
    expect(replySourceThreadId(reference, child, topicThreads)).toBe(parent);
    expect(
      replySourceThreadId(
        { ...reference, messageId: MessageId.make("child-answer"), replyTopicId: topic },
        parent,
        topicThreads,
      ),
    ).toBe(child);
  });

  it("distinguishes messages with the same ID in different threads", () => {
    const parentMessage = message("shared", 2, parent);
    const replyMessage = withInlineReplyEntryId(message("shared", 3, child));
    const target = { messageId: MessageId.make("shared"), sourceThreadId: child };
    expect(replyMessage.id).not.toBe(parentMessage.id);
    expect(findMessageJumpEntry([parentMessage], [replyMessage], target, parent)).toBe(
      replyMessage,
    );
    expect(findMessageJumpEntry([parentMessage], [], target, parent)).toBeUndefined();
  });
});
