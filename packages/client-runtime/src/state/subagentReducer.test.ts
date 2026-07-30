import {
  EventId,
  MessageId,
  SubagentId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationSubagentDetail,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applySubagentDetailEvent } from "./subagentReducer.ts";

const THREAD_ID = ThreadId.make("thread-subagents");
const SUBAGENT_ID = SubagentId.make("agent-client-runtime");
const OTHER_SUBAGENT_ID = SubagentId.make("agent-other");
const CREATED_AT = "2026-07-30T10:00:00.000Z";

const BASE_SUBAGENT: OrchestrationSubagentDetail = {
  id: SUBAGENT_ID,
  providerThreadId: "provider-agent-client-runtime",
  parentId: null,
  path: "/root/client_runtime",
  name: "client_runtime",
  nickname: "Carson",
  role: "worker",
  task: "Implement client runtime",
  model: "gpt-5.6-codex",
  reasoningEffort: "ultra",
  depth: 1,
  status: "running",
  statusMessage: "Implementing",
  latestProgress: null,
  latestTurn: null,
  startedAt: CREATED_AT,
  updatedAt: CREATED_AT,
  completedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
};

function event(
  type: OrchestrationEvent["type"],
  sequence: number,
  payload: unknown,
): OrchestrationEvent {
  return {
    eventId: EventId.make(`event-${sequence}`),
    sequence,
    occurredAt: `2026-07-30T10:00:${sequence.toString().padStart(2, "0")}.000Z`,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    type,
    payload,
  } as OrchestrationEvent;
}

describe("applySubagentDetailEvent", () => {
  it("merges an enriched summary without dropping transcript collections", () => {
    const result = applySubagentDetailEvent(
      {
        ...BASE_SUBAGENT,
        messages: [
          {
            id: MessageId.make("existing-message"),
            role: "assistant",
            text: "Existing",
            turnId: null,
            streaming: false,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
          },
        ],
      },
      event("thread.subagent-upserted", 1, {
        threadId: THREAD_ID,
        subagent: {
          ...BASE_SUBAGENT,
          messages: undefined,
          proposedPlans: undefined,
          activities: undefined,
          nickname: "Bernoulli",
          statusMessage: "Verifying",
          updatedAt: "2026-07-30T10:00:01.000Z",
        },
      }),
    );

    expect(result).toMatchObject({
      kind: "updated",
      subagent: {
        nickname: "Bernoulli",
        statusMessage: "Verifying",
        messages: [{ text: "Existing" }],
      },
    });
  });

  it("builds the selected transcript from routed messages, plans, and activities", () => {
    const withMessage = applySubagentDetailEvent(
      BASE_SUBAGENT,
      event("thread.message-sent", 2, {
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        messageId: MessageId.make("child-message"),
        role: "assistant",
        text: "Child output",
        turnId: null,
        streaming: false,
        createdAt: "2026-07-30T10:00:02.000Z",
        updatedAt: "2026-07-30T10:00:02.000Z",
      }),
    );
    expect(withMessage.kind).toBe("updated");
    if (withMessage.kind !== "updated") {
      return;
    }

    const withPlan = applySubagentDetailEvent(
      withMessage.subagent,
      event("thread.proposed-plan-upserted", 3, {
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        proposedPlan: {
          id: "child-plan",
          turnId: null,
          planMarkdown: "# Child plan",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-07-30T10:00:03.000Z",
          updatedAt: "2026-07-30T10:00:03.000Z",
        },
      }),
    );
    expect(withPlan.kind).toBe("updated");
    if (withPlan.kind !== "updated") {
      return;
    }

    const withActivity = applySubagentDetailEvent(
      withPlan.subagent,
      event("thread.activity-appended", 4, {
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        activity: {
          id: EventId.make("child-activity"),
          tone: "tool",
          kind: "command",
          summary: "Ran tests",
          payload: {},
          turnId: null,
          createdAt: "2026-07-30T10:00:04.000Z",
        },
      }),
    );

    expect(withActivity).toMatchObject({
      kind: "updated",
      subagent: {
        messages: [{ id: "child-message", text: "Child output" }],
        proposedPlans: [{ id: "child-plan" }],
        activities: [{ id: "child-activity" }],
      },
    });
  });

  it("merges streamed message chunks without duplicating the message", () => {
    const initial = applySubagentDetailEvent(
      BASE_SUBAGENT,
      event("thread.message-sent", 2, {
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        messageId: MessageId.make("streamed-message"),
        role: "assistant",
        text: "Hello ",
        turnId: null,
        streaming: true,
        createdAt: "2026-07-30T10:00:02.000Z",
        updatedAt: "2026-07-30T10:00:02.000Z",
      }),
    );
    expect(initial.kind).toBe("updated");
    if (initial.kind !== "updated") {
      return;
    }

    const appended = applySubagentDetailEvent(
      initial.subagent,
      event("thread.message-sent", 3, {
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        messageId: MessageId.make("streamed-message"),
        role: "assistant",
        text: "world",
        turnId: null,
        streaming: true,
        createdAt: "2026-07-30T10:00:02.000Z",
        updatedAt: "2026-07-30T10:00:03.000Z",
      }),
    );

    expect(appended).toMatchObject({
      kind: "updated",
      subagent: {
        messages: [{ id: "streamed-message", text: "Hello world", streaming: true }],
      },
    });
  });

  it("ignores transcript events routed to another subagent", () => {
    const result = applySubagentDetailEvent(
      BASE_SUBAGENT,
      event("thread.message-sent", 2, {
        threadId: THREAD_ID,
        subagentId: OTHER_SUBAGENT_ID,
        messageId: MessageId.make("other-message"),
        role: "assistant",
        text: "Other child output",
        turnId: null,
        streaming: false,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    );

    expect(result).toEqual({ kind: "unchanged" });
  });

  it("marks terminal states completed and clears completion when the agent resumes", () => {
    const completed = applySubagentDetailEvent(
      BASE_SUBAGENT,
      event("thread.subagent-state-set", 5, {
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        status: "completed",
        statusMessage: "Done",
        updatedAt: "2026-07-30T10:00:05.000Z",
      }),
    );
    expect(completed.kind).toBe("updated");
    if (completed.kind !== "updated") {
      return;
    }

    const resumed = applySubagentDetailEvent(
      completed.subagent,
      event("thread.subagent-state-set", 6, {
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        status: "running",
        statusMessage: "Follow-up",
        updatedAt: "2026-07-30T10:00:06.000Z",
      }),
    );

    expect(completed.subagent.completedAt).toBe("2026-07-30T10:00:05.000Z");
    expect(resumed).toMatchObject({
      kind: "updated",
      subagent: {
        status: "running",
        completedAt: null,
      },
    });
  });

  it("ignores lifecycle events older than the selected snapshot", () => {
    const result = applySubagentDetailEvent(
      {
        ...BASE_SUBAGENT,
        updatedAt: "2026-07-30T10:00:10.000Z",
      },
      event("thread.subagent-state-set", 11, {
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        status: "completed",
        statusMessage: "Stale",
        updatedAt: "2026-07-30T10:00:09.000Z",
      }),
    );

    expect(result).toEqual({ kind: "unchanged" });
  });

  it("marks the selected transcript deleted when its parent thread is deleted", () => {
    const result = applySubagentDetailEvent(
      BASE_SUBAGENT,
      event("thread.deleted", 7, {
        threadId: THREAD_ID,
        deletedAt: "2026-07-30T10:00:07.000Z",
      }),
    );

    expect(result).toEqual({ kind: "deleted" });
  });
});
