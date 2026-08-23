import type {
  OrchestrationEvent,
  OrchestrationSubagentStreamItem,
  OrchestrationThreadStreamItem,
  SubagentId,
  ThreadId,
} from "@t3tools/contracts";

export function isThreadAggregateEvent(event: OrchestrationEvent, threadId: ThreadId): boolean {
  return event.aggregateKind === "thread" && event.aggregateId === threadId;
}

function isRootThreadDetailEvent(event: OrchestrationEvent): boolean {
  switch (event.type) {
    case "thread.message-sent":
    case "thread.proposed-plan-upserted":
    case "thread.activity-appended":
      return event.payload.subagentId === undefined;
    case "thread.turn-abort-settled":
    case "thread.turn-diff-completed":
    case "thread.reverted":
    case "thread.session-set":
    case "thread.harness-sync-linked":
    case "thread.harness-sync-message-imported":
    case "thread.subagent-upserted":
    case "thread.subagent-state-set":
    case "thread.subagent-progress-set":
      return true;
    default:
      return false;
  }
}

function isSelectedSubagentDetailEvent(event: OrchestrationEvent, subagentId: SubagentId): boolean {
  switch (event.type) {
    case "thread.message-sent":
    case "thread.proposed-plan-upserted":
    case "thread.activity-appended":
    case "thread.subagent-state-set":
    case "thread.subagent-progress-set":
      return event.payload.subagentId === subagentId;
    case "thread.subagent-upserted":
      return event.payload.subagent.id === subagentId;
    default:
      return false;
  }
}

export function toRootThreadStreamItem(event: OrchestrationEvent): OrchestrationThreadStreamItem {
  return isRootThreadDetailEvent(event)
    ? { kind: "event", event }
    : { kind: "cursor", sequence: event.sequence };
}

export function toSubagentStreamItem(
  event: OrchestrationEvent,
  subagentId: SubagentId,
): OrchestrationSubagentStreamItem {
  return isSelectedSubagentDetailEvent(event, subagentId)
    ? { kind: "event", event }
    : { kind: "cursor", sequence: event.sequence };
}
