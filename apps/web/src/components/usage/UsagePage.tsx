import type { UsageProviderKind } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { CheckIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { DailyTotals, HourlyTotals } from "@t3tools/shared/usageMerge";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import {
  enumerateDays,
  enumerateHourStarts,
  formatDateTimeShort,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { UsageProviderChart, type UsageChartMetric } from "./UsageProviderChart";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION, providersWithUsage } from "./usageProviders";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

const WINDOW_OPTIONS = [
  { days: 1, messageId: "usage.window.past24Hours" },
  { days: 7, messageId: "usage.window.days7" },
  { days: 30, messageId: "usage.window.days30" },
  { days: 90, messageId: "usage.window.days90" },
] as const satisfies ReadonlyArray<{
  readonly days: number;
  readonly messageId: InterfaceMessageKey;
}>;

export function UsagePage() {
  const translator = useInterfaceTranslator();
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: 30,
    window: makeWindow(30),
  }));
  const [metric, setMetric] = useState<UsageChartMetric>("cost");
  const [breakdown, setBreakdown] = useState<"model" | "time">("model");
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);

  // Hold the content until every environment is terminal. Rendering merged
  // totals while devices are still answering makes every number on the page
  // jump as each one lands.
  const settling = isPending || isPartial;

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );
  const hours = useMemo(
    () =>
      window.sinceTime === undefined || window.untilTime === undefined
        ? []
        : enumerateHourStarts(window.sinceTime, window.untilTime),
    [window.sinceTime, window.untilTime],
  );
  // Newest first: the window can run 90 periods, so the interesting end
  // belongs at the top of the table.
  const breakdownPeriods = useMemo<readonly (DailyTotals | HourlyTotals)[]>(
    () => (isPast24Hours ? merged.hourly : merged.daily).toReversed(),
    [isPast24Hours, merged.daily, merged.hourly],
  );
  const breakdownModels = useMemo(
    () =>
      breakdown === "model" && metric === "tokens"
        ? merged.models.toSorted(
            (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
          )
        : merged.models,
    [breakdown, merged.models, metric],
  );
  const activeProviders = useMemo(() => providersWithUsage(merged.providers), [merged.providers]);
  const visibleCalls = merged.calls.filter(
    (call) => call.kind !== "unknown" || call.records > 0 || call.totalTokens > 0,
  );
  const hasCallUsage = visibleCalls.some((call) => call.records > 0 || call.totalTokens > 0);
  const hasContextDiagnostics = Object.values(merged.contextDiagnostics).some(
    (value) => (value ?? 0) > 0,
  );
  const timeValueColumnWidth = `${60 / (activeProviders.length + 2)}%`;

  const selectWindow = (days: number) => {
    setWindowSelection({
      days,
      window: makeWindow(days, undefined, days === 1 ? "hour" : "day"),
    });
  };
  const refreshWindow = () => {
    const nextWindow = makeWindow(windowDays, undefined, isPast24Hours ? "hour" : "day");
    if (
      nextWindow.sinceDay === window.sinceDay &&
      nextWindow.untilDay === window.untilDay &&
      nextWindow.sinceTime === window.sinceTime &&
      nextWindow.untilTime === window.untilTime
    ) {
      refresh();
    } else {
      setWindowSelection({ days: windowDays, window: nextWindow });
    }
  };
  const windowLabel =
    isPast24Hours && window.sinceTime !== undefined && window.untilTime !== undefined
      ? translator.message("usage.window.range", {
          from: formatDateTimeShort(window.sinceTime, window.timeZone),
          to: formatDateTimeShort(window.untilTime, window.timeZone),
        })
      : translator.message("usage.window.range", {
          from: formatDayShort(window.sinceDay),
          to: formatDayShort(window.untilDay),
        });
  const selectedWindowMessageId =
    WINDOW_OPTIONS.find((option) => option.days === windowDays)?.messageId ?? "usage.window.days30";
  const topbarContent = (
    <div className="flex w-full min-w-0 items-center gap-3">
      <WorkspaceBreadcrumb
        ariaLabel={translator.message("usage.breadcrumbAria")}
        className="min-w-0"
      >
        <WorkspaceBreadcrumbItem current>
          <h1>{translator.message("usage.title")}</h1>
        </WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator className="hidden md:flex" />
        <WorkspaceBreadcrumbItem className="hidden min-w-0 shrink md:flex">
          <span className="truncate">{windowLabel}</span>
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      <div className="ms-auto hidden min-w-0 items-center justify-end gap-2 lg:flex">
        <ToggleGroup
          aria-label={translator.message("usage.metricAria")}
          variant="segmented"
          value={[metric]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "cost" || value === "tokens") setMetric(value);
          }}
        >
          {(["cost", "tokens"] as const).map((option) => (
            <Toggle key={option} value={option}>
              {translator.message(option === "cost" ? "usage.metric.cost" : "usage.metric.tokens")}
            </Toggle>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label={translator.message("usage.periodAria")}
          variant="segmented"
          value={[String(windowDays)]}
          onValueChange={(next) => {
            const value = next[0];
            if (value) selectWindow(Number(value));
          }}
        >
          {WINDOW_OPTIONS.map((option) => (
            <Toggle key={option.days} value={String(option.days)}>
              {translator.message(option.messageId)}
            </Toggle>
          ))}
        </ToggleGroup>
        <Button
          onClick={refreshWindow}
          aria-label={translator.message("usage.refreshAria")}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
      <div className="ms-auto flex min-w-0 items-center justify-end gap-1 lg:hidden">
        <Select
          value={metric}
          onValueChange={(value) => {
            if (value === "cost" || value === "tokens") setMetric(value);
          }}
        >
          <SelectTrigger
            aria-label={translator.message("usage.metricAria")}
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>
              {translator.message(metric === "cost" ? "usage.metric.cost" : "usage.metric.tokens")}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="cost">{translator.message("usage.metric.cost")}</SelectItem>
            <SelectItem value="tokens">{translator.message("usage.metric.tokens")}</SelectItem>
          </SelectPopup>
        </Select>
        <Select value={String(windowDays)} onValueChange={(value) => selectWindow(Number(value))}>
          <SelectTrigger
            aria-label={translator.message("usage.periodAria")}
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>{translator.message(selectedWindowMessageId)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {WINDOW_OPTIONS.map((option) => (
              <SelectItem key={option.days} value={String(option.days)}>
                {translator.message(option.messageId)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          onClick={refreshWindow}
          aria-label={translator.message("usage.refreshAria")}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>{topbarContent}</WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {settling ? (
              <>
                {environments.length > 1 ? <UsageDeviceStrip environments={environments} /> : null}
                <UsageSkeleton />
              </>
            ) : (
              <>
                <UsageCoverageNotice
                  environments={environments}
                  duplicateSources={merged.duplicateSources}
                  staleEnvironments={merged.staleEnvironments}
                />

                <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                  <div className="flex min-w-0 flex-col gap-5">
                    <div className="flex flex-col gap-1">
                      <span className="text-4xl font-semibold text-foreground tabular-nums">
                        {metric === "cost"
                          ? formatUsd(merged.costUsd)
                          : formatTokens(merged.totalTokens)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {translator.message(
                          metric === "cost" ? "usage.summary.cost" : "usage.summary.tokens",
                          {
                            sessions: translator.message("usage.sessions", {
                              count: merged.sessions,
                              formattedCount: translator.number(merged.sessions),
                            }),
                          },
                        )}
                      </span>
                    </div>

                    {activeProviders.map((provider) => {
                      const totals = merged.providers.find((entry) => entry.provider === provider);
                      const share =
                        metric === "cost" ? (totals?.costShare ?? 0) : (totals?.tokenShare ?? 0);
                      const providerSessions = totals?.sessions ?? 0;
                      const sessionLabel = translator.message("usage.sessions", {
                        count: providerSessions,
                        formattedCount: translator.number(providerSessions),
                      });
                      return (
                        <div key={provider} className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: PROVIDER_PRESENTATION[provider].color,
                                }}
                              />
                              <ProviderMark provider={provider} className="size-4" />
                              <span className="flex min-w-0 items-baseline gap-1.5">
                                <span className="truncate">
                                  {PROVIDER_PRESENTATION[provider].label}
                                </span>
                                <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
                                  {sessionLabel}
                                </span>
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">
                              {metric === "cost"
                                ? formatUsd(totals?.costUsd ?? 0)
                                : formatTokens(totals?.totalTokens ?? 0)}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {metric === "cost"
                              ? translator.message("usage.provider.costShare", {
                                  share: formatPercent(share),
                                  tokens: formatTokens(totals?.totalTokens ?? 0),
                                })
                              : translator.message("usage.provider.tokenShare", {
                                  share: formatPercent(share),
                                  cost: formatUsd(totals?.costUsd ?? 0),
                                })}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex min-w-0 flex-col gap-3">
                    <h2 className="text-sm font-medium text-foreground">
                      {translator.message(
                        isPast24Hours
                          ? metric === "tokens"
                            ? "usage.chart.hourlyTokens"
                            : "usage.chart.hourlyCost"
                          : metric === "tokens"
                            ? "usage.chart.dailyTokens"
                            : "usage.chart.dailyCost",
                      )}
                    </h2>
                    <UsageProviderChart
                      providers={activeProviders}
                      days={days}
                      daily={merged.daily}
                      hours={hours}
                      hourly={merged.hourly}
                      metric={metric}
                      referenceTime={window.untilTime}
                      resolution={isPast24Hours ? "hour" : "day"}
                      timeZone={window.timeZone}
                    />
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-foreground">
                    {translator.message("usage.totals")}
                  </h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-4">
                    <Metric
                      label={translator.message("usage.newInput")}
                      value={formatTokens(merged.uncachedInputTokens)}
                    />
                    <Metric
                      label={translator.message("usage.cachedInput")}
                      value={formatTokens(merged.cachedInputTokens)}
                    />
                    <Metric
                      label={translator.message("usage.output")}
                      value={formatTokens(merged.outputTokens)}
                    />
                    <Metric
                      label={translator.message("usage.reasoning")}
                      value={formatTokens(merged.reasoningTokens)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border/50 pt-2 text-xs text-muted-foreground">
                    <SecondaryMetric
                      label={translator.message("usage.processedTotal")}
                      value={formatTokens(merged.totalTokens)}
                    />
                    <SecondaryMetric
                      label={translator.message("usage.cacheWrites")}
                      value={formatTokens(merged.cacheCreationTokens)}
                    />
                    <SecondaryMetric
                      label={translator.message("usage.cacheSavings")}
                      value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                    />
                  </div>
                </section>

                {hasCallUsage ? (
                  <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium text-foreground">
                      {translator.message("usage.calls")}
                    </h2>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-4">
                      {visibleCalls.map((call) => (
                        <Metric
                          key={call.kind}
                          label={translator.message(`usage.calls.${call.kind}`)}
                          value={formatTokens(call.totalTokens)}
                          detail={translator.message("usage.calls.records", {
                            count: call.records,
                            formattedCount: translator.number(call.records),
                          })}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}

                {hasContextDiagnostics ? (
                  <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium text-foreground">
                      {translator.message("usage.contextDiagnostics")}
                    </h2>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
                      <Metric
                        label={translator.message("usage.context.nativeForks")}
                        value={translator.number(merged.contextDiagnostics.nativeForks)}
                      />
                      <Metric
                        label={translator.message("usage.context.compactHandoffs")}
                        value={translator.number(merged.contextDiagnostics.compactHandoffs)}
                      />
                      <Metric
                        label={translator.message("usage.context.handoffCharacters")}
                        value={translator.number(merged.contextDiagnostics.totalHandoffChars)}
                      />
                      <Metric
                        label={translator.message("usage.context.compactionEvents")}
                        value={translator.number(merged.contextDiagnostics.compactionEvents)}
                      />
                      <Metric
                        label={translator.message("usage.context.maxContext")}
                        value={formatTokens(merged.contextDiagnostics.maxContextTokens)}
                      />
                      {(merged.contextDiagnostics.instructionChars ?? 0) > 0 ? (
                        <Metric
                          label={translator.message("usage.context.instructionCharacters")}
                          value={translator.number(merged.contextDiagnostics.instructionChars ?? 0)}
                        />
                      ) : null}
                      {(merged.contextDiagnostics.memoryInjectionChars ?? 0) > 0 ? (
                        <Metric
                          label={translator.message("usage.context.memoryInjectionCharacters")}
                          value={translator.number(
                            merged.contextDiagnostics.memoryInjectionChars ?? 0,
                          )}
                        />
                      ) : null}
                      {(merged.contextDiagnostics.toolSchemaChars ?? 0) > 0 ? (
                        <Metric
                          label={translator.message("usage.context.toolSchemaCharacters")}
                          value={translator.number(merged.contextDiagnostics.toolSchemaChars ?? 0)}
                        />
                      ) : null}
                      {(merged.contextDiagnostics.subagentResultChars ?? 0) > 0 ? (
                        <Metric
                          label={translator.message("usage.context.subagentResultCharacters")}
                          value={translator.number(
                            merged.contextDiagnostics.subagentResultChars ?? 0,
                          )}
                        />
                      ) : null}
                      {(merged.contextDiagnostics.toolDigestChars ?? 0) > 0 ? (
                        <Metric
                          label={translator.message("usage.context.toolDigestCharacters")}
                          value={translator.number(merged.contextDiagnostics.toolDigestChars ?? 0)}
                        />
                      ) : null}
                      {(merged.contextDiagnostics.autoRoutingChars ?? 0) > 0 ? (
                        <Metric
                          label={translator.message("usage.context.autoRoutingCharacters")}
                          value={translator.number(merged.contextDiagnostics.autoRoutingChars ?? 0)}
                        />
                      ) : null}
                    </div>
                  </section>
                ) : null}

                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium text-foreground">
                      {translator.message("usage.breakdown")}
                    </h2>
                    <ToggleGroup
                      aria-label={translator.message("usage.breakdownAria")}
                      variant="segmented"
                      value={[breakdown]}
                      onValueChange={(next) => {
                        const value = next[0];
                        if (value === "model" || value === "time") setBreakdown(value);
                      }}
                    >
                      {(
                        [
                          { value: "model", label: translator.message("usage.model") },
                          {
                            value: "time",
                            label: translator.message(isPast24Hours ? "usage.hour" : "usage.day"),
                          },
                        ] as const
                      ).map((option) => (
                        <Toggle key={option.value} value={option.value}>
                          {option.label}
                        </Toggle>
                      ))}
                    </ToggleGroup>
                  </div>

                  {breakdown === "model" ? (
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col className="w-2/5" />
                        <col className="w-1/5" />
                        <col className="w-1/5" />
                        <col className="w-1/5" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="py-2 font-normal">{translator.message("usage.model")}</th>
                          <th className="py-2 text-right font-normal">
                            {translator.message("usage.metric.cost")}
                          </th>
                          <th className="py-2 text-right font-normal">
                            {translator.message("usage.share")}
                          </th>
                          <th className="py-2 text-right font-normal">
                            {translator.message("usage.metric.tokens")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownModels.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-muted-foreground">
                              {translator.message("usage.emptyWindow")}
                            </td>
                          </tr>
                        ) : (
                          breakdownModels.map((model) => (
                            <tr
                              key={`${model.provider}:${model.model}`}
                              className="border-b border-border/50 transition-colors hover:bg-muted/50"
                            >
                              <td className="py-2 text-foreground">
                                <span className="flex items-center gap-2">
                                  <ProviderMark provider={model.provider} className="size-3.5" />
                                  {model.model}
                                </span>
                              </td>
                              <td className="py-2 text-right text-foreground tabular-nums">
                                {formatUsd(model.costUsd)}
                              </td>
                              <td className="py-2 text-right text-muted-foreground tabular-nums">
                                {formatPercent(model.costShare)}
                              </td>
                              <td className="py-2 text-right text-muted-foreground tabular-nums">
                                {formatTokens(model.totalTokens)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col className="w-2/5" />
                        {activeProviders.map((provider) => (
                          <col key={provider} style={{ width: timeValueColumnWidth }} />
                        ))}
                        <col style={{ width: timeValueColumnWidth }} />
                        <col style={{ width: timeValueColumnWidth }} />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="py-2 font-normal">
                            {translator.message(isPast24Hours ? "usage.hour" : "usage.day")}
                          </th>
                          {activeProviders.map((provider) => (
                            <th key={provider} className="py-2 text-right font-normal">
                              {PROVIDER_PRESENTATION[provider].label}
                            </th>
                          ))}
                          <th className="py-2 text-right font-normal">
                            {translator.message("usage.total")}
                          </th>
                          <th className="py-2 text-right font-normal">
                            {translator.message("usage.metric.tokens")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownPeriods.length === 0 ? (
                          <tr>
                            <td
                              colSpan={activeProviders.length + 3}
                              className="py-6 text-center text-muted-foreground"
                            >
                              {translator.message("usage.emptyWindow")}
                            </td>
                          </tr>
                        ) : (
                          breakdownPeriods.map((period) => (
                            <tr
                              key={"hourStart" in period ? period.hourStart : period.day}
                              className="border-b border-border/50 transition-colors hover:bg-muted/50"
                            >
                              <td className="py-2 text-foreground">
                                {"hourStart" in period
                                  ? formatHourShort(period.hourStart, window.timeZone)
                                  : formatDayShort(period.day)}
                              </td>
                              {activeProviders.map((provider) => (
                                <td
                                  key={provider}
                                  className="py-2 text-right text-muted-foreground tabular-nums"
                                >
                                  {formatUsd(period.byProvider.get(provider)?.costUsd ?? 0)}
                                </td>
                              ))}
                              <td className="py-2 text-right text-foreground tabular-nums">
                                {formatUsd(period.costUsd)}
                              </td>
                              <td className="py-2 text-right text-muted-foreground tabular-nums">
                                {formatTokens(period.totalTokens)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </section>
              </>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

/** Brand mark for the harness a row belongs to. */
function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_PRESENTATION[provider].mark;
  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

function Metric({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium text-foreground tabular-nums">{value}</span>
      {detail === undefined ? null : (
        <span className="text-xs text-muted-foreground">{detail}</span>
      )}
    </div>
  );
}

function SecondaryMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span>
      {label}: <span className="font-medium text-foreground tabular-nums">{value}</span>
    </span>
  );
}

/**
 * Says plainly when the totals are incomplete: an environment that failed, or
 * one whose transcripts another environment already reported. Environments
 * that are still answering never reach this notice; the page shows the
 * loading skeleton until every one is terminal.
 */
function UsageCoverageNotice({
  environments,
  duplicateSources,
  staleEnvironments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
}) {
  const translator = useInterfaceTranslator();
  const failed = environments.filter((environment) => environment.error !== null);
  const stale = environments.filter((environment) =>
    staleEnvironments.includes(environment.environmentId),
  );
  if (failed.length === 0 && stale.length === 0 && duplicateSources.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border border-border px-3 py-2 text-xs text-muted-foreground">
      {failed.map((environment) => (
        <span key={environment.label}>
          {translator.message("usage.coverage.failed", { environment: environment.label })}
        </span>
      ))}
      {stale.map((environment) => (
        <span key={environment.label}>
          {translator.message("usage.coverage.stale", { environment: environment.label })}
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          {translator.message("usage.coverage.duplicates", {
            sources: translator.list(duplicateSources),
          })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Per-device progress while the page waits for every environment to answer.
 * Only rendered with two or more devices; a lone device has nothing to
 * enumerate.
 */
function UsageDeviceStrip({
  environments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
}) {
  const translator = useInterfaceTranslator();
  const scanning = environments.filter(
    (environment) => environment.summary === null && environment.error === null,
  );
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border border-border px-3 py-2 text-xs">
      {environments.map((environment) => {
        if (environment.summary !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-foreground"
            >
              <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-300/90" aria-hidden />
              {environment.label}
            </span>
          );
        }
        if (environment.error !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-destructive"
            >
              <XIcon className="size-3" aria-hidden />
              {environment.label}
            </span>
          );
        }
        return (
          <span
            key={environment.environmentId}
            className="animate-status-pulse text-muted-foreground"
          >
            {environment.label}…
          </span>
        );
      })}
      <span className="ms-auto text-muted-foreground">
        {translator.message("usage.deviceScanning", {
          count: scanning.length,
          formattedCount: translator.number(scanning.length),
        })}
      </span>
    </div>
  );
}

/**
 * Static stand-in with the loaded page's shape. No shimmer; blocks fill in
 * exactly once when the last device answers.
 */
function UsageSkeleton() {
  const translator = useInterfaceTranslator();
  const metricLabels = [
    translator.message("usage.processedTokens"),
    translator.message("usage.cachedInput"),
    translator.message("usage.uncachedInput"),
    translator.message("usage.output"),
    translator.message("usage.cacheSavings"),
  ];
  return (
    <>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <div className="h-10 w-36 rounded-sm bg-muted" />
            <div className="h-4 w-32 rounded-sm bg-muted" />
          </div>
          {PROVIDER_ORDER.map((provider) => (
            <div key={provider} className="flex flex-col gap-1">
              <div className="flex min-h-5 items-center justify-between gap-4">
                <span className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-muted" />
                  <span className="size-4 shrink-0 rounded-full bg-muted" />
                  <div className="h-3.5 w-20 rounded-sm bg-muted" />
                </span>
                <div className="h-3.5 w-14 rounded-sm bg-muted" />
              </div>
              <div className="h-4 w-36 rounded-sm bg-muted" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <div className="h-5 w-24 rounded-sm bg-muted" />
          <div className="flex flex-col gap-1">
            <div className="ml-16 h-56 rounded-sm bg-muted/35" />
            <div className="ml-16 h-4 rounded-sm bg-muted/35" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">
          {translator.message("usage.totals")}
        </h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
          {metricLabels.map((label) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{label}</span>
              <div className="h-6 w-16 rounded-sm bg-muted" />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">
            {translator.message("usage.breakdown")}
          </h2>
          <div className="h-7 w-28 rounded-lg bg-input/40" />
        </div>
        <div className="h-44 rounded-sm bg-muted/35" />
      </section>
    </>
  );
}
