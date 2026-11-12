import { useAtomValue } from "@effect/atom-react";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { AuthDiagnosticsReadScope, type EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { InsightValue, InsightsSheet } from "./InsightsSheet";
import { TelemetryExportSettings } from "./TelemetryExportSettings";

export function SettingsServerDiagnosticsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const environments = useAtomValue(environmentPresentations.presentationsAtom);
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const connected = [...environments].filter(
    ([, environment]) => environment.connection.phase === "connected",
  );
  const environmentId =
    selected !== null && connected.some(([id]) => id === selected) ? selected : connected[0]?.[0];
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title={translator.message("mobile.insights.serverDiagnostics")}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {connected.map(([id, environment]) => (
          <Button
            key={id}
            tone="text"
            label={`${id === environmentId ? "✓ " : ""}${environment.entry.target.label}`}
            onPress={() => setSelected(id)}
          />
        ))}
        {environmentId ? (
          <EnvironmentDiagnostics key={environmentId} environmentId={environmentId} />
        ) : (
          <Text className="text-sm text-foreground-muted">
            {translator.message("mobile.usage.connectEnvironment")}
          </Text>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

type TraceRow = {
  readonly name: string;
  readonly details: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly at: string;
};

function EnvironmentDiagnostics(props: { readonly environmentId: EnvironmentId }) {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const canRead = useEnvironmentScope(props.environmentId, AuthDiagnosticsReadScope);
  const query = useEnvironmentQuery(
    focused && canRead
      ? serverEnvironment.traceDiagnostics({ environmentId: props.environmentId, input: {} })
      : null,
  );
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  const [tab, setTab] = useState<"spans" | "failures" | "logs">("spans");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TraceRow | null>(null);
  const data = query.data;
  const rows = useMemo((): readonly TraceRow[] => {
    const source =
      tab === "spans"
        ? data?.slowestSpans.map((span) => ({
            name: span.name,
            details: `${span.durationMs.toFixed(1)} ms`,
            traceId: span.traceId,
            spanId: span.spanId,
            at: DateTime.formatIso(span.endedAt),
          }))
        : tab === "failures"
          ? data?.latestFailures.map((failure) => ({
              name: failure.name,
              details: `${failure.durationMs.toFixed(1)} ms\n${failure.cause}`,
              traceId: failure.traceId,
              spanId: failure.spanId,
              at: DateTime.formatIso(failure.endedAt),
            }))
          : data?.latestWarningAndErrorLogs.map((event) => ({
              name: `${event.level} · ${event.spanName}`,
              details: event.message,
              traceId: event.traceId,
              spanId: event.spanId,
              at: DateTime.formatIso(event.seenAt),
            }));
    const filter = search.trim().toLocaleLowerCase();
    return (source ?? []).filter(
      (row) =>
        !filter ||
        `${row.name} ${row.details} ${row.traceId} ${row.spanId}`
          .toLocaleLowerCase()
          .includes(filter),
    );
  }, [data, search, tab]);
  return (
    <>
      <TelemetryExportSettings environmentId={props.environmentId} />
      <Button
        label={translator.message("mobile.insights.resources.live")}
        disabled={!config?.environment.capabilities.resourceDiagnosticsVersion}
        onPress={() =>
          navigation.navigate("SettingsBetterT3ResourceDiagnostics", {
            environmentId: props.environmentId,
          })
        }
      />
      <SettingsSection card title={translator.message("mobile.insights.traces")}>
        <View className="gap-3 p-4">
          <Button
            label={translator.message("mobile.insights.refresh")}
            loading={query.isPending}
            disabled={!canRead}
            onPress={query.refresh}
          />
          {!canRead ? (
            <Text className="text-sm text-foreground-muted">
              {translator.message("mobile.insights.readDenied")}
            </Text>
          ) : null}
          {query.error ? (
            <Text selectable className="text-sm text-danger-foreground">
              {query.error}
            </Text>
          ) : null}
          {data ? (
            <>
              <Text selectable className="text-xs text-foreground-muted">
                {data.traceFilePath}
              </Text>
              {Option.isSome(data.error) ? (
                <Text className="text-sm text-danger-foreground">{data.error.value.message}</Text>
              ) : null}
              <InsightValue
                label={translator.message("mobile.insights.records")}
                value={String(data.recordCount)}
              />
              <InsightValue
                label={translator.message("mobile.insights.failures")}
                value={String(data.failureCount)}
              />
              <InsightValue
                label={translator.message("mobile.insights.slowSpans")}
                value={String(data.slowSpanCount)}
              />
              <InsightValue
                label={translator.message("mobile.insights.parseErrors")}
                value={String(data.parseErrorCount)}
              />
            </>
          ) : null}
          <SegmentedControl
            options={[
              { value: "spans", label: translator.message("mobile.insights.traces") },
              { value: "failures", label: translator.message("mobile.insights.failures") },
              { value: "logs", label: translator.message("mobile.insights.logs") },
            ]}
            selected={tab}
            onSelect={setTab}
          />
          <TextInput
            accessibilityLabel={translator.message("mobile.insights.searchTraces")}
            placeholder={translator.message("mobile.insights.searchTraces")}
            autoCapitalize="none"
            autoCorrect={false}
            value={search}
            onChangeText={setSearch}
            className="min-h-12 rounded-xl bg-subtle px-3 text-base text-foreground"
          />
          {rows.map((row) => (
            <Pressable
              accessibilityRole="button"
              key={`${row.traceId}:${row.spanId}:${row.at}:${row.details}`}
              onPress={() => setSelected(row)}
              className="gap-1 border-t border-border-subtle py-3"
            >
              <Text className="text-sm font-t3-medium text-foreground">{row.name}</Text>
              <Text numberOfLines={3} className="text-xs text-foreground-muted">
                {row.details}
              </Text>
              <Text className="text-xs text-foreground-muted">{row.at}</Text>
            </Pressable>
          ))}
          {query.isSuccess && rows.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              {translator.message("mobile.insights.noRecords")}
            </Text>
          ) : null}
        </View>
      </SettingsSection>
      {data && tab === "spans" ? (
        <SettingsSection card title={translator.message("mobile.insights.spanCounts")}>
          <View className="p-4">
            {data.topSpansByCount
              .filter((span) =>
                span.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
              )
              .map((span) => (
                <View key={span.name} className="border-b border-border-subtle py-2">
                  <Text selectable className="text-sm text-foreground">
                    {span.name}
                  </Text>
                  <InsightValue
                    label={translator.message("mobile.insights.recordsAndFailures")}
                    value={`${span.count} · ${span.failureCount}`}
                  />
                  <InsightValue
                    label={translator.message("mobile.insights.averageMaximum")}
                    value={`${span.averageDurationMs.toFixed(1)} / ${span.maxDurationMs.toFixed(1)} ms`}
                  />
                </View>
              ))}
          </View>
        </SettingsSection>
      ) : null}
      {data && tab === "failures" ? (
        <SettingsSection card title={translator.message("mobile.insights.commonFailures")}>
          <View className="p-4">
            {data.commonFailures
              .filter((failure) =>
                `${failure.name} ${failure.cause} ${failure.traceId}`
                  .toLocaleLowerCase()
                  .includes(search.trim().toLocaleLowerCase()),
              )
              .map((failure) => (
                <Pressable
                  key={`${failure.name}:${failure.cause}`}
                  accessibilityRole="button"
                  className="border-b border-border-subtle py-3"
                  onPress={() =>
                    setSelected({
                      name: failure.name,
                      details: failure.cause,
                      traceId: failure.traceId,
                      spanId: failure.spanId,
                      at: DateTime.formatIso(failure.lastSeenAt),
                    })
                  }
                >
                  <InsightValue label={failure.name} value={String(failure.count)} />
                  <Text numberOfLines={3} className="text-xs text-foreground-muted">
                    {failure.cause}
                  </Text>
                </Pressable>
              ))}
          </View>
        </SettingsSection>
      ) : null}
      {selected ? (
        <InsightsSheet title={selected.name} onClose={() => setSelected(null)}>
          <Text selectable className="text-sm text-foreground">
            {selected.details}
          </Text>
          <InsightValue label="Trace ID" value={selected.traceId} />
          <InsightValue label="Span ID" value={selected.spanId} />
          <Text className="text-xs text-foreground-muted">{selected.at}</Text>
          <Button
            label={translator.message("mobile.insights.filterTrace")}
            onPress={() => {
              setSearch(selected.traceId);
              setSelected(null);
            }}
          />
        </InsightsSheet>
      ) : null}
    </>
  );
}
