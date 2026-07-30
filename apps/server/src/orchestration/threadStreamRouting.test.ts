import {
  CommandId,
  EventId,
  MessageId,
  SubagentId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  isThreadAggregateEvent,
  toRootThreadStreamItem,
  toSubagentStreamItem,
} from "./threadStreamRouting.ts";

const threadId = ThreadId.make("thread-stream-routing");
const selectedSubagentId = SubagentId.make("codex:selected");
const siblingSubagentId = SubagentId.make("codex:sibling");
const occurredAt = "2026-07-30T10:00:00.000Z";

function event(
  sequence: number,
  type: OrchestrationEvent["type"],
  payload: unknown,
  aggregateId = threadId,
): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId,
    type,
    occurredAt,
    commandId: CommandId.make(`command-${sequence}`),
    causationEventId: null,
    correlationId: CommandId.make(`command-${sequence}`),
    metadata: {},
    payload: payload as never,
  } as OrchestrationEvent;
}

function messageEvent(sequence: number, subagentId?: typeof selectedSubagentId) {
  return event(sequence, "thread.message-sent", {
    threadId,
    ...(subagentId === undefined ? {} : { subagentId }),
    messageId: MessageId.make(`message-${sequence}`),
    role: "assistant",
    text: "Working",
    turnId: null,
    streaming: false,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

function subagentSummary(id = selectedSubagentId): OrchestrationSubagentSummary {
  return {
    id,
    providerThreadId: id,
    parentId: null,
    path: null,
    name: "Selected",
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 1,
    status: "running",
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: occurredAt,
    updatedAt: occurredAt,
    completedAt: null,
  };
}

describe("thread stream routing", () => {
  it("matches only events belonging to the requested thread aggregate", () => {
    expect(isThreadAggregateEvent(messageEvent(1), threadId)).toBe(true);
    expect(
      isThreadAggregateEvent(
        event(2, "thread.message-sent", {}, ThreadId.make("another-thread")),
        threadId,
      ),
    ).toBe(false);
  });

  it("keeps root transcript events and subagent summaries while cursoring child transcript", () => {
    expect(toRootThreadStreamItem(messageEvent(1)).kind).toBe("event");
    expect(toRootThreadStreamItem(messageEvent(2, selectedSubagentId))).toEqual({
      kind: "cursor",
      sequence: 2,
    });

    const summaryEvent = event(3, "thread.subagent-upserted", {
      threadId,
      subagent: subagentSummary(),
    });
    expect(toRootThreadStreamItem(summaryEvent)).toEqual({
      kind: "event",
      event: summaryEvent,
    });
  });

  it("sends only the selected subagent transcript and summary updates", () => {
    const selectedMessage = messageEvent(1, selectedSubagentId);
    expect(toSubagentStreamItem(selectedMessage, selectedSubagentId)).toEqual({
      kind: "event",
      event: selectedMessage,
    });
    expect(toSubagentStreamItem(messageEvent(2, siblingSubagentId), selectedSubagentId)).toEqual({
      kind: "cursor",
      sequence: 2,
    });
    expect(toSubagentStreamItem(messageEvent(3), selectedSubagentId)).toEqual({
      kind: "cursor",
      sequence: 3,
    });

    const selectedState = event(4, "thread.subagent-state-set", {
      threadId,
      subagentId: selectedSubagentId,
      status: "completed",
      statusMessage: "Done",
      updatedAt: occurredAt,
    });
    expect(toSubagentStreamItem(selectedState, selectedSubagentId)).toEqual({
      kind: "event",
      event: selectedState,
    });

    const siblingSummary = event(5, "thread.subagent-upserted", {
      threadId,
      subagent: subagentSummary(siblingSubagentId),
    });
    expect(toSubagentStreamItem(siblingSummary, selectedSubagentId)).toEqual({
      kind: "cursor",
      sequence: 5,
    });
  });
});
