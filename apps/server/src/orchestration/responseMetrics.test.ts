import {
  EventId,
  ProviderDriverKind,
  TurnId,
  RuntimeItemId,
  SubagentId,
  ThreadId,
  type ProviderRuntimeEvent,
  type TurnTokenUsage,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createResponseMetricsTracker } from "./responseMetrics.ts";
import {
  stampProviderIngress,
  transferProviderIngress,
} from "../observability/ProviderPipelineMetrics.ts";

const base = {
  eventId: EventId.make("event"),
  provider: ProviderDriverKind.make("codex"),
  threadId: ThreadId.make("thread-a"),
  turnId: TurnId.make("turn-a"),
  createdAt: "2026-10-16T08:00:00.000Z",
};
const start: ProviderRuntimeEvent = { ...base, type: "turn.started", payload: {} };
const delta: ProviderRuntimeEvent = {
  ...base,
  type: "content.delta",
  payload: { streamKind: "assistant_text", delta: "Hello" },
};
const tokenUsage: TurnTokenUsage = {
  usageStatus: "complete",
  usageScope: "main_agent",
  inputTokens: 1000,
  outputTokens: 300,
  reasoningTokens: 100,
  hasSubagents: false,
};
const complete: ProviderRuntimeEvent = {
  ...base,
  type: "turn.completed",
  payload: { state: "completed", tokenUsage },
};

describe("response measurements", () => {
  it("uses true ingress even when ingestion is delayed and clocks have different origins", () => {
    const tracker = createResponseMetricsTracker({ now: () => 5000 });
    const stampedStart = stampProviderIngress({ ...start }, 100);
    const stampedDelta = stampProviderIngress({ ...delta }, 350);
    const stampedComplete = stampProviderIngress({ ...complete }, 2350);
    tracker.observe(transferProviderIngress(stampedStart, { ...stampedStart }), 1700000000000);
    tracker.observe(stampedDelta, 1700000010000);
    expect(tracker.observe(stampedComplete, 1700000020000)).toMatchObject({
      snapshot: { timeToFirstTokenMs: 250, responseDurationMs: 2000, tokenUsage },
      diagnostics: { ingressToObservationMs: 2650 },
    });
  });

  it("keeps missing ingress absent and preserves known zero timing", () => {
    const unknown = createResponseMetricsTracker();
    unknown.observe({ ...start });
    unknown.observe({ ...delta });
    expect(unknown.observe({ ...complete })).toMatchObject({
      snapshot: { tokenUsage },
      diagnostics: {},
    });
    const known = createResponseMetricsTracker({ now: () => 0 });
    known.observe(stampProviderIngress({ ...start }, 0));
    known.observe(stampProviderIngress({ ...delta }, 0));
    expect(known.observe(stampProviderIngress({ ...complete }, 0))).toMatchObject({
      snapshot: { timeToFirstTokenMs: 0, responseDurationMs: 0 },
      diagnostics: { ingressToObservationMs: 0 },
    });
  });

  it("uses the union of overlapping tool lifetimes while retaining overall response duration", () => {
    const tracker = createResponseMetricsTracker();
    const tool = (
      type: "item.started" | "item.completed",
      itemId: string,
    ): ProviderRuntimeEvent => ({
      ...base,
      itemId: RuntimeItemId.make(itemId),
      type,
      payload: { itemType: "command_execution" },
    });
    tracker.observe(start, 0);
    tracker.observe(delta, 100);
    tracker.observe(tool("item.started", "a"), 200);
    tracker.observe(tool("item.started", "b"), 300);
    tracker.observe(tool("item.completed", "a"), 500);
    tracker.observe(tool("item.completed", "b"), 700);
    tracker.observe(tool("item.completed", "b"), 800);
    expect(tracker.observe(complete, 1000)).toMatchObject({
      snapshot: { timeToFirstTokenMs: 100, responseDurationMs: 900 },
      diagnostics: { observedToolWaitMs: 500 },
    });
  });

  it("omits invalid clock intervals instead of reporting them as zero", () => {
    const tracker = createResponseMetricsTracker();
    tracker.observe(start, 500);
    tracker.observe(delta, 100);
    expect(tracker.observe(complete, 1000)?.snapshot).toEqual({
      responseDurationMs: 900,
      tokenUsage,
    });
  });

  it("does not invent tool duration for missing starts, missing clocks, or incomplete tools", () => {
    for (const variant of ["missing-start", "missing-clock", "incomplete"] as const) {
      const tracker = createResponseMetricsTracker();
      tracker.observe(start, 0);
      tracker.observe(delta, 100);
      if (variant !== "missing-start") {
        tracker.observe(
          {
            ...base,
            itemId: RuntimeItemId.make("tool"),
            type: "item.started",
            payload: { itemType: "mcp_tool_call" },
          },
          variant === "missing-clock" ? undefined : 200,
        );
      }
      if (variant !== "incomplete") {
        tracker.observe(
          {
            ...base,
            itemId: RuntimeItemId.make("tool"),
            type: "item.completed",
            payload: { itemType: "mcp_tool_call" },
          },
          600,
        );
      }
      expect(tracker.observe(complete, 1000)?.diagnostics.observedToolWaitMs).toBeUndefined();
    }
  });

  it("handles late earlier output without extending terminal timing or accepting stale starts", () => {
    const tracker = createResponseMetricsTracker();
    tracker.observe(start, 0);
    tracker.observe(complete, 1000);
    expect(tracker.observe(delta, 250)?.snapshot).toMatchObject({
      timeToFirstTokenMs: 250,
      responseDurationMs: 750,
    });
    expect(tracker.observe(complete, 5000)?.snapshot.responseDurationMs).toBe(750);
    const next = { ...base, turnId: TurnId.make("turn-b") };
    tracker.observe({ ...next, type: "turn.started", payload: {} }, 2000);
    tracker.observe(start, 0);
    expect(tracker.observe(complete, 1000)).toBeNull();
    expect(tracker.observe({ ...complete, ...next }, 3000)?.turnId).toBe(next.turnId);
  });

  it("bounds retained threads and leaves evicted measurements untimed", () => {
    const tracker = createResponseMetricsTracker({ maxTrackedThreads: 2 });
    tracker.observe(start, 0);
    tracker.observe(delta, 100);
    for (const threadId of ["thread-b", "thread-c"]) {
      tracker.observe({ ...start, threadId: ThreadId.make(threadId) }, 200);
    }
    expect(tracker.observe(complete, 1000)?.snapshot).toEqual({ tokenUsage });
  });

  it("measures provider output before composer delivery and preserves full-turn token totals", () => {
    const tracker = createResponseMetricsTracker();
    expect(tracker.observe(start, 1000)).toBeNull();
    expect(
      tracker.observe(
        {
          ...delta,
          payload: { streamKind: "reasoning_text", delta: "Thinking" },
        },
        1250,
      ),
    ).toBeNull();
    tracker.observe(delta, 1500);
    const result = tracker.observe(complete, 3250);
    expect(result?.snapshot).toEqual({
      timeToFirstTokenMs: 250,
      responseDurationMs: 2000,
      tokenUsage,
    });
    expect(tracker.observe(complete, 9999)?.snapshot).toEqual(result?.snapshot);
  });

  it("updates late context reports without changing timing or adding another turn", () => {
    const tracker = createResponseMetricsTracker();
    tracker.observe(start, 0);
    tracker.observe(delta, 0);
    tracker.observe(complete, 1000);
    const result = tracker.observe(
      {
        ...base,
        type: "thread.token-usage.updated",
        payload: { usage: { usedTokens: 1200, maxTokens: 2000 } },
      },
      5000,
    );
    expect(result?.snapshot).toMatchObject({
      timeToFirstTokenMs: 0,
      responseDurationMs: 1000,
      contextUsedTokens: 1200,
      contextLimitTokens: 2000,
    });
  });

  it("does not estimate latency for missing, non-streamed, or recovered output", () => {
    const tracker = createResponseMetricsTracker();
    tracker.observe(start, 0);
    expect(tracker.observe(complete, 1000)?.snapshot).toEqual({ tokenUsage });
    const recovered = createResponseMetricsTracker();
    expect(recovered.observe(complete, 1000)?.snapshot).toEqual({ tokenUsage });
  });

  it("keeps threads and subagent output separate", () => {
    const tracker = createResponseMetricsTracker();
    tracker.observe(start, 0);
    tracker.observe({ ...delta, subagentId: SubagentId.make("child") }, 1);
    tracker.observe({ ...delta, threadId: ThreadId.make("thread-b") }, 2);
    expect(tracker.observe(complete, 1000)?.snapshot).toEqual({ tokenUsage });
  });

  it("discards stale turn events and clears measurements for the next turn", () => {
    const tracker = createResponseMetricsTracker();
    tracker.observe(start, 0);
    tracker.observe(delta, 100);
    const next = { ...base, turnId: TurnId.make("turn-b") };
    tracker.observe({ ...next, type: "turn.started", payload: {} }, 1000);
    expect(tracker.observe(complete, 1100)).toBeNull();
    expect(tracker.observe({ ...complete, ...next }, 2000)?.snapshot).toEqual({ tokenUsage });
  });

  it("preserves partial usage and resets after session loss", () => {
    const tracker = createResponseMetricsTracker();
    tracker.observe(start, 0);
    tracker.observe(delta, 100);
    const partial: TurnTokenUsage = {
      usageStatus: "partial",
      usageScope: "main_agent",
      outputTokens: 12,
      hasSubagents: false,
    };
    expect(
      tracker.observe(
        {
          ...base,
          type: "turn.aborted",
          payload: { reason: "Cancelled", tokenUsage: partial },
        },
        1000,
      )?.snapshot.tokenUsage,
    ).toEqual(partial);
    tracker.observe(
      {
        ...base,
        type: "session.exited",
        payload: { reason: "Stopped" },
      },
      2000,
    );
    expect(tracker.observe(complete, 3000)?.snapshot).toEqual({ tokenUsage });
  });
});
