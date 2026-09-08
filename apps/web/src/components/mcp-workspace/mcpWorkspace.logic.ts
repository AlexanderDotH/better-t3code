import type {
  McpRuntimeSnapshot,
  McpServerDefinition,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";

import { deriveMcpManagementSummary } from "../mcp-management/mcpManagementSummary";
import { deriveMcpProviderTabs } from "../settings/McpServersSettings.logic";

export type McpWorkspaceState =
  | "live"
  | "configuration-only"
  | "disconnected"
  | "unsupported"
  | "upgrade-required";

export interface McpWorkspaceSummary {
  readonly attentionCount: number;
  readonly configuredCount: number;
  readonly connectedCount: number;
  readonly expectedCount: number;
  readonly freshnessLabel: string;
  readonly state: McpWorkspaceState;
  readonly statusLabel: string;
  readonly toolCount: number | null;
}

export interface McpWorkspaceProviderOption {
  readonly id: string;
  readonly label: string;
  readonly accentColor?: string;
}

export function deriveMcpWorkspaceProviderOptions(
  providers: readonly ServerProvider[],
): readonly McpWorkspaceProviderOption[] {
  return deriveMcpProviderTabs(providers).map((provider) => ({
    id: provider.instanceId,
    label: provider.label,
    ...(provider.accentColor ? { accentColor: provider.accentColor } : {}),
  }));
}

function enabledForProvider(
  server: McpServerDefinition,
  providerInstanceId: ProviderInstanceId | string | null,
): boolean {
  if (!server.enabled) return false;
  if (server.providerRouting.mode === "all") return true;
  if (providerInstanceId === null) return false;
  return server.providerRouting.instanceIds.some(
    (instanceId) => String(instanceId) === String(providerInstanceId),
  );
}

function appliesToProject(server: McpServerDefinition, projectCwd: string | null): boolean {
  if (server.scope === "global") return true;
  const normalizePath = (value: string | null | undefined) =>
    value?.trim().replaceAll("\\", "/").replace(/\/+$/u, "") || null;
  const serverCwd = normalizePath(server.projectCwd);
  const currentCwd = normalizePath(projectCwd);
  return serverCwd !== null && currentCwd !== null && serverCwd === currentCwd;
}

export function applicableMcpServerDefinitions(input: {
  readonly configuredServers: readonly McpServerDefinition[];
  readonly projectCwd: string | null;
  readonly providerInstanceId: ProviderInstanceId | string | null;
}): readonly McpServerDefinition[] {
  return input.configuredServers.filter(
    (server) =>
      enabledForProvider(server, input.providerInstanceId) &&
      appliesToProject(server, input.projectCwd),
  );
}

export function formatMcpWorkspaceFreshness(observedAt: string | null): string {
  if (observedAt === null) return "Not observed in this session";
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) return "Observation time unavailable";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "Observed just now";
  if (elapsed < 3_600_000) return `Observed ${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `Observed ${Math.floor(elapsed / 3_600_000)}h ago`;
  return `Observed ${Math.floor(elapsed / 86_400_000)}d ago`;
}

export function deriveMcpWorkspaceSummary(input: {
  readonly configuredServers: readonly McpServerDefinition[];
  readonly projectCwd: string | null;
  readonly providerInstanceId: ProviderInstanceId | string | null;
  readonly runtimeSnapshot: McpRuntimeSnapshot | null;
  readonly workspaceSupported: boolean;
}): McpWorkspaceSummary {
  const configuredCount = applicableMcpServerDefinitions(input).length;
  const summary = deriveMcpManagementSummary({
    applicableConfiguredCount: configuredCount,
    runtimeSupported: input.workspaceSupported,
    snapshot: input.runtimeSnapshot,
  });
  const runtimeUnavailable = summary.statusLabel.includes("runtime status unavailable");
  const state: McpWorkspaceState = !input.workspaceSupported
    ? "upgrade-required"
    : input.providerInstanceId === null
      ? "configuration-only"
      : summary.mode === "next-session"
        ? "disconnected"
        : runtimeUnavailable
          ? "unsupported"
          : "live";
  const statusLabel =
    input.providerInstanceId === null
      ? `${configuredCount} configured · configuration only`
      : summary.mode === "live" && summary.attentionCount > 0
        ? `${summary.connectedCount} of ${summary.expectedCount} connected · ${summary.attentionCount} needs attention`
        : summary.mode === "live" && !runtimeUnavailable
          ? `${summary.connectedCount} of ${summary.expectedCount} connected`
          : summary.statusLabel;
  return {
    attentionCount: summary.attentionCount,
    configuredCount: summary.configuredCount,
    connectedCount: summary.connectedCount,
    expectedCount: summary.expectedCount,
    freshnessLabel: !input.workspaceSupported
      ? "Runtime status requires a server upgrade"
      : input.providerInstanceId === null
        ? "Select a provider account for live status"
        : formatMcpWorkspaceFreshness(summary.observedAt),
    state,
    statusLabel,
    toolCount: summary.knownToolCount,
  };
}
