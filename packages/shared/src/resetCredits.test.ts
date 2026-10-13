import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import {
  accountCreditBalance,
  availableResetCredits,
  redeemedResetCredits,
  resetRecommendation,
} from "./resetCredits.ts";

const now = Date.parse("2026-10-13T10:00:00Z");
const limits = (usedPercent: number): ServerProviderUsageLimits => ({
  checkedAt: "2026-10-13T10:00:00.000Z",
  windows: [
    {
      id: "session",
      kind: "session",
      label: "Session",
      usedPercent,
      resetsAt: "2026-10-13T14:00:00Z",
    },
  ],
  resetCredits: { availableCount: 2, nextExpiresAt: "2026-11-01T10:00:00Z" },
});

describe("reset recommendations", () => {
  it.each([
    [30, 0, "low"],
    [75, 50, "moderate"],
    [95, 90, "high"],
  ] as const)("explains %s percent usage as score %s", (used, score, stage) => {
    expect(resetRecommendation(limits(used), now)).toMatchObject({ score, stage });
    expect(resetRecommendation(limits(used), now).reason).toContain(`${used}%`);
  });
  it("prefers the strongest live window and waits when a natural reset is imminent", () => {
    const current = limits(100);
    expect(
      resetRecommendation(
        { ...current, windows: [{ ...current.windows[0]!, resetsAt: "2026-10-13T10:05:00Z" }] },
        now,
      ),
    ).toMatchObject({ score: 25, stage: "low" });
    expect(
      resetRecommendation(
        {
          ...current,
          windows: [
            ...current.windows,
            { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 20 },
          ],
        },
        now,
      ).score,
    ).toBe(100);
  });
  it("accounts for an expiring credit without encouraging a reset of unused limits", () => {
    const expiring = { availableCount: 1, nextExpiresAt: "2026-10-13T11:00:00Z" };
    expect(resetRecommendation({ ...limits(75), resetCredits: expiring }, now).score).toBe(60);
    expect(resetRecommendation({ ...limits(0), resetCredits: expiring }, now).score).toBe(0);
  });
  it("does not turn missing, expired or unavailable information into a recommendation", () => {
    const current = limits(99);
    for (const entry of [
      { ...current, resetCredits: undefined },
      { ...current, resetCredits: { availableCount: 0 } },
      { ...current, windows: [] },
      { ...current, unavailable: { reason: "probeFailed" as const } },
      { ...current, resetCredits: { availableCount: 1, nextExpiresAt: "2026-10-12T10:00:00Z" } },
    ])
      expect(resetRecommendation(entry, now).score).toBeNull();
  });
});

describe("reset management data", () => {
  it("keeps available resets, expired grants and redeemed records distinct", () => {
    const current = {
      ...limits(80),
      resetCredits: {
        availableCount: 2,
        credits: [
          {
            id: "later",
            status: "available" as const,
            resetType: "codexRateLimits",
            expiresAt: "2026-11-02T00:00:00Z",
          },
          {
            id: "first",
            status: "available" as const,
            resetType: "codexRateLimits",
            expiresAt: "2026-11-01T00:00:00Z",
          },
          {
            id: "expired",
            status: "available" as const,
            resetType: "codexRateLimits",
            expiresAt: "2026-09-01T00:00:00Z",
          },
          { id: "used", status: "redeemed" as const, resetType: "codexRateLimits" },
        ],
      },
    };
    expect(availableResetCredits(current, now).map((credit) => credit.id)).toEqual([
      "first",
      "later",
    ]);
    expect(redeemedResetCredits(current).map((credit) => credit.id)).toEqual(["used"]);
  });
  it("does not invent an account balance from a missing field", () => {
    expect(accountCreditBalance(undefined)).toBe("Not reported");
    expect(accountCreditBalance({ hasCredits: true, unlimited: false })).toBe(
      "Available · balance not reported",
    );
    expect(accountCreditBalance({ hasCredits: false, unlimited: false, balance: "0" })).toBe("0");
    expect(accountCreditBalance({ hasCredits: true, unlimited: true })).toBe("Unlimited");
  });
});
