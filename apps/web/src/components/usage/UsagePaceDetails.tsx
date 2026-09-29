import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  DAILY_USAGE_PACE_LABELS,
  dailyUsagePace,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { type ReactNode, useEffect, useRef } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import "./UsagePaceDetails.css";

type DailyPace = NonNullable<ReturnType<typeof dailyUsagePace>>;

function paceLabel(pace: DailyPace, percent: (value: number) => string): string {
  return (pace.status === "fast" || pace.status === "exceeded") && pace.paceOverPercent !== null
    ? `${DAILY_USAGE_PACE_LABELS[pace.status]} (${percent(pace.paceOverPercent)} over pace)`
    : DAILY_USAGE_PACE_LABELS[pace.status];
}

function paceTone(status: DailyPace["status"]): string {
  return status === "exceeded"
    ? "text-destructive-foreground"
    : status === "fast"
      ? "text-warning-foreground"
      : status === "good"
        ? "text-success-foreground"
        : "text-muted-foreground";
}

export function UsagePaceHeaderLabel({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const settings = useClientSettings();
  const { number } = useInterfaceTranslator();
  const pace = dailyUsagePace(window, now, settings.usagePacingWorkdayHours);
  if (!settings.usagePacingEnabled || !pace) return null;
  const percent = (value: number) => `${number(value, { maximumFractionDigits: 1 })}%`;
  return (
    <span
      className={`shrink-0 text-[11px] whitespace-nowrap @max-[650px]:hidden ${paceTone(pace.status)}`}
    >
      {paceLabel(pace, percent)}
    </span>
  );
}

function ScrollingPaceLabel({
  label,
  tone,
  className = "",
}: {
  label: string;
  tone: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    const measure = () => {
      const overflow = Math.max(0, content.scrollWidth - element.clientWidth);
      element.dataset.overflow = String(overflow > 0);
      element.style.setProperty("--pace-scroll-distance", `${-overflow}px`);
      element.style.setProperty("--pace-scroll-duration", `${Math.max(8, overflow / 20 + 4)}s`);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    resize.observe(content);
    measure();
    const stopObserving = observeVisibleAnimation(element);
    return () => {
      resize.disconnect();
      stopObserving?.();
    };
  }, []);
  return (
    <span ref={ref} className={`usage-pace-label w-full min-w-0 ${tone} ${className}`}>
      <span>{label}</span>
    </span>
  );
}

export function UsagePaceBar({
  window,
  now,
  baseColor = "var(--foreground)",
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly baseColor?: string;
}) {
  const settings = useClientSettings();
  const { number } = useInterfaceTranslator();
  const pace = settings.usagePacingEnabled
    ? dailyUsagePace(window, now, settings.usagePacingWorkdayHours)
    : null;
  if (pace?.todayUsedPercent == null) return null;
  const overdrawn = pace.todayBalancePercent < 0;
  const remaining = remainingPercent(window);
  const width = Math.min(
    overdrawn ? 100 - remaining : remaining,
    Math.abs(pace.todayBalancePercent),
  );
  const hasNotch = !overdrawn && width > 0 && remaining > width;
  const catchUpShare =
    pace.todayRemainingPercent > 0
      ? (pace.catchUpRemainingPercent / pace.todayRemainingPercent) * 100
      : 0;
  const color =
    pace.status === "exceeded"
      ? "bg-destructive"
      : pace.status === "fast"
        ? "bg-warning"
        : pace.status === "good"
          ? "bg-success"
          : "bg-muted-foreground";
  return (
    <div
      role="meter"
      aria-label="Today's allowance remaining, including catch-up"
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={pace.todayBalancePercent}
      aria-valuetext={`${number(pace.todayRemainingPercent, { maximumFractionDigits: 1 })}% left today, including ${number(pace.catchUpRemainingPercent, { maximumFractionDigits: 1 })}% catch-up.${pace.todayOverdrawPercent !== null && pace.todayOverdrawPercent > 0 ? ` ${number(pace.todayOverdrawPercent, { maximumFractionDigits: 1 })}% overdrawn today.` : ""} ${DAILY_USAGE_PACE_LABELS[pace.status]}`}
      className="usage-pace-bar pointer-events-none absolute inset-y-0 flex rounded-r-full"
      data-overdrawn={overdrawn}
      style={{
        right: `${100 - remaining - (overdrawn ? width : 0)}%`,
        width: `${overdrawn ? remaining + width : width}%`,
      }}
    >
      <div
        className={`min-w-0 ${hasNotch ? "" : "rounded-l-full"} ${catchUpShare === 0 ? "rounded-r-full" : ""} ${color}`}
        style={{ flex: 100 - catchUpShare }}
      />
      {pace.catchUpRemainingPercent > 0 ? (
        <div
          className={`min-w-0 rounded-r-full opacity-50 ${color}`}
          style={{ flex: catchUpShare }}
        />
      ) : null}
      {hasNotch ? (
        <div
          aria-hidden
          className="usage-pace-notch absolute inset-y-0 left-0 -translate-x-1/2 rounded-full"
          style={{ width: "min(12px, 200%)", backgroundColor: baseColor }}
        />
      ) : null}
    </div>
  );
}

export function UsagePaceDetails({
  window,
  now,
  className = "",
  accountLabel,
  statusInHeader = false,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly className?: string;
  readonly accountLabel?: ReactNode;
  readonly statusInHeader?: boolean;
}) {
  const settings = useClientSettings();
  const { number } = useInterfaceTranslator();
  const pace = dailyUsagePace(window, now, settings.usagePacingWorkdayHours);
  if (!settings.usagePacingEnabled || !pace) return null;
  const percent = (value: number) => `${number(value, { maximumFractionDigits: 1 })}%`;
  const balance =
    pace.todayOverdrawPercent !== null && pace.todayOverdrawPercent > 0
      ? `${percent(pace.todayOverdrawPercent)} overdrawn today`
      : `${percent(pace.todayRemainingPercent)} left today`;
  const label = paceLabel(pace, percent);
  const tone = paceTone(pace.status);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        className={`flex w-full min-w-0 cursor-help flex-col items-center gap-0.5 rounded-sm text-center text-[11px] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      >
        {accountLabel ? <span className="text-muted-foreground">{accountLabel}</span> : null}
        <span className="min-w-0 text-center text-muted-foreground tabular-nums">
          <span className={pace.status === "exceeded" ? tone : undefined}>{balance}</span>
          {" · "}
          {percent(pace.dailyBudgetPercent)} budget today
          {" · "}
          {percent(pace.catchUpRemainingPercent)} catch-up left
        </span>
        <ScrollingPaceLabel
          key={label}
          label={label}
          tone={tone}
          className={statusInHeader ? "@min-[651px]:hidden" : ""}
        />
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-80 text-xs">
        <div className="flex flex-col gap-1.5 p-1">
          <span className="font-medium">{label}</span>
          <span>
            The filled bar shows the total quota left this week. Its colored right end is available
            today, including catch-up in the lighter section. The rest is reserved for later days.
            Green means within pace and amber means too fast. A red section beyond the remaining
            quota shows today's negative balance; its far edge marks zero daily allowance.
          </span>
          {pace.todayBudgetUsedPercent !== null ? (
            <span>{percent(pace.todayBudgetUsedPercent)} of today's allowance used</span>
          ) : null}
          {(pace.todayOverdrawPercent ?? 0) > 0 ? (
            <span>{balance}. This reduces the quota available for later days.</span>
          ) : null}
          <span>
            {pace.todayUsedPercent === null ? "—" : percent(pace.todayUsedPercent)} observed today
            {" · "}
            {percent(pace.dailyBudgetPercent)} daily allowance
          </span>
          <span>
            {percent(pace.hourlyBudgetPercent)} per hour · up to {pace.workdayHours}-hour day
          </span>
          {pace.catchUpPercent > 0 ? (
            <span>
              {percent(pace.catchUpPercent)} catch-up from earlier days is included in today's
              allowance and can be used immediately. {percent(pace.catchUpRemainingPercent)}{" "}
              remains.
            </span>
          ) : null}
          <span className="text-muted-foreground">
            {pace.workdayHours === 8
              ? window.usageHistorySource === "codex"
                ? "Your 8-hour workday starts with the first token usage recorded by Codex each local day, including activity outside T3."
                : "Your 8-hour workday starts with the first observed quota increase each local day."
              : "24-hour pacing spreads the regular daily allowance across the full local calendar day."}
          </span>
          <span className="text-muted-foreground">
            Unused allowance from earlier days in this weekly window is available as catch-up; the
            rest is shared across the days until reset, including weekends. Pace includes catch-up
            before comparing today's usage with the hourly target. An earlier reset shortens that
            target. Allowances are quota percentages, not a fixed token count.
          </span>
          {pace.status === "estimating" ? (
            <span className="text-muted-foreground">
              Allow 15 minutes to measure a useful pace.
            </span>
          ) : null}
          {pace.partial ? (
            <span className="text-muted-foreground">
              {window.usageHistorySource === "codex"
                ? "Codex history does not contain a complete baseline for today. Earlier usage on other machines may be missing."
                : "Earlier usage today is unknown. This estimate covers observed changes only; tracking restarts with the server."}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
