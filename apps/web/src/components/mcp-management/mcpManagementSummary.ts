import type { McpRuntimeServer, McpRuntimeSnapshot } from "@t3tools/contracts";

export type McpManagementMode = "live" | "next-session" | "upgrade-required";

export interface McpManagementSummary {
  readonly mode: McpManagementMode;
  readonly configuredCount: number;
  readonly connectedCount: number;
  readonly expectedCount: number;
  readonly attentionCount: number;
  readonly knownToolCount: number | null;
  readonly observedAt: string | null;
  readonly statusLabel: string;
}

const ATTENTION_STATES = new Set<McpRuntimeServer["state"]>([
  "auth-required",
  "setup-required",
  "failed",
  "stale",
]);

function userServers(snapshot: McpRuntimeSnapshot): ReadonlyArray<McpRuntimeServer> {
  return snapshot.servers.filter(
    (server) => server.source !== "t3-built-in" && server.state !== "disabled",
  );
}

function observedUserServers(
  servers: ReadonlyArray<McpRuntimeServer>,
): ReadonlyArray<McpRuntimeServer> {
  return servers.filter((server) => server.state !== "unsupported");
}

function requiresAttention(server: McpRuntimeServer): boolean {
  return ATTENTION_STATES.has(server.state) || server.configDrift !== "none";
}

function knownToolCount(
  servers: ReadonlyArray<McpRuntimeServer>,
  expectedCount: number,
): number | null {
  if (servers.length < expectedCount || servers.some((server) => server.toolCount === undefined)) {
    return null;
  }
  return servers.reduce((total, server) => total + (server.toolCount ?? 0), 0);
}

function configurationOnlySummary(input: {
  readonly applicableConfiguredCount: number;
  readonly runtimeSupported: boolean;
}): McpManagementSummary {
  const suffix = input.runtimeSupported ? "next session" : "upgrade required";
  return {
    mode: input.runtimeSupported ? "next-session" : "upgrade-required",
    configuredCount: input.applicableConfiguredCount,
    connectedCount: 0,
    expectedCount: input.applicableConfiguredCount,
    attentionCount: 0,
    knownToolCount: null,
    observedAt: null,
    statusLabel: `${input.applicableConfiguredCount} configured · ${suffix}`,
  };
}

export function deriveMcpManagementSummary(input: {
  readonly applicableConfiguredCount: number;
  readonly runtimeSupported: boolean;
  readonly snapshot: McpRuntimeSnapshot | null;
}): McpManagementSummary {
  if (!input.runtimeSupported || input.snapshot === null) {
    return configurationOnlySummary(input);
  }

  const servers = userServers(input.snapshot);
  const observedServers = observedUserServers(servers);
  const connectedCount = observedServers.filter((server) => server.state === "connected").length;
  const attentionCount = servers.filter(requiresAttention).length;
  const expectedCount = Math.max(input.applicableConfiguredCount, servers.length);
  return {
    mode: "live",
    configuredCount: input.applicableConfiguredCount,
    connectedCount,
    expectedCount,
    attentionCount,
    knownToolCount: knownToolCount(servers, expectedCount),
    observedAt: input.snapshot.observedAt,
    statusLabel:
      attentionCount > 0
        ? `${attentionCount} need attention`
        : observedServers.length === 0 && expectedCount > 0
          ? `${input.applicableConfiguredCount} configured · runtime status unavailable`
          : `${connectedCount}/${expectedCount} connected`,
  };
}
