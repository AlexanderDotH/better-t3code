import type {
  MessageReplyReference,
  OrchestrationV2MessageReply,
  ThreadId,
} from "@t3tools/contracts";
import type { ThreadFeedEntry } from "../../lib/threadActivity";
import type { ThreadMessageJump } from "./threadMessageJump";

const inlineEntries = new WeakMap<ThreadFeedEntry, ThreadFeedEntry>();

export function withInlineReplyEntryId(entry: ThreadFeedEntry): ThreadFeedEntry {
  if (entry.type !== "message") return entry;
  const existing = inlineEntries.get(entry);
  if (existing) return existing;
  const scoped = {
    ...entry,
    id: `inline-reply:${JSON.stringify([entry.message.sourceThreadId, entry.message.id])}`,
  };
  inlineEntries.set(entry, scoped);
  return scoped;
}

export function findMessageJumpEntry(
  parent: ReadonlyArray<ThreadFeedEntry>,
  replies: ReadonlyArray<ThreadFeedEntry> | undefined,
  target: ThreadMessageJump,
  currentThreadId: ThreadId,
) {
  const matchesMessage = (entry: ThreadFeedEntry) =>
    entry.type === "message" && entry.message.id === target.messageId;
  const matchesOwner = (entry: ThreadFeedEntry) =>
    entry.type === "message" &&
    matchesMessage(entry) &&
    (target.sourceThreadId === undefined || entry.message.sourceThreadId === target.sourceThreadId);
  return (
    parent.find(matchesOwner) ??
    replies?.find(matchesOwner) ??
    (target.sourceThreadId === currentThreadId
      ? parent.find(
          (entry) =>
            entry.type === "message" &&
            entry.message.visibility === "inherited" &&
            matchesMessage(entry),
        )
      : undefined)
  );
}

export function mergeReplyFeed(
  parent: ReadonlyArray<ThreadFeedEntry>,
  replies: ReadonlyArray<ThreadFeedEntry> | undefined,
): ReadonlyArray<ThreadFeedEntry> {
  if (!replies?.length) return parent;
  const merged: ThreadFeedEntry[] = [];
  let replyIndex = 0;
  for (const entry of parent) {
    while (
      replyIndex < replies.length &&
      (entry.type === "thinking" || replies[replyIndex]!.createdAt < entry.createdAt)
    ) {
      merged.push(replies[replyIndex++]!);
    }
    merged.push(entry);
  }
  return merged.concat(replies.slice(replyIndex));
}

export function replySourceThreadId(
  reference: MessageReplyReference,
  messageThreadId: ThreadId,
  topics: ReadonlyArray<{
    readonly id: ThreadId;
    readonly messageReply?: OrchestrationV2MessageReply | undefined;
  }>,
  ownerReply?: OrchestrationV2MessageReply,
): ThreadId {
  const owner = ownerReply ?? topics.find((thread) => thread.id === messageThreadId)?.messageReply;
  if (owner?.messageId === reference.messageId) return owner.sourceThreadId;
  if (reference.replyTopicId === undefined) return messageThreadId;
  return (
    topics.find((thread) => thread.messageReply?.replyTopicId === reference.replyTopicId)?.id ??
    messageThreadId
  );
}
