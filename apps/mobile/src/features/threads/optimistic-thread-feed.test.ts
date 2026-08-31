import { describe, expect, it } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import type { QueuedThreadMessage } from "../../state/thread-outbox";
import { mergeQueuedMessagesIntoThreadFeed, threadFeedMountKey } from "./optimistic-thread-feed";

function queued(id: string, text: string): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    messageId: MessageId.make(id),
    commandId: CommandId.make(`command-${id}`),
    text,
    attachments: [],
    createdAt: "2026-08-25T00:00:00.000Z",
  };
}

describe("optimistic mobile thread feed", () => {
  it("shows a newly queued user message before the server snapshot arrives", () => {
    expect(mergeQueuedMessagesIntoThreadFeed([], [queued("message-1", "Hello agent")])).toEqual([
      expect.objectContaining({
        id: "message-1",
        type: "message",
        message: expect.objectContaining({ role: "user", text: "Hello agent" }),
      }),
    ]);
  });

  it("removes the optimistic duplicate once the server message is present", () => {
    const serverEntry = {
      id: "message-1",
      type: "message",
      createdAt: "2026-08-25T00:00:00.000Z",
      message: {
        id: MessageId.make("message-1"),
        role: "user",
        text: "Hello agent",
        turnId: null,
        streaming: false,
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      },
    } satisfies ThreadFeedEntry;

    expect(
      mergeQueuedMessagesIntoThreadFeed([serverEntry], [queued("message-1", "Hello agent")]),
    ).toEqual([serverEntry]);
  });

  it("keeps the Android list mounted across the first message", () => {
    expect(threadFeedMountKey("environment-1:thread-1", "android", 0)).toBe(
      threadFeedMountKey("environment-1:thread-1", "android", 1),
    );
    expect(threadFeedMountKey("environment-1:thread-1", "ios", 0)).not.toBe(
      threadFeedMountKey("environment-1:thread-1", "ios", 1),
    );
  });
});
