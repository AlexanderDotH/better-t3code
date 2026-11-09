import { MAX_USAGE_PACE_SAMPLES } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { applyUsageLimitsUpdate, resolveUsageLimitsAfterProbe } from "./usageLimits.ts";

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

  it("marks a first sparse update as unavailable", () => {
    expect(
      applyUsageLimitsUpdate({ previous: undefined, checkedAt, update: { windows: [weekly] } }),
    ).toEqual({
      checkedAt,
      windows: [{ ...weekly, usageHistory: [{ at: checkedAt, usedPercent: 20 }] }],
      unavailable: { reason: "probeFailed" },
    });
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
  it("retains observed weekly usage through probes and updates, resetting with the quota", () => {
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

    let bounded = first;
    for (let index = 1; index <= MAX_USAGE_PACE_SAMPLES + 2; index += 1) {
      bounded = applyUsageLimitsUpdate({
        previous: bounded,
        checkedAt: DateTime.formatIso(DateTime.makeUnsafe(Date.parse(checkedAt) + index * 60_000)),
        update: { windows: [{ ...initial, usedPercent: 20 + index / 100 }] },
      })!;
    }
    expect(bounded.windows[0]?.usageHistory).toHaveLength(MAX_USAGE_PACE_SAMPLES);
  });

  it("keeps Codex transcript history for the same quota epoch only", () => {
    const native = {
      ...weekly,
      resetsAt: "2026-09-10T12:00:00.000Z",
      usageHistorySource: "codex" as const,
      usageHistory: [{ at: "2026-09-03T08:04:00.000Z", usedPercent: 20, hasUsage: true }],
    };
    const previous = { checkedAt, windows: [native] };
    const live = { ...native, usedPercent: 21, usageHistory: undefined };
    expect(
      applyUsageLimitsUpdate({ previous, checkedAt, update: { windows: [live] } })?.windows[0]
        ?.usageHistory,
    ).toEqual(native.usageHistory);
    expect(
      resolveUsageLimitsAfterProbe({ published: previous, probed: { checkedAt, windows: [live] } })
        ?.windows[0]?.usageHistory,
    ).toEqual(native.usageHistory);
    for (const window of [
      { ...live, usedPercent: 0 },
      { ...live, resetsAt: "2026-09-17T12:00:00.000Z" },
    ]) {
      expect(
        resolveUsageLimitsAfterProbe({
          published: previous,
          probed: { checkedAt, windows: [window] },
        })?.windows[0]?.usageHistory,
      ).toEqual([]);
    }
  });

  it("uses read order for windows while taking metadata from the successful probe", () => {
    const live = {
      checkedAt: "2026-09-03T12:00:05.000Z",
      windows: [
        { ...session, usedPercent: 95 },
        { ...weekly, usedPercent: 70 },
      ],
      resetCredits: { availableCount: 2 },
      externalUsage: { label: "Old dashboard", url: "https://example.com/old" },
    };
    const probed = {
      ...published,
      windows: [{ ...session, usedPercent: 0 }],
      resetCredits: { availableCount: 1 },
      externalUsage: { label: "Usage dashboard", url: "https://example.com/usage" },
    };

    expect(resolveUsageLimitsAfterProbe({ published: live, probed })).toEqual({
      ...probed,
      checkedAt: live.checkedAt,
      windows: live.windows,
    });

    const sameTime = { ...probed, checkedAt: live.checkedAt };
    const newer = { ...probed, checkedAt: "2026-09-03T12:00:06.000Z" };
    expect(resolveUsageLimitsAfterProbe({ published: live, probed: sameTime })).toEqual(sameTime);
    expect(resolveUsageLimitsAfterProbe({ published: live, probed: newer })).toEqual(newer);
  });

  it("keeps the last good windows through a failed probe but not an unsupported one", () => {
    const failed = { checkedAt, windows: [], unavailable: { reason: "probeFailed" as const } };
    const unsupported = { checkedAt, windows: [], unavailable: { reason: "unsupported" as const } };
    expect(resolveUsageLimitsAfterProbe({ published, probed: failed })).toBe(published);
    expect(resolveUsageLimitsAfterProbe({ published, probed: unsupported })).toBe(unsupported);
    expect(resolveUsageLimitsAfterProbe({ published: undefined, probed: failed })).toBe(failed);
  });
});
