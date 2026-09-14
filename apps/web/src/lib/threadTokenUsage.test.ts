import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { foldSubagentActivities } from "@t3tools/client-runtime/state/subagentRuntime";
import { describe, expect, it } from "vite-plus/test";

import { deriveLatestContextWindowSnapshot } from "./contextWindow";
import { summarizeThreadTokenUsage } from "./threadTokenUsage";

function activity(
  id: string,
  kind: string,
  payload: Record<string, unknown>,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-09-13T10:00:00.000Z",
    tone: "info",
    summary: kind,
    kind,
    payload,
  };
}

const cumulativeUsage = {
  inputTokens: 1_000,
  cachedInputTokens: 600,
  outputTokens: 200,
  reasoningOutputTokens: 50,
};
const mainUsage = activity("main", "context-window.updated", {
  usedTokens: 110,
  inputTokens: 100,
  outputTokens: 10,
  cumulativeUsage,
});

function summarize(activities: OrchestrationThreadActivity[]) {
  return summarizeThreadTokenUsage(
    deriveLatestContextWindowSnapshot(activities),
    foldSubagentActivities(activities, { limit: null }),
  );
}

describe("thread token usage", () => {
  it("adds all reported main and nested agent usage without counting snapshots or workflow totals twice", () => {
    const worker = activity("worker", "task.progress", {
      agentKind: "agent",
      taskId: "worker",
      parentAgentId: "workflow",
      typedUsage: {
        totalTokens: 500,
        inputTokens: 400,
        cachedInputTokens: 300,
        outputTokens: 100,
        reasoningOutputTokens: 80,
      },
    });
    const result = summarize([
      mainUsage,
      { ...mainUsage, id: EventId.make("main-duplicate") },
      activity("workflow", "task.progress", {
        agentKind: "agent",
        taskId: "workflow",
        taskType: "local_workflow",
        typedUsage: { totalTokens: 500, inputTokens: 400, outputTokens: 100 },
      }),
      worker,
      { ...worker, id: EventId.make("worker-duplicate") },
      activity("nested", "task.progress", {
        agentKind: "agent",
        taskId: "nested",
        parentAgentId: "worker",
        typedUsage: { totalTokens: 50, inputTokens: 40, outputTokens: 10 },
      }),
    ]);

    expect(result).toMatchObject({
      inputTokens: 1_440,
      outputTokens: 310,
      agentCount: 2,
      reportingAgentCount: 2,
      unclassifiedTokens: 0,
      inputIsPartial: false,
      outputIsPartial: false,
      mainAgent: cumulativeUsage,
      subagents: {
        inputTokens: 440,
        outputTokens: 110,
        cachedInputTokens: null,
        reasoningOutputTokens: null,
      },
    });
  });

  it("includes settled agents beyond the display roster's 100-agent limit", () => {
    const agents = Array.from({ length: 105 }, (_, index) =>
      activity(`agent-${index}`, "task.progress", {
        agentKind: "agent",
        taskId: `agent-${index}`,
        status: "completed",
        typedUsage: { totalTokens: 10, inputTokens: 8, outputTokens: 2 },
      }),
    );
    expect(foldSubagentActivities(agents)).toHaveLength(100);
    expect(summarize([mainUsage, ...agents])).toMatchObject({
      agentCount: 105,
      inputTokens: 1_840,
      outputTokens: 410,
    });
  });

  it("keeps unknown input/output splits visible without inventing tokens", () => {
    const result = summarize([
      mainUsage,
      activity("total-only", "task.progress", {
        agentKind: "agent",
        taskId: "total-only",
        typedUsage: { totalTokens: 800 },
      }),
      activity("pending", "task.started", { agentKind: "agent", taskId: "pending" }),
    ]);
    expect(result).toMatchObject({
      inputTokens: 1_000,
      outputTokens: 200,
      inputIsPartial: true,
      outputIsPartial: true,
      agentCount: 2,
      reportingAgentCount: 1,
      unclassifiedTokens: 800,
      subagents: { inputTokens: null, outputTokens: null },
    });
  });

  it("marks legacy snapshots as partial and rejects malformed cumulative counters", () => {
    const result = summarize([
      activity("legacy", "context-window.updated", {
        usedTokens: 110,
        inputTokens: 100,
        outputTokens: 10,
        cumulativeUsage: { ...cumulativeUsage, inputTokens: -1 },
      }),
    ]);
    expect(result).toMatchObject({
      inputTokens: 100,
      outputTokens: 10,
      inputIsPartial: true,
      outputIsPartial: true,
    });
    expect(summarize([])).toMatchObject({ inputTokens: 0, outputTokens: 0, agentCount: 0 });
  });
});
