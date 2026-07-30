import type { OrchestrationEvent, SubagentId, ThreadId } from "@t3tools/contracts";

export function isThreadAggregateEvent(event: OrchestrationEvent, threadId: ThreadId): boolean {
  return event.aggregateKind === "thread" && event.aggregateId === threadId;
}

export function isRootThreadDetailEvent(event: OrchestrationEvent): boolean {
  switch (event.type) {
    case "thread.message-sent":
    case "thread.proposed-plan-upserted":
    case "thread.activity-appended":
      return event.payload.subagentId === undefined;
    case "thread.turn-diff-completed":
    case "thread.reverted":
    case "thread.session-set":
    case "thread.subagent-upserted":
    case "thread.subagent-state-set":
    case "thread.subagent-progress-set":
    case "thread.deleted":
      return true;
    default:
      return false;
  }
}

export function isSelectedSubagentDetailEvent(
  event: OrchestrationEvent,
  subagentId: SubagentId,
): boolean {
  switch (event.type) {
    case "thread.message-sent":
    case "thread.proposed-plan-upserted":
    case "thread.activity-appended":
    case "thread.subagent-state-set":
    case "thread.subagent-progress-set":
      return event.payload.subagentId === subagentId;
    case "thread.subagent-upserted":
      return event.payload.subagent.id === subagentId;
    case "thread.deleted":
      return true;
    default:
      return false;
  }
}
