import {
  EventId,
  SubagentId,
  TurnId,
  type OrchestrationThreadActivity,
  type ResponseMetricsSnapshot,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";
import { formatResponseMetrics, selectResponseMetrics } from "./responseMetrics.ts";

const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
const snapshot: ResponseMetricsSnapshot = {
  timeToFirstTokenMs: 250,
  responseDurationMs: 2000,
  tokenUsage: {
    usageStatus: "complete",
    usageScope: "main_agent",
    inputTokens: 1000,
    outputTokens: 300,
    reasoningTokens: 100,
    hasSubagents: false,
  },
  contextUsedTokens: 1300,
  contextLimitTokens: 2000,
};
function activity(turn: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(turn),
    kind: "response.metrics",
    tone: "info",
    summary: "Metrics",
    turnId: TurnId.make(turn),
    createdAt: "2026-10-16T08:00:00.000Z",
    payload,
  };
}

describe("response metrics", () => {
  it("selects each turn independently and applies corrected snapshots", () => {
    const activities = [
      activity("a", snapshot),
      activity("b", {}),
      activity("a", { ...snapshot, contextUsedTokens: 1400 }),
    ];
    const result = selectResponseMetrics(activities);
    expect(result.get(TurnId.make("a"))?.contextUsedTokens).toBe(1400);
    expect(result.get(TurnId.make("b"))).toEqual({});
    expect(selectResponseMetrics([]).size).toBe(0);
  });

  it("ignores malformed, turnless, reply, and subagent measurements", () => {
    expect(
      selectResponseMetrics([
        activity("bad", { timeToFirstTokenMs: -1 }),
        { ...activity("no-turn", snapshot), turnId: null },
        { ...activity("reply", snapshot), replyTopicId: SubagentId.make("reply") },
        { ...activity("child", snapshot), id: EventId.make("subagent:child:metrics") },
      ]).size,
    ).toBe(0);
  });

  it("uses full output including reasoning without counting the subset twice", () => {
    const metrics = formatResponseMetrics(snapshot, translator);
    expect(metrics && Object.values(metrics).map((metric) => metric.text)).toEqual([
      "150 tok/s",
      "TTFT 0.25 s",
      "300 Tokens",
      "Context 1,300 / 2,000 (65%)",
    ]);
    expect(metrics?.speed.tooltip).toContain("including tool waits");
    expect(metrics?.firstToken.tooltip).toContain("provider turn start");
    expect(metrics?.output.tooltip).toContain("whole turn, including reasoning");
    expect(metrics?.context.tooltip).toContain("Final context tokens used");
  });

  it("keeps genuine zero values", () => {
    const result = formatResponseMetrics(
      {
        timeToFirstTokenMs: 0,
        responseDurationMs: 1000,
        contextUsedTokens: 0,
        contextLimitTokens: 2000,
        tokenUsage: {
          usageStatus: "complete",
          usageScope: "main_agent",
          inputTokens: 0,
          outputTokens: 0,
          hasSubagents: false,
        },
      },
      translator,
    );
    expect(result && Object.values(result).map((metric) => metric.text)).toEqual([
      "0 tok/s",
      "TTFT 0 s",
      "0 Tokens",
      "Context 0 / 2,000 (0%)",
    ]);
  });

  it("declines throughput when the response duration is zero or missing", () => {
    expect(
      formatResponseMetrics({ ...snapshot, responseDurationMs: 0 }, translator)?.speed.text,
    ).toBe("– tok/s");
    expect(formatResponseMetrics({ tokenUsage: snapshot.tokenUsage }, translator)?.speed.text).toBe(
      "– tok/s",
    );
  });

  it("marks partial counts and never invents throughput from them", () => {
    const result = formatResponseMetrics(
      {
        responseDurationMs: 1000,
        tokenUsage: {
          usageStatus: "partial",
          usageScope: "main_agent",
          outputTokens: 12,
          hasSubagents: true,
        },
      },
      translator,
    );
    expect(result && Object.values(result).map((metric) => metric.text)).toEqual([
      "– tok/s",
      "TTFT –",
      "≥ 12 Tokens",
      "Context –",
    ]);
  });

  it("omits absent snapshots and uses en dashes for missing measurements", () => {
    expect(formatResponseMetrics(null, translator)).toBeNull();
    const missing = formatResponseMetrics({}, translator);
    expect(missing && Object.values(missing).map((metric) => metric.text)).toEqual([
      "– tok/s",
      "TTFT –",
      "– Tokens",
      "Context –",
    ]);
    expect(formatResponseMetrics({ contextUsedTokens: 0 }, translator)?.context.text).toBe(
      "Context 0 / –",
    );
    expect(formatResponseMetrics({ contextLimitTokens: 128000 }, translator)?.context.text).toBe(
      "Context – / 128,000",
    );
  });

  it("formats overflow and localized values without capping actual context usage", () => {
    const de = createInterfaceTranslator({ language: "de", locale: "de-DE" });
    const result = formatResponseMetrics({ ...snapshot, contextUsedTokens: 3000 }, de);
    expect(result?.speed.text).toBe("150 Tok/s");
    expect(result?.firstToken.text).toBe("TTFT 0,25 s");
    expect(result?.output.text).toBe("300 Token");
    expect(result?.context.text).toBe("Kontext 3.000 / 2.000 (150\u00a0%)");

    const fr = createInterfaceTranslator({ language: "fr", locale: "fr-FR" });
    const french = formatResponseMetrics(snapshot, fr);
    expect(french?.speed.text).toBe("150 jetons/s");
    expect(french?.firstToken.text).toBe("TTFT 0,25 s");
    expect(french?.output.text).toBe("300 jetons");
    expect(french?.context.text).toBe("Contexte 1\u202f300 / 2\u202f000 (65\u00a0%)");
  });
});
