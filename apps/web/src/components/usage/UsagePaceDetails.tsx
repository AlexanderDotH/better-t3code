import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  DAILY_USAGE_PACE_LABELS,
  dailyUsagePace,
  usagePaceBarSegments,
} from "@t3tools/shared/usageLimits";
import { type ReactNode, useEffect, useRef } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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
      className={`shrink-0 text-2xs whitespace-nowrap @max-[650px]:hidden ${paceTone(pace.status)}`}
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
  shape = "pill",
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly baseColor?: string;
  readonly shape?: "pill" | "segment";
}) {
  const settings = useClientSettings();
  const { number } = useInterfaceTranslator();
  const pace = settings.usagePacingEnabled
    ? dailyUsagePace(window, now, settings.usagePacingWorkdayHours)
    : null;
  if (pace?.todayUsedPercent == null) return null;
  const segments = usagePaceBarSegments(window, pace);
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
      aria-label={
        pace.catchUpPercent > 0
          ? "Today's allowance remaining, including catch-up"
          : "Today's allowance remaining"
      }
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={pace.todayBalancePercent}
      aria-valuetext={`${number(pace.todayRemainingPercent, { maximumFractionDigits: 1 })}% left today.${pace.catchUpRemainingPercent > 0 ? ` ${number(pace.catchUpRemainingPercent, { maximumFractionDigits: 1 })}% catch-up left.` : ""}${pace.todayOverdrawPercent !== null && pace.todayOverdrawPercent > 0 ? ` ${number(pace.todayOverdrawPercent, { maximumFractionDigits: 1 })}% overdrawn today.` : ""} ${DAILY_USAGE_PACE_LABELS[pace.status]}`}
      className={`usage-pace-bar ${shape === "segment" ? "rounded-md" : "rounded-full"}`}
      style={{
        right: `${100 - segments.widthPercent}%`,
        width: `${segments.widthPercent}%`,
      }}
    >
      {segments.reservedPercent > 0 ? (
        <div
          className="min-w-0"
          style={{ flex: segments.reservedPercent, backgroundColor: baseColor }}
        />
      ) : null}
      {segments.regularPercent > 0 ? (
        <div className={`min-w-0 ${color}`} style={{ flex: segments.regularPercent }} />
      ) : null}
      {segments.catchUpPercent > 0 ? (
        <div className={`min-w-0 opacity-50 ${color}`} style={{ flex: segments.catchUpPercent }} />
      ) : null}
      {segments.overdrawPercent > 0 ? (
        <div className={`min-w-0 ${color}`} style={{ flex: segments.overdrawPercent }} />
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
    pace.todayUsedPercent === null
      ? null
      : pace.todayOverdrawPercent !== null && pace.todayOverdrawPercent > 0
        ? `${percent(pace.todayOverdrawPercent)} overdrawn today`
        : `${percent(pace.todayRemainingPercent)} left today`;
  const label = paceLabel(pace, percent);
  const tone = paceTone(pace.status);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        className={`flex w-full min-w-0 cursor-help flex-col items-center gap-0.5 rounded-sm text-center text-2xs leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      >
        {accountLabel ? <span className="text-muted-foreground">{accountLabel}</span> : null}
        {balance !== null ? (
          <span className="min-w-0 text-center text-muted-foreground tabular-nums">
            <span className={pace.status === "exceeded" ? tone : undefined}>{balance}</span>
            {" · "}
            {percent(pace.dailyBudgetPercent)} budget today
            {pace.catchUpRemainingPercent > 0 ? (
              <> · {percent(pace.catchUpRemainingPercent)} catch-up left</>
            ) : null}
          </span>
        ) : null}
        <ScrollingPaceLabel
          key={label}
          label={label}
          tone={tone}
          className={statusInHeader && balance !== null ? "@min-[651px]:hidden" : ""}
        />
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-80">
        <div className="flex flex-col gap-1.5 p-1">
          <span className="font-medium">{label}</span>
          {pace.todayBudgetUsedPercent !== null ? (
            <span>{percent(pace.todayBudgetUsedPercent)} of today's allowance used</span>
          ) : null}
          {balance !== null ? (
            <span>
              Daily budget: {percent(pace.dailyBudgetPercent)} · {pace.workdayHours}-hour pace
            </span>
          ) : null}
          {pace.catchUpRemainingPercent > 0 ? (
            <span>{percent(pace.catchUpRemainingPercent)} catch-up left</span>
          ) : null}
          {pace.status === "estimating" ? (
            <span className="text-muted-foreground">Measuring pace for the first 15 minutes.</span>
          ) : null}
          {balance === null ? (
            <span className="text-muted-foreground">
              Daily pace needs usage history covering the start of today. The bar shows the reported
              weekly quota remaining.
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
