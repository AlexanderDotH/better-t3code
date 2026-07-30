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
  isRootThreadDetailEvent,
  isSelectedSubagentDetailEvent,
  isThreadAggregateEvent,
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

  it("keeps root transcript events and summary updates but filters child transcript", () => {
    expect(isRootThreadDetailEvent(messageEvent(1))).toBe(true);
    expect(isRootThreadDetailEvent(messageEvent(2, selectedSubagentId))).toBe(false);
    expect(
      isRootThreadDetailEvent(
        event(3, "thread.subagent-upserted", {
          threadId,
          subagent: subagentSummary(),
        }),
      ),
    ).toBe(true);
    expect(
      isRootThreadDetailEvent(
        event(4, "thread.deleted", {
          threadId,
          deletedAt: occurredAt,
        }),
      ),
    ).toBe(true);
  });

  it("keeps only the selected child transcript and summary updates", () => {
    expect(
      isSelectedSubagentDetailEvent(messageEvent(1, selectedSubagentId), selectedSubagentId),
    ).toBe(true);
    expect(
      isSelectedSubagentDetailEvent(messageEvent(2, siblingSubagentId), selectedSubagentId),
    ).toBe(false);
    expect(isSelectedSubagentDetailEvent(messageEvent(3), selectedSubagentId)).toBe(false);
    expect(
      isSelectedSubagentDetailEvent(
        event(4, "thread.subagent-upserted", {
          threadId,
          subagent: subagentSummary(),
        }),
        selectedSubagentId,
      ),
    ).toBe(true);
    expect(
      isSelectedSubagentDetailEvent(
        event(5, "thread.deleted", {
          threadId,
          deletedAt: occurredAt,
        }),
        selectedSubagentId,
      ),
    ).toBe(true);
  });
});
