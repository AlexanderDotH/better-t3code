import { cacheHitRate, costPerMillionTokens } from "@t3tools/client-runtime/usage-model-stats";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import {
  isModelCostUnknown,
  type EnvironmentUsage,
  type MergedUsage,
  type ModelTotals,
} from "@t3tools/shared/usageMerge";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { SettingsSection } from "../settings/components/SettingsSection";
import { InsightValue, InsightsSheet } from "../diagnostics/InsightsSheet";
import { UsageDailyChart } from "./UsageDailyChart";
import type { UsageChartMetric } from "./usageChartData";
import { mergeModelUsage } from "./usage-insights";

export function UsageBreakdown(props: {
  readonly merged: MergedUsage;
  readonly environments: readonly EnvironmentUsage[];
  readonly metric: UsageChartMetric;
  readonly hourly: boolean;
  readonly days: readonly string[];
  readonly onSetPrice: (model?: string) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [breakdown, setBreakdown] = useState<"model" | "time">("model");
  const [selected, setSelected] = useState<ModelTotals | null>(null);
  const models = useMemo(
    () =>
      [...props.merged.models].sort((a, b) =>
        props.metric === "cost"
          ? b.costUsd - a.costUsd || b.totalTokens - a.totalTokens
          : b.totalTokens - a.totalTokens || b.costUsd - a.costUsd,
      ),
    [props.merged.models, props.metric],
  );
  const periods = props.hourly
    ? props.merged.hourly.map((hour) => ({ ...hour, day: hour.hourStart }))
    : props.merged.daily;
  return (
    <>
      <SettingsSection title={translator.message("mobile.insights.breakdown")}>
        <View className="gap-3 p-4">
          <SegmentedControl
            options={[
              { value: "model", label: translator.message("mobile.usage.byModel") },
              { value: "time", label: translator.message("mobile.insights.byTime") },
            ]}
            selected={breakdown}
            onSelect={setBreakdown}
          />
          {breakdown === "model"
            ? models.map((model) => (
                <Pressable
                  key={`${model.provider}:${model.model}`}
                  accessibilityRole="button"
                  onPress={() => setSelected(model)}
                  className="min-h-14 flex-row items-center gap-3 border-b border-border-subtle py-2"
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground">{model.model}</Text>
                    <Text className="text-xs text-foreground-muted">
                      {model.provider} · {formatTokens(model.totalTokens)}
                    </Text>
                  </View>
                  <Text className="text-sm tabular-nums text-foreground">
                    {props.metric === "tokens"
                      ? formatTokens(model.totalTokens)
                      : isModelCostUnknown(model)
                        ? translator.message("mobile.usage.unpriced")
                        : formatUsd(model.costUsd)}
                  </Text>
                </Pressable>
              ))
            : periods
                .slice()
                .reverse()
                .map((period) => {
                  const label = props.hourly ? new Date(period.day).toLocaleString() : period.day;
                  return (
                    <View key={label} className="border-b border-border-subtle py-2">
                      <InsightValue
                        label={label}
                        value={`${formatUsd(period.costUsd)} · ${formatTokens(period.totalTokens)}`}
                      />
                      {[...period.byProvider].map(([provider, totals]) => (
                        <InsightValue
                          key={provider}
                          label={provider}
                          value={
                            props.metric === "cost"
                              ? formatUsd(totals.costUsd)
                              : formatTokens(totals.totalTokens)
                          }
                        />
                      ))}
                    </View>
                  );
                })}
          <Button
            label={translator.message("mobile.insights.modelPrices")}
            tone="text"
            onPress={() => props.onSetPrice()}
          />
        </View>
      </SettingsSection>
      {selected ? (
        <UsageModelDetails
          model={selected}
          environments={props.environments}
          metric={props.metric}
          hourly={props.hourly}
          days={props.days}
          onClose={() => setSelected(null)}
          onSetPrice={() => {
            setSelected(null);
            props.onSetPrice(selected.model);
          }}
        />
      ) : null}
    </>
  );
}

function UsageModelDetails(props: {
  readonly model: ModelTotals;
  readonly environments: readonly EnvironmentUsage[];
  readonly metric: UsageChartMetric;
  readonly hourly: boolean;
  readonly days: readonly string[];
  readonly onClose: () => void;
  readonly onSetPrice: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const usage = useMemo(
    () => mergeModelUsage(props.environments, props.model.provider, props.model.model),
    [props.environments, props.model.provider, props.model.model],
  );
  const model = usage.models[0] ?? props.model;
  const unknown = isModelCostUnknown(model);
  const hitRate = cacheHitRate(model);
  const perMillion = costPerMillionTokens(model);
  const totals = props.hourly
    ? usage.hourly.map((hour) => ({ ...hour, day: hour.hourStart }))
    : usage.daily;
  return (
    <InsightsSheet title={props.model.model} onClose={props.onClose}>
      <Text className="text-sm text-foreground-muted">{props.model.provider}</Text>
      <InsightValue
        label={translator.message("mobile.usage.cost")}
        value={unknown ? translator.message("mobile.usage.unpriced") : formatUsd(usage.costUsd)}
      />
      <InsightValue
        label={translator.message("mobile.usage.tokens")}
        value={formatTokens(usage.totalTokens)}
      />
      {perMillion !== null ? (
        <InsightValue
          label={translator.message("mobile.insights.perMillion")}
          value={formatUsd(perMillion)}
        />
      ) : null}
      {hitRate !== null ? (
        <InsightValue
          label={translator.message("mobile.insights.cacheHit")}
          value={formatPercent(hitRate)}
        />
      ) : null}
      {model.unpricedTokens > 0 ? (
        <InsightValue
          label={translator.message("mobile.insights.unpricedTokens")}
          value={formatTokens(model.unpricedTokens)}
        />
      ) : null}
      <UsageDailyChart
        days={props.days}
        daily={totals}
        metric={unknown ? "tokens" : props.metric}
        height={180}
      />
      {(
        [
          "uncachedInputTokens",
          "cachedInputTokens",
          "cacheCreationTokens",
          "outputTokens",
          "reasoningTokens",
        ] as const
      ).map((key) => (
        <InsightValue
          key={key}
          label={translator.message(`mobile.insights.${key}`)}
          value={formatTokens(usage[key])}
        />
      ))}
      {!unknown
        ? (["input", "cacheRead", "cacheWrite", "output", "unsplit"] as const).map((key) => (
            <InsightValue
              key={key}
              label={translator.message(`mobile.insights.cost.${key}`)}
              value={formatUsd(usage.categoryCost[key])}
            />
          ))
        : null}
      {usage.speedCost.fast + usage.speedCost.ultrafast > 0
        ? (["standard", "fast", "ultrafast", "premium"] as const).map((key) => (
            <InsightValue
              key={key}
              label={translator.message(`mobile.insights.speed.${key}`)}
              value={formatUsd(usage.speedCost[key])}
            />
          ))
        : null}
      <Button
        label={translator.message("mobile.insights.modelPrices")}
        onPress={props.onSetPrice}
      />
    </InsightsSheet>
  );
}
