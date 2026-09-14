import type { ProviderInstanceId, ServerProviderUsageLimits } from "@t3tools/contracts";
import { dailyUsagePace } from "@t3tools/shared/usageLimits";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderRegistry } from "./Services/ProviderRegistry.ts";

export function usageHardBudgetBlockReason(
  limits: ServerProviderUsageLimits | undefined,
  now: number,
): string | null {
  const windows = limits?.windows.filter((window) => window.kind === "weekly") ?? [];
  const unavailable =
    "Hard daily budget: today's allowance cannot be verified. Refresh usage limits or turn off Hard daily budget in Settings → Better T3.";
  if (limits?.unavailable || windows.length === 0) return unavailable;
  for (const window of windows) {
    // A confirmed empty window needs no earlier observations to establish its allowance.
    const pace = dailyUsagePace(
      window.usedPercent === 0 && !window.usageHistory?.length
        ? {
            ...window,
            usageHistory: [{ at: DateTime.formatIso(DateTime.makeUnsafe(now)), usedPercent: 0 }],
          }
        : window,
      now,
      24,
    );
    if (!pace || pace.todayUsedPercent === null || pace.partial) return unavailable;
    if (pace.todayRemainingPercent <= 0) {
      return "Hard daily budget reached, including catch-up. Try again on the environment's next calendar day or turn off Hard daily budget in Settings → Better T3.";
    }
  }
  return null;
}

/** Uses the environment's calendar day so every connected client shares one limit. */
export const makeUsageHardBudgetCheck = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const providers = yield* Effect.serviceOption(ProviderRegistry);
  return Effect.fn("checkUsageHardBudget")(function* (instanceId: ProviderInstanceId) {
    const enabled = yield* settings.getSettings.pipe(
      Effect.map((value) => value.usageHardBudgetEnabled),
      Effect.catch(() => Effect.succeed(true)),
    );
    if (!enabled) return null;
    const snapshots = Option.isSome(providers) ? yield* providers.value.getProviders : [];
    return usageHardBudgetBlockReason(
      snapshots.find((provider) => provider.instanceId === instanceId)?.usageLimits,
      DateTime.toEpochMillis(yield* DateTime.now),
    );
  });
});
