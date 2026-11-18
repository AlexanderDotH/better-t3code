import {
  MAX_USAGE_PACE_SAMPLES,
  type ProviderUsageLimitsUpdate,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { supportsDailyUsagePace } from "@t3tools/shared/usageLimits";

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function sortWindows(
  windows: Iterable<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  return [...windows].toSorted(
    (left, right) =>
      WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind] ||
      left.id.localeCompare(right.id),
  );
}

export function makeUsageLimits(input: {
  readonly checkedAt: string;
  readonly windows: Iterable<ServerProviderUsageWindow>;
}): ServerProviderUsageLimits {
  return { checkedAt: input.checkedAt, windows: sortWindows(input.windows) };
}

export function makeUnavailableUsageLimits(input: {
  readonly checkedAt: string;
  readonly reason: "unsupported" | "probeFailed";
  readonly message?: string;
}): ServerProviderUsageLimits {
  return {
    checkedAt: input.checkedAt,
    windows: [],
    unavailable: {
      reason: input.reason,
      ...(input.message ? { message: input.message } : {}),
    },
  };
}

export function applyUsageLimitsUpdate(input: {
  readonly previous: ServerProviderUsageLimits | undefined;
  readonly update: ProviderUsageLimitsUpdate;
  readonly checkedAt: string;
}): ServerProviderUsageLimits | undefined {
  const { previous, update } = input;
  if (update.windows.length === 0 || previous?.unavailable?.reason === "unsupported") {
    return previous;
  }
  const merged = new Map(previous?.windows.map((window) => [window.id, window] as const));
  // Codex repeats unchanged limits on token ticks; avoid allocating snapshots for no-ops.
  let changed = false;
  for (const window of update.windows) {
    const existing = merged.get(window.id);
    const next: ServerProviderUsageWindow = {
      ...window,
      usedPercent: clampPercent(window.usedPercent),
      ...(window.resetsAt === undefined && existing?.resetsAt !== undefined
        ? { resetsAt: existing.resetsAt }
        : {}),
      ...(window.windowDurationMins === undefined && existing?.windowDurationMins !== undefined
        ? { windowDurationMins: existing.windowDurationMins }
        : {}),
    };
    if (existing === undefined || !usageWindowEquals(existing, next)) {
      merged.set(window.id, withUsageHistory(next, input.checkedAt, existing, previous?.checkedAt));
      changed = true;
    }
  }
  if (!changed && previous !== undefined) {
    return previous;
  }
  const unavailable =
    previous === undefined ? { reason: "probeFailed" as const } : previous.unavailable;
  return {
    ...makeUsageLimits({ checkedAt: input.checkedAt, windows: merged.values() }),
    ...(previous?.credentialFingerprint !== undefined
      ? { credentialFingerprint: previous.credentialFingerprint }
      : {}),
    ...(previous?.resetCredits !== undefined ? { resetCredits: previous.resetCredits } : {}),
    ...(unavailable !== undefined ? { unavailable } : {}),
  };
}

function usageWindowEquals(a: ServerProviderUsageWindow, b: ServerProviderUsageWindow): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.usedPercent === b.usedPercent &&
    a.resetsAt === b.resetsAt &&
    a.windowDurationMins === b.windowDurationMins
  );
}

function withUsageHistory(
  window: ServerProviderUsageWindow,
  checkedAt: string,
  previous?: ServerProviderUsageWindow,
  previousCheckedAt?: string,
): ServerProviderUsageWindow {
  if (!supportsDailyUsagePace(window)) return window;
  if (window.usageHistorySource === "codex" && window.usageHistory?.length) return window;
  // Codex history comes from its transcripts; live ticks only keep it while the epoch holds.
  if (window.usageHistorySource === "codex" || previous?.usageHistorySource === "codex") {
    return {
      ...window,
      usageHistorySource: "codex",
      usageHistory:
        previous?.usageHistorySource === "codex" &&
        previous.resetsAt === window.resetsAt &&
        previous.windowDurationMins === window.windowDurationMins &&
        previous.usedPercent <= window.usedPercent
          ? (previous.usageHistory ?? [])
          : [],
    };
  }
  const sameWindow =
    previous?.kind === window.kind &&
    previous.resetsAt === window.resetsAt &&
    previous.windowDurationMins === window.windowDurationMins &&
    previous.usedPercent <= window.usedPercent;
  const previousHistory = sameWindow
    ? (previous.usageHistory ??
      (previousCheckedAt ? [{ at: previousCheckedAt, usedPercent: previous.usedPercent }] : []))
    : [];
  const history = [
    ...new Map(
      [...previousHistory, ...(window.usageHistory ?? [])].map((sample) => [
        `${sample.at}:${sample.usedPercent}`,
        sample,
      ]),
    ).values(),
  ].toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = history.at(-1);
  // A late probe must not invent a usage increase at an earlier time.
  if (last && Date.parse(checkedAt) < Date.parse(last.at)) {
    return { ...window, usageHistorySource: "observed", usageHistory: [] };
  }
  const windowStart = Date.parse(window.resetsAt!) - window.windowDurationMins! * 60_000;
  const usageHistory =
    last?.usedPercent === window.usedPercent
      ? history
      : [...history, { at: checkedAt, usedPercent: window.usedPercent }];
  const resetIndex = usageHistory.findLastIndex(
    (sample, index) => index > 0 && sample.usedPercent < usageHistory[index - 1]!.usedPercent,
  );
  return {
    ...window,
    usageHistorySource: "observed",
    usageHistory: compactUsageHistory(
      usageHistory
        .slice(Math.max(0, resetIndex))
        .filter((sample) => Date.parse(sample.at) >= windowStart),
      checkedAt,
    ),
  };
}

const HISTORY_LOOKBACK_MS = 48 * 60 * 60_000;
const HISTORY_BUCKET_MS = 15 * 60_000;

function compactUsageHistory(
  samples: NonNullable<ServerProviderUsageWindow["usageHistory"]>,
  checkedAt: string,
) {
  if (samples.length <= MAX_USAGE_PACE_SAMPLES) return samples;
  const since = Date.parse(checkedAt) - HISTORY_LOOKBACK_MS;
  let baseline: (typeof samples)[number] | undefined;
  const buckets = new Map<
    number,
    { first: (typeof samples)[number]; last: (typeof samples)[number] }
  >();
  for (const sample of samples) {
    const at = Date.parse(sample.at);
    if (at < since) {
      baseline = sample;
      continue;
    }
    const bucket = Math.floor(at / HISTORY_BUCKET_MS);
    buckets.set(bucket, { first: buckets.get(bucket)?.first ?? sample, last: sample });
  }
  return [
    ...new Set([
      ...(baseline ? [baseline] : []),
      ...[...buckets.values()].flatMap(({ first, last }) => [first, last]),
    ]),
  ].slice(-MAX_USAGE_PACE_SAMPLES);
}

export function resolveUsageLimitsAfterProbe(input: {
  readonly published: ServerProviderUsageLimits | undefined;
  readonly probed: ServerProviderUsageLimits | undefined;
}): ServerProviderUsageLimits | undefined {
  const { probed } = input;
  const changedAccount =
    input.published?.credentialFingerprint !== undefined &&
    probed?.credentialFingerprint !== undefined &&
    input.published.credentialFingerprint !== probed.credentialFingerprint;
  const published = changedAccount ? undefined : input.published;
  if (probed?.unavailable?.reason === "probeFailed" && published && !published.unavailable) {
    return published;
  }
  if (
    published &&
    probed &&
    !published.unavailable &&
    !probed.unavailable &&
    Date.parse(published.checkedAt) > Date.parse(probed.checkedAt)
  ) {
    return { ...probed, checkedAt: published.checkedAt, windows: published.windows };
  }
  if (!probed || probed.unavailable) return probed;
  return {
    ...probed,
    windows: probed.windows.map((window) =>
      withUsageHistory(
        window,
        probed.checkedAt,
        published?.windows.find((previous) => previous.id === window.id),
        published?.checkedAt,
      ),
    ),
  };
}
