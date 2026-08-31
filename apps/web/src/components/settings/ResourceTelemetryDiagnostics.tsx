import {
  ActivityIcon,
  AlertTriangleIcon,
  BatteryIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CpuIcon,
  DatabaseIcon,
  GaugeIcon,
  HardDriveIcon,
  MemoryStickIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import type {
  BackgroundBooleanState,
  ResourceAttributionEntry,
  ResourceTelemetryAggregate,
  ResourceTelemetryHistoryBucket,
  ResourceTelemetryProcess,
  ResourceTelemetryProcessCategory,
  ResourceTelemetryProcessSummary,
  ResourceTelemetrySourceHealth,
  ResourceTelemetrySourceStatus,
  ServerProcessSignal,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import {
  useResourceTelemetry,
  useResourceTelemetryHistory,
} from "../../lib/resourceTelemetryState";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTime } from "../../timestampFormat";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  resourceTelemetryCategoryMessageKey,
  resourceTelemetryIoSemanticsMessageKey,
  resourceTelemetrySourceStatusMessageKey,
  resourceTelemetryThermalMessageKey,
  resourceHistoryBarHeight,
  resourceHistoryCpuScaleMax,
  shouldShowResourceMonitorRetry,
  visibleResourceTelemetryProcesses,
} from "./ResourceTelemetryDiagnostics.logic";
import { SettingsSection, useRelativeTimeTick } from "./settingsLayout";

const HISTORY_WINDOWS = [
  {
    messageKey: "settings.diagnostics.window.fiveMinutes",
    windowMs: 5 * 60_000,
    bucketMs: 15_000,
  },
  {
    messageKey: "settings.diagnostics.window.fifteenMinutes",
    windowMs: 15 * 60_000,
    bucketMs: 30_000,
  },
  {
    messageKey: "settings.diagnostics.window.thirtyMinutes",
    windowMs: 30 * 60_000,
    bucketMs: 60_000,
  },
  {
    messageKey: "settings.diagnostics.window.oneHour",
    windowMs: 60 * 60_000,
    bucketMs: 2 * 60_000,
  },
] as const;

function formatBytes(value: number, translator: InterfaceTranslator): string {
  if (value < 1_024) return `${translator.number(Math.round(value))} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let next = value;
  let unitIndex = -1;
  do {
    next /= 1_024;
    unitIndex += 1;
  } while (next >= 1_024 && unitIndex < units.length - 1);
  return `${translator.number(next, {
    maximumFractionDigits: next >= 100 ? 0 : next >= 10 ? 1 : 2,
  })} ${units[unitIndex]}`;
}

function formatRate(value: number, translator: InterfaceTranslator): string {
  return `${formatBytes(value, translator)}/s`;
}

function formatCpuTime(valueMs: number, translator: InterfaceTranslator): string {
  const seconds = valueMs / 1_000;
  if (seconds < 60) {
    return `${translator.number(seconds, { maximumFractionDigits: seconds >= 10 ? 1 : 2 })}s`;
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${translator.number(minutes, { maximumFractionDigits: minutes >= 10 ? 1 : 2 })}m`;
  }
  return `${translator.number(minutes / 60, { maximumFractionDigits: 2 })}h`;
}

function formatDurationMicros(value: number, translator: InterfaceTranslator): string {
  if (value < 1_000) return `${translator.number(Math.round(value))} µs`;
  if (value < 1_000_000) {
    return `${translator.number(value / 1_000, { maximumFractionDigits: 2 })} ms`;
  }
  return `${translator.number(value / 1_000_000, { maximumFractionDigits: 2 })} s`;
}

function formatSampleInterval(valueMs: number, translator: InterfaceTranslator): string {
  if (valueMs < 1_000) return `${translator.number(Math.max(0, Math.round(valueMs)))} ms`;
  const seconds = valueMs / 1_000;
  return translator.message("settings.diagnostics.sampleInterval", {
    count: seconds,
  });
}

function processIdentityKey(process: ResourceTelemetryProcess): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

function processSummaryIdentityKey(process: ResourceTelemetryProcessSummary): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

function formatProcessName(process: Pick<ResourceTelemetryProcess, "command" | "name">): string {
  if (process.name.trim()) return process.name;
  const firstToken = process.command.trim().split(/\s+/)[0] ?? process.command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  return normalized.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? normalized;
}

function categoryDotClass(category: ResourceTelemetryProcessCategory): string {
  if (category === "resource-monitor") return "bg-amber-500";
  if (category.startsWith("electron-")) return "bg-sky-500";
  if (category === "server") return "bg-violet-500";
  return "bg-emerald-500";
}

function booleanStateLabel(
  value: BackgroundBooleanState,
  labels: { readonly true: string; readonly false: string; readonly unknown: string },
): string {
  if (value === "true") return labels.true;
  if (value === "false") return labels.false;
  return labels.unknown;
}

function sourceStatusTone(status: ResourceTelemetrySourceStatus): "default" | "warning" | "danger" {
  if (status === "healthy") return "default";
  if (status === "starting" || status === "degraded") return "warning";
  return "danger";
}

function SourceStatusBadge({
  label,
  status,
  presentation,
}: {
  label: string;
  status: ResourceTelemetrySourceStatus;
  presentation?:
    | {
        readonly label: string;
        readonly tone: "neutral";
      }
    | undefined;
}) {
  const translate = useInterfaceTranslator().message;
  const tone = presentation?.tone ?? sourceStatusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
        tone === "neutral" && "border-border/70 bg-muted/45 text-muted-foreground",
        tone === "default" &&
          "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "warning" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "neutral" && "bg-muted-foreground/55",
          tone === "default" && "bg-emerald-500",
          tone === "warning" && "bg-amber-500",
          tone === "danger" && "bg-destructive",
        )}
      />
      {label} {presentation?.label ?? translate(resourceTelemetrySourceStatusMessageKey(status))}
    </span>
  );
}

function LastSampleLabel({ sampledAt }: { sampledAt: DateTime.Utc | null }) {
  const translate = useInterfaceTranslator().message;
  useRelativeTimeTick();
  if (!sampledAt) {
    return (
      <span className="text-[11px] text-muted-foreground/55">
        {translate("settings.diagnostics.common.waitingSample")}
      </span>
    );
  }
  const relative = formatRelativeTime(DateTime.formatIso(sampledAt));
  if (!relative) {
    return (
      <span className="text-[11px] text-muted-foreground/55">
        {translate("settings.diagnostics.common.waitingSample")}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-muted-foreground/60">
      {translate("settings.diagnostics.common.updated", {
        value: relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value,
      })}
    </span>
  );
}

function IconStat({
  icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string | undefined;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="group min-w-0 px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground/70">
        <span className="text-muted-foreground/55 transition-colors group-hover:text-foreground/65">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "mt-2.5 truncate font-mono text-2xl font-semibold tracking-[-0.05em] tabular-nums text-foreground",
          tone === "warning" && "text-amber-600 dark:text-amber-300",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
      {detail ? (
        <div className="mt-1.5 truncate text-[10px] text-muted-foreground/60">{detail}</div>
      ) : null}
    </div>
  );
}

function AggregateCard({
  label,
  accentClass,
  aggregate,
}: {
  label: string;
  accentClass: string;
  aggregate: ResourceTelemetryAggregate;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  return (
    <div className="relative overflow-hidden border-t border-border/60 px-4 py-4 first:border-t-0 md:border-t-0 md:border-l md:first:border-l-0 sm:px-5">
      <span className={cn("absolute inset-x-5 top-0 h-0.5 rounded-full opacity-75", accentClass)} />
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground/75">
          {label}
        </div>
        <div className="rounded-md bg-muted/55 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-muted-foreground/70">
          {translate("settings.diagnostics.process.count", { count: aggregate.processCount })}
        </div>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <MetricPair
          label={translate("settings.diagnostics.resourceMonitor.cpu")}
          value={`${translator.number(aggregate.currentCpuPercent, { maximumFractionDigits: 1 })}%`}
        />
        <MetricPair
          label={translate("settings.diagnostics.resourceMonitor.memory")}
          value={formatBytes(aggregate.currentRssBytes, translator)}
        />
        <MetricPair
          label={translate("settings.diagnostics.resourceMonitor.read")}
          value={formatRate(aggregate.ioReadBytesPerSecond, translator)}
        />
        <MetricPair
          label={translate("settings.diagnostics.resourceMonitor.write")}
          value={formatRate(aggregate.ioWriteBytesPerSecond, translator)}
        />
      </div>
    </div>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/45">
        {label}
      </div>
      <div className="truncate font-mono text-xs font-medium tabular-nums text-foreground/90">
        {value}
      </div>
    </div>
  );
}

function HealthSource({ label, health }: { label: string; health: ResourceTelemetrySourceHealth }) {
  const translate = useInterfaceTranslator().message;
  const expectedInBrowser =
    health.status === "unavailable" &&
    Option.exists(health.lastError, (error) => error.includes("'web' mode"));
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/50 py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground/65">
          {expectedInBrowser
            ? translate("settings.diagnostics.common.availableDesktop")
            : Option.match(health.lastError, {
                onNone: () => translate("settings.diagnostics.common.noReportedErrors"),
                onSome: (error) => error,
              })}
        </div>
      </div>
      <SourceStatusBadge
        label=""
        status={health.status}
        presentation={
          expectedInBrowser
            ? {
                label: translate("settings.diagnostics.common.desktopOnly"),
                tone: "neutral",
              }
            : undefined
        }
      />
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/50 py-2.5 first:border-t-0">
      <span className="text-[11px] text-muted-foreground/75">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right font-mono text-[11px] tabular-nums text-foreground/85",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function HistoryWindowSelector({
  selectedWindowMs,
  onSelect,
}: {
  selectedWindowMs: number;
  onSelect: (windowMs: number) => void;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <div className="flex items-center rounded-md border border-border/60 p-0.5">
      {HISTORY_WINDOWS.map((option) => (
        <button
          key={option.windowMs}
          type="button"
          className={cn(
            "cursor-pointer h-6 rounded-sm px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground",
            selectedWindowMs === option.windowMs && "bg-muted text-foreground",
          )}
          onClick={() => onSelect(option.windowMs)}
        >
          {translate(option.messageKey)}
        </button>
      ))}
    </div>
  );
}

function ResourceHistoryChart({
  buckets,
}: {
  buckets: ReadonlyArray<ResourceTelemetryHistoryBucket>;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const maxCpu = resourceHistoryCpuScaleMax(buckets);
  const maxIo = Math.max(1, ...buckets.map((bucket) => bucket.ioReadBytes + bucket.ioWriteBytes));

  return (
    <div className="border-t border-border/60 px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground/65">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-foreground/70" />
          {translate("settings.diagnostics.timeline.cpuAverage")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-sky-500/70" />
          {translate("settings.diagnostics.timeline.ioReads")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-amber-500/80" />
          {translate("settings.diagnostics.timeline.ioWrites")}
        </span>
      </div>
      <div className="flex h-32 items-end gap-1 overflow-hidden rounded-lg border border-border/40 bg-muted/8 px-2 pt-3 pb-2">
        {buckets.map((bucket) => {
          const cpuHeight = resourceHistoryBarHeight({
            value: bucket.avgCpuPercent,
            max: maxCpu,
            minimumVisiblePercent: 2,
          });
          const readHeight = resourceHistoryBarHeight({
            value: bucket.ioReadBytes,
            max: maxIo,
            minimumVisiblePercent: 1,
          });
          const writeHeight = resourceHistoryBarHeight({
            value: bucket.ioWriteBytes,
            max: maxIo,
            minimumVisiblePercent: 1,
          });
          return (
            <Tooltip key={DateTime.formatIso(bucket.startedAt)}>
              <TooltipTrigger
                render={
                  <div className="grid h-full min-w-1 flex-1 grid-cols-3 items-end gap-px">
                    <span
                      className="block rounded-t-sm bg-foreground/65"
                      style={{ height: `${cpuHeight}%` }}
                    />
                    <span
                      className="block rounded-t-sm bg-sky-500/70"
                      style={{ height: `${readHeight}%` }}
                    />
                    <span
                      className="block rounded-t-sm bg-amber-500/80"
                      style={{ height: `${writeHeight}%` }}
                    />
                  </div>
                }
              />
              <TooltipPopup side="top" className="space-y-0.5 text-left">
                <div>
                  {translate("settings.diagnostics.timeline.cpuAverageValue", {
                    value: translator.number(bucket.avgCpuPercent, { maximumFractionDigits: 1 }),
                  })}
                </div>
                <div>
                  {translate("settings.diagnostics.timeline.cpuPeakValue", {
                    value: translator.number(bucket.maxCpuPercent, { maximumFractionDigits: 1 }),
                  })}
                </div>
                <div>
                  {translate("settings.diagnostics.timeline.readValue", {
                    value: formatBytes(bucket.ioReadBytes, translator),
                  })}
                </div>
                <div>
                  {translate("settings.diagnostics.timeline.writeValue", {
                    value: formatBytes(bucket.ioWriteBytes, translator),
                  })}
                </div>
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function ProcessTreeName({
  process,
  collapsed,
  onToggle,
}: {
  process: ResourceTelemetryProcess;
  collapsed: boolean;
  onToggle: (process: ResourceTelemetryProcess) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const name = formatProcessName(process);
  const hasChildren = process.childPids.length > 0;
  const ChevronIcon = collapsed ? ChevronRightIcon : ChevronDownIcon;
  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(process.depth, 7) * 10}px` }}
    >
      {hasChildren ? (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={() => onToggle(process)}
          aria-label={translate(
            collapsed
              ? "settings.diagnostics.process.expand"
              : "settings.diagnostics.process.collapse",
            { name },
          )}
        >
          <ChevronIcon className="size-3.5" />
        </Button>
      ) : (
        <span className="size-5" aria-hidden />
      )}
      <span className={cn("size-1.5 rounded-full", categoryDotClass(process.category))} />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(520px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px]"
        >
          {process.command || process.name}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function canSignalProcess(process: ResourceTelemetryProcess): boolean {
  return (
    process.category === "server-child" ||
    process.category === "provider-root" ||
    process.category === "terminal-root"
  );
}

function ProcessActions({
  process,
  signalingKeys,
  onSignal,
}: {
  process: ResourceTelemetryProcess;
  signalingKeys: ReadonlySet<string>;
  onSignal: (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => void;
}) {
  const translate = useInterfaceTranslator().message;
  if (!canSignalProcess(process)) {
    return <span className="text-[10px] text-muted-foreground/35">-</span>;
  }
  const isSignaling = signalingKeys.has(processIdentityKey(process));
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        disabled={isSignaling}
        aria-label={translate("settings.diagnostics.signal.sendInt")}
        className="cursor-pointer text-[10px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
        onClick={() => onSignal(process, "SIGINT")}
      >
        {translate("settings.diagnostics.signal.intShort")}
      </button>
      <button
        type="button"
        disabled={isSignaling}
        aria-label={translate("settings.diagnostics.signal.sendKill")}
        className="cursor-pointer text-[10px] font-semibold text-destructive hover:underline disabled:opacity-50"
        onClick={() => onSignal(process, "SIGKILL")}
      >
        {translate("settings.diagnostics.signal.killShort")}
      </button>
    </div>
  );
}

function ProcessTable({
  processes,
  signalingKeys,
  onSignal,
}: {
  processes: ReadonlyArray<ResourceTelemetryProcess>;
  signalingKeys: ReadonlySet<string>;
  onSignal: (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => void;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const visible = useMemo(
    () => visibleResourceTelemetryProcesses(processes, collapsed),
    [collapsed, processes],
  );
  const toggle = useCallback((process: ResourceTelemetryProcess) => {
    const identityKey = processIdentityKey(process);
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(identityKey)) {
        next.delete(identityKey);
      } else {
        next.add(identityKey);
      }
      return next;
    });
  }, []);

  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="max-h-[min(68vh,48rem)] w-full max-w-full border-t border-border/60"
    >
      <table className="w-full min-w-[1320px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[20%]" />
          <col className="w-[10%]" />
          <col className="w-[7%]" />
          <col className="w-[8%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[10%]" />
          <col className="w-[8%]" />
          <col className="w-[6%]" />
          <col className="w-[4%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-[10px] uppercase tracking-[0.08em] text-muted-foreground/65">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">
              {translate("settings.diagnostics.table.process")}
            </th>
            <th className="px-3 py-2 font-semibold">
              {translate("settings.diagnostics.table.category")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.cpu")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.cpuTime")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.memory")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.readPerSecond")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.writePerSecond")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.readTotal")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.writeTotal")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.pid")}
            </th>
            <th className="px-2 py-2 text-right font-semibold sm:pr-4">
              {translate("settings.diagnostics.table.kill")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {visible.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-4 py-5 text-xs text-muted-foreground sm:px-5">
                {translate("settings.diagnostics.timeline.emptyLive")}
              </td>
            </tr>
          ) : null}
          {visible.map((process) => (
            <tr key={processIdentityKey(process)} className="hover:bg-muted/20">
              <td className="px-4 py-2 sm:pl-5">
                <ProcessTreeName
                  process={process}
                  collapsed={collapsed.has(processIdentityKey(process))}
                  onToggle={toggle}
                />
              </td>
              <td className="truncate px-3 py-2 text-[11px] text-muted-foreground">
                {translate(resourceTelemetryCategoryMessageKey(process.category))}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {translator.number(process.cpuPercent, { maximumFractionDigits: 1 })}%
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {formatCpuTime(process.cpuTimeMs, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {formatBytes(process.residentBytes, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-sky-700 dark:text-sky-300">
                {formatRate(process.ioReadBytesPerSecond, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700 dark:text-amber-300">
                {formatRate(process.ioWriteBytesPerSecond, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {formatBytes(process.ioReadBytes, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger
                    render={<span>{formatBytes(process.ioWriteBytes, translator)}</span>}
                  />
                  <TooltipPopup side="top">
                    {translate(resourceTelemetryIoSemanticsMessageKey(process.ioSemantics))}
                  </TooltipPopup>
                </Tooltip>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {process.identity.pid}
              </td>
              <td className="px-2 py-2 text-right sm:pr-4">
                <ProcessActions
                  process={process}
                  signalingKeys={signalingKeys}
                  onSignal={onSignal}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function HistoryProcessTable({
  processes,
}: {
  processes: ReadonlyArray<ResourceTelemetryProcessSummary>;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="max-h-[28rem] w-full max-w-full border-t border-border/60"
    >
      <table className="w-full min-w-[1020px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[11%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[7%]" />
          <col className="w-[5%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-[10px] uppercase tracking-[0.08em] text-muted-foreground/65">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">
              {translate("settings.diagnostics.table.process")}
            </th>
            <th className="px-3 py-2 font-semibold">
              {translate("settings.diagnostics.table.category")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.cpuTime")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.peakCpu")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.peakMemory")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.read")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.write")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.samples")}
            </th>
            <th className="px-3 py-2 text-right font-semibold sm:pr-5">
              {translate("settings.diagnostics.table.pid")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {processes.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-5 text-xs text-muted-foreground sm:px-5">
                {translate("settings.diagnostics.timeline.emptyHistory")}
              </td>
            </tr>
          ) : null}
          {processes.map((process) => (
            <tr key={processSummaryIdentityKey(process)} className="hover:bg-muted/20">
              <td className="px-4 py-2 sm:pl-5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="block truncate font-medium text-foreground">
                        {process.name || process.command}
                      </span>
                    }
                  />
                  <TooltipPopup
                    side="top"
                    className="max-w-[min(520px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px]"
                  >
                    {process.command || process.name}
                  </TooltipPopup>
                </Tooltip>
              </td>
              <td className="truncate px-3 py-2 text-[11px] text-muted-foreground">
                {translate(resourceTelemetryCategoryMessageKey(process.category))}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {formatCpuTime(process.cpuTimeMs, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {translator.number(process.maxCpuPercent, { maximumFractionDigits: 1 })}%
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {formatBytes(process.peakRssBytes, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-sky-700 dark:text-sky-300">
                {formatBytes(process.ioReadBytes, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700 dark:text-amber-300">
                {formatBytes(process.ioWriteBytes, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {translator.number(process.sampleCount)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground sm:pr-5">
                {process.identity.pid}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function AttributionTable({ entries }: { entries: ReadonlyArray<ResourceAttributionEntry> }) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  return (
    <div className="overflow-x-auto border-t border-border/60">
      <table className="w-full min-w-[720px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[28%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-[10%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead className="border-b border-border/60 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/65">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">
              {translate("settings.diagnostics.table.component")}
            </th>
            <th className="px-3 py-2 font-semibold">
              {translate("settings.diagnostics.table.operation")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.logicalRead")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.logicalWrite")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.count")}
            </th>
            <th className="px-3 py-2 text-right font-semibold sm:pr-5">
              {translate("settings.diagnostics.table.time")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {entries.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-5 text-xs text-muted-foreground sm:px-5">
                {translate("settings.diagnostics.attribution.empty")}
              </td>
            </tr>
          ) : null}
          {entries.map((entry) => (
            <tr key={`${entry.component}:${entry.operation}`} className="hover:bg-muted/20">
              <td className="truncate px-4 py-2 font-medium text-foreground sm:pl-5">
                {entry.component}
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{entry.operation}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-sky-700 dark:text-sky-300">
                {formatBytes(entry.logicalReadBytes, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700 dark:text-amber-300">
                {formatBytes(entry.logicalWriteBytes, translator)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {translator.number(entry.count)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground sm:pr-5">
                {formatCpuTime(entry.durationMs, translator)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResourceTelemetryDiagnostics() {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const [windowMs, setWindowMs] = useState(15 * 60_000);
  const selectedWindow =
    HISTORY_WINDOWS.find((option) => option.windowMs === windowMs) ?? HISTORY_WINDOWS[1];
  const telemetry = useResourceTelemetry();
  const retryTelemetry = telemetry.retry;
  const history = useResourceTelemetryHistory({
    windowMs: selectedWindow.windowMs,
    bucketMs: selectedWindow.bucketMs,
  });
  const primaryEnvironment = usePrimaryEnvironment();
  const signalServerProcess = useAtomCommand(serverEnvironment.signalProcess, {
    reportFailure: false,
  });
  const [signalingKeys, setSignalingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const signalingKeysRef = useRef<ReadonlySet<string>>(new Set());
  signalingKeysRef.current = signalingKeys;
  const primaryEnvironmentIdRef = useRef(primaryEnvironment?.environmentId);
  primaryEnvironmentIdRef.current = primaryEnvironment?.environmentId;
  const [isRetrying, setIsRetrying] = useState(false);
  const snapshot = telemetry.data;
  const allT3 = snapshot?.groups.allT3;

  const signalProcess = useCallback(
    async (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => {
      const identityKey = processIdentityKey(process);
      if (signalingKeysRef.current.has(identityKey)) return;
      const nextSignalingKeys = new Set(signalingKeysRef.current).add(identityKey);
      signalingKeysRef.current = nextSignalingKeys;
      setSignalingKeys(nextSignalingKeys);
      const clearSignaling = () => {
        const next = new Set(signalingKeysRef.current);
        next.delete(identityKey);
        signalingKeysRef.current = next;
        setSignalingKeys(next);
      };

      if (signal === "SIGKILL") {
        let confirmed = false;
        try {
          confirmed = await ensureLocalApi().dialogs.confirm(
            translate("settings.diagnostics.signal.confirmKill", {
              pid: process.identity.pid,
            }),
            { variant: "destructive" },
          );
        } catch (error) {
          clearSignaling();
          toastManager.add({
            type: "error",
            title: translate("settings.diagnostics.signal.confirmFailed"),
            description:
              error instanceof Error
                ? error.message
                : translate("settings.diagnostics.signal.sendFailed", { signal }),
          });
          return;
        }
        if (!confirmed) {
          clearSignaling();
          return;
        }
      }
      const environmentId = primaryEnvironmentIdRef.current;
      if (environmentId === undefined) {
        clearSignaling();
        return;
      }
      void signalServerProcess({
        environmentId,
        input: {
          pid: process.identity.pid,
          startTimeMs: process.identity.startTimeMs,
          signal,
        },
      })
        .then((result) => {
          if (result._tag === "Failure") {
            if (isAtomCommandInterrupted(result)) return;
            throw squashAtomCommandFailure(result);
          }
          if (result.value.signaled) return;
          toastManager.add({
            type: "error",
            title: translate("settings.diagnostics.signal.sendFailedTitle", { signal }),
            description: Option.getOrElse(result.value.message, () =>
              translate("settings.diagnostics.signal.sendProcessFailed", {
                signal,
                pid: process.identity.pid,
              }),
            ),
          });
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: translate("settings.diagnostics.signal.sendFailedTitle", { signal }),
            description:
              error instanceof Error
                ? error.message
                : translate("settings.diagnostics.signal.sendFailed", { signal }),
          });
        })
        .finally(() => {
          clearSignaling();
        });
    },
    [signalServerProcess, translate],
  );

  const retryCollector = useCallback(() => {
    setIsRetrying(true);
    void retryTelemetry()
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: translate("settings.diagnostics.resourceMonitor.restartFailed"),
          description:
            error instanceof Error
              ? error.message
              : translate("settings.diagnostics.resourceMonitor.retryFailed"),
        });
      })
      .finally(() => {
        setIsRetrying(false);
      });
  }, [retryTelemetry, translate]);

  const speedLimit = snapshot ? Option.getOrNull(snapshot.speedLimitPercent) : null;
  const collectorNeedsRetry = shouldShowResourceMonitorRetry({
    nativeStatus: snapshot?.health.native.status ?? null,
    error: telemetry.error,
  });
  const hasHostPowerSignal =
    snapshot !== null &&
    (snapshot.power.onBattery !== "unknown" ||
      snapshot.power.lowPowerMode !== "unknown" ||
      snapshot.power.idle !== "unknown" ||
      snapshot.power.locked !== "unknown" ||
      snapshot.power.thermalState !== "unknown");

  return (
    <>
      <SettingsSection
        title={translate("settings.diagnostics.resourceMonitor.title")}
        icon={<ActivityIcon className="size-4 text-muted-foreground" />}
        headerAction={
          <div className="flex items-center gap-2">
            {snapshot ? (
              <SourceStatusBadge
                label={translate("settings.diagnostics.resourceMonitor.native")}
                status={snapshot.health.native.status}
              />
            ) : null}
            <LastSampleLabel sampledAt={snapshot?.readAt ?? null} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-micro"
                    variant="ghost"
                    disabled={telemetry.isPending}
                    onClick={telemetry.refresh}
                    aria-label={translate("settings.diagnostics.resourceMonitor.refresh")}
                  >
                    <RefreshCwIcon
                      className={cn("size-3", telemetry.isPending && "animate-spin")}
                    />
                  </Button>
                }
              />
              <TooltipPopup side="top">
                {translate("settings.diagnostics.resourceMonitor.refreshSnapshot")}
              </TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_1px_rgb(0_0_0/0.03),0_8px_30px_rgb(0_0_0/0.035)]">
          <div className="flex flex-col gap-3 border-b border-border/60 bg-linear-to-r from-muted/45 via-muted/20 to-transparent px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {translate("settings.diagnostics.resourceMonitor.footprint")}
              </div>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                {translate("settings.diagnostics.resourceMonitor.description")}
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/65">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {translate("settings.diagnostics.resourceMonitor.samplingEvery", {
                interval: snapshot
                  ? formatSampleInterval(snapshot.sampleIntervalMs, translator)
                  : "...",
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-border/55 md:grid-cols-3">
            <IconStat
              icon={<CpuIcon className="size-3.5" />}
              label={translate("settings.diagnostics.resourceMonitor.currentCpu")}
              value={
                allT3
                  ? `${translator.number(allT3.currentCpuPercent, { maximumFractionDigits: 1 })}%`
                  : "..."
              }
              detail={
                allT3
                  ? translate("settings.diagnostics.resourceMonitor.observedCpu", {
                      value: formatCpuTime(allT3.cpuTimeMs, translator),
                    })
                  : undefined
              }
            />
            <IconStat
              icon={<MemoryStickIcon className="size-3.5" />}
              label={translate("settings.diagnostics.resourceMonitor.residentMemory")}
              value={allT3 ? formatBytes(allT3.currentRssBytes, translator) : "..."}
              detail={
                allT3
                  ? translate("settings.diagnostics.resourceMonitor.combinedPeaks", {
                      value: formatBytes(allT3.peakRssBytes, translator),
                    })
                  : undefined
              }
            />
            <IconStat
              icon={<ActivityIcon className="size-3.5" />}
              label={translate("settings.diagnostics.resourceMonitor.processCount")}
              value={allT3 ? translator.number(allT3.processCount) : "..."}
              detail={
                allT3
                  ? translate("settings.diagnostics.resourceMonitor.startsExits", {
                      starts: translator.number(allT3.processStarts),
                      exits: translator.number(allT3.processExits),
                    })
                  : undefined
              }
            />
            <IconStat
              icon={<HardDriveIcon className="size-3.5" />}
              label={translate("settings.diagnostics.resourceMonitor.readThroughput")}
              value={allT3 ? formatRate(allT3.ioReadBytesPerSecond, translator) : "..."}
              detail={
                allT3
                  ? translate("settings.diagnostics.resourceMonitor.observed", {
                      value: formatBytes(allT3.ioReadBytes, translator),
                    })
                  : undefined
              }
            />
            <IconStat
              icon={<DatabaseIcon className="size-3.5" />}
              label={translate("settings.diagnostics.resourceMonitor.writeThroughput")}
              value={allT3 ? formatRate(allT3.ioWriteBytesPerSecond, translator) : "..."}
              detail={
                allT3
                  ? translate("settings.diagnostics.resourceMonitor.observed", {
                      value: formatBytes(allT3.ioWriteBytes, translator),
                    })
                  : undefined
              }
              tone={
                allT3 && allT3.ioWriteBytesPerSecond >= 10 * 1_024 * 1_024
                  ? "danger"
                  : allT3 && allT3.ioWriteBytesPerSecond >= 1_024 * 1_024
                    ? "warning"
                    : "default"
              }
            />
            <IconStat
              icon={<GaugeIcon className="size-3.5" />}
              label={translate("settings.diagnostics.resourceMonitor.speedLimit")}
              value={
                snapshot
                  ? speedLimit === null
                    ? translate("settings.diagnostics.common.unknown")
                    : `${translator.number(speedLimit, { maximumFractionDigits: 0 })}%`
                  : "..."
              }
              detail={
                snapshot
                  ? translate("settings.diagnostics.resourceMonitor.thermalState", {
                      state: translate(
                        resourceTelemetryThermalMessageKey(snapshot.power.thermalState),
                      ),
                    })
                  : undefined
              }
              tone={speedLimit !== null && speedLimit < 80 ? "warning" : "default"}
            />
          </div>
          {telemetry.error ? (
            <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive sm:px-5">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{telemetry.error}</span>
            </div>
          ) : null}
          {snapshot ? (
            <div className="grid border-t border-border/60 bg-muted/10 md:grid-cols-3">
              <AggregateCard
                label={translate("settings.diagnostics.resourceMonitor.backend")}
                accentClass="bg-emerald-500/80"
                aggregate={snapshot.groups.backend}
              />
              <AggregateCard
                label={translate("settings.diagnostics.resourceMonitor.desktop")}
                accentClass="bg-sky-500/80"
                aggregate={snapshot.groups.electron}
              />
              <AggregateCard
                label={translate("settings.diagnostics.resourceMonitor.overhead")}
                accentClass="bg-amber-500/80"
                aggregate={snapshot.groups.monitor}
              />
            </div>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title={translate("settings.diagnostics.host.title")}
        icon={<GaugeIcon className="size-4 text-muted-foreground" />}
        headerAction={
          collectorNeedsRetry ? (
            <Button size="xs" variant="outline" disabled={isRetrying} onClick={retryCollector}>
              <RotateCcwIcon className={cn("size-3", isRetrying && "animate-spin")} />
              {translate("settings.diagnostics.host.retry")}
            </Button>
          ) : null
        }
      >
        <div className="grid overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_1px_rgb(0_0_0/0.03)] md:grid-cols-2 md:divide-x md:divide-border/60">
          <div className="px-4 py-4 sm:px-5">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted/60">
                <BatteryIcon className="size-3.5" />
              </span>
              {translate("settings.diagnostics.host.state")}
            </div>
            {hasHostPowerSignal && snapshot ? (
              <>
                <DetailRow
                  label={translate("settings.diagnostics.host.powerSource")}
                  value={booleanStateLabel(snapshot.power.onBattery, {
                    true: translate("settings.diagnostics.common.battery"),
                    false: translate("settings.diagnostics.common.externalPower"),
                    unknown: translate("settings.diagnostics.common.unknown"),
                  })}
                />
                <DetailRow
                  label={translate("settings.diagnostics.host.lowPower")}
                  value={booleanStateLabel(snapshot.power.lowPowerMode, {
                    true: translate("settings.diagnostics.common.enabled"),
                    false: translate("settings.diagnostics.common.disabled"),
                    unknown: translate("settings.diagnostics.common.unknown"),
                  })}
                />
                <DetailRow
                  label={translate("settings.diagnostics.common.idle")}
                  value={`${booleanStateLabel(snapshot.power.idle, {
                    true: translate("settings.diagnostics.common.idle"),
                    false: translate("settings.diagnostics.common.active"),
                    unknown: translate("settings.diagnostics.common.unknown"),
                  })}${
                    snapshot.power.idleSeconds === null
                      ? ""
                      : ` · ${translator.number(Math.round(snapshot.power.idleSeconds))}s`
                  }`}
                />
                <DetailRow
                  label={translate("settings.diagnostics.host.session")}
                  value={
                    snapshot.power.suspended
                      ? translate("settings.diagnostics.common.suspended")
                      : booleanStateLabel(snapshot.power.locked, {
                          true: translate("settings.diagnostics.common.locked"),
                          false: translate("settings.diagnostics.common.unlocked"),
                          unknown: translate("settings.diagnostics.common.unknown"),
                        })
                  }
                />
                <DetailRow
                  label={translate("settings.diagnostics.host.thermal")}
                  value={translate(resourceTelemetryThermalMessageKey(snapshot.power.thermalState))}
                  valueClassName={
                    snapshot.power.thermalState === "serious" ||
                    snapshot.power.thermalState === "critical"
                      ? "text-destructive"
                      : undefined
                  }
                />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-5">
                <div className="text-[13px] font-medium text-foreground">
                  {translate("settings.diagnostics.host.signalsMissing")}
                </div>
                <p className="mt-1.5 max-w-sm text-[11px] leading-relaxed text-muted-foreground/70">
                  {translate("settings.diagnostics.host.signalsDescription")}
                </p>
              </div>
            )}
          </div>
          <div className="border-t border-border/60 px-4 py-4 md:border-t-0 sm:px-5">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted/60">
                <GaugeIcon className="size-3.5" />
              </span>
              {translate("settings.diagnostics.host.collectionHealth")}
            </div>
            {snapshot ? (
              <>
                <HealthSource
                  label={translate("settings.diagnostics.host.nativeMonitor")}
                  health={snapshot.health.native}
                />
                <HealthSource
                  label={translate("settings.diagnostics.host.electronMain")}
                  health={snapshot.health.desktop}
                />
                <DetailRow
                  label={translate("settings.diagnostics.host.collectionTime")}
                  value={formatDurationMicros(snapshot.health.collectionDurationMicros, translator)}
                />
                <DetailRow
                  label={translate("settings.diagnostics.host.processScan")}
                  value={translate("settings.diagnostics.host.retained", {
                    retained: translator.number(snapshot.health.retainedProcessCount),
                    scanned: translator.number(snapshot.health.scannedProcessCount),
                  })}
                />
                <DetailRow
                  label={translate("settings.diagnostics.host.inaccessible")}
                  value={translator.number(snapshot.health.inaccessibleProcessCount)}
                  valueClassName={
                    snapshot.health.inaccessibleProcessCount > 0
                      ? "text-amber-600 dark:text-amber-300"
                      : undefined
                  }
                />
                <DetailRow
                  label={translate("settings.diagnostics.host.sidecar")}
                  value={Option.match(snapshot.health.sidecarVersion, {
                    onNone: () => translate("settings.diagnostics.common.unavailable"),
                    onSome: (version) =>
                      `${version}${Option.match(snapshot.health.sidecarPid, {
                        onNone: () => "",
                        onSome: (pid) => ` · PID ${pid}`,
                      })}`,
                  })}
                />
                <DetailRow
                  label={translate("settings.diagnostics.host.restarts")}
                  value={translator.number(snapshot.health.restartCount)}
                />
              </>
            ) : (
              <div className="py-4 text-xs text-muted-foreground">
                {translate("settings.diagnostics.host.waitingHealth")}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title={translate("settings.diagnostics.timeline.title")}
        icon={<HardDriveIcon className="size-4 text-muted-foreground" />}
        headerAction={
          <div className="flex items-center gap-2">
            <HistoryWindowSelector selectedWindowMs={windowMs} onSelect={setWindowMs} />
            <Button
              size="icon-micro"
              variant="ghost"
              disabled={history.isPending}
              onClick={history.refresh}
              aria-label={translate("settings.diagnostics.history.refresh")}
            >
              <RefreshCwIcon className={cn("size-3", history.isPending && "animate-spin")} />
            </Button>
          </div>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_1px_rgb(0_0_0/0.03)]">
          {history.error ? (
            <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive sm:px-5">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{history.error}</span>
            </div>
          ) : null}
          <ResourceHistoryChart buckets={history.data?.buckets ?? []} />
          <HistoryProcessTable processes={history.data?.topProcesses ?? []} />
        </div>
      </SettingsSection>

      <SettingsSection
        title={translate("settings.diagnostics.timeline.liveTree")}
        icon={<CpuIcon className="size-4 text-muted-foreground" />}
        headerAction={
          snapshot ? (
            <span className="text-[10px] text-muted-foreground/55">
              {translate("settings.diagnostics.timeline.identity")}
            </span>
          ) : null
        }
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_1px_rgb(0_0_0/0.03)]">
          <ProcessTable
            processes={snapshot?.processes ?? []}
            signalingKeys={signalingKeys}
            onSignal={signalProcess}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title={translate("settings.diagnostics.attribution.title")}
        icon={<DatabaseIcon className="size-4 text-muted-foreground" />}
        headerAction={
          <span className="text-[10px] text-muted-foreground/55">
            {translate("settings.diagnostics.attribution.logical")}
          </span>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_1px_rgb(0_0_0/0.03)]">
          <div className="bg-muted/15 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground sm:px-5">
            {translate("settings.diagnostics.attribution.description")}
          </div>
          <AttributionTable entries={snapshot?.attribution.entries ?? []} />
        </div>
      </SettingsSection>
    </>
  );
}
