import * as Effect from "effect/Effect";
import type { ProviderHost } from "./ProviderHost.ts";
import {
  ProviderAdapterProtocolError,
  type ProviderAdapterV2RuntimePolicy,
} from "./ProviderAdapter.ts";
import type {
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  ProjectId,
} from "@t3tools/contracts";
import type { McpServerDefinition, McpServerId, McpSecretValue } from "@t3tools/contracts";
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

export function toAcpMcpServers(servers: ReadonlyArray<McpServerDefinition>) {
  return servers.map((server) => {
    switch (server.transport) {
      case "stdio":
        return {
          type: "stdio",
          name: managedMcpProviderKey(server.id),
          command: server.command,
          args: [...server.args],
          env: Object.entries(server.env).map(([name, value]) => ({ name, value: value.value })),
          ...(server.cwd ? { _meta: { cwd: server.cwd } } : {}),
        } as const;
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
        } as const;
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
              args: [...server.args],
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

export const resolveProviderMcpServers = Effect.fn("ProviderHost.resolveManagedMcpServers")(
  function* (
    host: ProviderHost["Service"],
    input: {
      readonly cwd: string;
      readonly instanceId: ProviderInstanceId;
      readonly driver: ProviderDriverKind;
      readonly threadId?: ThreadId;
      readonly projectId?: ProjectId;
      readonly projectCwd?: string;
      readonly runtimePolicy?: Pick<
        ProviderAdapterV2RuntimePolicy,
        "interactionMode" | "commandExecutionPolicy"
      >;
    },
  ) {
    if (
      !host.resolveMcpServers ||
      input.runtimePolicy?.interactionMode === "chat" ||
      input.runtimePolicy?.commandExecutionPolicy === "deny"
    )
      return [];
    return yield* host
      .resolveMcpServers({
        cwd: input.cwd,
        providerInstanceId: input.instanceId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.projectCwd === undefined ? {} : { projectCwd: input.projectCwd }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProtocolError({
              driver: input.driver,
              detail: "Could not resolve configured MCP servers",
              cause,
            }),
        ),
      );
  },
);

const MANAGED_MCP_CONFIGURATION_DRIVERS = new Set([
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "fx",
  "opencode",
  "antigravity",
  "acpRegistry",
  "openai",
  "chatgpt",
  "openrouter",
  "openaiCompatible",
  "lmstudio",
]);

export function supportsManagedMcpConfiguration(driver: string | undefined): boolean {
  return driver !== undefined && MANAGED_MCP_CONFIGURATION_DRIVERS.has(driver);
}
