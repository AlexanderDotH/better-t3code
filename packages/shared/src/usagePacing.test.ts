import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";

import { dailyUsagePace, paceOf, usageWindowLabel } from "./usageLimits.ts";

const time = (day: number, hour: number, minute = 0) =>
  DateTime.toEpochMillis(
    DateTime.makeZonedUnsafe(
      { year: 2026, month: 9, day, hour, minute },
      { adjustForTimeZone: true },
    ),
  );
const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
const sample = (day: number, hour: number, usedPercent: number) => ({
  at: iso(time(day, hour)),
  usedPercent,
});
const weekly: ServerProviderUsageWindow = {
  id: "weekly",
  kind: "weekly",
  label: "Weekly",
  usedPercent: 6,
  windowDurationMins: 10_080,
  resetsAt: iso(time(20, 0)),
  usageHistory: [sample(13, 8, 0), sample(13, 9, 1), sample(13, 13, 6)],
};

describe("daily usage pacing", () => {
  it("measures consumption against today's allowance, including overdraw and catch-up", () => {
    expect(dailyUsagePace(weekly, time(13, 13), 8)?.todayBudgetUsedPercent).toBeCloseTo(42);
    expect(
      dailyUsagePace({ ...weekly, usedPercent: 30 }, time(13, 13), 8)?.todayBudgetUsedPercent,
    ).toBeCloseTo(210);
    expect(
      dailyUsagePace(
        { ...weekly, usedPercent: 0, usageHistory: [sample(13, 8, 0)] },
        time(13, 13),
        8,
      )?.todayBudgetUsedPercent,
    ).toBe(0);
    expect(
      dailyUsagePace({ ...weekly, usageHistory: undefined }, time(13, 13), 8)
        ?.todayBudgetUsedPercent,
    ).toBeNull();
    expect(
      dailyUsagePace(
        { ...weekly, usedPercent: 100, usageHistory: [sample(13, 8, 100)] },
        time(13, 13),
        8,
      )?.todayBudgetUsedPercent,
    ).toBe(0);
    const catchUp = dailyUsagePace(
      {
        ...weekly,
        usedPercent: 12,
        usageHistory: [...weekly.usageHistory!, sample(14, 10, 7), sample(14, 14, 12)],
      },
      time(14, 14),
      8,
    )!;
    expect(catchUp.todayBudgetUsedPercent).toBeCloseTo((6 / (200 / 7 - 6)) * 100);
  });

  it("reports overdraw only beyond the full allowance and carries the lower balance into tomorrow", () => {
    for (const usedPercent of [0, 100 / 7, 30, 100]) {
      const pace = dailyUsagePace({ ...weekly, usedPercent }, time(13, 13), 8)!;
      expect(pace.todayOverdrawPercent).toBeCloseTo(Math.max(0, usedPercent - 100 / 7));
      expect(pace.todayRemainingPercent).toBeCloseTo(Math.max(0, 100 / 7 - usedPercent));
      expect(pace.todayBalancePercent).toBeCloseTo(100 / 7 - usedPercent);
    }
    const withCatchUp = dailyUsagePace(
      {
        ...weekly,
        usedPercent: 50,
        usageHistory: [sample(14, 22, 5), sample(15, 9, 6)],
      },
      time(15, 13),
      8,
    )!;
    expect(withCatchUp.todayOverdrawPercent).toBeCloseTo(50 - 300 / 7);
    expect(withCatchUp.catchUpRemainingPercent).toBe(0);
    expect(withCatchUp.status).toBe("exceeded");

    const tomorrow = dailyUsagePace(
      {
        ...weekly,
        usedPercent: 31,
        usageHistory: [sample(13, 22, 30), sample(14, 9, 31)],
      },
      time(14, 13),
      8,
    )!;
    expect(tomorrow.todayOverdrawPercent).toBe(0);
    expect(tomorrow.dailyBudgetPercent).toBeCloseTo(70 / 6);
    expect(tomorrow.catchUpPercent).toBe(0);
    expect(
      dailyUsagePace({ ...weekly, usageHistory: undefined }, time(13, 13), 8)?.todayOverdrawPercent,
    ).toBeNull();
  });

  it("does not schedule today's allowance past local midnight for a late-starting workday", () => {
    const late = {
      ...weekly,
      usedPercent: 5,
      usageHistory: [
        sample(13, 8, 0),
        sample(13, 23, 1),
        { at: iso(time(13, 23, 30)), usedPercent: 5 },
      ],
    };
    const pace = dailyUsagePace(late, time(13, 23, 30), 8)!;
    expect(pace.status).toBe("good");
    expect(pace.hourlyBudgetPercent).toBeCloseTo(100 / 7);
  });

  it("shortens the hourly target when the weekly quota resets before the workday ends", () => {
    const ending = {
      ...weekly,
      usedPercent: 40,
      resetsAt: iso(time(13, 11)),
      usageHistory: [sample(13, 8, 0), sample(13, 9, 1), sample(13, 10, 40)],
    };
    const pace = dailyUsagePace(ending, time(13, 10), 8)!;
    expect(pace).toMatchObject({
      status: "good",
      dailyBudgetPercent: 100,
    });
    expect(pace.hourlyBudgetPercent).toBeCloseTo(100 / 7 / 2);
  });

  it("allocates the weekly remainder per day and per working hour, with readable pace states", () => {
    const good = dailyUsagePace(weekly, time(13, 13), 8)!;
    expect(good.dailyBudgetPercent).toBeCloseTo(100 / 7);
    expect(good.hourlyBudgetPercent).toBeCloseTo(100 / 7 / 8);
    expect(good.todayRemainingPercent).toBeCloseTo(100 / 7 - 6);
    expect(good).toMatchObject({
      status: "good",
      todayUsedPercent: 6,
      startedAt: time(13, 9),
      partial: false,
    });
    const fast = dailyUsagePace({ ...weekly, usedPercent: 10 }, time(13, 13), 8)!;
    expect(fast).toMatchObject({
      status: "fast",
      catchUpPercent: 0,
    });
    expect(fast.paceOverPercent).toBeCloseTo(40);
    expect(dailyUsagePace({ ...weekly, usedPercent: 16 }, time(13, 13), 8)?.status).toBe(
      "exceeded",
    );
  });

  it("starts eight hours at first observed usage, not the first read or a fixed morning schedule", () => {
    const lateStart = {
      ...weekly,
      usedPercent: 9,
      usageHistory: [sample(13, 8, 0), sample(13, 17, 1), sample(13, 18, 9)],
    };
    expect(dailyUsagePace(lateStart, time(13, 18), 8)).toMatchObject({
      status: "fast",
      startedAt: time(13, 17),
    });
    expect(dailyUsagePace(lateStart, time(13, 18), 24)?.status).toBe("good");
    expect(
      dailyUsagePace(
        { ...lateStart, usedPercent: 1, usageHistory: lateStart.usageHistory.slice(0, 2) },
        time(13, 17, 10),
        8,
      )?.status,
    ).toBe("estimating");
    expect(dailyUsagePace(lateStart, time(13, 8), 8)).toEqual(
      dailyUsagePace(lateStart, time(13, 18), 8),
    );
    expect(
      dailyUsagePace(
        { ...weekly, usedPercent: 0, usageHistory: [sample(13, 8, 0)] },
        time(13, 12),
        8,
      ),
    ).toMatchObject({ status: "waiting", startedAt: null });
  });

  it("uses the last known balance before local midnight and starts a new workday", () => {
    const nextDay = {
      ...weekly,
      usedPercent: 12,
      usageHistory: [...weekly.usageHistory!, sample(14, 10, 7), sample(14, 14, 12)],
    };
    const pace = dailyUsagePace(nextDay, time(14, 14), 8)!;
    expect(pace).toMatchObject({ todayUsedPercent: 6, startedAt: time(14, 10), partial: false });
    expect(pace.catchUpPercent).toBeCloseTo(100 / 7 - 6);
    expect(pace.dailyBudgetPercent).toBeCloseTo(200 / 7 - 6);
    expect(dailyUsagePace(nextDay, time(14, 23), 8)?.dailyBudgetPercent).toBe(
      pace.dailyBudgetPercent,
    );
  });

  it("makes earlier unused days available immediately without allocating catch-up twice", () => {
    const catchingUp = {
      ...weekly,
      usedPercent: 20,
      usageHistory: [sample(14, 22, 5), sample(15, 9, 6), sample(15, 10, 20)],
    };
    const pace = dailyUsagePace(catchingUp, time(15, 10), 8)!;
    expect(pace).toMatchObject({ status: "good", todayUsedPercent: 15, paceOverPercent: 0 });
    expect(pace.catchUpPercent).toBeCloseTo(200 / 7 - 5);
    expect(pace.catchUpRemainingPercent).toBeCloseTo(200 / 7 - 20);
    expect(pace.dailyBudgetPercent).toBeCloseTo(300 / 7 - 5);
    expect(pace.dailyBudgetPercent + 4 * pace.hourlyBudgetPercent * 8).toBeCloseTo(95);

    const fast = dailyUsagePace({ ...catchingUp, usedPercent: 40 }, time(15, 13), 8)!;
    expect(fast.status).toBe("fast");
    expect(fast.catchUpRemainingPercent).toBe(0);
    expect(fast.paceOverPercent).toBeCloseTo((35 / (250 / 7 - 5) - 1) * 100);
    const calendarDay = dailyUsagePace({ ...catchingUp, usedPercent: 40 }, time(15, 13), 24)!;
    expect(calendarDay.catchUpPercent).toBe(pace.catchUpPercent);
    expect(calendarDay.paceOverPercent).toBeCloseTo(
      (35 / (pace.catchUpPercent + (100 / 7) * (13 / 24)) - 1) * 100,
    );

    const nextDay = dailyUsagePace(
      { ...catchingUp, usageHistory: [...catchingUp.usageHistory, sample(16, 9, 20)] },
      time(16, 9),
      8,
    )!;
    expect(nextDay.catchUpPercent).toBeCloseTo(300 / 7 - 20);
  });

  it("keeps catch-up within the current window and reduces the daily share after overspending", () => {
    const overspent = dailyUsagePace(
      {
        ...weekly,
        usedPercent: 45,
        usageHistory: [sample(14, 22, 40), sample(15, 9, 41), sample(15, 13, 45)],
      },
      time(15, 13),
      8,
    )!;
    expect(overspent).toMatchObject({
      status: "good",
      catchUpPercent: 0,
      dailyBudgetPercent: 12,
    });
    const reset = dailyUsagePace(
      {
        ...weekly,
        resetsAt: iso(time(27, 0)),
        usedPercent: 1,
        usageHistory: [sample(20, 8, 0), sample(20, 9, 1)],
      },
      time(20, 9, 10),
      8,
    )!;
    expect(reset).toMatchObject({ status: "estimating", catchUpPercent: 0, paceOverPercent: null });
    expect(reset.dailyBudgetPercent).toBeCloseTo(100 / 7);
    expect(
      dailyUsagePace({ ...weekly, windowDurationMins: undefined }, time(15, 13), 8),
    ).toMatchObject({
      catchUpPercent: 0,
      dailyBudgetPercent: 94 / 5,
    });
  });

  it("does not invent earlier usage or a missing reset time", () => {
    expect(dailyUsagePace({ ...weekly, usageHistory: undefined }, time(13, 13), 8)).toMatchObject({
      status: "waiting",
      todayUsedPercent: null,
      partial: true,
      catchUpPercent: 0,
      paceOverPercent: null,
    });
    expect(
      dailyUsagePace(
        { ...weekly, usageHistory: [sample(13, 12, 4), sample(13, 13, 6)] },
        time(13, 13),
        8,
      ),
    ).toMatchObject({ todayUsedPercent: 2, startedAt: time(13, 13), partial: true });
    expect(dailyUsagePace({ ...weekly, resetsAt: undefined }, time(13, 13), 8)).toBeNull();
    expect(dailyUsagePace(weekly, time(20, 1), 8)).toBeNull();
    expect(dailyUsagePace(weekly, Number.NaN, 8)).toBeNull();
  });

  it("keeps returning five-hour windows on their own rolling clock", () => {
    const session: ServerProviderUsageWindow = {
      ...weekly,
      kind: "session",
      label: "Session",
      windowDurationMins: 300,
      resetsAt: iso(time(13, 14)),
      usedPercent: 90,
    };
    expect(usageWindowLabel(session)).toBe("5-hour");
    expect(dailyUsagePace(session, time(13, 12), 8)).toBeNull();
    expect(paceOf(session, time(13, 12))).toBe("ahead");
  });
});
