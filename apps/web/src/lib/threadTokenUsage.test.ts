import { projectedSubagentsToRuntime } from "@t3tools/client-runtime/state/subagentRuntime";
import { NodeId, type ThreadTokenUsageSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { deriveLatestContextWindowSnapshot } from "./contextWindow";
import { summarizeThreadTokenUsage } from "./threadTokenUsage";

const timestamp = DateTime.makeUnsafe("2026-09-13T10:00:00.000Z");
type ProjectedAgent = Parameters<typeof projectedSubagentsToRuntime>[0][number];
function agent(id: string, overrides: Partial<ProjectedAgent> & { parentNodeId?: NodeId } = {}) {
  return {
    id: NodeId.make(id),
    title: id,
    prompt: id,
    model: null,
    status: "completed" as const,
    result: null,
    startedAt: timestamp,
    completedAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}
const cumulativeUsage = {
  inputTokens: 1_000,
  cachedInputTokens: 600,
  outputTokens: 200,
  reasoningOutputTokens: 50,
};
const mainUsage: ThreadTokenUsageSnapshot = {
  usedTokens: 110,
  inputTokens: 100,
  outputTokens: 10,
  cumulativeUsage,
};
function summarize(
  agents: ReadonlyArray<ProjectedAgent>,
  usage: ThreadTokenUsageSnapshot | null = mainUsage,
) {
  return summarizeThreadTokenUsage(
    deriveLatestContextWindowSnapshot([], null, { contextUsage: usage, updatedAt: timestamp }),
    projectedSubagentsToRuntime(agents),
  );
}

describe("thread token usage", () => {
  it("uses cumulative main usage and avoids counting workflow totals again with nested workers", () => {
    const result = summarize([
      agent("workflow", {
        usage: { totalTokens: 500, inputTokens: 400, outputTokens: 100 },
        workflow: { phases: [], agents: [], totalTokens: 500 },
      }),
      agent("worker", {
        parentNodeId: NodeId.make("workflow"),
        usage: {
          totalTokens: 500,
          inputTokens: 400,
          cachedInputTokens: 300,
          outputTokens: 100,
          reasoningOutputTokens: 80,
        },
      }),
      agent("nested", {
        parentNodeId: NodeId.make("worker"),
        usage: { totalTokens: 50, inputTokens: 40, outputTokens: 10 },
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
  it("includes all settled agents beyond the display roster's 100-agent limit", () => {
    const agents = Array.from({ length: 105 }, (_, index) =>
      agent(`agent-${index}`, { usage: { totalTokens: 10, inputTokens: 8, outputTokens: 2 } }),
    );
    expect(summarize(agents)).toMatchObject({
      agentCount: 105,
      inputTokens: 1_840,
      outputTokens: 410,
    });
  });
  it("keeps unknown input/output splits visible without inventing tokens", () => {
    expect(
      summarize([
        agent("total-only", { usage: { totalTokens: 800 } }),
        agent("pending", { status: "pending" }),
      ]),
    ).toMatchObject({
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
  it("marks snapshots without cumulative counters as partial and stays empty before usage arrives", () => {
    expect(summarize([], { usedTokens: 110, inputTokens: 100, outputTokens: 10 })).toMatchObject({
      inputTokens: 100,
      outputTokens: 10,
      inputIsPartial: true,
      outputIsPartial: true,
    });
    expect(summarize([], null)).toMatchObject({ inputTokens: 0, outputTokens: 0, agentCount: 0 });
  });
});
