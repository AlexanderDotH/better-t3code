import { describe, expect, it } from "vite-plus/test";

import {
  EventId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationSubagentDetail,
} from "@t3tools/contracts";

import { applySubagentDetailEvent } from "./subagentReducer.ts";

const threadId = ThreadId.make("thread-subagents");
const subagentId = SubagentId.make("agent-client-runtime");
const otherSubagentId = SubagentId.make("agent-other");
const createdAt = "2026-07-30T10:00:00.000Z";

const detail: OrchestrationSubagentDetail = {
  id: subagentId,
  origin: "t3-fetch",
  providerInstanceId: ProviderInstanceId.make("claude-work"),
  providerDriver: ProviderDriverKind.make("claudeAgent"),
  providerThreadId: "provider-agent-client-runtime",
  parentId: null,
  path: "/root/client_runtime",
  name: "client_runtime",
  nickname: "Carson",
  role: "worker",
  task: "Implement client runtime",
  model: "gpt-5.6-codex",
  reasoningEffort: "ultra",
  serviceTier: "priority",
  depth: 1,
  status: "running",
  statusMessage: "Implementing",
  latestProgress: null,
  latestTurn: null,
  startedAt: createdAt,
  updatedAt: createdAt,
  completedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
};

const event = (
  type: OrchestrationEvent["type"],
  sequence: number,
  payload: unknown,
): OrchestrationEvent =>
  ({
    eventId: EventId.make(`event-${sequence}`),
    sequence,
    occurredAt: `2026-07-30T10:00:0${sequence}.000Z`,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    aggregateKind: "thread",
    aggregateId: threadId,
    type,
    payload,
  }) as OrchestrationEvent;

describe("applySubagentDetailEvent", () => {
  it("merges an enriched summary without dropping transcript collections", () => {
    const result = applySubagentDetailEvent(
      {
        ...detail,
        messages: [
          {
            id: MessageId.make("existing-message"),
            role: "assistant",
            text: "Existing",
            turnId: null,
            streaming: false,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      },
      event("thread.subagent-upserted", 1, {
        threadId,
        subagent: {
          id: subagentId,
          origin: detail.origin,
          providerInstanceId: detail.providerInstanceId,
          providerDriver: detail.providerDriver,
          providerThreadId: detail.providerThreadId,
          parentId: detail.parentId,
          path: detail.path,
          name: detail.name,
          nickname: "Bernoulli",
          role: detail.role,
          task: detail.task,
          model: detail.model,
          reasoningEffort: detail.reasoningEffort,
          depth: detail.depth,
          status: detail.status,
          statusMessage: "Verifying",
          latestProgress: null,
          latestTurn: null,
          startedAt: createdAt,
          updatedAt: "2026-07-30T10:00:01.000Z",
          completedAt: null,
        },
      }),
    );

    expect(result).toMatchObject({
      kind: "updated",
      subagent: {
        nickname: "Bernoulli",
        origin: "t3-fetch",
        providerInstanceId: "claude-work",
        providerDriver: "claudeAgent",
        serviceTier: "priority",
        statusMessage: "Verifying",
        messages: [{ text: "Existing" }],
      },
    });
  });

  it("builds the selected transcript from routed messages, plans, and activities", () => {
    const withMessage = applySubagentDetailEvent(
      detail,
      event("thread.message-sent", 2, {
        threadId,
        subagentId,
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
        threadId,
        subagentId,
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
        threadId,
        subagentId,
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

  it("ignores transcript events routed to another subagent", () => {
    const result = applySubagentDetailEvent(
      detail,
      event("thread.message-sent", 2, {
        threadId,
        subagentId: otherSubagentId,
        messageId: MessageId.make("other-message"),
        role: "assistant",
        text: "Other child output",
        turnId: null,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      }),
    );

    expect(result).toEqual({ kind: "unchanged" });
  });

  it("marks terminal states completed and clears completion when the agent resumes", () => {
    const completed = applySubagentDetailEvent(
      detail,
      event("thread.subagent-state-set", 5, {
        threadId,
        subagentId,
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
        threadId,
        subagentId,
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
});
