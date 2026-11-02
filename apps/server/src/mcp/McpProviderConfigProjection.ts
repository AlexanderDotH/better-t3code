import type {
  McpProviderCapability,
  McpProviderStatus,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
export {
  managedMcpProviderKey,
  toAcpMcpServers,
  toClaudeMcpServers,
  toOpenCodeMcpServers,
} from "@t3tools/provider-core/server/mcpConfiguration";
export type {
  ClaudeMcpServerConfig,
  OpenCodeMcpServerConfig,
} from "@t3tools/provider-core/server/mcpConfiguration";

export function getMcpProviderStatuses(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly activeServerCount: number;
  readonly capabilities: ReadonlyMap<ProviderInstanceId, McpProviderCapability>;
}): ReadonlyArray<McpProviderStatus> {
  return input.providers.map((provider) => {
    const capability = input.capabilities.get(provider.instanceId) ?? "unsupported";
    const unsupported = capability === "unsupported";
    return {
      provider: provider.driver,
      instanceId: provider.instanceId,
      capability,
      state: unsupported ? "unsupported" : "ready",
      activeServerCount: unsupported ? 0 : input.activeServerCount,
      message: unsupported
        ? `${provider.displayName ?? provider.driver} does not expose MCP session configuration in this build.`
        : capability === "sessionConfig"
          ? "New sessions receive the resolved MCP server set."
          : "MCP status is managed by the provider runtime when available.",
    };
  });
}
