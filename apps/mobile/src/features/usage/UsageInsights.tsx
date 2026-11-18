import { cacheHitRate, costPerMillionTokens } from "@t3tools/client-runtime/usage-model-stats";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import {
  isModelCostUnknown,
  mergeUsage,
  type EnvironmentUsage,
  type MergedUsage,
  type ModelTotals,
} from "@t3tools/shared/usageMerge";
import { USAGE_CONTRACT_VERSION, type UsageSpeed } from "@t3tools/contracts";

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
  readonly speed: UsageSpeed | undefined;
  readonly hourly: boolean;
  readonly days: readonly string[];
  readonly onSetPrice: (model?: string) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [breakdown, setBreakdown] = useState<"model" | "project" | "time">("model");
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
              { value: "project", label: translator.message("mobile.insights.byProject") },
              { value: "time", label: translator.message("mobile.insights.byTime") },
            ]}
            selected={breakdown}
            onSelect={setBreakdown}
          />
          {breakdown === "model" ? (
            models.map((model) => (
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
          ) : breakdown === "project" ? (
            <UsageProjects {...props} />
          ) : (
            periods
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
              })
          )}
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
          speed={props.speed}
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

function UsageProjects({
  merged,
  environments,
  speed,
  hourly,
  days,
}: Pick<
  Parameters<typeof UsageBreakdown>[0],
  "merged" | "environments" | "speed" | "hourly" | "days"
>) {
  const translator = useMobileInterfaceTranslator();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const project = merged.projects.find(({ key }) => key === selectedKey) ?? merged.projects[0];
  const usage = useMemo(
    () =>
      project === undefined
        ? null
        : mergeUsage(environments, USAGE_CONTRACT_VERSION, {
            speed,
            keepBucket: (bucket, environmentId) =>
              environmentId === project.environmentId && bucket.project?.id === project.id,
          }),
    [environments, project, speed],
  );
  const daily = hourly
    ? usage?.hourly.map((hour) => ({ ...hour, day: hour.hourStart }))
    : usage?.daily;
  const showEnvironment = new Set(merged.projects.map((entry) => entry.environmentId)).size > 1;
  return (
    <View className="gap-2">
      {merged.projects.length === 0 ? (
        <Text className="py-2 text-sm text-foreground-muted">
          {translator.message("mobile.insights.noProjectUsage")}
        </Text>
      ) : null}
      {merged.projects.map((entry) => (
        <Pressable
          key={entry.key}
          accessibilityRole="button"
          accessibilityState={{ selected: entry.key === project?.key }}
          onPress={() => setSelectedKey(entry.key)}
          className={`min-h-12 justify-center rounded-xl px-3 py-2 ${entry.key === project?.key ? "bg-muted" : ""}`}
        >
          <InsightValue label={entry.title} value={formatTokens(entry.totalTokens)} />
          {showEnvironment ? (
            <Text className="text-xs text-foreground-muted">{entry.environmentLabel}</Text>
          ) : null}
        </Pressable>
      ))}
      {merged.unassignedProjectTokens > 0 ? (
        <InsightValue
          label={translator.message("mobile.insights.unassignedTokens")}
          value={formatTokens(merged.unassignedProjectTokens)}
        />
      ) : null}
      {usage !== null && daily !== undefined ? (
        <View className="gap-2 border-t border-border-subtle pt-3">
          <Text className="text-sm font-t3-semibold">
            {translator.message("mobile.insights.projectTokens")}
          </Text>
          <UsageDailyChart days={days} daily={daily} metric="tokens" height={100} />
          {[...usage.models]
            .sort((a, b) => b.totalTokens - a.totalTokens)
            .map((model) => (
              <InsightValue
                key={`${model.provider}:${model.model}`}
                label={model.model}
                value={formatTokens(model.totalTokens)}
              />
            ))}
        </View>
      ) : null}
    </View>
  );
}

function UsageModelDetails(props: {
  readonly model: ModelTotals;
  readonly environments: readonly EnvironmentUsage[];
  readonly metric: UsageChartMetric;
  readonly speed: UsageSpeed | undefined;
  readonly hourly: boolean;
  readonly days: readonly string[];
  readonly onClose: () => void;
  readonly onSetPrice: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const usage = useMemo(
    () => mergeModelUsage(props.environments, props.model.provider, props.model.model, props.speed),
    [props.environments, props.model.provider, props.model.model, props.speed],
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
