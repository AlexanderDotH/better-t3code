import type { MessageId, OrchestrationV2ThreadProjection, RunId } from "@t3tools/contracts";

export interface InterruptedTurnRetryTarget {
  readonly messageId: MessageId;
  readonly runId: RunId;
}

export function resolveInterruptedTurnRetryTarget(input: {
  readonly projection: OrchestrationV2ThreadProjection;
}): InterruptedTurnRetryTarget | null {
  const { projection } = input;
  if (
    projection.runs.some((run) =>
      ["preparing", "queued", "starting", "running", "waiting"].includes(run.status),
    )
  )
    return null;
  const run = projection.runs.at(-1);
  if (run === undefined || !["interrupted", "cancelled", "failed"].includes(run.status))
    return null;
  const message = projection.messages.find((candidate) => candidate.id === run.userMessageId);
  if (message === undefined || message.role !== "user" || message.streaming) return null;
  if (
    projection.messages.some(
      (candidate) =>
        candidate.runId === run.id &&
        candidate.role === "assistant" &&
        candidate.text.trim().length > 0,
    )
  )
    return null;
  return { messageId: message.id, runId: run.id };
}
