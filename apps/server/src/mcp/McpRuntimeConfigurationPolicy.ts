import type {
  McpRuntimeSnapshot,
  McpServerDefinition,
  McpSetProviderEnabledInput,
  ProviderInstanceId,
} from "@t3tools/contracts";

import type { ProviderMcpRuntimeTarget } from "../provider/Services/ProviderAdapter.ts";
import { managedMcpProviderKey } from "./McpProviderConfigProjection.ts";
import type { McpRuntimeConfigurationReconcileInput } from "./McpRuntimeConfigurationTypes.ts";
import type { RuntimeEntry } from "./McpRuntimeContextState.ts";

export interface ConfigurationTransition {
  readonly previous: ReadonlyArray<McpServerDefinition>;
  readonly desired: ReadonlyArray<McpServerDefinition>;
  readonly enable: ReadonlyArray<McpServerDefinition>;
  readonly disable: ReadonlyArray<McpServerDefinition>;
}

function normalizeRuntimePath(value: string | undefined): string | undefined {
  const normalized = value?.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized ? normalized : undefined;
}

export function isServerInRuntimeScope(
  server: McpServerDefinition | undefined,
  entry: RuntimeEntry,
): boolean {
  if (server === undefined || server.scope === "global") return true;
  const serverCwd = normalizeRuntimePath(server.projectCwd);
  const runtimeCwd = normalizeRuntimePath(entry.context.projectCwd);
  return serverCwd !== undefined && runtimeCwd !== undefined && serverCwd === runtimeCwd;
}

export function isServerAssignedToProvider(
  server: McpServerDefinition,
  providerInstanceId: ProviderInstanceId,
): boolean {
  return (
    server.providerRouting.mode === "all" ||
    server.providerRouting.instanceIds.includes(providerInstanceId)
  );
}

function enabledServersForRuntime(
  servers: ReadonlyArray<McpServerDefinition>,
  providerInstanceId: ProviderInstanceId,
  entry: RuntimeEntry,
): ReadonlyArray<McpServerDefinition> {
  return servers.filter(
    (server) =>
      server.enabled &&
      isServerAssignedToProvider(server, providerInstanceId) &&
      isServerInRuntimeScope(server, entry),
  );
}

export function resolveConfigurationTransition(
  input: McpRuntimeConfigurationReconcileInput,
  entry: RuntimeEntry,
): ConfigurationTransition {
  const previous = enabledServersForRuntime(input.previousServers, input.providerInstanceId, entry);
  const desired = enabledServersForRuntime(input.desiredServers, input.providerInstanceId, entry);
  const previousById = new Map(previous.map((server) => [server.id, server]));
  const desiredIds = new Set(desired.map((server) => server.id));
  return {
    previous,
    desired,
    enable: desired.filter((server) => {
      const prior = previousById.get(server.id);
      return prior === undefined || JSON.stringify(prior) !== JSON.stringify(server);
    }),
    disable: previous.filter((server) => !desiredIds.has(server.id)),
  };
}

export function runtimeTarget(entry: RuntimeEntry): ProviderMcpRuntimeTarget {
  return {
    providerInstanceId: entry.context.providerInstanceId,
    threadId: entry.context.threadId,
    runtimeSessionId: entry.context.runtimeSessionId,
  };
}

export function isSingleConfigurationChangeReflected(input: {
  readonly snapshot: McpRuntimeSnapshot;
  readonly change: McpSetProviderEnabledInput;
  readonly definition?: McpServerDefinition;
}): boolean {
  const expectedProviderKey =
    input.definition === undefined ? undefined : managedMcpProviderKey(input.definition.id);
  const matching = input.snapshot.servers.filter(
    (candidate) =>
      candidate.serverId === input.change.serverId || candidate.providerKey === expectedProviderKey,
  );
  return input.change.enabled
    ? matching.some(
        (candidate) =>
          candidate.state !== "disabled" &&
          candidate.state !== "stale" &&
          candidate.statusSource !== "configuration",
      )
    : matching.every((candidate) => candidate.state === "disabled");
}

export function unconfirmedConfiguration(input: {
  readonly snapshot: McpRuntimeSnapshot;
  readonly transition: ConfigurationTransition;
}): {
  readonly missing: ReadonlyArray<McpServerDefinition>;
  readonly unexpected: ReadonlyArray<McpServerDefinition>;
} {
  const healthyManaged = input.snapshot.servers.filter(
    (server) =>
      server.source === "t3-managed" &&
      server.state !== "disabled" &&
      server.state !== "stale" &&
      server.statusSource !== "configuration",
  );
  const missing = input.transition.desired.filter((definition) => {
    const providerKey = managedMcpProviderKey(definition.id);
    return !healthyManaged.some(
      (server) => server.serverId === definition.id || server.providerKey === providerKey,
    );
  });
  const unexpected = healthyManaged.flatMap((server) => {
    const expected = input.transition.desired.some(
      (definition) =>
        server.serverId === definition.id ||
        server.providerKey === managedMcpProviderKey(definition.id),
    );
    if (expected) return [];
    const definition = input.transition.previous.find(
      (candidate) =>
        candidate.id === server.serverId ||
        managedMcpProviderKey(candidate.id) === server.providerKey,
    );
    return definition === undefined ? [] : [definition];
  });
  return { missing, unexpected };
}
