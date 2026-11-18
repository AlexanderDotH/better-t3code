import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  DAILY_USAGE_PACE_LABELS,
  USAGE_PACE_BAR_DESCRIPTION,
  dailyUsagePace,
  formatResetCountdown,
  formatUsageResetAt,
  paceOf,
  usagePaceBarSegments,
} from "@t3tools/shared/usageLimits";
import { Clock3Icon } from "lucide-react";
import { useId } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function UsageWindowDetails({
  window,
  now,
  focusable = true,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly focusable?: boolean;
}) {
  const tooltipId = useId();
  const pacingEnabled = useClientSettings((settings) => settings.usagePacingEnabled);
  const { message } = useInterfaceTranslator();
  const { locale } = useInterfaceLocaleRuntime();
  const pace = pacingEnabled ? paceOf(window, now) : null;
  const countdown = formatResetCountdown(window, now);
  const resetsAt = formatUsageResetAt(window, locale);
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground tabular-nums">
      {pace ? (
        <span
          className={
            pace === "under"
              ? "text-success-foreground"
              : pace === "ahead"
                ? "text-warning-foreground"
                : "text-muted-foreground"
          }
        >
          {message(`usage.pace.${pace}`)}
        </span>
      ) : null}
      {pace && countdown ? <span aria-hidden>{" · "}</span> : null}
      {countdown && resetsAt ? (
        <Tooltip>
          <TooltipTrigger
            aria-describedby={tooltipId}
            render={
              <time
                dateTime={window.resetsAt}
                tabIndex={focusable ? 0 : undefined}
                className="inline-flex cursor-help items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            {countdown}
            <Clock3Icon className="size-3" aria-hidden />
          </TooltipTrigger>
          <TooltipPopup id={tooltipId} role="tooltip" side="top">
            {resetsAt}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}

export function UsagePaceTooltip({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const settings = useClientSettings();
  const { number } = useInterfaceTranslator();
  const pace = settings.usagePacingEnabled
    ? dailyUsagePace(window, now, settings.usagePacingWorkdayHours)
    : null;
  if (pace?.todayUsedPercent == null) return null;
  const percent = (value: number) => `${number(value, { maximumFractionDigits: 1 })}%`;
  return (
    <div className="flex flex-col gap-1.5">
      <span>{DAILY_USAGE_PACE_LABELS[pace.status]}</span>
      <span>
        {percent(pace.todayRemainingPercent)} left today · {percent(pace.dailyBudgetPercent)} budget
        today
      </span>
      {pace.catchUpRemainingPercent > 0 ? (
        <span>{percent(pace.catchUpRemainingPercent)} catch-up left</span>
      ) : null}
      {pace.todayOverdrawPercent !== null && pace.todayOverdrawPercent > 0 ? (
        <span>{percent(pace.todayOverdrawPercent)} overdrawn today</span>
      ) : null}
      <span>{USAGE_PACE_BAR_DESCRIPTION}</span>
    </div>
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
  const scale = segments.widthPercent > 0 ? 100 / segments.widthPercent : 0;
  const adjacentPercent =
    segments.regularPercent + segments.catchUpPercent + segments.overdrawPercent;
  const color =
    pace.status === "exceeded"
      ? "bg-destructive"
      : pace.status === "fast"
        ? "bg-warning"
        : pace.status === "good"
          ? "bg-success"
          : "bg-muted-foreground";
  const rounding = shape === "segment" ? "rounded-r-md" : "rounded-r-full";
  return (
    <div
      role="meter"
      aria-label={
        pace.todayBalancePercent < 0
          ? "Today's allowance overdrawn"
          : pace.catchUpPercent > 0
            ? "Today's allowance remaining, including catch-up"
            : "Today's allowance remaining"
      }
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={pace.todayBalancePercent}
      aria-valuetext={`${number(pace.todayRemainingPercent, { maximumFractionDigits: 1 })}% left today.${pace.catchUpRemainingPercent > 0 ? ` ${number(pace.catchUpRemainingPercent, { maximumFractionDigits: 1 })}% catch-up left.` : ""}${pace.todayOverdrawPercent !== null && pace.todayOverdrawPercent > 0 ? ` ${number(pace.todayOverdrawPercent, { maximumFractionDigits: 1 })}% overdrawn today; already spent from the quota.` : ""} ${DAILY_USAGE_PACE_LABELS[pace.status]}`}
      className={`usage-pace-bar ${shape === "segment" ? "rounded-md" : "rounded-full"}`}
      style={{
        right: `${100 - segments.widthPercent}%`,
        width: `${segments.widthPercent}%`,
      }}
    >
      <div aria-hidden className="absolute inset-0 flex overflow-hidden rounded-[inherit]">
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
          <div
            className={`min-w-0 opacity-50 ${color}`}
            style={{ flex: segments.catchUpPercent }}
          />
        ) : null}
        {segments.overdrawPercent > 0 ? (
          <div
            className={`usage-pace-overdraw min-w-0 ${color}`}
            style={{ flex: segments.overdrawPercent }}
          />
        ) : null}
        {segments.reservedPercent > 0 && adjacentPercent > 0 ? (
          <div
            className={`usage-pace-cap ${rounding}`}
            style={{
              left: `${segments.reservedPercent * scale}%`,
              width: `${Math.min(segments.reservedPercent, adjacentPercent) * scale}%`,
              backgroundColor: baseColor,
            }}
          />
        ) : null}
        {segments.regularPercent > 0 && segments.catchUpPercent > 0 ? (
          <div
            className={`usage-pace-cap ${rounding} ${color}`}
            style={{
              left: `${(segments.reservedPercent + segments.regularPercent) * scale}%`,
              width: `${Math.min(segments.regularPercent, segments.catchUpPercent) * scale}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
