import type { MessageId, RunId, ThreadId } from "@t3tools/contracts";

export interface ReplyTopicThread {
  readonly id: ThreadId;
  readonly title: string;
  readonly createdAt: string;
  readonly messageReply?: { readonly sourceThreadId: ThreadId; readonly messageId: MessageId };
  readonly latestRun: {
    readonly status: string;
    readonly runId?: RunId;
    readonly assistantMessageId?: MessageId | null;
  } | null;
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly source?: {
    readonly latestVisibleMessage: { readonly id: MessageId; readonly role: string } | null;
    readonly lastError?: string | null;
  };
}

export type ReplyTopicStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "interrupted"
  | "failed";
export interface ReplyTopicSummary {
  readonly messageId: MessageId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly count: number;
  readonly status: ReplyTopicStatus | null;
  readonly error: string | null;
  readonly runId: RunId | null;
  readonly retry: { readonly messageId: MessageId; readonly runId: RunId } | null;
}

function topicStatus(thread: ReplyTopicThread): ReplyTopicStatus | null {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "waiting";
  switch (thread.latestRun?.status) {
    case "preparing":
    case "queued":
    case "starting":
      return "pending";
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "completed":
      return "completed";
    case "interrupted":
    case "cancelled":
      return "interrupted";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

export function deriveReplyTopics(
  threads: ReadonlyArray<ReplyTopicThread>,
  sourceThreadId: ThreadId,
) {
  const topics = new Map<MessageId, ReplyTopicSummary & { readonly createdAt: string }>();
  for (const thread of threads) {
    if (thread.messageReply?.sourceThreadId !== sourceThreadId) continue;
    const messageId = thread.messageReply.messageId;
    const previous = topics.get(messageId);
    const count = (previous?.count ?? 0) + 1;
    if (previous && previous.createdAt > thread.createdAt) {
      topics.set(messageId, { ...previous, count });
      continue;
    }
    const status = topicStatus(thread);
    const prompt = thread.source?.latestVisibleMessage;
    const runId = thread.latestRun?.runId ?? null;
    topics.set(messageId, {
      messageId,
      threadId: thread.id,
      title: thread.title,
      count,
      status,
      runId,
      createdAt: thread.createdAt,
      error: status === "failed" ? (thread.source?.lastError ?? null) : null,
      retry:
        (status === "failed" || status === "interrupted") &&
        !thread.latestRun?.assistantMessageId &&
        prompt?.role === "user" &&
        runId !== null
          ? { messageId: prompt.id, runId }
          : null,
    });
  }
  return new Map<MessageId, ReplyTopicSummary>(
    [...topics].map(([id, { createdAt: _createdAt, ...topic }]) => [id, topic]),
  );
}
