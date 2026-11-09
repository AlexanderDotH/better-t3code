import type { OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";

type PeerThread = Pick<
  OrchestrationV2ThreadShell,
  "lineage" | "fetchWorker" | "messageReply" | "deletedAt" | "archivedAt"
>;

export const isAvailableThread = (thread: Pick<PeerThread, "deletedAt" | "archivedAt">) =>
  thread.deletedAt === null && thread.archivedAt === null;

/** Subagents, native children, fetch workers and reply topics work under their root chat. */
export const isRootThread = (
  thread: Pick<PeerThread, "lineage" | "fetchWorker" | "messageReply">,
) =>
  thread.lineage.relationshipToParent !== "subagent" &&
  thread.fetchWorker === undefined &&
  thread.messageReply === undefined;

/** Running reply topics by source thread; a reply turn counts as its source chat working. */
export const activeRepliesBySource = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) => {
  const replies = new Map<ThreadId, Array<OrchestrationV2ThreadShell>>();
  for (const thread of threads) {
    const source = thread.messageReply?.sourceThreadId;
    if (source === undefined || thread.activeRunId === null || !isAvailableThread(thread)) continue;
    replies.set(source, [...(replies.get(source) ?? []), thread]);
  }
  return replies;
};

/** Another root chat is working, or a reply topic runs beside any root chat, this one included. */
export const hasActiveProjectAgentPeer = (
  threadId: ThreadId,
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
) => {
  const replies = activeRepliesBySource(threads);
  return threads.some(
    (thread) =>
      isAvailableThread(thread) &&
      isRootThread(thread) &&
      ((thread.id !== threadId && thread.activeRunId !== null) || replies.has(thread.id)),
  );
};
