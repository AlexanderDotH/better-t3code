import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import { formatContextWindowTokens, type ContextWindowSnapshot } from "./contextWindow.ts";
import type { RuntimeSubagent } from "./state/subagentRuntime.ts";

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

export type TokenDirection = "input" | "output";

/** One direction's total and the splits the reported counters can support. */
export function summarizeTokenDirection(usage: ThreadTokenUsage, direction: TokenDirection) {
  const isInput = direction === "input";
  const totalField = isInput ? "inputTokens" : "outputTokens";
  const subsetField = isInput ? "cachedInputTokens" : "reasoningOutputTokens";
  const total = usage[totalField];
  const sources = usage.agentCount > 0 ? [usage.mainAgent, usage.subagents] : [usage.mainAgent];
  let subset = 0;
  let rest = 0;
  let reported = false;
  for (const source of sources) {
    const sourceTotal = source[totalField];
    const sourceSubset = source[subsetField];
    if (sourceTotal === null || sourceSubset === null) continue;
    reported = true;
    const part = Math.min(sourceTotal, sourceSubset);
    subset += part;
    rest += sourceTotal - part;
  }
  const subagents = usage.agentCount > 0 ? usage.subagents[totalField] : null;
  return {
    total,
    partial: isInput ? usage.inputIsPartial : usage.outputIsPartial,
    composition: reported ? { rest, subset, unsplit: Math.max(0, total - rest - subset) } : null,
    agents: subagents === null ? null : { mainAgent: usage.mainAgent[totalField] ?? 0, subagents },
  };
}

export interface TokenUsageSegment {
  readonly label: string;
  readonly value: number;
  readonly share: string;
}

export interface TokenUsageSection {
  readonly id: "total" | TokenDirection;
  readonly title: string;
  readonly total: number;
  readonly partial: boolean;
  readonly splits: ReadonlyArray<ReadonlyArray<TokenUsageSegment>>;
}

function tokenSplit(
  segments: ReadonlyArray<{ readonly label: string; readonly value: number }>,
  translator: InterfaceTranslator,
): ReadonlyArray<ReadonlyArray<TokenUsageSegment>> {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) return [];
  return [
    segments.map((segment) => {
      const ratio = segment.value / total;
      const percent = translator.number(segment.value > 0 ? Math.max(ratio, 0.01) : 0, {
        style: "percent",
        maximumFractionDigits: 0,
      });
      return { ...segment, share: segment.value > 0 && ratio < 0.01 ? `<${percent}` : percent };
    }),
  ];
}

/** The totals, splits and caveats a client shows when someone opens the token details. */
export function describeThreadTokenUsage(usage: ThreadTokenUsage, translator: InterfaceTranslator) {
  const { message } = translator;
  const inputLabel = message("chat.timeline.inputTokens");
  const outputLabel = message("chat.timeline.outputTokens");
  const inputPartial = usage.inputIsPartial && usage.inputTokens > 0;
  const outputPartial = usage.outputIsPartial && usage.outputTokens > 0;
  const direction = (id: TokenDirection, label: string): TokenUsageSection => {
    const isInput = id === "input";
    const { total, partial, composition, agents } = summarizeTokenDirection(usage, id);
    return {
      id,
      title: message("chat.tokens.title", { direction: label }),
      total,
      partial: partial && total > 0,
      splits: [
        ...(composition
          ? tokenSplit(
              [
                {
                  label: message(isInput ? "chat.tokens.uncached" : "chat.tokens.response"),
                  value: composition.rest,
                },
                {
                  label: message(isInput ? "chat.tokens.cached" : "chat.tokens.reasoning"),
                  value: composition.subset,
                },
                ...(composition.unsplit > 0
                  ? [{ label: message("chat.tokens.unsplit"), value: composition.unsplit }]
                  : []),
              ],
              translator,
            )
          : []),
        ...(agents
          ? tokenSplit(
              [
                { label: message("chat.tokens.mainAgent"), value: agents.mainAgent },
                {
                  label: message("chat.tokens.subagents", { count: usage.agentCount }),
                  value: agents.subagents,
                },
              ],
              translator,
            )
          : []),
      ],
    };
  };
  const sections: ReadonlyArray<TokenUsageSection> = [
    {
      id: "total",
      title: message("chat.timeline.totalTokens"),
      total: usage.inputTokens + usage.outputTokens,
      partial: inputPartial || outputPartial,
      splits: tokenSplit(
        [
          { label: inputLabel, value: usage.inputTokens },
          { label: outputLabel, value: usage.outputTokens },
        ],
        translator,
      ),
    },
    direction("input", inputLabel),
    direction("output", outputLabel),
  ];
  const notes = [
    ...(usage.agentCount > usage.reportingAgentCount
      ? [
          message("chat.tokens.reporting", {
            reported: usage.reportingAgentCount,
            count: usage.agentCount,
          }),
        ]
      : []),
    ...(usage.unclassifiedTokens > 0
      ? [
          message("chat.tokens.unclassified", {
            count: translator.number(usage.unclassifiedTokens),
          }),
        ]
      : []),
    ...(inputPartial || outputPartial ? [message("chat.tokens.partial")] : []),
  ];
  return { sections, notes };
}

export function formatTokenTotal(value: number, partial: boolean): string {
  return `${formatContextWindowTokens(value)}${partial && value > 0 ? "+" : ""}`;
}
