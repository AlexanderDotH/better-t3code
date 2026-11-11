import {
  MessageId,
  RunId,
  RunAttemptId,
  ProviderTurnId,
  ProviderThreadId,
  NodeId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { v2Projection, v2Now } from "./state/orchestrationV2TestFixtures.ts";
import type { UsageActivity } from "./responseMetrics.ts";
import { EventId, SubagentId, TurnId, type ResponseMetricsSnapshot } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";
import {
  formatResponseMetrics,
  selectResponseMetrics,
  selectV2ResponseMetrics,
} from "./responseMetrics.ts";

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
function activity(turn: string, payload: unknown): UsageActivity {
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
    expect(metrics?.context.tooltip).toContain("Latest context tokens used");
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

  it("updates live text estimates and replaces them with provider totals", () => {
    const live = {
      liveStartedAt: 1000,
      outputCharacters: 400,
      outputCharactersByMessageId: new Map([[MessageId.make("reply"), 200]]),
    };
    const result = formatResponseMetrics(live, translator, {
      nowMs: 3000,
      message: { id: MessageId.make("reply"), text: "x".repeat(600) },
    });
    expect(result?.speed.text).toBe("≈ 100 tok/s");
    expect(result?.output.text).toBe("≈ 200 Tokens");
    expect(formatResponseMetrics(live, translator, { nowMs: 5000 })?.speed.text).toBe("≈ 25 tok/s");
    const final = formatResponseMetrics(
      { ...live, ...snapshot, liveStartedAt: undefined },
      translator,
    );
    expect(final?.speed.text).toBe("150 tok/s");
    expect(final?.output.text).toBe("300 Tokens");
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

it("uses the run's provider attempt and retains reported latency without borrowing runless usage", () => {
  const attemptId = RunAttemptId.make("attempt");
  const run = {
    id: RunId.make("run"),
    threadId: v2Projection.thread.id,
    ordinal: 1,
    providerInstanceId: v2Projection.thread.providerInstanceId,
    modelSelection: v2Projection.thread.modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make("user"),
    rootNodeId: null,
    activeAttemptId: attemptId,
    status: "completed" as const,
    requestedAt: v2Now,
    startedAt: v2Now,
    completedAt: v2Now,
    checkpointId: null,
    contextHandoffId: null,
  };
  const providerTurn = {
    id: ProviderTurnId.make("provider-turn"),
    providerThreadId: ProviderThreadId.make("provider-thread"),
    nodeId: NodeId.make("root"),
    runAttemptId: attemptId,
    nativeTurnRef: null,
    ordinal: 1,
    status: "completed" as const,
    startedAt: v2Now,
    completedAt: DateTime.add(v2Now, { seconds: 2 }),
    responseMetrics: { timeToFirstTokenMs: 125 },
    turnTokenUsage: {
      usageScope: "main_agent" as const,
      usageStatus: "complete" as const,
      hasSubagents: false,
      inputTokens: 10,
      outputTokens: 20,
    },
  };
  const result = selectV2ResponseMetrics({
    runs: [run, { ...run, id: RunId.make("never-started"), activeAttemptId: null }],
    providerTurns: [
      providerTurn,
      {
        ...providerTurn,
        id: ProviderTurnId.make("runless"),
        runAttemptId: null,
        responseMetrics: { timeToFirstTokenMs: 999 },
      },
    ],
  });
  expect([...result]).toEqual([
    [
      run.id,
      {
        responseDurationMs: 2000,
        timeToFirstTokenMs: 125,
        tokenUsage: providerTurn.turnTokenUsage,
      },
    ],
  ]);

  const contextUsage = { usedTokens: 100, outputTokens: 30, updatedAt: "2026-01-01T00:00:00Z" };
  const output = {
    id: TurnItemId.make("reply-item"),
    type: "assistant_message" as const,
    threadId: run.threadId,
    runId: run.id,
    nodeId: providerTurn.nodeId,
    providerThreadId: providerTurn.providerThreadId,
    providerTurnId: providerTurn.id,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "running" as const,
    title: null,
    startedAt: v2Now,
    completedAt: null,
    updatedAt: v2Now,
    messageId: MessageId.make("reply"),
    text: "x".repeat(200),
    streaming: true,
  };
  const running = selectV2ResponseMetrics({
    runs: [{ ...run, status: "running", completedAt: null }],
    providerTurns: [
      {
        ...providerTurn,
        ordinal: 2,
        status: "running",
        completedAt: null,
        tokenUsage: contextUsage,
        turnTokenUsage: undefined,
      },
      { ...providerTurn, id: ProviderTurnId.make("older"), ordinal: 1 },
    ],
    turnItems: [
      output,
      { ...output, id: TurnItemId.make("reasoning"), type: "reasoning", text: "x".repeat(400) },
      { ...output, id: TurnItemId.make("child"), providerTurnId: ProviderTurnId.make("child") },
      {
        type: "assistant_message",
        providerTurnId: providerTurn.id,
        messageId: MessageId.make("quiet"),
      },
    ],
  }).get(run.id);
  expect(running?.liveStartedAt).toBe(DateTime.toEpochMillis(v2Now));
  expect(running?.tokenUsage?.outputTokens).toBe(30);
  expect(running?.tokenUsage?.usageStatus).toBe("partial");
  expect(running?.contextUsedTokens).toBe(100);
  expect(running?.outputCharacters).toBe(600);
  expect(running?.outputCharactersByMessageId?.get(output.messageId)).toBe(200);
});
