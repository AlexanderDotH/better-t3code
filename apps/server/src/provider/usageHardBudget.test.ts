import { ProviderInstanceId, type ServerProviderUsageLimits } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { ServerSettingsService } from "../serverSettings.ts";
import { makeUsageHardBudgetCheck, usageHardBudgetBlockReason } from "./usageHardBudget.ts";

const now = new Date(2026, 8, 14, 10).getTime();
const day = 86_400_000;
const limits = (usedPercent: number): ServerProviderUsageLimits => ({
  checkedAt: new Date(now).toISOString(),
  windows: [
    {
      id: "weekly",
      label: "Weekly",
      kind: "weekly",
      usedPercent,
      windowDurationMins: 7 * 24 * 60,
      resetsAt: new Date(now + 7 * day).toISOString(),
      usageHistory: [
        { at: new Date(now - day).toISOString(), usedPercent: 0 },
        { at: new Date(now).toISOString(), usedPercent },
      ],
    },
  ],
});

describe("hard daily budget", () => {
  it("blocks at the allowance and reopens on the next calendar day", () => {
    expect(usageHardBudgetBlockReason(limits(10), now)).toBeNull();
    expect(usageHardBudgetBlockReason(limits(100 / 7), now)).toContain("reached");
    expect(usageHardBudgetBlockReason(limits(20), now)).toContain("reached");
    expect(usageHardBudgetBlockReason(limits(20), now + day)).toBeNull();
    expect(usageHardBudgetBlockReason(limits(100), now)).toContain("reached");
  });

  it("allows banked catch-up once, then blocks at the larger allowance", () => {
    const withCatchUp = (used: number) => ({
      ...limits(used),
      windows: limits(used).windows.map((window) => ({
        ...window,
        resetsAt: new Date(now + 6 * day).toISOString(),
      })),
    });
    expect(usageHardBudgetBlockReason(withCatchUp(20), now)).toBeNull();
    expect(usageHardBudgetBlockReason(withCatchUp(29), now)).toContain("reached");
  });

  it("denies unavailable, expired, and incomplete history without locking an empty account", () => {
    expect(usageHardBudgetBlockReason(undefined, now)).toContain("cannot be verified");
    expect(usageHardBudgetBlockReason({ ...limits(0), windows: [] }, now)).toContain(
      "cannot be verified",
    );
    expect(usageHardBudgetBlockReason(limits(10), now + 7 * day)).toContain("cannot be verified");
    const withoutHistory = (used: number) => ({
      ...limits(used),
      windows: limits(used).windows.map((window) => ({ ...window, usageHistory: [] })),
    });
    expect(usageHardBudgetBlockReason(withoutHistory(10), now)).toContain("cannot be verified");
    expect(usageHardBudgetBlockReason(withoutHistory(0), now)).toBeNull();
    expect(
      usageHardBudgetBlockReason(
        {
          ...limits(10),
          windows: limits(10).windows.map((window) => ({
            ...window,
            usageHistory: [{ at: new Date(now).toISOString(), usedPercent: 10 }],
          })),
        },
        now,
      ),
    ).toContain("cannot be verified");
  });

  it.effect("is opt-in and disabling it immediately unblocks unverifiable accounts", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettingsService;
      const check = yield* makeUsageHardBudgetCheck;
      const instanceId = ProviderInstanceId.make("codex");
      expect(yield* check(instanceId)).toBeNull();
      yield* settings.updateSettings({ usageHardBudgetEnabled: true });
      expect(yield* check(instanceId)).toContain("cannot be verified");
      yield* settings.updateSettings({ usageHardBudgetEnabled: false });
      expect(yield* check(instanceId)).toBeNull();
    }).pipe(Effect.provide(ServerSettingsService.layerTest())),
  );
});
