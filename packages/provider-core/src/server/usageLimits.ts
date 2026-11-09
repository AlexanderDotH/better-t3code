import {
  MAX_USAGE_PACE_SAMPLES,
  type ProviderUsageLimitsUpdate,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";

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

// Weekly pace needs a day-start baseline, so each weekly window keeps its observed percentages.
function withUsageHistory(
  window: ServerProviderUsageWindow,
  checkedAt: string,
  previous?: ServerProviderUsageWindow,
  previousCheckedAt?: string,
): ServerProviderUsageWindow {
  if (window.kind !== "weekly") return window;
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
    previous.usedPercent <= window.usedPercent;
  const history = sameWindow
    ? (previous.usageHistory ??
      (previousCheckedAt ? [{ at: previousCheckedAt, usedPercent: previous.usedPercent }] : []))
    : [];
  const last = history.at(-1);
  // A late probe must not invent a usage increase at an earlier time.
  if (last && Date.parse(checkedAt) < Date.parse(last.at)) {
    return { ...window, usageHistory: [] };
  }
  const usageHistory =
    last?.usedPercent === window.usedPercent
      ? history
      : [...history, { at: checkedAt, usedPercent: window.usedPercent }].slice(
          -MAX_USAGE_PACE_SAMPLES,
        );
  return { ...window, usageHistory };
}

export function resolveUsageLimitsAfterProbe(input: {
  readonly published: ServerProviderUsageLimits | undefined;
  readonly probed: ServerProviderUsageLimits | undefined;
}): ServerProviderUsageLimits | undefined {
  const { published, probed } = input;
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
