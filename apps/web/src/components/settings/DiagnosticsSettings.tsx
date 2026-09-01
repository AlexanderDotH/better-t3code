import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderOpenIcon,
  InfoIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ServerProcessDiagnosticsEntry,
  ServerProcessResourceHistorySummary,
  ServerProcessSignal,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import type { InterfaceMessageKey, InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import { formatRelativeTimeLabel, getRelativeTimeState } from "../../timestampFormat";
import { useEnvironmentQuery } from "../../state/query";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerObservabilityAtom,
  serverEnvironment,
} from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { usePrimaryEnvironment } from "../../state/environments";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { ResourceTelemetryDiagnostics } from "./ResourceTelemetryDiagnostics";
import { SettingsPageContainer, SettingsSection, useRelativeTimeTick } from "./settingsLayout";
import { useAtomCommand } from "../../state/use-atom-command";

function formatCount(value: number, translator: InterfaceTranslator): string {
  return translator.number(value);
}

function formatDuration(value: number, translator: InterfaceTranslator): string {
  if (value < 1_000) return `${translator.number(Math.round(value))} ms`;
  return `${translator.number(value / 1_000, { maximumFractionDigits: value >= 10_000 ? 1 : 2 })} s`;
}

function formatBytes(value: number, translator: InterfaceTranslator): string {
  if (value < 1024) return `${translator.number(value)} B`;
  const units = ["KB", "MB", "GB"] as const;
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${translator.number(next, { maximumFractionDigits: next >= 10 ? 1 : 2 })} ${units[unitIndex]}`;
}

function formatRelative(
  value: DateTime.Utc | null,
  translate: InterfaceTranslator["message"],
): string {
  if (!value) return translate("settings.diagnostics.trace.noSpans");
  return formatRelativeTimeLabel(DateTime.formatIso(value));
}

function formatRelativeNoWrap(
  value: DateTime.Utc | null,
  translate: InterfaceTranslator["message"],
): string {
  return formatRelative(value, translate).replaceAll(" ", "\u00a0");
}

function shortenTraceId(traceId: string): string {
  if (traceId.length <= 32) return traceId;
  return `${traceId.slice(0, 18)}...${traceId.slice(-10)}`;
}

function isStaleProcessSignalMessage(message: string | undefined): boolean {
  return message?.includes("not a live descendant") ?? false;
}

function StatBlock({
  label,
  value,
  tooltip,
  tone = "default",
}: {
  label: string;
  value: string;
  tooltip?: ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <div className="min-w-0 border-border/60 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        <span className="min-w-0 truncate">{label}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="cursor-pointer inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground"
                  aria-label={translate("settings.diagnostics.common.details", { label })}
                >
                  <InfoIcon className="size-3" />
                </button>
              }
            />
            <TooltipPopup
              side="top"
              className="max-w-[min(300px,calc(100vw-2rem))] whitespace-normal text-left text-[11px] leading-relaxed text-wrap"
            >
              {tooltip}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-lg font-semibold tabular-nums text-foreground",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatsGrid({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid grid-cols-2 sm:grid-cols-4">
      <span
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border/60"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border/60 sm:hidden"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-1/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-3/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      {children}
    </div>
  );
}

function EmptyRows({ label }: { label: string }) {
  return <div className="px-4 py-4 text-xs text-muted-foreground sm:px-5">{label}</div>;
}

function ExpandableText({
  text,
  className,
  collapsedClassName = "line-clamp-3",
  expandLabel,
}: {
  text: string;
  className?: string;
  collapsedClassName?: string;
  expandLabel?: string;
}) {
  const translate = useInterfaceTranslator().message;
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.length > 180 || text.includes("\n");

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "whitespace-pre-wrap break-words",
          !expanded && canExpand ? collapsedClassName : null,
        )}
      >
        {text}
      </div>
      {canExpand ? (
        <button
          type="button"
          className="cursor-pointer mt-1 text-[11px] font-medium text-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? translate("settings.diagnostics.common.showLess")
            : (expandLabel ?? translate("settings.diagnostics.common.showFullError"))}
        </button>
      ) : null}
    </div>
  );
}

function DiagnosticsTable({
  headers,
  children,
  minTableWidth = "min-w-[640px]",
  columnWidths,
}: {
  headers: ReadonlyArray<string>;
  children: ReactNode;
  minTableWidth?: string;
  columnWidths?: ReadonlyArray<string>;
}) {
  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="w-full max-w-full rounded-none"
    >
      <table
        className={cn("w-full text-left text-xs", minTableWidth, columnWidths && "table-fixed")}
      >
        {columnWidths ? (
          <colgroup>
            {headers.map((header, index) => (
              <col key={header} className={columnWidths[index]} />
            ))}
          </colgroup>
        ) : null}
        <thead className="border-b border-border/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            {headers.map((header, index) => (
              <th
                key={header}
                className={cn(
                  "whitespace-nowrap px-4 py-2.5 font-semibold first:sm:pl-5 last:sm:pr-5",
                  !columnWidths && index === headers.length - 1 && "w-px",
                )}
              >
                {header.replaceAll(" ", "\u00a0")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </ScrollArea>
  );
}

function TraceIdCell({ traceId }: { traceId: string }) {
  const translate = useInterfaceTranslator().message;
  const { copyToClipboard, isCopied: copied } = useCopyToClipboard({
    target: "trace ID",
    timeout: 1_200,
  });

  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {shortenTraceId(traceId)}
            </span>
          }
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(520px,calc(100vw-2rem))] break-all font-mono text-[11px]"
        >
          {traceId}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={
                copied
                  ? translate("settings.diagnostics.common.copiedTraceId")
                  : translate("settings.diagnostics.common.copyTraceId")
              }
              onClick={() => copyToClipboard(traceId)}
            >
              <CopyIcon className="size-3" />
            </Button>
          }
        />
        <TooltipPopup side="top">
          {copied
            ? translate("settings.diagnostics.common.copied")
            : translate("settings.diagnostics.common.copyFullTraceId")}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function formatProcessName(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0];
  if (!firstToken) return command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function processTypeMessageKey(process: ServerProcessDiagnosticsEntry): InterfaceMessageKey {
  if (process.depth > 0) return "settings.diagnostics.process.type.subprocess";
  if (/\b(codex|claude|opencode|cursor)\b/i.test(process.command)) {
    return "settings.diagnostics.process.type.agent";
  }
  return "settings.diagnostics.process.type.process";
}

function ProcessNameCell({
  process,
  isExpanded,
  onToggle,
}: {
  process: ServerProcessDiagnosticsEntry;
  isExpanded: boolean;
  onToggle: (pid: number) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const name = formatProcessName(process.command);
  const hasChildren = process.childPids.length > 0;
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(process.depth, 6) * 10}px` }}
    >
      {hasChildren ? (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={translate(
            isExpanded
              ? "settings.diagnostics.process.collapse"
              : "settings.diagnostics.process.expand",
            { name },
          )}
          onClick={() => onToggle(process.pid)}
        >
          <ChevronIcon className="size-3.5" />
        </Button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden="true" />
      )}
      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500/80" />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
        >
          {process.command}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessSignalActions({
  process,
  isSignaling,
  onSignal,
}: {
  process: ServerProcessDiagnosticsEntry;
  isSignaling: boolean;
  onSignal: (pid: number, signal: ServerProcessSignal) => void;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={isSignaling}
              className="cursor-pointer text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onSignal(process.pid, "SIGINT")}
            >
              {translate("settings.diagnostics.signal.intShort")}
            </button>
          }
        />
        <TooltipPopup side="top">{translate("settings.diagnostics.signal.sendInt")}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={isSignaling}
              className="cursor-pointer text-[11px] font-medium text-destructive underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onSignal(process.pid, "SIGKILL")}
            >
              {translate("settings.diagnostics.signal.killShort")}
            </button>
          }
        />
        <TooltipPopup side="top">{translate("settings.diagnostics.signal.sendKill")}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessDiagnosticsTable({
  processes,
  signalingPid,
  onSignal,
  emptyLabel,
}: {
  processes: ReadonlyArray<ServerProcessDiagnosticsEntry>;
  signalingPid: number | null;
  onSignal: (pid: number, signal: ServerProcessSignal) => void;
  emptyLabel?: string;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const [collapsedPids, setCollapsedPids] = useState<ReadonlySet<number>>(() => new Set());
  const visibleProcesses = useMemo(() => {
    const visible: ServerProcessDiagnosticsEntry[] = [];
    let hiddenChildDepth: number | null = null;

    for (const process of processes) {
      if (hiddenChildDepth !== null) {
        if (process.depth > hiddenChildDepth) continue;
        hiddenChildDepth = null;
      }

      visible.push(process);
      if (collapsedPids.has(process.pid)) {
        hiddenChildDepth = process.depth;
      }
    }

    return visible;
  }, [collapsedPids, processes]);

  const toggleProcess = useCallback((pid: number) => {
    setCollapsedPids((previous) => {
      const next = new Set(previous);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  }, []);

  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="max-h-[min(64vh,44rem)] w-full max-w-full rounded-none border-t border-border/60"
    >
      <table className="w-full min-w-[1040px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[33%]" />
          <col className="w-[8%]" />
          <col className="w-[11%]" />
          <col className="w-[6%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">
              {translate("settings.diagnostics.table.name")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.cpu")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.memory")}
            </th>
            <th className="px-3 py-2 font-semibold">
              {translate("settings.diagnostics.table.command")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.pid")}
            </th>
            <th className="px-3 py-2 font-semibold">
              {translate("settings.diagnostics.table.type")}
            </th>
            <th className="p-2 text-right font-semibold sm:pr-4">
              {translate("settings.diagnostics.table.kill")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {visibleProcesses.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                {emptyLabel ?? translate("settings.diagnostics.live.empty")}
              </td>
            </tr>
          ) : null}
          {visibleProcesses.map((process) => (
            <tr key={process.pid} className="hover:bg-muted/20">
              <td className="px-4 py-2 align-middle sm:pl-5">
                <ProcessNameCell
                  process={process}
                  isExpanded={!collapsedPids.has(process.pid)}
                  onToggle={toggleProcess}
                />
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {process.cpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {formatBytes(process.rssBytes, translator)}
              </td>
              <td className="px-3 py-2 align-middle text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="block truncate">{process.command}</span>}
                  />
                  <TooltipPopup
                    side="top"
                    className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
                  >
                    {process.command}
                  </TooltipPopup>
                </Tooltip>
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground">
                {process.pid}
              </td>
              <td className="truncate px-3 py-2 align-middle text-muted-foreground">
                {translate(processTypeMessageKey(process))}
              </td>
              <td className="p-2 align-middle sm:pr-4">
                <ProcessSignalActions
                  process={process}
                  isSignaling={signalingPid === process.pid}
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

const RESOURCE_HISTORY_WINDOWS = [
  {
    messageKey: "settings.diagnostics.window.fiveMinutes",
    windowMs: 5 * 60_000,
    bucketMs: 30_000,
  },
  {
    messageKey: "settings.diagnostics.window.fifteenMinutes",
    windowMs: 15 * 60_000,
    bucketMs: 60_000,
  },
  {
    messageKey: "settings.diagnostics.window.thirtyMinutes",
    windowMs: 30 * 60_000,
    bucketMs: 2 * 60_000,
  },
  {
    messageKey: "settings.diagnostics.window.oneHour",
    windowMs: 60 * 60_000,
    bucketMs: 5 * 60_000,
  },
] as const;

function formatCpuTime(seconds: number, translator: InterfaceTranslator): string {
  if (seconds < 60) {
    return `${translator.number(seconds, { maximumFractionDigits: seconds >= 10 ? 1 : 2 })}s`;
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${translator.number(minutes, { maximumFractionDigits: minutes >= 10 ? 1 : 2 })}m`;
  }
  return `${translator.number(minutes / 60, { maximumFractionDigits: 2 })}h`;
}

function formatShortProcessName(command: string): string {
  const name = formatProcessName(command);
  return name.length > 42 ? `${name.slice(0, 39)}...` : name;
}

function ResourceHistoryProcessNameCell({
  process,
  visualDepth,
}: {
  process: ServerProcessResourceHistorySummary;
  visualDepth: number;
}) {
  const translate = useInterfaceTranslator().message;
  const name = formatShortProcessName(process.command);

  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(visualDepth, 6) * 10}px` }}
      aria-label={translate(
        process.isServerRoot
          ? "settings.diagnostics.process.rootAria"
          : "settings.diagnostics.process.childAria",
        { name },
      )}
    >
      <span className="size-5 shrink-0" aria-hidden="true" />
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          process.isServerRoot ? "bg-amber-500/90" : "bg-emerald-500/80",
        )}
      />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
        >
          {process.command}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessResourceHistoryChart({
  buckets,
}: {
  buckets: ReadonlyArray<{
    readonly startedAt: DateTime.Utc;
    readonly avgCpuPercent: number;
    readonly maxCpuPercent: number;
  }>;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const maxCpuPercent = Math.max(1, ...buckets.map((bucket) => bucket.maxCpuPercent));

  return (
    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
      <div className="flex h-28 items-end gap-1 overflow-hidden rounded-sm bg-muted/10 p-2">
        {buckets.map((bucket) => {
          const peakHeight = Math.max(2, (bucket.maxCpuPercent / maxCpuPercent) * 100);
          const averageHeight = Math.max(2, (bucket.avgCpuPercent / maxCpuPercent) * 100);
          return (
            <Tooltip key={DateTime.formatIso(bucket.startedAt)}>
              <TooltipTrigger
                render={
                  <div className="flex h-full min-w-1 flex-1 items-end">
                    <div
                      className="relative h-full w-full"
                      aria-label={translate("settings.diagnostics.history.averagePeakAria", {
                        average: translator.number(bucket.avgCpuPercent, {
                          maximumFractionDigits: 1,
                        }),
                        peak: translator.number(bucket.maxCpuPercent, { maximumFractionDigits: 1 }),
                      })}
                    >
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/15 transition-colors"
                        style={{ height: `${peakHeight}%` }}
                      />
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/60 transition-colors"
                        style={{ height: `${averageHeight}%` }}
                      />
                    </div>
                  </div>
                }
              />
              <TooltipPopup side="top">
                {translate("settings.diagnostics.history.averagePeak", {
                  average: translator.number(bucket.avgCpuPercent, { maximumFractionDigits: 1 }),
                  peak: translator.number(bucket.maxCpuPercent, { maximumFractionDigits: 1 }),
                })}
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function ResourceHistoryWindowSelector({
  selectedWindowMs,
  onSelect,
}: {
  selectedWindowMs: number;
  onSelect: (windowMs: number) => void;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <div className="flex items-center rounded-md border border-border/60 p-0.5">
      {RESOURCE_HISTORY_WINDOWS.map((option) => (
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

function ProcessResourceHistoryTable({
  processes,
  emptyLabel,
}: {
  processes: ReadonlyArray<ServerProcessResourceHistorySummary>;
  emptyLabel: string;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const shallowestChildDepth = processes.reduce<number | null>((minDepth, process) => {
    if (process.isServerRoot) return minDepth;
    return minDepth === null ? process.depth : Math.min(minDepth, process.depth);
  }, null);

  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="max-h-[min(64vh,44rem)] w-full max-w-full border-t border-border/60"
    >
      <table className="w-full min-w-[980px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[16%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">
              {translate("settings.diagnostics.table.process")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.cpuTime")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.current")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.average")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.peak")}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {translate("settings.diagnostics.table.maxMemory")}
            </th>
            <th className="px-3 py-2 font-semibold">
              {translate("settings.diagnostics.table.command")}
            </th>
            <th className="px-3 py-2 text-right font-semibold sm:pr-5">
              {translate("settings.diagnostics.table.pid")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {processes.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                {emptyLabel}
              </td>
            </tr>
          ) : null}
          {processes.map((process) => (
            <tr key={process.processKey} className="hover:bg-muted/20">
              <td className="px-4 py-2 align-middle sm:pl-5">
                <ResourceHistoryProcessNameCell
                  process={process}
                  visualDepth={
                    process.isServerRoot || shallowestChildDepth === null
                      ? 0
                      : Math.max(1, process.depth - shallowestChildDepth + 1)
                  }
                />
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {formatCpuTime(process.cpuSecondsApprox, translator)}
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {process.currentCpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {process.avgCpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {process.maxCpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                {formatBytes(process.maxRssBytes, translator)}
              </td>
              <td className="px-3 py-2 align-middle text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="block truncate">{process.command}</span>}
                  />
                  <TooltipPopup
                    side="top"
                    className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
                  >
                    {process.command}
                  </TooltipPopup>
                </Tooltip>
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground sm:pr-5">
                {process.pid}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function DiagnosticsLastChecked({ checkedAt }: { checkedAt: DateTime.Utc | null }) {
  const translate = useInterfaceTranslator().message;
  useRelativeTimeTick();
  const relative = getRelativeTimeState(checkedAt ? DateTime.formatIso(checkedAt) : null);

  if (relative.status === "missing") {
    return (
      <span className="text-[11px] text-muted-foreground/50">
        {translate("settings.diagnostics.common.checking")}
      </span>
    );
  }

  if (relative.status === "invalid") {
    return (
      <span className="text-[11px] text-muted-foreground/50">
        {translate("settings.diagnostics.common.checkedUnavailable")}
      </span>
    );
  }

  return (
    <span className="text-[11px] text-muted-foreground/60">
      {translate("settings.diagnostics.common.checked", {
        value: relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value,
      })}
    </span>
  );
}

function DiagnosticsRefreshButton({
  isPending,
  label,
  onClick,
}: {
  isPending: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            disabled={isPending}
            onClick={onClick}
            aria-label={label}
          >
            <RefreshCwIcon className={cn("size-3", isPending && "animate-spin")} />
          </Button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function DiagnosticsSettingsPanel() {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const observability = useAtomValue(primaryServerObservabilityAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const signalServerProcess = useAtomCommand(serverEnvironment.signalProcess, {
    reportFailure: false,
  });
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  const [resourceWindowMs, setResourceWindowMs] = useState(15 * 60_000);
  const selectedResourceWindow =
    RESOURCE_HISTORY_WINDOWS.find((option) => option.windowMs === resourceWindowMs) ??
    RESOURCE_HISTORY_WINDOWS[1];
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.traceDiagnostics({ environmentId, input: {} }),
  );
  const {
    data: processData,
    error: processError,
    isPending: isProcessPending,
    refresh: refreshProcesses,
  } = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.processDiagnostics({ environmentId, input: {} }),
  );
  const {
    data: resourceData,
    error: resourceError,
    isPending: isResourcePending,
    refresh: refreshResources,
  } = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.processResourceHistory({
          environmentId,
          input: {
            windowMs: selectedResourceWindow.windowMs,
            bucketMs: selectedResourceWindow.bucketMs,
          },
        }),
  );
  const [isOpeningLogsDirectory, setIsOpeningLogsDirectory] = useState(false);
  const [openLogsDirectoryError, setOpenLogsDirectoryError] = useState<string | null>(null);
  const [signalingPid, setSignalingPid] = useState<number | null>(null);
  const signalingPidRef = useRef<number | null>(null);
  const environmentIdRef = useRef(environmentId);
  const processDataRef = useRef(processData);
  environmentIdRef.current = environmentId;
  processDataRef.current = processData;

  const openLogsDirectory = useCallback(() => {
    const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
    if (!logsDirectoryPath) return;

    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenLogsDirectoryError(translate("settings.diagnostics.trace.noEditors"));
      return;
    }
    if (environmentId === null) {
      setOpenLogsDirectoryError(translate("settings.diagnostics.trace.noEnvironment"));
      return;
    }

    setIsOpeningLogsDirectory(true);
    setOpenLogsDirectoryError(null);
    void (async () => {
      const result = await openInEditor({
        environmentId,
        input: {
          cwd: logsDirectoryPath,
          editor,
        },
      });
      setIsOpeningLogsDirectory(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setOpenLogsDirectoryError(
          error instanceof Error
            ? error.message
            : translate("settings.diagnostics.trace.openLogsFailed"),
        );
      }
    })();
  }, [availableEditors, environmentId, observability?.logsDirectoryPath, openInEditor, translate]);

  const isInitialLoading = isPending && data === null;
  const isProcessInitialLoading = isProcessPending && processData === null;
  const signalProcess = useCallback(
    async (pid: number, signal: ServerProcessSignal) => {
      if (signalingPidRef.current !== null) return;
      signalingPidRef.current = pid;
      setSignalingPid(pid);
      const clearSignaling = () => {
        signalingPidRef.current = null;
        setSignalingPid(null);
      };
      if (signal === "SIGKILL") {
        let confirmed = false;
        try {
          confirmed = await ensureLocalApi().dialogs.confirm(
            translate("settings.diagnostics.signal.confirmKill", { pid }),
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
      const currentEnvironmentId = environmentIdRef.current;
      if (currentEnvironmentId === null) {
        clearSignaling();
        return;
      }
      const process = processDataRef.current?.processes.find((entry) => entry.pid === pid);
      if (process === undefined) {
        clearSignaling();
        return;
      }

      try {
        const result = await signalServerProcess({
          environmentId: currentEnvironmentId,
          input: { pid, startTimeMs: process.startTimeMs, signal },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add({
              type: "error",
              title: translate("settings.diagnostics.signal.sendFailedTitle", { signal }),
              description:
                error instanceof Error
                  ? error.message
                  : translate("settings.diagnostics.signal.sendFailed", { signal }),
            });
          }
          return;
        }
        if (!result.value.signaled) {
          const message = Option.getOrUndefined(result.value.message);
          refreshProcesses();
          if (isStaleProcessSignalMessage(message)) {
            toastManager.add({
              type: "info",
              title: translate("settings.diagnostics.signal.alreadyExited"),
              description: translate("settings.diagnostics.signal.alreadyExitedDescription"),
            });
            return;
          }

          toastManager.add({
            type: "error",
            title: translate("settings.diagnostics.signal.sendFailedTitle", { signal }),
            description: message ?? translate("settings.diagnostics.signal.sendFailed", { signal }),
          });
          return;
        }
        refreshProcesses();
      } finally {
        clearSignaling();
      }
    },
    [refreshProcesses, signalServerProcess, translate],
  );

  const processDiagnosticsError = processData ? Option.getOrNull(processData.error) : null;
  const processResourceError = resourceData ? Option.getOrNull(resourceData.error) : null;
  const traceDiagnosticsError = data ? Option.getOrNull(data.error) : null;
  const traceDiagnosticsPartialFailure = data
    ? Option.getOrElse(data.partialFailure, () => false)
    : false;

  return (
    <SettingsPageContainer width="expanded" className="gap-10">
      <ResourceTelemetryDiagnostics />

      <SettingsSection
        title={translate("settings.diagnostics.live.title")}
        headerAction={
          <div className="flex items-center gap-1.5">
            <DiagnosticsLastChecked checkedAt={processData?.readAt ?? null} />
            <DiagnosticsRefreshButton
              isPending={isProcessPending}
              label={translate("settings.diagnostics.live.refresh")}
              onClick={refreshProcesses}
            />
          </div>
        }
      >
        <StatsGrid>
          <StatBlock
            label={translate("settings.diagnostics.live.childProcesses")}
            value={processData ? formatCount(processData.processCount, translator) : "..."}
          />
          <StatBlock
            label={translate("settings.diagnostics.table.cpu")}
            value={
              processData
                ? `${translator.number(processData.totalCpuPercent, { maximumFractionDigits: 1 })}%`
                : "..."
            }
            tooltip={translate("settings.diagnostics.live.cpuTooltip")}
          />
          <StatBlock
            label={translate("settings.diagnostics.table.memory")}
            value={processData ? formatBytes(processData.totalRssBytes, translator) : "..."}
            tooltip={translate("settings.diagnostics.live.memoryTooltip")}
          />
          <StatBlock
            label={translate("settings.diagnostics.live.serverPid")}
            value={processData ? String(processData.serverPid) : "..."}
          />
        </StatsGrid>
        {processDiagnosticsError || processError ? (
          <div className="space-y-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            {processDiagnosticsError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{processDiagnosticsError.message}</span>
              </div>
            ) : null}
            {processError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{processError}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <ProcessDiagnosticsTable
          processes={processData?.processes ?? []}
          signalingPid={signalingPid}
          onSignal={signalProcess}
          emptyLabel={
            isProcessInitialLoading
              ? translate("settings.diagnostics.live.loading")
              : translate("settings.diagnostics.live.empty")
          }
        />
      </SettingsSection>

      <SettingsSection
        title={translate("settings.diagnostics.history.title")}
        headerAction={
          <div className="flex items-center gap-1.5">
            <ResourceHistoryWindowSelector
              selectedWindowMs={resourceWindowMs}
              onSelect={setResourceWindowMs}
            />
            <DiagnosticsLastChecked checkedAt={resourceData?.readAt ?? null} />
            <DiagnosticsRefreshButton
              isPending={isResourcePending}
              label={translate("settings.diagnostics.history.refresh")}
              onClick={refreshResources}
            />
          </div>
        }
      >
        <StatsGrid>
          <StatBlock
            label={translate("settings.diagnostics.table.cpuTime")}
            value={
              resourceData ? formatCpuTime(resourceData.totalCpuSecondsApprox, translator) : "..."
            }
            tooltip={translate("settings.diagnostics.history.cpuTimeTooltip")}
          />
          <StatBlock
            label={translate("settings.diagnostics.table.samples")}
            value={resourceData ? formatCount(resourceData.retainedSampleCount, translator) : "..."}
            tooltip={translate("settings.diagnostics.history.samplesTooltip")}
          />
          <StatBlock
            label={translate("settings.diagnostics.history.interval")}
            value={resourceData ? formatDuration(resourceData.sampleIntervalMs, translator) : "..."}
          />
          <StatBlock
            label={translate("settings.diagnostics.history.processes")}
            value={resourceData ? formatCount(resourceData.topProcesses.length, translator) : "..."}
          />
        </StatsGrid>
        {processResourceError || resourceError ? (
          <div className="space-y-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            {processResourceError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{processResourceError.message}</span>
              </div>
            ) : null}
            {resourceError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{resourceError}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <ProcessResourceHistoryChart buckets={resourceData?.buckets ?? []} />
        <ProcessResourceHistoryTable
          processes={resourceData?.topProcesses ?? []}
          emptyLabel={
            isResourcePending && resourceData === null
              ? translate("settings.diagnostics.history.collecting")
              : translate("settings.diagnostics.history.empty")
          }
        />
      </SettingsSection>

      <SettingsSection
        title={translate("settings.diagnostics.trace.title")}
        headerAction={
          <div className="flex items-center gap-1.5">
            <DiagnosticsLastChecked checkedAt={data?.readAt ?? null} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    disabled={!observability?.logsDirectoryPath || isOpeningLogsDirectory}
                    onClick={openLogsDirectory}
                    aria-label={translate("settings.diagnostics.trace.openLogs")}
                  >
                    <FolderOpenIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="top">
                {translate("settings.diagnostics.trace.openLogs")}
              </TooltipPopup>
            </Tooltip>
            <DiagnosticsRefreshButton
              isPending={isPending}
              label={translate("settings.diagnostics.trace.refresh")}
              onClick={refresh}
            />
          </div>
        }
      >
        <StatsGrid>
          <StatBlock
            label={translate("settings.diagnostics.trace.spans")}
            value={data ? formatCount(data.recordCount, translator) : "..."}
          />
          <StatBlock
            label={translate("settings.diagnostics.trace.failures")}
            value={data ? formatCount(data.failureCount, translator) : "..."}
            tone={data && data.failureCount > 0 ? "danger" : "default"}
          />
          <StatBlock
            label={translate("settings.diagnostics.trace.slowSpans")}
            value={data ? formatCount(data.slowSpanCount, translator) : "..."}
            tooltip={
              data
                ? translate("settings.diagnostics.trace.slowThreshold", {
                    duration: formatDuration(data.slowSpanThresholdMs, translator),
                  })
                : translate("settings.diagnostics.trace.slowThresholdDefault")
            }
            tone={data && data.slowSpanCount > 0 ? "warning" : "default"}
          />
          <StatBlock
            label={translate("settings.diagnostics.trace.parseErrors")}
            value={data ? formatCount(data.parseErrorCount, translator) : "..."}
            tone={data && data.parseErrorCount > 0 ? "warning" : "default"}
          />
        </StatsGrid>
        {openLogsDirectoryError || traceDiagnosticsError || error ? (
          <div className="space-y-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            {openLogsDirectoryError ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{openLogsDirectoryError}</span>
              </div>
            ) : null}
            {traceDiagnosticsError ? (
              <div
                className={cn(
                  "flex items-start gap-2",
                  traceDiagnosticsPartialFailure
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-destructive",
                )}
              >
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {traceDiagnosticsPartialFailure
                    ? translate("settings.diagnostics.trace.partialFailure", {
                        detail: traceDiagnosticsError.message,
                      })
                    : traceDiagnosticsError.message}
                </span>
              </div>
            ) : null}
            {error ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title={translate("settings.diagnostics.trace.latestFailures")}>
        {data && data.latestFailures.length > 0 ? (
          <DiagnosticsTable
            headers={[
              translate("settings.diagnostics.table.span"),
              translate("settings.diagnostics.table.cause"),
              translate("settings.diagnostics.table.duration"),
              translate("settings.diagnostics.table.ended"),
            ]}
          >
            {data.latestFailures.map((failure) => (
              <tr key={`${failure.traceId}:${failure.spanId}`}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {failure.name}
                </td>
                <td className="max-w-[360px] px-4 py-3 align-top text-muted-foreground">
                  <ExpandableText text={failure.cause} />
                </td>
                <td className="px-4 py-3 align-top font-mono tabular-nums">
                  {formatDuration(failure.durationMs, translator)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground last:sm:pr-5">
                  {formatRelativeNoWrap(failure.endedAt, translate)}
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows
            label={
              isInitialLoading
                ? translate("settings.diagnostics.trace.loadingFailures")
                : translate("settings.diagnostics.trace.noFailures")
            }
          />
        )}
      </SettingsSection>

      <SettingsSection title={translate("settings.diagnostics.trace.commonFailures")}>
        {data && data.commonFailures.length > 0 ? (
          <DiagnosticsTable
            headers={[
              translate("settings.diagnostics.table.span"),
              translate("settings.diagnostics.table.count"),
              translate("settings.diagnostics.table.cause"),
              translate("settings.diagnostics.table.lastSeen"),
            ]}
            minTableWidth="min-w-[760px]"
          >
            {data.commonFailures.map((failure) => (
              <tr key={`${failure.name}:${failure.cause}`}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {failure.name}
                </td>
                <td className="px-4 py-3 align-top font-mono tabular-nums">
                  {formatCount(failure.count, translator)}
                </td>
                <td className="max-w-[360px] px-4 py-3 align-top text-muted-foreground">
                  <ExpandableText text={failure.cause} />
                </td>
                <td className="w-px whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground last:sm:pr-5">
                  {formatRelativeNoWrap(failure.lastSeenAt, translate)}
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows
            label={
              isInitialLoading
                ? translate("settings.diagnostics.trace.loadingGroups")
                : translate("settings.diagnostics.trace.noGroups")
            }
          />
        )}
      </SettingsSection>

      <SettingsSection title={translate("settings.diagnostics.trace.slowestSpans")}>
        {data && data.slowestSpans.length > 0 ? (
          <DiagnosticsTable
            headers={[
              translate("settings.diagnostics.table.span"),
              translate("settings.diagnostics.table.duration"),
              translate("settings.diagnostics.table.ended"),
              translate("settings.diagnostics.table.trace"),
            ]}
            minTableWidth="min-w-[900px]"
            columnWidths={["w-[44%]", "w-[14%]", "w-[12%]", "w-[30%]"]}
          >
            {data.slowestSpans.map((span) => (
              <tr key={`${span.traceId}:${span.spanId}`}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {span.name}
                </td>
                <td className="px-4 py-3 align-top font-mono tabular-nums">
                  {formatDuration(span.durationMs, translator)}
                </td>
                <td className="w-px whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground">
                  {formatRelativeNoWrap(span.endedAt, translate)}
                </td>
                <td className="min-w-0 whitespace-nowrap px-4 py-3 align-top text-muted-foreground last:sm:pr-5">
                  <TraceIdCell traceId={span.traceId} />
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows
            label={
              isInitialLoading
                ? translate("settings.diagnostics.trace.loadingSlow")
                : translate("settings.diagnostics.trace.noSpans")
            }
          />
        )}
      </SettingsSection>

      <SettingsSection title={translate("settings.diagnostics.trace.spanLogs")}>
        {data && data.latestWarningAndErrorLogs.length > 0 ? (
          <ScrollArea
            chainVerticalScroll
            scrollFade
            hideScrollbars
            className="w-full max-w-full rounded-none"
          >
            <table className="w-full min-w-[920px] table-fixed text-left text-xs">
              <colgroup>
                <col className="w-[11%]" />
                <col className="w-[9%]" />
                <col className="w-[24%]" />
                <col className="w-[26%]" />
                <col className="w-[30%]" />
              </colgroup>
              <thead className="border-b border-border/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold sm:pl-5">
                    {translate("settings.diagnostics.table.time")}
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold">
                    {translate("settings.diagnostics.table.level")}
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold">
                    {translate("settings.diagnostics.table.span")}
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold">
                    {translate("settings.diagnostics.table.message")}
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 font-semibold sm:pr-5">
                    {translate("settings.diagnostics.table.trace")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.latestWarningAndErrorLogs.map((event) => (
                  <tr
                    key={`${event.traceId}:${event.spanId}:${DateTime.formatIso(event.seenAt)}:${event.message}`}
                    className="hover:bg-muted/15"
                  >
                    <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground sm:pl-5">
                      {formatRelativeNoWrap(event.seenAt, translate)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase text-foreground/80">
                        {event.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="truncate font-medium text-foreground">{event.spanName}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      <ExpandableText
                        collapsedClassName="line-clamp-2"
                        expandLabel={translate("settings.diagnostics.common.showFullMessage")}
                        text={event.message}
                      />
                    </td>
                    <td className="min-w-0 whitespace-nowrap px-4 py-3 align-top text-muted-foreground sm:pr-5">
                      <TraceIdCell traceId={event.traceId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        ) : (
          <EmptyRows
            label={
              isInitialLoading
                ? translate("settings.diagnostics.trace.loadingLogs")
                : translate("settings.diagnostics.trace.noLogs")
            }
          />
        )}
      </SettingsSection>

      <SettingsSection title={translate("settings.diagnostics.trace.topNames")}>
        {data && data.topSpansByCount.length > 0 ? (
          <DiagnosticsTable
            headers={[
              translate("settings.diagnostics.table.span"),
              translate("settings.diagnostics.table.count"),
              translate("settings.diagnostics.table.failures"),
              translate("settings.diagnostics.table.average"),
              translate("settings.diagnostics.table.max"),
            ]}
            minTableWidth="min-w-[760px]"
            columnWidths={["w-[48%]", "w-[13%]", "w-[13%]", "w-[13%]", "w-[13%]"]}
          >
            {data.topSpansByCount.map((span) => (
              <tr key={span.name}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {span.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums">
                  {formatCount(span.count, translator)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums">
                  {formatCount(span.failureCount, translator)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums">
                  {formatDuration(span.averageDurationMs, translator)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums last:sm:pr-5">
                  {formatDuration(span.maxDurationMs, translator)}
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows
            label={
              isInitialLoading
                ? translate("settings.diagnostics.trace.loadingNames")
                : translate("settings.diagnostics.trace.noSpans")
            }
          />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
