import {
  EnvironmentId,
  USAGE_CONTRACT_VERSION,
  type UsageBucket,
  type UsageDay,
  type UsageSummary,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { parseUsagePriceForm, usagePriceForm } from "@t3tools/client-runtime/usage-prices";
import { dailyUsagePace } from "@t3tools/shared/usageLimits";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { mergeModelUsage } from "./usage-insights";

const day = "2026-09-13" as UsageDay;
function summary(buckets: readonly UsageBucket[]): UsageSummary {
  return {
    contractVersion: USAGE_CONTRACT_VERSION,
    readAt: "2026-09-13T12:00:00.000Z",
    timeZone: "UTC",
    sinceDay: day,
    untilDay: day,
    buckets,
    sources: [
      {
        fingerprint: {
          hostId: "shared-host",
          provider: "codex",
          resolvedHomePath: "/transcripts",
          volumeId: "shared-volume",
        },
        status: "ok",
        scannedFiles: 1,
        skippedFiles: 0,
        malformedRecords: 0,
        distinctSessions: 1,
        message: null,
      },
    ],
    pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 1 },
    scanDurationMs: 1,
  };
}
const bucket: UsageBucket = {
  day,
  provider: "codex",
  model: "custom",
  totals: {
    uncachedInputTokens: 100,
    cachedInputTokens: 200,
    cacheCreationTokens: 0,
    outputTokens: 20,
    reasoningTokens: 5,
  },
  costUsd: 2,
  cacheSavingsUsd: 1,
  costSource: "modelPriced",
  records: 1,
  unpricedRecords: 0,
  sessions: 1,
};

describe("mobile usage insights", () => {
  it("filters the selected provider and model without counting shared transcripts twice", () => {
    const usage = summary([
      bucket,
      { ...bucket, model: "other", costUsd: 100 },
      { ...bucket, provider: "claude", costUsd: 200 },
    ]);
    const environments = ["one", "two"].map((id) => ({
      environmentId: EnvironmentId.make(id),
      label: id,
      summary: usage,
    }));
    const merged = mergeModelUsage(environments, "codex", "custom");
    expect(merged.models.map((model) => model.model)).toEqual(["custom"]);
    expect(merged.costUsd).toBe(2);
    expect(merged.totalTokens).toBe(320);
    expect(merged.daily.map((period) => [period.day, period.costUsd, period.totalTokens])).toEqual([
      [day, 2, 320],
    ]);
    expect(merged.duplicateSources).toHaveLength(1);
  });

  it("preserves explicit free cache prices and rejects invalid override values", () => {
    const form = {
      ...usagePriceForm(" custom "),
      inputCostPerMillionTokens: "2,5",
      outputCostPerMillionTokens: "10",
      cacheReadCostPerMillionTokens: "0",
    };
    expect(parseUsagePriceForm(form)).toEqual({
      model: "custom",
      price: {
        inputCostPerMillionTokens: 2.5,
        outputCostPerMillionTokens: 10,
        cacheReadCostPerMillionTokens: 0,
      },
    });
    expect(
      parseUsagePriceForm({ ...form, cacheReadCostPerMillionTokens: "" })?.price,
    ).not.toHaveProperty("cacheReadCostPerMillionTokens");
    for (const value of ["-1", "Infinity", "0x10", "", "1e999"])
      expect(parseUsagePriceForm({ ...form, inputCostPerMillionTokens: value })).toBeNull();
  });

  it("shows observed daily usage, catch-up and the selected workday budget", () => {
    const time = (date: number, hour: number) =>
      DateTime.toEpochMillis(
        DateTime.makeZonedUnsafe(
          { year: 2026, month: 9, day: date, hour },
          { adjustForTimeZone: true },
        ),
      );
    const iso = (date: number, hour: number) =>
      DateTime.formatIso(DateTime.makeUnsafe(time(date, hour)));
    const window: ServerProviderUsageWindow = {
      id: "weekly",
      label: "Weekly",
      kind: "weekly",
      windowDurationMins: 10_080,
      usedPercent: 6,
      resetsAt: iso(20, 0),
      usageHistory: [
        { at: iso(13, 0), usedPercent: 0 },
        { at: iso(13, 8), usedPercent: 1 },
        { at: iso(13, 12), usedPercent: 6 },
      ],
    };
    const workday = dailyUsagePace(window, time(13, 12), 8)!;
    const fullDay = dailyUsagePace(window, time(13, 12), 24)!;
    expect(workday.todayUsedPercent).toBe(6);
    expect(workday.dailyBudgetPercent).toBeCloseTo(100 / 7);
    expect(workday.todayRemainingPercent).toBeCloseTo(100 / 7 - 6);
    expect(workday.todayBudgetUsedPercent).toBeCloseTo(42);
    expect(workday.hourlyBudgetPercent).toBeCloseTo(100 / 7 / 8);
    expect(fullDay.hourlyBudgetPercent).toBeCloseTo(100 / 7 / 24);
    const nextDay = dailyUsagePace(
      {
        ...window,
        usedPercent: 8,
        usageHistory: [
          ...window.usageHistory!,
          { at: iso(14, 0), usedPercent: 6 },
          { at: iso(14, 8), usedPercent: 8 },
        ],
      },
      time(14, 12),
      8,
    )!;
    expect(nextDay.catchUpRemainingPercent).toBeCloseTo(100 / 7 - 8);
    expect(nextDay.todayUsedPercent).toBe(2);
    expect(
      dailyUsagePace(
        { ...window, usageHistory: [{ at: iso(13, 8), usedPercent: 6 }] },
        time(13, 12),
        8,
      )?.todayUsedPercent,
    ).toBeNull();
  });
});
