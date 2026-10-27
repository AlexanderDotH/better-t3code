import type { OrchestrationCheckpointSummary } from "@t3tools/contracts";
import type { ThreadFeedEntry } from "../../lib/threadActivity";

export const COLLAPSED_CHANGED_FILE_COUNT = 3;

export function changedFileMotionId(checkpoint: OrchestrationCheckpointSummary, path: string) {
  return `checkpoint:${checkpoint.checkpointRef}:${path}`;
}

export function messageCheckpoints(
  feed: readonly ThreadFeedEntry[],
  checkpoints: readonly OrchestrationCheckpointSummary[],
) {
  const byMessage = new Map<string, OrchestrationCheckpointSummary>();
  const latestAssistantByTurn = new Map<string, string>();
  const assistants = new Map<string, string>();
  for (const entry of feed) {
    if (
      entry.type !== "message" ||
      entry.message.role !== "assistant" ||
      entry.message.replyTopicId
    )
      continue;
    if (entry.message.turnId) {
      latestAssistantByTurn.set(entry.message.turnId, entry.id);
      assistants.set(entry.message.id, entry.id);
    }
  }
  for (const checkpoint of checkpoints) {
    if (checkpoint.status !== "ready" || checkpoint.files.length === 0) continue;
    const messageId = checkpoint.assistantMessageId
      ? assistants.get(checkpoint.assistantMessageId)
      : latestAssistantByTurn.get(checkpoint.turnId);
    if (messageId) byMessage.set(messageId, checkpoint);
  }
  return byMessage;
}
