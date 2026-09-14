import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProviderConsumeResetCreditOutcome,
  ProviderConsumeResetCreditInput,
  ServerProvider,
  ServerProviderResetCredits,
  ServerProviderUsageWindow,
  UsageProviderKind,
} from "@t3tools/contracts";
import {
  DAILY_USAGE_PACE_LABELS,
  dailyUsagePace,
  formatDuration,
  formatResetsIn,
  limitsNotice,
  paceOf,
  remainingPercent,
  usageWindowLabel,
} from "@t3tools/shared/usageLimits";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState, Pressable, ScrollView, View } from "react-native";
import { AsyncResult } from "effect/unstable/reactivity";

import { AppText as Text } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { useProviderColors } from "./usageProviders";

const PACE_LABEL = { ahead: "ahead of pace", on: "on pace", under: "under pace" } as const;

type Driver = ServerProvider["driver"];

function ScrollingPaceLabel({ label, tone }: { label: string; tone: string }) {
  const ref = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  useEffect(() => {
    const overflow = contentWidth - width;
    if (width === 0 || overflow <= 0) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    void AccessibilityInfo.isReduceMotionEnabled().then((reducedMotion) => {
      if (cancelled || reducedMotion) return;
      for (const [delay, x] of [
        [2000, overflow],
        [6000, 0],
      ] as const) {
        timers.push(
          setTimeout(() => {
            if (AppState.currentState === "active") ref.current?.scrollTo({ x, animated: true });
          }, delay),
        );
      }
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [width, contentWidth]);
  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onContentSizeChange={setContentWidth}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
    >
      <Text numberOfLines={1} className={`text-center text-[11px] ${tone}`}>
        {label}
      </Text>
    </ScrollView>
  );
}

/** The series colour the usage chart uses for this driver, so the two views read as one. */
function useBarColor(driver: Driver): string | null {
  const colors = useProviderColors();
  const kind: UsageProviderKind | null =
    driver === "codex" ? "codex" : driver === "claudeAgent" ? "claude" : null;
  return kind ? colors[kind] : null;
}

/**
 * Quota remaining, with pace and reset information beneath the bar.
 */
function WindowRow(props: {
  readonly window: ServerProviderUsageWindow;
  readonly color: string | null;
  readonly now: number;
}) {
  const { window, now } = props;
  const preferences = useAtomValue(mobilePreferencesAtom);
  const pacingEnabled =
    !AsyncResult.isSuccess(preferences) || preferences.value.usagePacingEnabled !== false;
  const showPaceBar = pacingEnabled && window.kind === "weekly";
  const remaining = remainingPercent(window);
  const pace = pacingEnabled && window.kind !== "weekly" ? paceOf(window, now) : null;
  const resetsIn = formatResetsIn(window, now);
  return (
    <View className="gap-1">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-sm text-foreground">{usageWindowLabel(window)}</Text>
        <Text className="text-sm font-t3-medium tabular-nums text-foreground">
          {remaining}% left
        </Text>
      </View>
      <View className="h-3 justify-center">
        <View
          className={`${showPaceBar ? "h-3" : "h-1.5"} flex-row overflow-hidden rounded-full bg-subtle`}
        >
          <View
            className={
              remaining <= 10
                ? "h-full rounded-full bg-red-500"
                : remaining <= 30
                  ? "h-full rounded-full bg-amber-500"
                  : "h-full rounded-full bg-foreground"
            }
            style={[
              { flex: remaining },
              remaining > 30 && props.color ? { backgroundColor: props.color } : null,
            ]}
          >
            <View
              pointerEvents="none"
              className="absolute inset-0 rounded-full border-r-2 border-screen"
            />
          </View>
          <View style={{ flex: 100 - remaining }} />
          <UsagePaceBar window={window} now={now} baseColor={remaining > 30 ? props.color : null} />
        </View>
      </View>
      {pace || resetsIn ? (
        <View className="flex-row justify-between gap-3">
          <Text className="text-xs text-foreground-tertiary">{pace ? PACE_LABEL[pace] : ""}</Text>
          <Text className="text-xs tabular-nums text-foreground-tertiary">{resetsIn ?? ""}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function UsagePaceBar({
  window,
  now,
  baseColor = null,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly baseColor?: string | null;
}) {
  const result = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(result) ? result.value : {};
  const pace =
    preferences.usagePacingEnabled !== false
      ? dailyUsagePace(window, now, preferences.usagePacingWorkdayHours ?? 8)
      : null;
  if (pace?.todayUsedPercent == null) return null;
  const overdrawn = pace.todayBalancePercent < 0;
  const remaining = remainingPercent(window);
  const width = Math.min(
    overdrawn ? 100 - remaining : remaining,
    Math.abs(pace.todayBalancePercent),
  );
  const catchUpShare =
    pace.todayRemainingPercent > 0
      ? (pace.catchUpRemainingPercent / pace.todayRemainingPercent) * 100
      : 0;
  const color =
    pace.status === "exceeded"
      ? "bg-danger-foreground"
      : pace.status === "fast"
        ? "bg-warning-foreground"
        : pace.status === "good"
          ? "bg-adaptive-emerald-700-300"
          : "bg-foreground-tertiary";
  return (
    <View
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel="Today's allowance remaining, including catch-up"
      accessibilityValue={{
        min: -100,
        max: 100,
        now: pace.todayBalancePercent,
        text: `${pace.todayRemainingPercent.toFixed(1)}% left today, including ${pace.catchUpRemainingPercent.toFixed(1)}% catch-up.${pace.todayOverdrawPercent !== null && pace.todayOverdrawPercent > 0 ? ` ${pace.todayOverdrawPercent.toFixed(1)}% overdrawn today.` : ""} ${DAILY_USAGE_PACE_LABELS[pace.status]}`,
      }}
      className="absolute inset-y-0 flex-row rounded-full"
      style={{
        right: `${100 - remaining - (overdrawn ? width : 0)}%`,
        width: `${width}%`,
      }}
    >
      <View className={`min-w-0 rounded-r-full ${color}`} style={{ flex: 100 - catchUpShare }} />
      {pace.catchUpRemainingPercent > 0 ? (
        <View
          className={`min-w-0 rounded-r-full opacity-50 ${color}`}
          style={{ flex: catchUpShare }}
        />
      ) : null}
      {overdrawn ? <View className="absolute inset-y-0 right-0 w-px bg-foreground/60" /> : null}
      {remainingPercent(window) > pace.todayRemainingPercent && pace.todayRemainingPercent > 0 ? (
        <View
          className={`absolute inset-y-0 right-full w-3 max-w-[200%] translate-x-1/2 rounded-full ${remainingPercent(window) <= 10 ? "bg-red-500" : remainingPercent(window) <= 30 ? "bg-amber-500" : "bg-foreground"}`}
          style={baseColor ? { backgroundColor: baseColor } : undefined}
        />
      ) : null}
    </View>
  );
}

export function UsagePaceDetails({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const result = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(result) ? result.value : {};
  const pace = dailyUsagePace(window, now, preferences.usagePacingWorkdayHours ?? 8);
  if (preferences.usagePacingEnabled === false || !pace) return null;
  const balance =
    pace.todayOverdrawPercent !== null && pace.todayOverdrawPercent > 0
      ? `${pace.todayOverdrawPercent.toFixed(1)}% overdrawn today`
      : `${pace.todayRemainingPercent.toFixed(1)}% left today`;
  const warning = pace.status === "fast" || pace.status === "exceeded";
  const label =
    warning && pace.paceOverPercent !== null
      ? `${DAILY_USAGE_PACE_LABELS[pace.status]} (${pace.paceOverPercent.toFixed(1)}% over pace)`
      : DAILY_USAGE_PACE_LABELS[pace.status];
  const details = [
    "The filled bar shows the total quota left this week. Its colored right end is available today, including catch-up in the lighter section. The rest is reserved for later days. Green means within pace and amber means too fast. A red section beyond the remaining quota shows today's negative balance; its far edge marks zero daily allowance.",
    ...(pace.todayBudgetUsedPercent !== null
      ? [`${pace.todayBudgetUsedPercent.toFixed(1)}% of today's allowance used`]
      : []),
    ...((pace.todayOverdrawPercent ?? 0) > 0
      ? [`${balance}. This reduces the quota available for later days.`]
      : []),
    `${pace.todayUsedPercent?.toFixed(1) ?? "—"}% observed today · ${pace.dailyBudgetPercent.toFixed(1)}% daily allowance`,
    `${pace.hourlyBudgetPercent.toFixed(1)}% per hour · up to ${pace.workdayHours}-hour day (shortened by an earlier reset)`,
    pace.workdayHours === 8
      ? window.usageHistorySource === "codex"
        ? "Your 8-hour day starts with the first token usage recorded by Codex each local day, including activity outside T3."
        : "Your 8-hour day starts with the first observed quota increase each local day."
      : "24-hour pacing uses the full local calendar day.",
    ...(pace.catchUpPercent > 0
      ? [
          `${pace.catchUpPercent.toFixed(1)}% catch-up from earlier days is included in today's allowance and can be used immediately. ${pace.catchUpRemainingPercent.toFixed(1)}% remains.`,
        ]
      : []),
    "Unused allowance from earlier days in this weekly window is available as catch-up; the rest is shared across days until reset, including weekends. Pace includes catch-up before comparing today's usage with the hourly target. Allowances refer to quota, not a fixed token count.",
    ...(pace.partial
      ? [
          window.usageHistorySource === "codex"
            ? "Codex history does not contain a complete baseline for today. Earlier usage on other machines may be missing."
            : "Earlier usage today is unknown. This estimate covers observed changes only; tracking restarts with the server.",
        ]
      : []),
  ].join("\n\n");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${balance}. ${pace.dailyBudgetPercent.toFixed(1)}% budget today. ${pace.catchUpRemainingPercent.toFixed(1)}% catch-up left. Show pace details`}
      onPress={() => Alert.alert(label, details)}
      className="min-h-[44px] justify-center gap-0.5 active:opacity-60"
    >
      <Text className="w-full text-center text-[11px] tabular-nums text-foreground-muted">
        <Text className={pace.status === "exceeded" ? "text-danger-foreground" : undefined}>
          {balance}
        </Text>
        {" · "}
        {pace.dailyBudgetPercent.toFixed(1)}% budget today
        {` · ${pace.catchUpRemainingPercent.toFixed(1)}% catch-up left`}
      </Text>
      <ScrollingPaceLabel
        key={label}
        label={label}
        tone={
          pace.status === "exceeded"
            ? "text-danger-foreground"
            : warning
              ? "text-warning-foreground"
              : "text-foreground-tertiary"
        }
      />
    </Pressable>
  );
}

function AccountInstanceLabel({ value }: { readonly value: string }) {
  const [revealed, setRevealed] = useState(false);
  if (!value.includes("@")) {
    return (
      <Text className="shrink text-xs text-foreground-tertiary" numberOfLines={1}>
        · {value}
      </Text>
    );
  }
  return (
    <Pressable
      className="shrink active:opacity-60"
      accessibilityRole="button"
      accessibilityLabel={revealed ? "Hide account label" : "Reveal account label"}
      onPress={() => setRevealed((current) => !current)}
    >
      <Text className="text-xs text-foreground-tertiary" numberOfLines={1}>
        · {revealed ? value : "••••••@••••••"}
      </Text>
    </Pressable>
  );
}

/** One account: icon, name and plan on a single line, then its windows. */
export function AccountLimits(props: {
  readonly driver: Driver;
  readonly label: string;
  readonly instanceLabel: string;
  readonly detail: string | undefined;
  readonly limits: ServerProvider["usageLimits"];
  readonly now: number;
  readonly first: boolean;
  /** Tighter padding for the composer card. */
  readonly dense?: boolean;
  /** Sits at the end of the heading row, such as a close control. */
  readonly trailing?: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { limits, now, dense = false } = props;
  const color = useBarColor(props.driver);
  if (!limits) return null;
  const notice = limitsNotice(limits);
  const padding = dense ? "px-4 py-3" : "p-4";
  return (
    <View
      className={
        props.first ? `gap-3 ${padding}` : `gap-3 border-t border-border-subtle ${padding}`
      }
    >
      <View className="flex-row items-center gap-2">
        <ProviderIcon provider={props.driver} size={16} />
        <View className="min-w-0 flex-1 flex-row items-baseline gap-2">
          <Text className="text-base font-t3-medium text-foreground">{props.label}</Text>
          {props.instanceLabel !== props.label ? (
            <AccountInstanceLabel key={props.instanceLabel} value={props.instanceLabel} />
          ) : null}
          {props.detail ? (
            <Text className="shrink text-sm text-foreground-muted" numberOfLines={1}>
              · {props.detail}
            </Text>
          ) : null}
        </View>
        {props.trailing}
      </View>
      {notice ? (
        <Text className="text-sm text-foreground-muted">{notice}</Text>
      ) : (
        <View className="gap-3">
          {limits.windows.map((window) => (
            <WindowRow key={window.id} window={window} color={color} now={now} />
          ))}
        </View>
      )}
      {props.footer}
      {!notice
        ? limits.windows.map((window) => (
            <UsagePaceDetails key={window.id} window={window} now={now} />
          ))
        : null}
    </View>
  );
}

const OUTCOME_TEXT: Record<ProviderConsumeResetCreditOutcome, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

/**
 * Banked reset credits with a confirmed redeem action. Redeeming spends a
 * credit the provider granted the user, so it goes through the native
 * confirm alert rather than firing on a bare tap.
 */
export function ResetCredits(props: {
  readonly environmentId: EnvironmentId;
  readonly input: ProviderConsumeResetCreditInput;
  readonly credits: ServerProviderResetCredits;
  readonly now: number;
  /** A smaller pill for the composer card. */
  readonly dense?: boolean;
}) {
  const { environmentId, input, credits, now, dense = false } = props;
  const consume = useAtomCommand(serverEnvironment.consumeResetCredit, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  if (dense && credits.availableCount === 0 && status === null) return null;

  const expiresIn = credits.nextExpiresAt
    ? formatDuration(Date.parse(credits.nextExpiresAt) - now)
    : null;
  const summary =
    credits.availableCount === 0
      ? "No reset credits banked"
      : `${credits.availableCount} ${credits.availableCount === 1 ? "reset credit" : "reset credits"} banked${
          expiresIn ? ` · next expires in ${expiresIn}` : ""
        }`;

  const redeem = async () => {
    setBusy(true);
    setStatus(null);
    const result = await consume({ environmentId, input });
    setBusy(false);
    if (result._tag === "Success") {
      setStatus(result.value.warning ?? OUTCOME_TEXT[result.value.outcome]);
      return;
    }
    setStatus(
      "error" in result.cause && result.cause.error instanceof Error
        ? result.cause.error.message
        : "Could not use the reset credit.",
    );
  };

  const confirm = () => {
    Alert.alert(
      "Use a reset credit?",
      "This redeems one credit on your account and clears the current rate-limit windows. It cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Use credit", onPress: () => void redeem() },
      ],
    );
  };

  return (
    <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
      <Text className="text-xs tabular-nums text-foreground-tertiary">{summary}</Text>
      {credits.availableCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={confirm}
          className={
            dense
              ? "rounded-full bg-subtle-strong px-2.5 py-1"
              : "min-h-[44px] justify-center rounded-full bg-subtle-strong px-3 py-1.5"
          }
        >
          <Text
            className={
              dense
                ? "text-xs font-t3-medium text-foreground"
                : "text-sm font-t3-medium text-foreground"
            }
          >
            {busy ? "Using…" : "Use reset"}
          </Text>
        </Pressable>
      ) : null}
      {status ? <Text className="text-sm text-foreground">{status}</Text> : null}
    </View>
  );
}

/**
 * Re-probes every provider (and usage-limit source) on each connected
 * environment; the fresh snapshots then arrive over the config stream.
 * Countdowns and pace anchor to `now` rather than ticking, so a refresh also
 * re-anchors the clock: quota and elapsed time move together, or not at all.
 * Environments whose probe failed are named, since their rows keep showing
 * the previous quota with nothing else to say so.
 */
export function useRefreshLimits(selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null = null) {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [failedEnvironments, setFailedEnvironments] = useState<
    readonly { environmentId: EnvironmentId; label: string }[]
  >([]);
  // Always toggles `refreshing`, even with nothing to probe: Android's
  // RefreshControl keeps its spinner up until it sees true then false.
  const refresh = async () => {
    const connected = [...presentations].filter(
      ([environmentId, presentation]) =>
        presentation.connection.phase === "connected" &&
        (selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId)),
    );
    setRefreshing(true);
    try {
      const results = await Promise.all(
        connected.map(([environmentId]) => refreshProviders({ environmentId, input: {} })),
      );
      setFailedEnvironments(
        connected
          .filter((_, index) => results[index]?._tag === "Failure")
          .map(([environmentId, presentation]) => ({
            environmentId,
            label: presentation.entry.target.label,
          })),
      );
    } finally {
      setNow(Date.now());
      setRefreshing(false);
    }
  };
  const failedLabels = failedEnvironments
    .filter(
      ({ environmentId }) =>
        selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId),
    )
    .map(({ label }) => label);
  return { now, refreshing, failedLabels, refresh };
}
