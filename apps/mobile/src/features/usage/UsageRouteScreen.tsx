import type { DailyTotals, MergedUsage } from "@t3tools/shared/usageMerge";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import {
  enumerateDays,
  enumerateHourStarts,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";

import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { AppText as Text } from "../../components/AppText";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { SettingsSection } from "../settings/components/SettingsSection";
import { UsageDailyChart } from "./UsageDailyChart";
import type { UsageChartMetric } from "./usageChartData";
import { PROVIDER_LABEL, useProviderColors } from "./usageProviders";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobileUsageCallMessageKey, visibleMobileContextDiagnostics } from "./usage-presentation";

const WINDOW_OPTIONS = [
  { days: 1, messageKey: "mobile.usage.past24Hours" },
  { days: 7, messageKey: "mobile.usage.days" },
  { days: 30, messageKey: "mobile.usage.days" },
  { days: 90, messageKey: "mobile.usage.days" },
] as const satisfies ReadonlyArray<{
  readonly days: number;
  readonly messageKey: InterfaceMessageKey;
}>;

const CHART_HEIGHT = 180;

export function UsageRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: 30,
    window: makeWindow(30),
  }));
  const [metric, setMetric] = useState<UsageChartMetric>("cost");
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );
  const chartDays = useMemo(
    () =>
      isPast24Hours && window.sinceTime !== undefined && window.untilTime !== undefined
        ? enumerateHourStarts(window.sinceTime, window.untilTime)
        : days,
    [days, isPast24Hours, window.sinceTime, window.untilTime],
  );
  const chartTotals = useMemo(
    (): readonly DailyTotals[] =>
      isPast24Hours
        ? merged.hourly.map((hour) => ({
            day: hour.hourStart,
            costUsd: hour.costUsd,
            totalTokens: hour.totalTokens,
            byProvider: hour.byProvider,
          }))
        : merged.daily,
    [isPast24Hours, merged.daily, merged.hourly],
  );

  // The pull spinner tracks re-scans of environments that have answered
  // before. The initial scan renders its own placeholder, and an unreachable
  // environment stays pending forever — neither may pin the spinner on.
  const refreshing = environments.some((entry) => entry.isPending && entry.summary !== null);
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

  return (
    <AndroidScreenScaffold title={translator.message("mobile.usage.title")}>
      <ScreenScaffoldScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWindow} />}
      >
        <SegmentedControl
          options={WINDOW_OPTIONS.map((option) => ({
            value: option.days,
            label: translator.message(option.messageKey, { count: option.days }),
          }))}
          selected={windowDays}
          onSelect={selectWindow}
        />

        <UsageCoverageNotice environments={environments} merged={merged} isPartial={isPartial} />

        {isPending ? (
          <Text className="py-16 text-center text-base text-foreground-muted">
            {translator.message("mobile.usage.scanning")}
          </Text>
        ) : environments.length === 0 ? (
          <Text className="py-16 text-center text-base text-foreground-muted">
            {translator.message("mobile.usage.connectEnvironment")}
          </Text>
        ) : (
          <>
            <ChartCard
              merged={merged}
              days={chartDays}
              daily={chartTotals}
              metric={metric}
              onMetricChange={setMetric}
              sinceDay={window.sinceDay}
              untilDay={window.untilDay}
              isPast24Hours={isPast24Hours}
              timeZone={window.timeZone}
            />
            <ProviderSection merged={merged} metric={metric} />
            <TotalsSection merged={merged} isPast24Hours={isPast24Hours} />
            <CallsSection merged={merged} />
            <ContextDiagnosticsSection merged={merged} />
            <ModelsSection merged={merged} />
          </>
        )}
      </ScreenScaffoldScrollView>
    </AndroidScreenScaffold>
  );
}

function SegmentedControl<Value extends number | string>(props: {
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly selected: Value;
  readonly onSelect: (value: Value) => void;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-full border-continuous bg-card">
      {props.options.map((option) => {
        const active = option.value === props.selected;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => props.onSelect(option.value)}
            className={
              active
                ? "flex-1 items-center rounded-full bg-subtle-strong py-2"
                : "flex-1 items-center py-2"
            }
          >
            <Text
              className={
                active ? "text-sm font-t3-medium text-foreground" : "text-sm text-foreground-muted"
              }
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Headline figure, the animated daily chart, and its legend, in one card. */
function ChartCard(props: {
  readonly merged: MergedUsage;
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly metric: UsageChartMetric;
  readonly onMetricChange: (metric: UsageChartMetric) => void;
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly isPast24Hours: boolean;
  readonly timeZone: string;
}) {
  const translator = useMobileInterfaceTranslator();
  const { merged, metric } = props;
  const colors = useProviderColors();
  const hasActivity = props.daily.some((period) => period.totalTokens > 0);

  return (
    <View className="gap-4 rounded-[24px] border-continuous bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-sm text-foreground-muted">
            {translator.message(
              metric === "cost" ? "mobile.usage.rawTokenCost" : "mobile.usage.processedTokens",
            )}
          </Text>
          <Text className="text-4xl font-t3-bold tabular-nums text-foreground">
            {metric === "cost" ? `${formatUsd(merged.costUsd)}*` : formatTokens(merged.totalTokens)}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {metric === "cost"
              ? translator.message("mobile.usage.fullApiRate")
              : translator.message("mobile.usage.sessions", { count: merged.sessions })}
          </Text>
        </View>
        <MetricToggle metric={metric} onChange={props.onMetricChange} />
      </View>

      {hasActivity ? (
        <UsageDailyChart
          days={props.days}
          daily={props.daily}
          metric={metric}
          height={CHART_HEIGHT}
        />
      ) : (
        <View style={{ height: CHART_HEIGHT }} className="items-center justify-center">
          <Text className="text-base text-foreground-muted">
            {translator.message("mobile.usage.noActivity")}
          </Text>
        </View>
      )}

      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-foreground-tertiary">
          {props.isPast24Hours
            ? formatHourShort(props.days[0] ?? "", props.timeZone)
            : formatDayShort(props.sinceDay)}
        </Text>
        <View className="flex-row items-center gap-4">
          {merged.providers.map((provider) => (
            <View key={provider.provider} className="flex-row items-center gap-1.5">
              <View
                className="size-2 rounded-full"
                style={{ backgroundColor: colors[provider.provider] }}
              />
              <Text className="text-xs text-foreground-muted">
                {PROVIDER_LABEL[provider.provider]}
              </Text>
            </View>
          ))}
        </View>
        <Text className="text-xs text-foreground-tertiary">
          {props.isPast24Hours
            ? formatHourShort(props.days[props.days.length - 1] ?? "", props.timeZone)
            : formatDayShort(props.untilDay)}
        </Text>
      </View>
    </View>
  );
}

function MetricToggle(props: {
  readonly metric: UsageChartMetric;
  readonly onChange: (metric: UsageChartMetric) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="flex-row overflow-hidden rounded-full bg-subtle">
      {(["cost", "tokens"] as const).map((option) => {
        const active = option === props.metric;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => props.onChange(option)}
            className={active ? "rounded-full bg-subtle-strong px-3 py-1.5" : "px-3 py-1.5"}
          >
            <Text
              className={
                active
                  ? "text-xs font-t3-medium uppercase text-foreground"
                  : "text-xs uppercase text-foreground-muted"
              }
            >
              {translator.message(option === "cost" ? "mobile.usage.cost" : "mobile.usage.tokens")}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ProviderSection(props: {
  readonly merged: MergedUsage;
  readonly metric: UsageChartMetric;
}) {
  const translator = useMobileInterfaceTranslator();
  const { merged, metric } = props;
  const colors = useProviderColors();
  if (merged.providers.length === 0) return null;

  // Ranked by whatever the toggle is showing, so the rows always descend.
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023 method.
  const ordered = [...merged.providers].sort((a, b) =>
    metric === "cost" ? b.costUsd - a.costUsd : b.totalTokens - a.totalTokens,
  );

  return (
    <SettingsSection title={translator.message("mobile.usage.providers")} card>
      {ordered.map((provider, index) => {
        const share = metric === "cost" ? provider.costShare : provider.tokenShare;
        return (
          <View
            key={provider.provider}
            className={index === 0 ? "gap-2 p-4" : "gap-2 border-t border-border-subtle p-4"}
          >
            <View className="flex-row items-baseline justify-between gap-3">
              <View className="flex-row items-center gap-2">
                <View
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: colors[provider.provider] }}
                />
                <Text className="text-lg text-foreground">{PROVIDER_LABEL[provider.provider]}</Text>
              </View>
              <Text className="text-lg tabular-nums text-foreground">
                {metric === "cost"
                  ? formatUsd(provider.costUsd)
                  : formatTokens(provider.totalTokens)}
              </Text>
            </View>
            <View className="h-1 flex-row overflow-hidden rounded-full bg-subtle">
              <View
                className="h-full rounded-full"
                style={{ flex: share, backgroundColor: colors[provider.provider] }}
              />
              <View style={{ flex: 1 - share }} />
            </View>
            <Text className="text-sm text-foreground-muted">
              {metric === "cost"
                ? translator.message("mobile.usage.costShare", {
                    share: formatPercent(share),
                    tokens: formatTokens(provider.totalTokens),
                  })
                : translator.message("mobile.usage.tokenShare", {
                    share: formatPercent(share),
                    cost: formatUsd(provider.costUsd),
                  })}
            </Text>
          </View>
        );
      })}
    </SettingsSection>
  );
}

function TotalsSection(props: { readonly merged: MergedUsage; readonly isPast24Hours: boolean }) {
  const translator = useMobileInterfaceTranslator();
  const { merged } = props;
  const activePeriods = (props.isPast24Hours ? merged.hourly : merged.daily).filter(
    (period) => period.totalTokens > 0,
  ).length;
  const periodAverage = activePeriods === 0 ? 0 : merged.totalTokens / activePeriods;
  const observedInput =
    merged.uncachedInputTokens + merged.cacheCreationTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;

  return (
    <SettingsSection title={translator.message("mobile.usage.totals")} card>
      <View className="flex-row flex-wrap">
        <MetricCell
          label={translator.message("mobile.usage.newInput")}
          value={formatTokens(merged.uncachedInputTokens)}
          detail={translator.message("mobile.usage.cacheWrites", {
            tokens: formatTokens(merged.cacheCreationTokens),
          })}
        />
        <MetricCell
          label={translator.message("mobile.usage.cachedInput")}
          value={formatTokens(merged.cachedInputTokens)}
          detail={translator.message("mobile.usage.observedInputShare", {
            share: formatPercent(cachedShare),
          })}
        />
        <MetricCell
          label={translator.message("mobile.usage.output")}
          value={formatTokens(merged.outputTokens)}
        />
        <MetricCell
          label={translator.message("mobile.usage.reasoning")}
          value={formatTokens(merged.reasoningTokens)}
          detail={translator.message("mobile.usage.includedInOutput")}
        />
      </View>
      <View className="gap-2 border-t border-border-subtle p-4">
        <SecondaryRow
          label={translator.message("mobile.usage.processedTotal")}
          value={formatTokens(merged.totalTokens)}
          detail={translator.message("mobile.usage.activePeriodAverage", {
            tokens: formatTokens(periodAverage),
            period: translator.message(
              props.isPast24Hours ? "mobile.usage.hour" : "mobile.usage.day",
            ),
          })}
        />
        <SecondaryRow
          label={translator.message("mobile.usage.cacheSavings")}
          value={formatUsd(merged.costQuality.cacheSavingsUsd)}
          detail={
            merged.costUsd > 0
              ? translator.message("mobile.usage.rawCostMultiple", {
                  multiple: (merged.costQuality.cacheSavingsUsd / merged.costUsd).toFixed(1),
                })
              : translator.message("mobile.usage.fullInputRates")
          }
        />
        <SecondaryRow
          label={translator.message("mobile.usage.unpriced")}
          value={formatPercent(merged.costQuality.unpricedShare)}
          detail={translator.message("mobile.usage.unpricedDetail")}
        />
      </View>
    </SettingsSection>
  );
}

function MetricCell(props: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <View className="w-1/2 gap-0.5 p-4">
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <Text className="text-xl font-t3-medium tabular-nums text-foreground">{props.value}</Text>
      {props.detail === undefined ? null : (
        <Text className="text-xs text-foreground-tertiary">{props.detail}</Text>
      )}
    </View>
  );
}

function SecondaryRow(props: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <View className="min-w-0 flex-1">
        <Text className="text-sm text-foreground-muted">{props.label}</Text>
        <Text className="text-xs text-foreground-tertiary">{props.detail}</Text>
      </View>
      <Text className="text-base font-t3-medium tabular-nums text-foreground">{props.value}</Text>
    </View>
  );
}

function CallsSection(props: { readonly merged: MergedUsage }) {
  const translator = useMobileInterfaceTranslator();
  const calls = props.merged.calls.filter(
    (call) => call.kind !== "unknown" || call.records > 0 || call.totalTokens > 0,
  );
  if (!calls.some((call) => call.records > 0 || call.totalTokens > 0)) return null;

  return (
    <SettingsSection title={translator.message("mobile.usage.calls")} card>
      <View className="flex-row flex-wrap">
        {calls.map((call) => (
          <MetricCell
            key={call.kind}
            label={translator.message(mobileUsageCallMessageKey(call.kind))}
            value={formatTokens(call.totalTokens)}
            detail={translator.message("mobile.usage.callCount", { count: call.records })}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function ContextDiagnosticsSection(props: { readonly merged: MergedUsage }) {
  const translator = useMobileInterfaceTranslator();
  const diagnostics = props.merged.contextDiagnostics;
  if (!Object.values(diagnostics).some((value) => value > 0)) return null;

  return (
    <SettingsSection title={translator.message("mobile.usage.contextDiagnostics")} card>
      <View className="flex-row flex-wrap">
        {visibleMobileContextDiagnostics(diagnostics).map((row) => (
          <MetricCell
            key={row.key}
            label={translator.message(row.messageKey)}
            value={row.tokens ? formatTokens(row.value) : translator.number(row.value)}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function ModelsSection(props: { readonly merged: MergedUsage }) {
  const translator = useMobileInterfaceTranslator();
  const { merged } = props;
  const colors = useProviderColors();
  if (merged.models.length === 0) return null;

  return (
    <SettingsSection title={translator.message("mobile.usage.byModel")} card>
      {merged.models.map((model, index) => (
        <View
          key={`${model.provider}:${model.model}`}
          className={
            index === 0
              ? "flex-row items-center gap-3 p-4"
              : "flex-row items-center gap-3 border-t border-border-subtle p-4"
          }
        >
          <View
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colors[model.provider] }}
          />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base text-foreground" numberOfLines={1}>
              {model.model}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {translator.message("mobile.usage.costShare", {
                share: formatPercent(model.costShare),
                tokens: formatTokens(model.totalTokens),
              })}
            </Text>
          </View>
          <Text className="text-base tabular-nums text-foreground">{formatUsd(model.costUsd)}</Text>
        </View>
      ))}
    </SettingsSection>
  );
}

/**
 * Says plainly when the totals are incomplete: an environment still answering,
 * one that failed, or one whose transcripts another environment already
 * reported.
 */
function UsageCoverageNotice(props: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly merged: MergedUsage;
  readonly isPartial: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const failed = props.environments.filter((environment) => environment.error !== null);
  const stale = props.environments.filter((environment) =>
    props.merged.staleEnvironments.includes(environment.environmentId),
  );
  const duplicateSources = props.merged.duplicateSources;
  if (
    failed.length === 0 &&
    stale.length === 0 &&
    duplicateSources.length === 0 &&
    !props.isPartial
  ) {
    return null;
  }

  return (
    <View className="gap-1 rounded-[16px] border-continuous bg-card px-4 py-3">
      {props.isPartial ? (
        <Text className="text-sm text-foreground-muted">
          {translator.message("mobile.usage.partial")}
        </Text>
      ) : null}
      {failed.map((environment) => (
        <Text key={environment.environmentId} className="text-sm text-foreground-muted">
          {translator.message("mobile.usage.failedEnvironment", {
            environment: environment.label,
          })}
        </Text>
      ))}
      {stale.map((environment) => (
        <Text key={environment.environmentId} className="text-sm text-foreground-muted">
          {translator.message("mobile.usage.staleEnvironment", {
            environment: environment.label,
          })}
        </Text>
      ))}
      {duplicateSources.length > 0 ? (
        <Text className="text-sm text-foreground-muted">
          {translator.message("mobile.usage.duplicateSources", {
            sources: translator.list(duplicateSources),
          })}
        </Text>
      ) : null}
    </View>
  );
}
