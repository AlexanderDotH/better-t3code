import { useAtomValue } from "@effect/atom-react";
import { useIsFocused } from "@react-navigation/native";
import {
  AuthDiagnosticsReadScope,
  type EnvironmentId,
  type ResourceTelemetryProcess,
  type ServerProcessSignal,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatMobileResourceBytes as bytes } from "../settings/better-t3-settings";
import { SettingsSection } from "../settings/components/SettingsSection";
import { InsightValue, InsightsSheet } from "./InsightsSheet";
import { sortResourceProcesses, type ResourceProcessSort } from "./resource-processes";

const HISTORY_WINDOWS = [
  { value: 5, label: "5m", bucketMs: 15_000 },
  { value: 15, label: "15m", bucketMs: 30_000 },
  { value: 30, label: "30m", bucketMs: 60_000 },
  { value: 60, label: "1h", bucketMs: 120_000 },
] as const;
const PROCESS_PAGE_SIZE = 40;

export function ResourceMonitor(props: { readonly environmentId: EnvironmentId }) {
  const translator = useMobileInterfaceTranslator();
  const focused = useIsFocused();
  const canRead = useEnvironmentScope(props.environmentId, AuthDiagnosticsReadScope);
  const telemetry = useEnvironmentQuery(
    focused && canRead
      ? serverEnvironment.resourceTelemetry({ environmentId: props.environmentId, input: {} })
      : null,
  );
  const [minutes, setMinutes] = useState(15);
  const selectedWindow = HISTORY_WINDOWS.find((option) => option.value === minutes)!;
  const history = useEnvironmentQuery(
    focused && canRead
      ? serverEnvironment.resourceTelemetryHistory({
          environmentId: props.environmentId,
          input: { windowMs: minutes * 60_000, bucketMs: selectedWindow.bucketMs },
        })
      : null,
  );
  const [sort, setSort] = useState<ResourceProcessSort>("cpu");
  const [shown, setShown] = useState(PROCESS_PAGE_SIZE);
  const [historyShown, setHistoryShown] = useState(PROCESS_PAGE_SIZE);
  const [selected, setSelected] = useState<ResourceTelemetryProcess | null>(null);
  const processes = useMemo(
    () => sortResourceProcesses(telemetry.data?.processes ?? [], sort),
    [telemetry.data?.processes, sort],
  );
  const snapshot = telemetry.data;
  const aggregate = snapshot?.groups.allT3;
  const latestSelected = selected
    ? processes.find(
        (process) =>
          process.identity.pid === selected.identity.pid &&
          process.identity.startTimeMs === selected.identity.startTimeMs,
      )
    : undefined;
  return (
    <>
      <SettingsSection card title={translator.message("mobile.insights.resources.live")}>
        <View className="p-4">
          {telemetry.error ? (
            <Text selectable className="text-sm text-danger-foreground">
              {telemetry.error}
            </Text>
          ) : null}
          {aggregate ? (
            <>
              <InsightValue
                label={translator.message("mobile.insights.resources.processes")}
                value={String(aggregate.processCount)}
              />
              <InsightValue label="CPU" value={`${aggregate.currentCpuPercent.toFixed(1)}%`} />
              <InsightValue label="RSS" value={bytes(aggregate.currentRssBytes)} />
              <InsightValue
                label={translator.message("mobile.insights.resources.readWrite")}
                value={`${bytes(aggregate.ioReadBytesPerSecond)}/s · ${bytes(aggregate.ioWriteBytesPerSecond)}/s`}
              />
              <InsightValue
                label={translator.message("mobile.insights.resources.totalIo")}
                value={`${bytes(aggregate.ioReadBytes)} · ${bytes(aggregate.ioWriteBytes)}`}
              />
            </>
          ) : (
            <Text className="text-sm text-foreground-muted">
              {translator.message(
                canRead ? "mobile.insights.loading" : "mobile.insights.readDenied",
              )}
            </Text>
          )}
          <SegmentedControl
            options={[
              { value: "cpu", label: "CPU" },
              { value: "memory", label: "RSS" },
              { value: "pid", label: "PID" },
            ]}
            selected={sort}
            onSelect={(value) => {
              setSort(value);
              setShown(PROCESS_PAGE_SIZE);
            }}
          />
          {processes.slice(0, shown).map((process) => (
            <Pressable
              key={`${process.identity.pid}:${process.identity.startTimeMs}`}
              accessibilityRole="button"
              className="min-h-16 border-b border-border-subtle py-3"
              onPress={() => setSelected(process)}
            >
              <Text className="text-sm text-foreground">
                {process.name || process.command} · {process.identity.pid}
              </Text>
              <Text className="text-xs tabular-nums text-foreground-muted">
                {process.category} · {process.cpuPercent.toFixed(1)}% ·{" "}
                {bytes(process.residentBytes)}
              </Text>
            </Pressable>
          ))}
          {processes.length > shown ? (
            <Button
              tone="text"
              label={translator.message("mobile.insights.showMore")}
              onPress={() => setShown((value) => value + PROCESS_PAGE_SIZE)}
            />
          ) : null}
        </View>
      </SettingsSection>
      {snapshot ? (
        <SettingsSection card title={translator.message("mobile.insights.resources.health")}>
          <View className="p-4">
            {(["native", "desktop"] as const).map((source) => (
              <View key={source}>
                <InsightValue
                  label={translator.message(`mobile.insights.resources.${source}`)}
                  value={snapshot.health[source].status}
                />
                {Option.isSome(snapshot.health[source].lastError) ? (
                  <Text selectable className="text-xs text-foreground-muted">
                    {snapshot.health[source].lastError.value}
                  </Text>
                ) : null}
              </View>
            ))}
            <InsightValue
              label={translator.message("mobile.insights.resources.sample")}
              value={`${DateTime.formatIso(snapshot.readAt)} · ${snapshot.sampleIntervalMs} ms`}
            />
            <InsightValue
              label={translator.message("mobile.insights.resources.collection")}
              value={`${snapshot.health.collectionDurationMicros} µs · ${snapshot.health.scannedProcessCount}/${snapshot.health.retainedProcessCount}/${snapshot.health.inaccessibleProcessCount}`}
            />
            <InsightValue
              label={translator.message("mobile.insights.resources.restarts")}
              value={String(snapshot.health.restartCount)}
            />
            <InsightValue
              label={translator.message("mobile.insights.resources.host")}
              value={`${snapshot.power.thermalState} · ${snapshot.power.source}`}
            />
            {(["idle", "locked", "onBattery", "lowPowerMode"] as const).map((key) => (
              <InsightValue
                key={key}
                label={translator.message(`mobile.insights.resources.${key}`)}
                value={snapshot.power[key]}
              />
            ))}
            <InsightValue
              label={translator.message("mobile.insights.resources.suspended")}
              value={translator.message(
                snapshot.power.suspended ? "mobile.insights.yes" : "mobile.insights.no",
              )}
            />
            <InsightValue
              label={translator.message("mobile.insights.resources.stale")}
              value={translator.message(
                snapshot.power.stale ? "mobile.insights.yes" : "mobile.insights.no",
              )}
            />
            {Option.isSome(snapshot.speedLimitPercent) ? (
              <InsightValue
                label={translator.message("mobile.insights.resources.speedLimit")}
                value={`${snapshot.speedLimitPercent.value}%`}
              />
            ) : null}
          </View>
        </SettingsSection>
      ) : null}
      <SettingsSection card title={translator.message("mobile.insights.resources.history")}>
        <View className="gap-4 p-4">
          <SegmentedControl options={HISTORY_WINDOWS} selected={minutes} onSelect={setMinutes} />
          <Button
            label={translator.message("mobile.insights.refresh")}
            loading={history.isPending}
            onPress={history.refresh}
          />
          {history.error ? (
            <Text className="text-sm text-danger-foreground">{history.error}</Text>
          ) : null}
          {history.data ? (
            <>
              <HistoryBars
                label="CPU"
                values={history.data.buckets.map((bucket) => ({
                  key: DateTime.formatIso(bucket.startedAt),
                  value: bucket.avgCpuPercent,
                }))}
                format={(value) => `${value.toFixed(1)}%`}
              />
              <HistoryBars
                label="RSS"
                values={history.data.buckets.map((bucket) => ({
                  key: DateTime.formatIso(bucket.startedAt),
                  value: bucket.maxRssBytes,
                }))}
                format={bytes}
              />
              <HistoryBars
                label={translator.message("mobile.insights.resources.readWrite")}
                values={history.data.buckets.map((bucket) => ({
                  key: DateTime.formatIso(bucket.startedAt),
                  value: bucket.ioReadBytes + bucket.ioWriteBytes,
                }))}
                format={bytes}
              />
              <Text className="text-xs text-foreground-muted">
                {translator.message("mobile.insights.resources.samples", {
                  count: history.data.retainedSampleCount,
                })}
              </Text>
              {history.data.topProcesses.slice(0, historyShown).map((process) => (
                <View
                  key={`${process.identity.pid}:${process.identity.startTimeMs}`}
                  className="border-t border-border-subtle py-2"
                >
                  <Text selectable className="text-sm text-foreground">
                    {process.name || process.command} · {process.identity.pid}
                  </Text>
                  <InsightValue
                    label={translator.message("mobile.insights.resources.averagePeakCpu")}
                    value={`${process.avgCpuPercent.toFixed(1)}% / ${process.maxCpuPercent.toFixed(1)}%`}
                  />
                  <InsightValue
                    label={translator.message("mobile.insights.resources.peakMemory")}
                    value={bytes(process.peakRssBytes)}
                  />
                  <InsightValue
                    label={translator.message("mobile.insights.resources.totalIo")}
                    value={`${bytes(process.ioReadBytes)} / ${bytes(process.ioWriteBytes)} · ${process.ioSemantics}`}
                  />
                  <Text className="text-xs text-foreground-muted">
                    {DateTime.formatIso(process.firstSeenAt)} ·{" "}
                    {DateTime.formatIso(process.lastSeenAt)}
                  </Text>
                </View>
              ))}
              {history.data.topProcesses.length > historyShown ? (
                <Button
                  tone="text"
                  label={translator.message("mobile.insights.showMore")}
                  onPress={() => setHistoryShown((value) => value + PROCESS_PAGE_SIZE)}
                />
              ) : null}
            </>
          ) : null}
        </View>
      </SettingsSection>
      {snapshot?.attribution.entries.length ? (
        <SettingsSection card title={translator.message("mobile.insights.resources.attribution")}>
          <View className="p-4">
            {snapshot.attribution.entries.map((entry) => (
              <InsightValue
                key={`${entry.component}:${entry.operation}`}
                label={`${entry.component} · ${entry.operation}`}
                value={`${bytes(entry.logicalReadBytes)} / ${bytes(entry.logicalWriteBytes)} · ${entry.count} · ${entry.durationMs.toFixed(1)} ms`}
              />
            ))}
          </View>
        </SettingsSection>
      ) : null}
      {selected ? (
        <ProcessDetails
          environmentId={props.environmentId}
          process={latestSelected ?? selected}
          live={latestSelected !== undefined}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}

function HistoryBars(props: {
  readonly label: string;
  readonly values: readonly { readonly key: string; readonly value: number }[];
  readonly format: (value: number) => string;
}) {
  const maximum = Math.max(0, ...props.values.map((entry) => entry.value));
  return (
    <View className="gap-1">
      <InsightValue label={props.label} value={props.format(maximum)} />
      <View
        accessible
        accessibilityLabel={`${props.label}: ${props.values.map((entry) => props.format(entry.value)).join(", ")}`}
        className="h-24 flex-row items-end gap-px"
      >
        {props.values.map(({ key, value }) => (
          <View
            key={key}
            className="flex-1 rounded-t-sm bg-primary"
            style={{
              height: maximum === 0 || value <= 0 ? 0 : Math.max(1, (value / maximum) * 96),
            }}
          />
        ))}
      </View>
    </View>
  );
}

function ProcessDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly process: ResourceTelemetryProcess;
  readonly live: boolean;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const permitted = useAtomValue(
    serverEnvironment.signalProcess.permissionAtom(props.environmentId),
  );
  const signal = useAtomCommand(serverEnvironment.signalProcess, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const send = async (value: ServerProcessSignal) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    await (async () => {
      const result = await signal({
        environmentId: props.environmentId,
        input: { ...props.process.identity, signal: value },
      });
      setMessage(
        result._tag === "Success"
          ? Option.getOrElse(result.value.message, () =>
              translator.message(
                result.value.signaled
                  ? "mobile.insights.resources.signaled"
                  : "mobile.insights.resources.signalFailed",
              ),
            )
          : translator.message("mobile.insights.resources.signalFailed"),
      );
    })().finally(() => {
      pendingRef.current = false;
      setPending(false);
    });
  };
  const confirm = (value: ServerProcessSignal) =>
    Dialog.alert(
      translator.message("mobile.insights.resources.confirmSignal", {
        signal: value,
        pid: props.process.identity.pid,
      }),
      translator.message("mobile.insights.resources.signalWarning"),
      [
        { text: translator.message("settings.common.cancel"), style: "cancel" },
        { text: value, style: "destructive", onPress: () => void send(value) },
      ],
    );
  return (
    <InsightsSheet
      title={`${props.process.name} · ${props.process.identity.pid}`}
      onClose={props.onClose}
    >
      <Text selectable className="text-sm text-foreground">
        {props.process.command}
      </Text>
      <InsightValue
        label="CPU / RSS"
        value={`${props.process.cpuPercent.toFixed(1)}% / ${bytes(props.process.residentBytes)}`}
      />
      <InsightValue
        label={translator.message("mobile.insights.resources.peakMemory")}
        value={bytes(props.process.peakResidentBytes)}
      />
      <InsightValue
        label={translator.message("mobile.insights.resources.readWrite")}
        value={`${bytes(props.process.ioReadBytesPerSecond)}/s / ${bytes(props.process.ioWriteBytesPerSecond)}/s`}
      />
      <InsightValue
        label={translator.message("mobile.insights.resources.totalIo")}
        value={`${bytes(props.process.ioReadBytes)} / ${bytes(props.process.ioWriteBytes)} · ${props.process.ioSemantics}`}
      />
      <InsightValue
        label={translator.message("mobile.insights.resources.cpuTime")}
        value={`${props.process.cpuTimeMs / 1_000}s`}
      />
      <InsightValue
        label={translator.message("mobile.insights.resources.processState")}
        value={`${props.process.status} · ${props.process.category} · PPID ${props.process.ppid}`}
      />
      <View className="flex-row gap-3">
        {(["SIGINT", "SIGKILL"] as const).map((value) => (
          <Button
            key={value}
            label={value}
            tone="danger"
            disabled={!permitted || pending || !props.live}
            onPress={() => confirm(value)}
          />
        ))}
      </View>
      {message ? (
        <Text accessibilityRole="alert" className="text-sm text-foreground">
          {message}
        </Text>
      ) : null}
    </InsightsSheet>
  );
}
