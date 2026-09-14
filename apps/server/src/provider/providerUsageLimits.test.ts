import { describe, expect, it } from "vite-plus/test";
import { MAX_USAGE_PACE_SAMPLES } from "@t3tools/contracts";

import { applyUsageLimitsUpdate, resolveUsageLimitsAfterProbe } from "./providerUsageLimits.ts";

const checkedAt = "2026-09-03T12:00:00.000Z";
const session = {
  id: "five_hour",
  kind: "session",
  label: "Session",
  usedPercent: 40,
  windowDurationMins: 300,
  resetsAt: "2026-09-03T14:00:00.000Z",
} as const;
const weekly = {
  id: "seven_day",
  kind: "weekly",
  label: "Weekly",
  usedPercent: 20,
  windowDurationMins: 10_080,
} as const;
const published = { checkedAt, windows: [session, weekly] };

describe("applyUsageLimitsUpdate", () => {
  it("returns the published object itself when no window moved", () => {
    // Codex repeats the same numbers beside every token-usage tick; the
    // ingestion path relies on identity to skip the publish.
    const next = applyUsageLimitsUpdate({
      previous: published,
      checkedAt: "2026-09-03T12:00:05.000Z",
      update: {
        windows: [
          { ...weekly },
          { id: "five_hour", kind: "session", label: "Session", usedPercent: 40 },
        ],
      },
    });
    expect(next).toBe(published);
  });

  it("upserts by id and keeps the reset a percent-only update omits", () => {
    const next = applyUsageLimitsUpdate({
      previous: published,
      checkedAt: "2026-09-03T12:00:05.000Z",
      update: {
        windows: [{ id: "five_hour", kind: "session", label: "Session", usedPercent: 55 }],
      },
    });
    expect(next).not.toBe(published);
    expect(next).toEqual({
      checkedAt: "2026-09-03T12:00:05.000Z",
      windows: [{ ...session, usedPercent: 55 }, weekly],
    });
  });

  it("leaves an unsupported account and an empty update alone", () => {
    const unsupported = { checkedAt, windows: [], unavailable: { reason: "unsupported" as const } };
    expect(
      applyUsageLimitsUpdate({ previous: unsupported, checkedAt, update: { windows: [session] } }),
    ).toBe(unsupported);
    expect(
      applyUsageLimitsUpdate({ previous: published, checkedAt, update: { windows: [] } }),
    ).toBe(published);
  });

  it("preserves reset credits when a streamed window update changes usage", () => {
    const resetCredits = { availableCount: 2, nextExpiresAt: "2026-10-01T00:00:00.000Z" };
    const next = applyUsageLimitsUpdate({
      previous: { ...published, resetCredits },
      checkedAt: "2026-09-03T12:00:05.000Z",
      update: { windows: [{ ...session, usedPercent: 55 }] },
    });

    expect(next).toEqual({
      checkedAt: "2026-09-03T12:00:05.000Z",
      windows: [{ ...session, usedPercent: 55 }, weekly],
      resetCredits,
    });
  });
});

describe("resolveUsageLimitsAfterProbe", () => {
  it("retains observed weekly usage through probes and repeated updates, resetting with the quota", () => {
    const initial = { ...weekly, resetsAt: "2026-09-10T12:00:00.000Z" };
    const first = resolveUsageLimitsAfterProbe({
      published: undefined,
      probed: { checkedAt, windows: [initial] },
    })!;
    const changedAt = "2026-09-03T13:00:00.000Z";
    const changed = applyUsageLimitsUpdate({
      previous: first,
      checkedAt: changedAt,
      update: { windows: [{ ...initial, usedPercent: 22 }] },
    })!;
    expect(changed.windows[0]?.usageHistory).toEqual([
      { at: checkedAt, usedPercent: 20 },
      { at: changedAt, usedPercent: 22 },
    ]);
    expect(
      applyUsageLimitsUpdate({
        previous: changed,
        checkedAt: changedAt,
        update: { windows: [{ ...initial, usedPercent: 22 }] },
      }),
    ).toBe(changed);
    const probed = resolveUsageLimitsAfterProbe({
      published: changed,
      probed: { checkedAt: "2026-09-03T14:00:00.000Z", windows: [{ ...initial, usedPercent: 22 }] },
    })!;
    expect(probed.windows[0]?.usageHistory).toEqual(changed.windows[0]?.usageHistory);
    const resetAt = "2026-09-03T15:00:00.000Z";
    const reset = applyUsageLimitsUpdate({
      previous: probed,
      checkedAt: resetAt,
      update: { windows: [{ ...initial, usedPercent: 0 }] },
    })!;
    expect(reset.windows[0]?.usageHistory).toEqual([{ at: resetAt, usedPercent: 0 }]);
  });

  it("bounds fractional quota history and adds a returning session window without losing weekly history", () => {
    let limits = resolveUsageLimitsAfterProbe({
      published: undefined,
      probed: { checkedAt, windows: [{ ...weekly, usedPercent: 0 }] },
    })!;
    for (let index = 1; index <= MAX_USAGE_PACE_SAMPLES + 2; index += 1) {
      limits = applyUsageLimitsUpdate({
        previous: limits,
        checkedAt: new Date(Date.parse(checkedAt) + index * 60_000).toISOString(),
        update: {
          windows: [{ ...weekly, usedPercent: (index / (MAX_USAGE_PACE_SAMPLES + 2)) * 75 }],
        },
      })!;
    }
    expect(limits.windows[0]?.usageHistory).toHaveLength(MAX_USAGE_PACE_SAMPLES);
    const restored = applyUsageLimitsUpdate({
      previous: limits,
      checkedAt: "2026-09-03T15:00:00.000Z",
      update: { windows: [session] },
    })!;
    expect(restored.windows).toHaveLength(2);
    expect(restored.windows[0]).toEqual(session);
    expect(restored.windows[1]?.usageHistory).toEqual(limits.windows[0]?.usageHistory);
  });

  it("keeps the last good windows through a failed probe but not an unsupported one", () => {
    const failed = { checkedAt, windows: [], unavailable: { reason: "probeFailed" as const } };
    const unsupported = { checkedAt, windows: [], unavailable: { reason: "unsupported" as const } };
    expect(resolveUsageLimitsAfterProbe({ published, probed: failed })).toBe(published);
    expect(resolveUsageLimitsAfterProbe({ published, probed: unsupported })).toBe(unsupported);
    expect(resolveUsageLimitsAfterProbe({ published: undefined, probed: failed })).toBe(failed);
    expect(resolveUsageLimitsAfterProbe({ published, probed: undefined })).toBe(published);
    expect(resolveUsageLimitsAfterProbe({ published, probed: { checkedAt, windows: [] } })).toBe(
      published,
    );
  });

  it("retains cached Codex history after an empty read only for the same quota window", () => {
    const native = {
      ...weekly,
      resetsAt: "2026-09-10T12:00:00.000Z",
      usageHistorySource: "codex" as const,
      usageHistory: [{ at: checkedAt, usedPercent: 20, hasUsage: true }],
    };
    const previous = { checkedAt, windows: [native] };
    const missingHistory = { ...native, usedPercent: 21, usageHistory: [] };
    const recovered = resolveUsageLimitsAfterProbe({
      published: previous,
      probed: { checkedAt, windows: [missingHistory] },
    });
    expect(recovered?.windows[0]?.usageHistory).toEqual(native.usageHistory);
    expect(recovered?.windows[0]?.usedPercent).toBe(21);

    for (const window of [
      { ...missingHistory, usedPercent: 0 },
      { ...missingHistory, resetsAt: "2026-09-17T12:00:00.000Z" },
      { ...missingHistory, windowDurationMins: 20_160 },
    ]) {
      expect(
        resolveUsageLimitsAfterProbe({
          published: previous,
          probed: { checkedAt, windows: [window] },
        })?.windows[0]?.usageHistory,
      ).toEqual([]);
    }
    const freshHistory = [{ at: "2026-09-03T12:05:00.000Z", usedPercent: 21, hasUsage: true }];
    expect(
      resolveUsageLimitsAfterProbe({
        published: previous,
        probed: { checkedAt, windows: [{ ...missingHistory, usageHistory: freshHistory }] },
      })?.windows[0]?.usageHistory,
    ).toEqual(freshHistory);
  });

  it("keeps Codex native timestamps through live updates without inventing an earlier start", () => {
    const native = {
      ...weekly,
      usageHistorySource: "codex" as const,
      usageHistory: [{ at: "2026-09-03T08:04:00.000Z", usedPercent: 20, hasUsage: true }],
    };
    const initial = resolveUsageLimitsAfterProbe({
      published: undefined,
      probed: { checkedAt, windows: [native] },
    });
    const update = {
      windows: [{ ...weekly, usedPercent: 21, usageHistorySource: "codex" as const }],
    };
    const updated = applyUsageLimitsUpdate({ previous: initial, update, checkedAt })!;
    expect(updated.windows[0]?.usageHistory).toEqual(native.usageHistory);
    expect(
      applyUsageLimitsUpdate({ previous: undefined, update, checkedAt })?.windows[0]?.usageHistory,
    ).toEqual([]);
    expect(
      resolveUsageLimitsAfterProbe({
        published: updated,
        probed: {
          checkedAt,
          windows: [{ ...weekly, usedPercent: 22, usageHistorySource: "codex" as const }],
        },
      })?.windows[0]?.usageHistory,
    ).toEqual(native.usageHistory);
    expect(
      applyUsageLimitsUpdate({
        previous: updated,
        checkedAt,
        update: {
          windows: [{ ...weekly, usedPercent: 0, usageHistorySource: "codex" }],
        },
      })?.windows[0]?.usageHistory,
    ).toEqual([]);
  });
});
