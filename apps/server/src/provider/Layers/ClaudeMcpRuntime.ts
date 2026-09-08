import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import {
  McpRuntimeServerKey,
  McpServerName,
  type McpRuntimeServer,
  type McpRuntimeTool,
  type McpServerId,
  type ProviderInstanceId,
  type RuntimeSessionId,
  type ThreadId,
} from "@t3tools/contracts";

export interface ClaudeMcpRuntimeMetadata {
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly observedAt: string;
  readonly managedServerIds: ReadonlyMap<string, McpServerId>;
  readonly builtInProviderKeys: ReadonlySet<string>;
}

const MAX_PROVIDER_KEY_LENGTH = 512;
const MAX_SERVER_NAME_LENGTH = 128;
const MAX_SERVER_INFO_LENGTH = 512;
const MAX_TOOL_NAME_LENGTH = 512;
const MAX_TOOL_DESCRIPTION_LENGTH = 65_536;
const MAX_ISSUE_LENGTH = 8_192;

function boundedNonEmpty(value: string, maximumLength: number, fallback: string): string {
  const trimmed = value.trim();
  return (trimmed.length > 0 ? trimmed : fallback).slice(0, maximumLength);
}

function providerKey(status: McpServerStatus): McpRuntimeServerKey {
  return McpRuntimeServerKey.make(
    boundedNonEmpty(status.name, MAX_PROVIDER_KEY_LENGTH, "unknown-server"),
  );
}

function transportFromStatus(status: McpServerStatus): McpRuntimeServer["transport"] | undefined {
  switch (status.config?.type) {
    case "http":
    case "sse":
      return status.config.type;
    case "stdio":
      return "stdio";
    default:
      return status.config && Object.hasOwn(status.config, "command") ? "stdio" : undefined;
  }
}

function stateFromStatus(status: McpServerStatus): McpRuntimeServer["state"] {
  switch (status.status) {
    case "connected":
      return "connected";
    case "failed":
      return "failed";
    case "needs-auth":
      return "auth-required";
    case "pending":
      return "starting";
    case "disabled":
      return "disabled";
  }
}

function authStateFromStatus(status: McpServerStatus): McpRuntimeServer["authState"] {
  switch (status.status) {
    case "connected":
      return "authenticated";
    case "needs-auth":
      return "required";
    default:
      return "unknown";
  }
}

function redactClaudeMcpError(error: string | undefined): string {
  const source = error?.trim() || "Claude reported an MCP connection failure.";
  return source
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /((?:authorization|api[-_ ]?key|access[-_ ]?token|token|secret|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/([?&](?:access_token|token|api_key|key|secret)=)[^&#\s]+/gi, "$1[REDACTED]")
    .slice(0, MAX_ISSUE_LENGTH);
}

function issueFromStatus(status: McpServerStatus): McpRuntimeServer["issue"] | undefined {
  if (status.status === "needs-auth") {
    return {
      code: "needs-auth",
      message: "Authorization required",
    };
  }
  if (status.status !== "failed") {
    return undefined;
  }
  return {
    code: "provider-error",
    message: redactClaudeMcpError(status.error),
  };
}

function serverInfoFromStatus(status: McpServerStatus): McpRuntimeServer["serverInfo"] {
  if (!status.serverInfo) {
    return undefined;
  }
  const name = boundedNonEmpty(status.serverInfo.name, MAX_SERVER_INFO_LENGTH, status.name);
  const version = status.serverInfo.version.trim().slice(0, MAX_SERVER_INFO_LENGTH);
  return {
    name,
    ...(version.length > 0 ? { version } : {}),
  };
}

export function normalizeClaudeMcpRuntimeServer(
  status: McpServerStatus,
  metadata: ClaudeMcpRuntimeMetadata,
): McpRuntimeServer {
  const key = providerKey(status);
  const managedServerId = metadata.managedServerIds.get(key);
  const source = managedServerId
    ? "t3-managed"
    : metadata.builtInProviderKeys.has(key)
      ? "t3-built-in"
      : "provider-native";
  const transport = transportFromStatus(status);
  const serverInfo = serverInfoFromStatus(status);
  const issue = issueFromStatus(status);

  return {
    ...(managedServerId ? { serverId: managedServerId } : {}),
    providerKey: key,
    source,
    providerInstanceId: metadata.providerInstanceId,
    threadId: metadata.threadId,
    runtimeSessionId: metadata.runtimeSessionId,
    name: McpServerName.make(
      boundedNonEmpty(status.name, MAX_SERVER_NAME_LENGTH, "Unknown MCP server"),
    ),
    ...(transport ? { transport } : {}),
    state: stateFromStatus(status),
    statusSource: "provider-query",
    observedAt: metadata.observedAt,
    authState: authStateFromStatus(status),
    availableActions: status.status === "disabled" ? ["refresh"] : ["refresh", "reconnect"],
    reportsTools: true,
    ...(serverInfo ? { serverInfo } : {}),
    ...(status.tools ? { toolCount: status.tools.length } : {}),
    ...(issue ? { issue } : {}),
    configDrift: "none",
  };
}

export function claudeMcpRuntimeTools(status: McpServerStatus): ReadonlyArray<McpRuntimeTool> {
  return (status.tools ?? []).flatMap((tool) => {
    const name = tool.name.trim().slice(0, MAX_TOOL_NAME_LENGTH);
    if (name.length === 0) {
      return [];
    }
    const description = tool.description?.slice(0, MAX_TOOL_DESCRIPTION_LENGTH);
    return [
      {
        name,
        ...(description ? { description } : {}),
        ...(tool.annotations?.readOnly !== undefined
          ? { readOnly: tool.annotations.readOnly }
          : {}),
        ...(tool.annotations?.destructive !== undefined
          ? { destructive: tool.annotations.destructive }
          : {}),
        ...(tool.annotations?.openWorld !== undefined
          ? { openWorld: tool.annotations.openWorld }
          : {}),
      },
    ];
  });
}
