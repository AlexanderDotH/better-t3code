import {
  EventId,
  MessageId,
  SubagentId,
  type OrchestrationSubagentDetail,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveSubagentTranscriptEntries,
  groupSubagents,
  resolveSubagentDisplayName,
  resolveSubagentStatusPresentation,
} from "./subagentPresentation";

const STARTED_AT = "2026-07-30T09:00:00.000Z";

function makeSubagent(
  id: string,
  status: OrchestrationSubagentStatus,
  overrides: Partial<OrchestrationSubagentSummary> = {},
): OrchestrationSubagentSummary {
  return {
    id: SubagentId.make(id),
    providerThreadId: `provider-${id}`,
    parentId: null,
    path: null,
    name: `Agent ${id}`,
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 0,
    status,
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: STARTED_AT,
    updatedAt: STARTED_AT,
    completedAt: null,
    ...overrides,
  };
}

describe("subagent presentation", () => {
  it("uses provider nickname first and falls back to a stable accessible agent name", () => {
    const named = makeSubagent("agent-review", "running", {
      name: "Review worker",
      nickname: "Bernoulli",
    });
    const unnamed = makeSubagent("codex:thread-agent-9f31c2", "starting", {
      name: " ",
      nickname: null,
      role: null,
      path: null,
    });

    expect(resolveSubagentDisplayName(named)).toBe("Bernoulli");
    expect(resolveSubagentDisplayName(unnamed)).toBe("Agent 9f31c2");
  });

  it("groups live states under Active and terminal states under Finished deterministically", () => {
    const groups = groupSubagents([
      makeSubagent("finished-old", "completed", {
        updatedAt: "2026-07-30T09:10:00.000Z",
      }),
      makeSubagent("waiting", "waiting", {
        startedAt: "2026-07-30T09:02:00.000Z",
      }),
      makeSubagent("running", "running", {
        startedAt: "2026-07-30T09:01:00.000Z",
      }),
      makeSubagent("finished-new", "error", {
        updatedAt: "2026-07-30T09:20:00.000Z",
      }),
      makeSubagent("starting", "starting", {
        startedAt: "2026-07-30T09:00:00.000Z",
      }),
    ]);

    expect(groups.active.map((agent) => agent.id)).toEqual([
      SubagentId.make("starting"),
      SubagentId.make("running"),
      SubagentId.make("waiting"),
    ]);
    expect(groups.finished.map((agent) => agent.id)).toEqual([
      SubagentId.make("finished-new"),
      SubagentId.make("finished-old"),
    ]);
  });

  it("shows real provider progress before status text without inventing a percentage", () => {
    const presentation = resolveSubagentStatusPresentation(
      makeSubagent("transport", "running", {
        statusMessage: "Working",
        latestProgress: {
          kind: "analysis",
          summary: "Checking reconnect cursor handling",
          detail: "Comparing buffered and live events",
          createdAt: "2026-07-30T09:05:00.000Z",
        },
      }),
    );

    expect(presentation).toMatchObject({
      label: "Running",
      activity: "Checking reconnect cursor handling",
      detail: "Comparing buffered and live events",
      tone: "progress",
      isActive: true,
    });
    expect(`${presentation.activity} ${presentation.detail}`).not.toContain("%");
  });

  it("falls back to truthful status language when no activity text exists", () => {
    expect(resolveSubagentStatusPresentation(makeSubagent("waiting", "waiting"))).toMatchObject({
      label: "Waiting",
      activity: "Waiting",
      detail: null,
      tone: "progress",
      isActive: true,
    });
    expect(resolveSubagentStatusPresentation(makeSubagent("failed", "error"))).toMatchObject({
      label: "Error",
      activity: "Failed",
      tone: "danger",
      isActive: false,
    });
    expect(
      resolveSubagentStatusPresentation(makeSubagent("interrupted", "interrupted")),
    ).toMatchObject({
      label: "Interrupted",
      tone: "danger",
      isActive: false,
    });
    expect(
      resolveSubagentStatusPresentation(makeSubagent("unavailable", "unavailable")),
    ).toMatchObject({
      label: "Unavailable",
      tone: "danger",
      isActive: false,
    });
  });
});

describe("deriveSubagentTranscriptEntries", () => {
  it("keeps every message, plan, and activity in chronological order", () => {
    const detail: OrchestrationSubagentDetail = {
      ...makeSubagent("transcript", "completed"),
      messages: [
        {
          id: MessageId.make("message-2"),
          role: "assistant",
          text: "Finished the review.",
          turnId: null,
          streaming: false,
          createdAt: "2026-07-30T09:03:00.000Z",
          updatedAt: "2026-07-30T09:03:00.000Z",
        },
        {
          id: MessageId.make("message-1"),
          role: "user",
          text: "Review the transport.",
          turnId: null,
          streaming: false,
          createdAt: "2026-07-30T09:01:00.000Z",
          updatedAt: "2026-07-30T09:01:00.000Z",
        },
      ],
      proposedPlans: [
        {
          id: "plan-1",
          turnId: null,
          planMarkdown: "## Plan\n\n- Inspect transport",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-07-30T09:02:00.000Z",
          updatedAt: "2026-07-30T09:02:00.000Z",
        },
      ],
      activities: [
        {
          id: EventId.make("activity-1"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Inspected transport",
          payload: { detail: "Read wsRpcClient.ts" },
          turnId: null,
          createdAt: "2026-07-30T09:04:00.000Z",
        },
      ],
    };

    const entries = deriveSubagentTranscriptEntries(detail);

    expect(entries.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      "message:message-1",
      "proposed-plan:plan-1",
      "message:message-2",
      "activity:activity-1",
    ]);
  });
});
