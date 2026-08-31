import type {
  McpProviderCapability,
  McpProviderStatus,
  McpSecretValue,
  McpServerDefinition,
  McpServerId,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

export type ClaudeMcpServerConfig =
  | {
      readonly type?: "stdio";
      readonly command: string;
      readonly args?: Array<string>;
      readonly env?: Record<string, string>;
    }
  | {
      readonly type: "sse" | "http";
      readonly url: string;
      readonly headers?: Record<string, string>;
    };

export type OpenCodeMcpServerConfig =
  | {
      readonly type: "local";
      readonly command: Array<string>;
      readonly environment?: Record<string, string>;
      readonly enabled?: boolean;
    }
  | {
      readonly type: "remote";
      readonly url: string;
      readonly headers?: Record<string, string>;
      readonly enabled?: boolean;
    };

export function managedMcpProviderKey(serverId: McpServerId): string {
  return serverId === "t3-code" ? `t3-managed:${serverId}` : serverId;
}

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

export function toAcpMcpServers(
  servers: ReadonlyArray<McpServerDefinition>,
): ReadonlyArray<EffectAcpSchema.McpServer> {
  return servers.map((server) => {
    switch (server.transport) {
      case "stdio":
        return {
          name: managedMcpProviderKey(server.id),
          command: server.command,
          args: server.args,
          env: Object.entries(server.env).map(([name, value]) => ({ name, value: value.value })),
          ...(server.cwd ? { _meta: { cwd: server.cwd } } : {}),
        } satisfies EffectAcpSchema.McpServer;
      case "sse":
      case "http":
        return {
          type: server.transport,
          name: managedMcpProviderKey(server.id),
          url: server.url,
          headers: Object.entries(server.headers).map(([name, value]) => ({
            name,
            value: value.value,
          })),
        } satisfies EffectAcpSchema.McpServer;
    }
  });
}

function secretMapToPlainValues(values: Record<string, McpSecretValue>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.value]));
}

export function toClaudeMcpServers(
  servers: ReadonlyArray<McpServerDefinition>,
): Record<string, ClaudeMcpServerConfig> {
  return Object.fromEntries(
    servers.map((server) => {
      const providerKey = managedMcpProviderKey(server.id);
      switch (server.transport) {
        case "stdio":
          return [
            providerKey,
            {
              type: "stdio",
              command: server.command,
              args: server.args,
              env: secretMapToPlainValues(server.env),
            },
          ] as const;
        case "sse":
        case "http":
          return [
            providerKey,
            {
              type: server.transport,
              url: server.url,
              headers: secretMapToPlainValues(server.headers),
            },
          ] as const;
      }
    }),
  );
}

export function toOpenCodeMcpServers(
  servers: ReadonlyArray<McpServerDefinition>,
): Record<string, OpenCodeMcpServerConfig> {
  return Object.fromEntries(
    servers.map((server) => {
      const providerKey = managedMcpProviderKey(server.id);
      switch (server.transport) {
        case "stdio":
          return [
            providerKey,
            {
              type: "local",
              command: [server.command, ...server.args],
              environment: secretMapToPlainValues(server.env),
              enabled: true,
            },
          ] as const;
        case "sse":
        case "http":
          return [
            providerKey,
            {
              type: "remote",
              url: server.url,
              headers: secretMapToPlainValues(server.headers),
              enabled: true,
            },
          ] as const;
      }
    }),
  );
}
