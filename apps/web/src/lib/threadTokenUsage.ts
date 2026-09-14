import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

import type { ContextWindowSnapshot } from "./contextWindow";

export interface TokenUsageBreakdown {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningOutputTokens: number | null;
}

export function summarizeThreadTokenUsage(
  snapshot: ContextWindowSnapshot | null,
  agents: readonly RuntimeSubagent[],
) {
  const mainAgent: TokenUsageBreakdown = {
    inputTokens: snapshot?.cumulativeUsage?.inputTokens ?? snapshot?.inputTokens ?? null,
    cachedInputTokens:
      snapshot?.cumulativeUsage?.cachedInputTokens ?? snapshot?.cachedInputTokens ?? null,
    outputTokens: snapshot?.cumulativeUsage?.outputTokens ?? snapshot?.outputTokens ?? null,
    reasoningOutputTokens:
      snapshot?.cumulativeUsage?.reasoningOutputTokens ?? snapshot?.reasoningOutputTokens ?? null,
  };
  const parentIds = new Set(agents.map((agent) => agent.parentAgentId));
  const workers = agents.filter((agent) => agent.kind !== "workflow" || !parentIds.has(agent.id));
  const sumReported = (field: keyof TokenUsageBreakdown) => {
    if (
      (field === "cachedInputTokens" || field === "reasoningOutputTokens") &&
      workers.some((agent) => agent.usage?.[field] === undefined)
    ) {
      return null;
    }
    const counts = workers.flatMap((agent) => {
      const count = agent.usage?.[field];
      return count === undefined ? [] : [count];
    });
    return workers.length > 0 && counts.length === 0
      ? null
      : counts.reduce((sum, count) => sum + count, 0);
  };
  const subagents: TokenUsageBreakdown = {
    inputTokens: sumReported("inputTokens"),
    cachedInputTokens: sumReported("cachedInputTokens"),
    outputTokens: sumReported("outputTokens"),
    reasoningOutputTokens: sumReported("reasoningOutputTokens"),
  };
  const unclassifiedTokens = workers.reduce(
    (sum, agent) =>
      sum +
      Math.max(
        0,
        (agent.usage?.totalTokens ?? 0) -
          (agent.usage?.inputTokens ?? 0) -
          (agent.usage?.outputTokens ?? 0),
      ),
    0,
  );

  return {
    mainAgent,
    subagents,
    inputTokens: (mainAgent.inputTokens ?? 0) + (subagents.inputTokens ?? 0),
    outputTokens: (mainAgent.outputTokens ?? 0) + (subagents.outputTokens ?? 0),
    agentCount: workers.length,
    reportingAgentCount: workers.filter((agent) => agent.usage !== null).length,
    unclassifiedTokens,
    inputIsPartial:
      snapshot?.cumulativeUsage == null ||
      workers.some((agent) => agent.usage?.inputTokens === undefined),
    outputIsPartial:
      snapshot?.cumulativeUsage == null ||
      workers.some((agent) => agent.usage?.outputTokens === undefined),
  };
}

export type ThreadTokenUsage = ReturnType<typeof summarizeThreadTokenUsage>;
