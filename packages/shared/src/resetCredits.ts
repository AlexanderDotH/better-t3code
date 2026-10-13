import * as DateTime from "effect/DateTime";
import type {
  ServerConfig,
  ServerProviderAccountCredits,
  ServerProviderUsageLimits,
  UsageLimitsReport,
} from "@t3tools/contracts";
import {
  collectProviderUsageLimits,
  formatDuration,
  usageWindowLabel,
  type LimitAccount,
} from "./usageLimits.ts";

const MINUTE_MS = 60_000;
const EXPIRING_SOON_MS = 24 * 60 * MINUTE_MS;
const NATURAL_RESET_SOON_MS = 15 * MINUTE_MS;
const USAGE_PRESSURE_START = 50;
const EXPIRY_SCORE_BONUS = 10;
const WAIT_FOR_RESET_SCORE_CAP = 25;

export type ResetRecommendation = {
  readonly score: number | null;
  readonly stage: "low" | "moderate" | "high" | "unavailable";
  readonly label: string;
  readonly reason: string;
};

export function resetRecommendation(
  limits: ServerProviderUsageLimits,
  now: number,
): ResetRecommendation {
  const unavailable = (reason: string): ResetRecommendation => ({
    score: null,
    stage: "unavailable",
    label: "Recommendation unavailable",
    reason,
  });
  if (!limits.resetCredits) return unavailable("The account has not reported reset availability.");
  if (limits.resetCredits.availableCount === 0)
    return unavailable("There are no reset credits available.");
  if (limits.unavailable)
    return unavailable("Refresh account usage before deciding whether to reset.");
  const windows = limits.windows.filter(
    (window) =>
      Number.isFinite(window.usedPercent) &&
      (!window.resetsAt || Date.parse(window.resetsAt) > now),
  );
  if (!windows.length) return unavailable("Current usage limits have not been reported.");
  const expiryWait = limits.resetCredits.nextExpiresAt
    ? Date.parse(limits.resetCredits.nextExpiresAt) - now
    : Infinity;
  if (expiryWait <= 0) return unavailable("A reported reset has expired. Refresh account usage.");
  const expiringSoon = expiryWait <= EXPIRING_SOON_MS;
  const candidates = windows
    .map((window) => {
      const resetWait = window.resetsAt ? Date.parse(window.resetsAt) - now : Infinity;
      const resetsSoon = resetWait <= NATURAL_RESET_SOON_MS;
      const pressure = Math.max(0, (window.usedPercent - USAGE_PRESSURE_START) * 2);
      const expiryBonus =
        expiringSoon && window.usedPercent > WAIT_FOR_RESET_SCORE_CAP ? EXPIRY_SCORE_BONUS : 0;
      const score = Math.round(
        Math.min(
          100,
          resetsSoon ? Math.min(WAIT_FOR_RESET_SCORE_CAP, pressure) : pressure + expiryBonus,
        ),
      );
      return { window, resetWait, resetsSoon, score };
    })
    .sort((a, b) => b.score - a.score || b.window.usedPercent - a.window.usedPercent);
  const strongest = candidates[0]!;
  const { score, window, resetWait, resetsSoon } = strongest;
  const stage =
    score >= RESET_GAUGE_STAGES[2].from
      ? "high"
      : score >= RESET_GAUGE_STAGES[1].from
        ? "moderate"
        : "low";
  const pressure = `${usageWindowLabel(window)} usage is ${Math.round(window.usedPercent)}%.`;
  return {
    score,
    stage,
    label:
      stage === "high"
        ? "Good time to reset"
        : stage === "moderate"
          ? "Consider a reset"
          : "Keep your reset",
    reason: resetsSoon
      ? `${pressure} It resets naturally in ${formatDuration(resetWait)}.`
      : `${pressure}${Number.isFinite(resetWait) ? ` Next reset in ${formatDuration(resetWait)}.` : ""}${expiringSoon ? " A reset credit expires within 24 hours." : ""}`,
  };
}

export function accountCreditBalance(credits: ServerProviderAccountCredits | undefined): string {
  if (!credits) return "Not reported";
  if (credits.unlimited) return "Unlimited";
  if (credits.balance !== undefined) {
    const amount = Number(credits.balance);
    return Number.isFinite(amount)
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount)
      : credits.balance;
  }
  return credits.hasCredits ? "Available · balance not reported" : "No credits available";
}

export function availableResetCredits(limits: ServerProviderUsageLimits, now: number) {
  return (limits.resetCredits?.credits ?? [])
    .filter(
      (credit) =>
        credit.status === "available" && (!credit.expiresAt || Date.parse(credit.expiresAt) > now),
    )
    .sort(
      (a, b) =>
        (a.expiresAt ? Date.parse(a.expiresAt) : Infinity) -
        (b.expiresAt ? Date.parse(b.expiresAt) : Infinity),
    );
}

export function redeemedResetCredits(limits: ServerProviderUsageLimits) {
  return (limits.resetCredits?.credits ?? [])
    .filter((credit) => credit.status === "redeemed")
    .sort(
      (a, b) =>
        (b.redeemedAt ? Date.parse(b.redeemedAt) : 0) -
        (a.redeemedAt ? Date.parse(a.redeemedAt) : 0),
    );
}

export function liveResetAccounts(
  report: UsageLimitsReport,
  config: Pick<ServerConfig, "providers" | "usageLimitSources"> | null | undefined,
  now: number,
): UsageLimitsReport["accounts"] {
  if (!config) return report.accounts;
  const driver = report.accounts[0]?.driver;
  const provider = config.providers.find((entry) => entry.driver === driver);
  if (!provider) return report.accounts;
  return (
    collectProviderUsageLimits(
      provider.instanceId,
      config.providers,
      config.usageLimitSources ?? [],
      now,
    )?.accounts ?? report.accounts
  );
}

export function resetGaugePoint(value: number, radius = 82) {
  const angle = Math.PI * (1 - Math.max(0, Math.min(100, value)) / 100);
  return { x: 110 + Math.cos(angle) * radius, y: 102 - Math.sin(angle) * radius };
}

export const RESET_GAUGE_STAGES = [
  { from: 0, to: 40, stage: "low" },
  { from: 40, to: 75, stage: "moderate" },
  { from: 75, to: 100, stage: "high" },
] as const;

export function resetGaugeArc(from: number, to: number): string {
  const start = resetGaugePoint(from);
  const end = resetGaugePoint(to);
  return `M ${start.x} ${start.y} A 82 82 0 0 1 ${end.x} ${end.y}`;
}

export function resetManagementReport(account: LimitAccount, now: number): UsageLimitsReport {
  const input = account.redeem?.input;
  return {
    createdAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
    notices: [],
    accounts: [
      {
        id: input
          ? "instanceId" in input
            ? input.instanceId
            : `${input.sourceId}:${input.accountId}`
          : account.key,
        driver: account.driver,
        label: account.displayName ?? account.sourceLabel ?? String(account.driver),
        ...(account.email ? { email: account.email } : {}),
        ...(account.plan ? { plan: account.plan } : {}),
        ...(account.displayName ? { displayName: account.displayName } : {}),
        ...(input ? { resetCreditInput: input } : {}),
        ...(input && "instanceId" in input ? { instanceId: input.instanceId } : {}),
        limits: account.limits,
      },
    ],
  };
}
