import type {
  McpMutationResult,
  McpProviderCapability,
  ProviderInstanceId,
} from "@t3tools/contracts";

const MAX_SEARCH_VALUE_LENGTH = 512;
const SEARCH_KEYS = ["environment", "provider", "thread", "runtime", "server"] as const;

export interface McpMutationToastPresentation {
  readonly type: "success" | "info";
  readonly title: string;
  readonly description: string;
}

export function mcpMutationToastPresentation(
  result: McpMutationResult,
  successTitle: string,
): McpMutationToastPresentation {
  if (result.liveApplyResults.length === 0) {
    return {
      type: "info",
      title: `${successTitle} — applies to the next session`,
      description: "No matching live runtime required an update.",
    };
  }

  const counts = new Map<string, { readonly label: string; readonly count: number }>();
  for (const entry of result.liveApplyResults) {
    const provider = entry.providerInstanceId ? String(entry.providerInstanceId) : "Provider";
    const outcome =
      entry.outcome === "applied"
        ? "updated now"
        : entry.outcome === "pending-next-session"
          ? "next session"
          : entry.outcome;
    const key = `${provider}\u0000${outcome}`;
    const current = counts.get(key);
    counts.set(key, { label: `${provider}: ${outcome}`, count: (current?.count ?? 0) + 1 });
  }
  const descriptions = [...counts.values()].map(({ label, count }) =>
    count === 1 ? label : `${label} (${count} runtimes)`,
  );
  const hasFailed = result.liveApplyResults.some((entry) => entry.outcome === "failed");
  const hasPending = result.liveApplyResults.some(
    (entry) => entry.outcome === "pending-next-session",
  );
  const hasUnsupported = result.liveApplyResults.some((entry) => entry.outcome === "unsupported");
  return {
    type: hasFailed || hasPending || hasUnsupported ? "info" : "success",
    title: hasFailed
      ? `${successTitle} — some live updates failed`
      : hasPending
        ? `${successTitle} — some changes apply next session`
        : hasUnsupported
          ? `${successTitle} — live update unsupported`
          : `${successTitle} — updated live`,
    description: `${descriptions.join(" · ")}.`,
  };
}

export interface McpSettingsSearch {
  readonly environment?: string;
  readonly provider?: string;
  readonly thread?: string;
  readonly runtime?: string;
  readonly server?: string;
}

export function normalizeMcpSettingsSearch(input: Record<string, unknown>): McpSettingsSearch {
  const entries = SEARCH_KEYS.flatMap((key) => {
    const value = input[key];
    if (typeof value !== "string") return [];
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > MAX_SEARCH_VALUE_LENGTH) return [];
    return [[key, normalized] as const];
  });
  return Object.fromEntries(entries);
}

interface ProviderTabSource {
  readonly instanceId: ProviderInstanceId | string;
  readonly driver: string;
  readonly displayName?: string | undefined;
  readonly accentColor?: string | undefined;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly availability?: string | undefined;
  readonly status?: "ready" | "warning" | "error" | "disabled" | undefined;
  readonly mcpCapability?: McpProviderCapability | undefined;
  readonly auth?:
    | {
        readonly label?: string | undefined;
        readonly email?: string | undefined;
      }
    | undefined;
}

export interface McpProviderTab {
  readonly instanceId: string;
  readonly driver: string;
  readonly label: string;
  readonly displayName: string;
  readonly tooltip: string;
  readonly accentColor?: string;
  readonly disabled: boolean;
  readonly supportsUserMcp: boolean;
  readonly statusLabel: string;
  readonly statusTone: "success" | "warning" | "danger" | "neutral";
  readonly account?: string;
}

const DRIVER_LABELS: Readonly<Record<string, string>> = {
  codex: "Codex",
  claudeAgent: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
};

function providerDisplayName(provider: ProviderTabSource): string {
  return provider.displayName?.trim() || DRIVER_LABELS[provider.driver] || provider.driver;
}

function shortInstanceLabel(instanceId: string): string {
  if (instanceId.length <= 24) return instanceId;
  return `${instanceId.slice(0, 12)}…${instanceId.slice(-8)}`;
}

function providerStatus(
  provider: ProviderTabSource,
): Pick<McpProviderTab, "statusLabel" | "statusTone"> {
  if (!provider.installed || provider.availability === "unavailable") {
    return { statusLabel: "Unavailable", statusTone: "neutral" };
  }
  if (!provider.enabled || provider.status === "disabled") {
    return { statusLabel: "Disabled", statusTone: "neutral" };
  }
  switch (provider.status) {
    case "error":
      return { statusLabel: "Error", statusTone: "danger" };
    case "warning":
      return { statusLabel: "Warning", statusTone: "warning" };
    case "ready":
    default:
      return { statusLabel: "Ready", statusTone: "success" };
  }
}

export function deriveMcpProviderTabs(
  providers: ReadonlyArray<ProviderTabSource>,
): ReadonlyArray<McpProviderTab> {
  const displayNames = providers.map(providerDisplayName);
  const counts = new Map<string, number>();
  for (const name of displayNames) counts.set(name, (counts.get(name) ?? 0) + 1);

  return providers.map((provider, index) => {
    const displayName = displayNames[index] ?? provider.driver;
    const instanceId = String(provider.instanceId);
    const driverLabel = DRIVER_LABELS[provider.driver] ?? provider.driver;
    const status = providerStatus(provider);
    const account = provider.auth?.email?.trim() || provider.auth?.label?.trim();
    return {
      instanceId,
      driver: provider.driver,
      displayName,
      label:
        counts.get(displayName) === 1
          ? displayName
          : `${displayName} · ${shortInstanceLabel(instanceId)}`,
      tooltip: `${displayName} · ${driverLabel} · ${instanceId}`,
      ...(provider.accentColor ? { accentColor: provider.accentColor } : {}),
      disabled: !provider.enabled || !provider.installed || provider.availability === "unavailable",
      supportsUserMcp: provider.mcpCapability !== "unsupported",
      ...status,
      ...(account ? { account } : {}),
    };
  });
}

interface ProviderRoutingSource {
  readonly enabled: boolean;
  readonly providerRouting?:
    | { readonly mode: "all" }
    | {
        readonly mode: "selected";
        readonly instanceIds: ReadonlyArray<ProviderInstanceId | string>;
      };
}

export function isMcpServerEnabledForProvider(
  server: ProviderRoutingSource,
  instanceId: ProviderInstanceId | string,
): boolean {
  if (!server.enabled) return false;
  if (!server.providerRouting || server.providerRouting.mode === "all") return true;
  return server.providerRouting.instanceIds.some((candidate) => candidate === instanceId);
}

export type McpRuntimeState =
  | "not-started"
  | "starting"
  | "connected"
  | "auth-required"
  | "setup-required"
  | "failed"
  | "disabled"
  | "unsupported"
  | "unknown"
  | "stale";

export type McpRuntimeTone = "success" | "warning" | "danger" | "neutral";

const RUNTIME_PRESENTATION: Readonly<
  Record<McpRuntimeState, { readonly label: string; readonly tone: McpRuntimeTone }>
> = {
  "not-started": { label: "Not started", tone: "neutral" },
  starting: { label: "Starting", tone: "warning" },
  connected: { label: "Connected", tone: "success" },
  "auth-required": { label: "Authorization required", tone: "warning" },
  "setup-required": { label: "Setup required", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  disabled: { label: "Disabled", tone: "neutral" },
  unsupported: { label: "Status not reported", tone: "neutral" },
  unknown: { label: "Status unknown", tone: "neutral" },
  stale: { label: "Status may be outdated", tone: "warning" },
};

export function runtimeStatePresentation(state: McpRuntimeState) {
  return RUNTIME_PRESENTATION[state];
}
