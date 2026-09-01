import type { ThreadFeedEntry } from "../../lib/threadActivity";
import type { QueuedThreadMessage } from "../../state/thread-outbox";

export function mergeQueuedMessagesIntoThreadFeed(
  feed: ReadonlyArray<ThreadFeedEntry>,
  queuedMessages: ReadonlyArray<QueuedThreadMessage>,
): ThreadFeedEntry[] {
  const existingIds = new Set(feed.map((entry) => entry.id));
  const optimisticEntries = queuedMessages
    .filter((message) => !existingIds.has(message.messageId))
    .map<ThreadFeedEntry>((message) => ({
      type: "message",
      id: message.messageId,
      createdAt: message.createdAt,
      message: {
        id: message.messageId,
        role: "user",
        text: message.text,
        attachments: message.attachments.map(
          ({ dataUrl: _, previewUri: __, ...attachment }) => attachment,
        ),
        turnId: null,
        streaming: false,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      },
    }));
  return [...feed, ...optimisticEntries].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function threadFeedMountKey(
  scopedThreadKey: string,
  platform: "android" | "ios",
  feedLength: number,
): string {
  if (platform === "android") return scopedThreadKey;
  return `${scopedThreadKey}:${feedLength === 0 ? "empty" : "filled"}`;
}
