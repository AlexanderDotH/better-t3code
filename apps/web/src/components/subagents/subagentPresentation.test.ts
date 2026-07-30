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
  resolveSubagentDisplayName,
  resolveSubagentStatusPresentation,
} from "./subagentPresentation";

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
    startedAt: "2026-07-30T09:00:00.000Z",
    updatedAt: "2026-07-30T09:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("subagent presentation", () => {
  it("prefers provider nicknames and provides a stable fallback name", () => {
    expect(
      resolveSubagentDisplayName(
        makeSubagent("agent-review", "running", {
          name: "Review worker",
          nickname: "Bernoulli",
        }),
      ),
    ).toBe("Bernoulli");
    expect(
      resolveSubagentDisplayName(
        makeSubagent("codex:thread-agent-9f31c2", "starting", {
          name: " ",
          role: null,
          path: null,
        }),
      ),
    ).toBe("Agent 9f31c2");
  });

  it("shows provider progress and truthful active status language", () => {
    const presentation = resolveSubagentStatusPresentation(
      makeSubagent("transport", "waiting", {
        latestProgress: {
          kind: "analysis",
          summary: "Checking reconnect cursor handling",
          detail: "Comparing buffered and live events",
          createdAt: "2026-07-30T09:05:00.000Z",
        },
      }),
    );

    expect(presentation).toMatchObject({
      label: "Waiting",
      activity: "Checking reconnect cursor handling",
      detail: "Comparing buffered and live events",
      tone: "progress",
      isActive: true,
    });
  });
});

describe("deriveSubagentTranscriptEntries", () => {
  it("merges messages, plans, and activities into chronological order", () => {
    const detail: OrchestrationSubagentDetail = {
      ...makeSubagent("transcript", "completed"),
      messages: [
        {
          id: MessageId.make("message-2"),
          role: "assistant",
          text: "Finished.",
          turnId: null,
          streaming: false,
          createdAt: "2026-07-30T09:03:00.000Z",
          updatedAt: "2026-07-30T09:03:00.000Z",
        },
        {
          id: MessageId.make("message-1"),
          role: "user",
          text: "Review transport.",
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
          planMarkdown: "Inspect transport",
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
          payload: null,
          turnId: null,
          createdAt: "2026-07-30T09:04:00.000Z",
        },
      ],
    };

    expect(
      deriveSubagentTranscriptEntries(detail).map((entry) => `${entry.kind}:${entry.id}`),
    ).toEqual([
      "message:message-1",
      "proposed-plan:plan-1",
      "message:message-2",
      "activity:activity-1",
    ]);
  });
});
