import type {
  HostPowerThermalState,
  ResourceTelemetryIoSemantics,
  ResourceTelemetryProcess,
  ResourceTelemetryProcessCategory,
  ResourceTelemetrySourceStatus,
} from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

export function resourceTelemetryCategoryMessageKey(
  category: ResourceTelemetryProcessCategory,
): InterfaceMessageKey {
  switch (category) {
    case "server":
      return "settings.diagnostics.process.category.server";
    case "server-child":
      return "settings.diagnostics.process.category.serverChild";
    case "provider-root":
      return "settings.diagnostics.process.category.provider";
    case "terminal-root":
      return "settings.diagnostics.process.category.terminal";
    case "electron-main":
      return "settings.diagnostics.process.category.electronMain";
    case "electron-renderer":
      return "settings.diagnostics.process.category.renderer";
    case "electron-gpu":
      return "settings.diagnostics.process.category.gpu";
    case "electron-utility":
      return "settings.diagnostics.process.category.electronUtility";
    case "resource-monitor":
      return "settings.diagnostics.process.category.monitor";
    case "unknown-t3":
      return "settings.diagnostics.process.category.t3";
  }
}

export function resourceTelemetryIoSemanticsMessageKey(
  semantics: ResourceTelemetryIoSemantics,
): InterfaceMessageKey {
  switch (semantics) {
    case "storage":
      return "settings.diagnostics.io.storage";
    case "logical":
      return "settings.diagnostics.io.logical";
    case "all-io":
      return "settings.diagnostics.io.all";
    case "unavailable":
      return "settings.diagnostics.common.unavailable";
  }
}

export function resourceTelemetrySourceStatusMessageKey(
  status: ResourceTelemetrySourceStatus,
): InterfaceMessageKey {
  switch (status) {
    case "starting":
      return "settings.diagnostics.source.starting";
    case "healthy":
      return "settings.diagnostics.source.healthy";
    case "degraded":
      return "settings.diagnostics.source.degraded";
    case "unavailable":
      return "settings.diagnostics.common.unavailable";
    case "stopped":
      return "settings.diagnostics.source.stopped";
  }
}

export function resourceTelemetryThermalMessageKey(
  state: HostPowerThermalState,
): InterfaceMessageKey {
  switch (state) {
    case "unknown":
      return "settings.diagnostics.common.unknown";
    case "nominal":
      return "settings.diagnostics.thermal.nominal";
    case "fair":
      return "settings.diagnostics.thermal.fair";
    case "serious":
      return "settings.diagnostics.thermal.serious";
    case "critical":
      return "settings.diagnostics.thermal.critical";
  }
}

function processIdentityKey(process: ResourceTelemetryProcess): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

export function visibleResourceTelemetryProcesses(
  processes: ReadonlyArray<ResourceTelemetryProcess>,
  collapsed: ReadonlySet<string>,
): ReadonlyArray<ResourceTelemetryProcess> {
  const childrenByParent = new Map<number, ResourceTelemetryProcess[]>();
  for (const process of processes) {
    const children = childrenByParent.get(process.ppid) ?? [];
    children.push(process);
    childrenByParent.set(process.ppid, children);
  }

  const hidden = new Set<string>();
  const hideDescendants = (pid: number): void => {
    for (const child of childrenByParent.get(pid) ?? []) {
      const key = processIdentityKey(child);
      if (hidden.has(key)) continue;
      hidden.add(key);
      hideDescendants(child.identity.pid);
    }
  };
  for (const process of processes) {
    if (collapsed.has(processIdentityKey(process))) {
      hideDescendants(process.identity.pid);
    }
  }
  return processes.filter((process) => !hidden.has(processIdentityKey(process)));
}

export function shouldShowResourceMonitorRetry(input: {
  readonly nativeStatus: ResourceTelemetrySourceStatus | null;
  readonly error: string | null;
}): boolean {
  return (
    (input.nativeStatus === null && input.error !== null) ||
    input.nativeStatus === "degraded" ||
    input.nativeStatus === "unavailable" ||
    input.nativeStatus === "stopped"
  );
}

export function resourceHistoryBarHeight(input: {
  readonly value: number;
  readonly max: number;
  readonly minimumVisiblePercent: number;
}): number {
  if (input.value <= 0) return 0;
  return Math.max(input.minimumVisiblePercent, (input.value / Math.max(1, input.max)) * 100);
}

export function resourceHistoryCpuScaleMax(
  buckets: ReadonlyArray<{ readonly avgCpuPercent: number }>,
): number {
  return Math.max(1, ...buckets.map((bucket) => bucket.avgCpuPercent));
}
