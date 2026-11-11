import { NodeId, type ThreadTokenUsageSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";
import type { ContextWindowSnapshot } from "./contextWindow.ts";
import { projectedSubagentsToRuntime } from "./state/subagentRuntime.ts";
import {
  describeThreadTokenUsage,
  formatTokenTotal,
  summarizeThreadTokenUsage,
  summarizeTokenDirection,
} from "./threadTokenUsage.ts";

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
    usage === null
      ? null
      : ({
          ...usage,
          remainingTokens: null,
          usedPercentage: null,
          remainingPercentage: null,
          updatedAt: "2026-09-13T10:00:00.000Z",
        } as ContextWindowSnapshot),
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
  it("splits what is known and leaves unreported subagent tokens unsplit", () => {
    const silent = summarize([agent("silent")]);
    expect(summarizeTokenDirection(silent, "input")).toEqual({
      total: 1_000,
      partial: true,
      composition: { rest: 400, subset: 600, unsplit: 0 },
      agents: null,
    });

    const reporting = summarize([
      agent("reporting", { usage: { inputTokens: 500, outputTokens: 100 } } as never),
    ]);
    expect(summarizeTokenDirection(reporting, "output")).toEqual({
      total: 300,
      partial: false,
      composition: { rest: 150, subset: 50, unsplit: 100 },
      agents: { mainAgent: 200, subagents: 100 },
    });
  });

  it("offers no split before any counter is reported", () => {
    expect(summarizeTokenDirection(summarize([], null), "input")).toMatchObject({
      composition: null,
      agents: null,
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

  it("describes totals and splits for every client, without empty charts", () => {
    const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
    const { sections, notes } = describeThreadTokenUsage(summarize([]), translator);
    expect(sections.map(({ id, total, partial }) => ({ id, total, partial }))).toEqual([
      { id: "total", total: 1_200, partial: false },
      { id: "input", total: 1_000, partial: false },
      { id: "output", total: 200, partial: false },
    ]);
    expect(sections[0]?.splits).toEqual([
      [
        { label: "Input", value: 1_000, share: "83%" },
        { label: "Output", value: 200, share: "17%" },
      ],
    ]);
    expect(notes).toEqual([]);

    const tiny = describeThreadTokenUsage(
      summarize([], {
        usedTokens: 1,
        cumulativeUsage: {
          inputTokens: 100_000,
          cachedInputTokens: 0,
          outputTokens: 1,
          reasoningOutputTokens: 0,
        },
      }),
      translator,
    );
    expect(tiny.sections[0]?.splits[0]?.[1]?.share).toBe("<1%");

    const empty = describeThreadTokenUsage(summarize([], null), translator);
    expect(empty.sections.flatMap((section) => section.splits)).toEqual([]);
    expect(formatTokenTotal(0, true)).toBe("0");
  });
});
