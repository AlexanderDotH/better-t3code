import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, SubagentId, TurnId } from "@t3tools/contracts";

import { deriveLatestContextWindowSnapshot, formatContextWindowTokens } from "./contextWindow.ts";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
        autoCompactThreshold: 200_000,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
    expect(snapshot?.autoCompactThreshold).toBe(200_000);
  });

  it("has no snapshot before the provider reports context usage", () => {
    expect(deriveLatestContextWindowSnapshot([])).toBeNull();
    expect(
      deriveLatestContextWindowSnapshot([
        makeActivity("activity-1", "turn.started", { usedTokens: 1_000, maxTokens: 100_000 }),
        makeActivity("activity-2", "context-compaction", { afterTokens: 500 }),
      ]),
    ).toBeNull();
  });

  it.each([
    undefined,
    null,
    [],
    "invalid",
    {},
    { usedTokens: null },
    { usedTokens: "1000" },
    { usedTokens: Number.NaN },
    { usedTokens: Number.POSITIVE_INFINITY },
    { usedTokens: Number.NEGATIVE_INFINITY },
    { usedTokens: -1 },
  ])("ignores malformed context usage: %j", (payload) => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", payload),
    ]);

    expect(snapshot).toBeNull();
  });

  it("falls back to the latest valid sample when newer usage is invalid", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 25_000,
        maxTokens: 100_000,
      }),
      makeActivity("activity-2", "context-window.updated", { usedTokens: Number.NaN }),
    ]);

    expect(snapshot).toMatchObject({ usedTokens: 25_000, usedPercentage: 25 });
  });

  it.each([undefined, null, "100000", Number.NaN, Infinity, -Infinity, 0, -100_000])(
    "keeps the latest usage with an unknown limit: %s",
    (maxTokens) => {
      const snapshot = deriveLatestContextWindowSnapshot([
        makeActivity("activity-1", "context-window.updated", {
          usedTokens: 50_000,
          maxTokens: 100_000,
        }),
        makeActivity("activity-2", "context-window.updated", { usedTokens: 25_000, maxTokens }),
      ]);

      expect(snapshot).toMatchObject({
        usedTokens: 25_000,
        maxTokens: null,
        usedPercentage: null,
        remainingTokens: null,
        remainingPercentage: null,
      });
    },
  );

  it.each([
    { usedTokens: 0, usedPercentage: 0, remainingTokens: 100_000, remainingPercentage: 100 },
    { usedTokens: 50_000, usedPercentage: 50, remainingTokens: 50_000, remainingPercentage: 50 },
    { usedTokens: 100_000, usedPercentage: 100, remainingTokens: 0, remainingPercentage: 0 },
    { usedTokens: 125_000, usedPercentage: 125, remainingTokens: 0, remainingPercentage: 0 },
  ])("preserves usage and remaining capacity for $usedPercentage% used", (expected) => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: expected.usedTokens,
        maxTokens: 100_000,
      }),
    ]);

    expect(snapshot).toMatchObject({ ...expected, maxTokens: 100_000 });
  });

  it("uses a later smaller provider sample after compaction", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 90_000,
        totalProcessedTokens: 200_000,
        maxTokens: 100_000,
      }),
      makeActivity("activity-2", "context-compaction", { afterTokens: 20_000 }),
      {
        ...makeActivity("activity-3", "context-window.updated", {
          usedTokens: 10_000,
          totalProcessedTokens: 210_000,
          maxTokens: 100_000,
        }),
        createdAt: "2026-03-23T00:01:00.000Z",
      },
    ]);

    expect(snapshot).toMatchObject({
      usedTokens: 10_000,
      totalProcessedTokens: 210_000,
      usedPercentage: 10,
      remainingTokens: 90_000,
      updatedAt: "2026-03-23T00:01:00.000Z",
    });
  });

  it("isolates main usage from newer reply and subagent samples", () => {
    const mainActivity = makeActivity("activity-1", "context-window.updated", {
      usedTokens: 50_000,
      maxTokens: 100_000,
    });
    const replyActivity = {
      ...makeActivity("activity-2", "context-window.updated", {
        usedTokens: 90_000,
        maxTokens: 100_000,
      }),
      replyTopicId: SubagentId.make("reply-topic-1"),
    };
    const subagentActivity = makeActivity(
      "subagent:thread-1:worker-1:activity-3",
      "context-window.updated",
      { usedTokens: 80_000, maxTokens: 100_000 },
    );

    expect(
      deriveLatestContextWindowSnapshot([mainActivity, replyActivity, subagentActivity]),
    ).toMatchObject({ usedTokens: 50_000, usedPercentage: 50 });
    expect(deriveLatestContextWindowSnapshot([replyActivity, subagentActivity])).toBeNull();
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });

  it("preserves the provider's additional usage fields", () => {
    const payload = {
      usedTokens: 1_000,
      totalProcessedTokens: 20_000,
      cumulativeUsage: {
        inputTokens: 16_000,
        cachedInputTokens: 4_000,
        outputTokens: 3_000,
        reasoningOutputTokens: 1_000,
      },
      inputTokens: 800,
      cachedInputTokens: 200,
      outputTokens: 150,
      reasoningOutputTokens: 50,
      lastUsedTokens: 500,
      lastInputTokens: 400,
      lastCachedInputTokens: 100,
      lastOutputTokens: 75,
      lastReasoningOutputTokens: 25,
      toolUses: 3,
      durationMs: 2_000,
      compactsAutomatically: true,
      autoCompactThreshold: 80_000,
    };

    expect(
      deriveLatestContextWindowSnapshot([
        makeActivity("activity-1", "context-window.updated", payload),
      ]),
    ).toMatchObject(payload);
  });
});
