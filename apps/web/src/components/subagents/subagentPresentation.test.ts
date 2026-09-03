import {
  EventId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  SubagentId,
  type OrchestrationSubagentDetail,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ASTERIX_AGENT_NAMES,
  deriveSubagentTranscriptEntries,
  groupSubagents,
  resolveSubagentDisplayName,
  resolveSubagentStatusPresentation,
  resolveSubagentTranscriptMetadata,
} from "./subagentPresentation";

const STARTED_AT = "2026-07-30T09:00:00.000Z";

function makeSubagent(
  id: string,
  status: OrchestrationSubagentStatus,
  overrides: Partial<OrchestrationSubagentSummary> = {},
): OrchestrationSubagentSummary {
  return {
    id: SubagentId.make(id),
    origin: "provider-native",
    providerInstanceId: null,
    providerDriver: null,
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
  it("uses the Codex nickname and falls back to a stable Asterix character name", () => {
    const named = makeSubagent("agent-review", "running", {
      name: "Review worker",
      nickname: "Bernoulli",
    });
    const unnamed = makeSubagent("codex:thread-agent-9f31c2", "starting", {
      name: "stream_routing_retry",
      nickname: null,
      role: "worker",
      path: "/root/stream_routing_retry",
    });

    expect(resolveSubagentDisplayName(named)).toBe("Bernoulli");
    expect(ASTERIX_AGENT_NAMES).toContain(resolveSubagentDisplayName(unnamed));
    expect(resolveSubagentDisplayName(unnamed)).toBe(resolveSubagentDisplayName(unnamed));
    expect(resolveSubagentDisplayName(unnamed)).not.toContain("stream_routing_retry");
  });

  it("gives different unnamed agents different character names", () => {
    const names = ["agent-one", "agent-two", "agent-three"].map((id) =>
      resolveSubagentDisplayName(
        makeSubagent(`codex:${id}`, "running", {
          name: id,
          nickname: null,
          path: `/root/${id}`,
        }),
      ),
    );

    expect(new Set(names).size).toBe(names.length);
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
  });

  it("labels Fetch transcripts with the exact provider instance and selected traits", () => {
    expect(
      resolveSubagentTranscriptMetadata(
        makeSubagent("fetch-review", "running", {
          origin: "t3-fetch",
          providerInstanceId: ProviderInstanceId.make("claude-work"),
          providerDriver: ProviderDriverKind.make("claudeAgent"),
          role: "explorer",
          model: "claude-opus-4-1",
          reasoningEffort: "high",
          serviceTier: "priority",
        }),
      ),
    ).toEqual(["Fetch", "claude-work", "claude-opus-4-1", "high", "priority"]);

    expect(
      resolveSubagentTranscriptMetadata(
        makeSubagent("native-review", "running", {
          role: "reviewer",
          model: "gpt-5.6",
          reasoningEffort: "ultra",
          serviceTier: "priority",
        }),
      ),
    ).toEqual(["reviewer", "gpt-5.6", "ultra", "priority"]);
  });

  it("labels T3-managed subagents with the exact provider instance and selected traits", () => {
    expect(
      resolveSubagentTranscriptMetadata(
        makeSubagent("managed-security-review", "running", {
          origin: "t3-managed",
          providerInstanceId: ProviderInstanceId.make("codex-security"),
          providerDriver: ProviderDriverKind.make("codex"),
          role: "General",
          model: "gpt-daybreak-blue-latest",
          reasoningEffort: "max",
          serviceTier: "priority",
        }),
      ),
    ).toEqual(["Subagent", "codex-security", "gpt-daybreak-blue-latest", "max", "priority"]);
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
