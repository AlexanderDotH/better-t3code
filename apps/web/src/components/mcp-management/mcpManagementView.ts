import type {
  EnvironmentId,
  McpRuntimeContext,
  McpRuntimeServer,
  McpRuntimeServerDetailsResult,
  McpRuntimeServerKey,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";

import type { McpRuntimeState } from "../settings/McpServersSettings.logic";

export interface McpRuntimeContextView {
  readonly id: string;
  readonly runtimeSessionId: string;
  readonly threadId: string;
  readonly label: string;
  readonly live: boolean;
}

export interface McpConfiguredServerView {
  readonly id: string;
  readonly name: string;
  readonly enabledForProvider: boolean;
  readonly globallyEnabled: boolean;
  readonly globalScope: boolean;
  readonly scopeLabel: string;
  readonly transport: string;
  readonly summary: string;
  readonly secretCount: number;
}

export interface McpRuntimeToolView {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly openWorld?: boolean;
}

export interface McpRuntimeResourceView {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly size?: number;
}

export interface McpRuntimeResourceTemplateView {
  readonly uriTemplate: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpRuntimeServerView {
  readonly serverKey: string;
  readonly definitionId?: string;
  readonly name: string;
  readonly source: "t3-managed" | "provider-native" | "t3-built-in";
  readonly state: McpRuntimeState;
  readonly authLabel?: string;
  readonly transport?: string;
  readonly toolCount?: number;
  readonly resourceCount?: number;
  readonly templateCount?: number;
  readonly version?: string;
  readonly error?: string;
  readonly drift?: "pending-enable" | "pending-disable";
  readonly tools?: ReadonlyArray<McpRuntimeToolView>;
  readonly resources?: ReadonlyArray<McpRuntimeResourceView>;
  readonly templates?: ReadonlyArray<McpRuntimeResourceTemplateView>;
  readonly detailsLoading?: boolean;
  readonly capabilities: {
    readonly authorize?: boolean;
    readonly reconnect?: boolean;
    readonly refresh?: boolean;
    readonly reportsTools?: boolean;
  };
}

export interface McpRuntimeDetailsTarget {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly providerKey: McpRuntimeServerKey;
}

export interface McpRuntimeDetailsEntry {
  readonly target: McpRuntimeDetailsTarget;
  readonly details: McpRuntimeServerDetailsResult;
}

export function mcpRuntimeContextId(context: McpRuntimeContext): string {
  return `${context.threadId}:${context.runtimeSessionId}`;
}

export function toMcpRuntimeContextView(context: McpRuntimeContext): McpRuntimeContextView {
  const project = context.projectCwd?.match(/([^\\/]+)[\\/]?$/u)?.[1];
  const label = [project, context.threadTitle].filter(Boolean).join(" · ");
  return {
    id: mcpRuntimeContextId(context),
    runtimeSessionId: String(context.runtimeSessionId),
    threadId: String(context.threadId),
    label: label || String(context.threadId),
    live: context.state === "active",
  };
}

export function toMcpRuntimeServerView(
  server: McpRuntimeServer,
  details?: McpRuntimeServerDetailsResult,
  detailsLoading = false,
  authorizationAvailable = true,
): McpRuntimeServerView {
  const actions = new Set(server.availableActions);
  return {
    serverKey: String(server.providerKey),
    ...(server.serverId ? { definitionId: String(server.serverId) } : {}),
    name: server.name,
    source: server.source,
    state: server.state,
    ...(server.authState === "required"
      ? {
          authLabel: authorizationAvailable
            ? "Authorization required"
            : "Authorization required · complete sign-in on the environment host",
        }
      : {}),
    ...(server.transport ? { transport: server.transport } : {}),
    ...(server.toolCount !== undefined ? { toolCount: server.toolCount } : {}),
    ...(server.resourceCount !== undefined ? { resourceCount: server.resourceCount } : {}),
    ...(server.templateCount !== undefined ? { templateCount: server.templateCount } : {}),
    ...(server.serverInfo?.version ? { version: server.serverInfo.version } : {}),
    ...(server.issue?.message ? { error: server.issue.message } : {}),
    ...(server.configDrift !== "none" ? { drift: server.configDrift } : {}),
    ...(details
      ? {
          tools: details.tools,
          resources: details.resources,
          templates: details.templates,
        }
      : {}),
    ...(detailsLoading ? { detailsLoading: true } : {}),
    capabilities: {
      authorize: authorizationAvailable && actions.has("authorize"),
      reconnect: actions.has("reconnect"),
      refresh: actions.has("refresh"),
      reportsTools: server.reportsTools,
    },
  };
}

export function createMcpRuntimeDetailsTarget(
  target: McpRuntimeDetailsTarget,
): McpRuntimeDetailsTarget {
  return target;
}

export function isMcpRuntimeDetailsTargetCurrent(
  current: McpRuntimeDetailsTarget,
  entry: McpRuntimeDetailsEntry,
): boolean {
  const target = entry.target;
  return (
    current.environmentId === target.environmentId &&
    current.providerInstanceId === target.providerInstanceId &&
    current.threadId === target.threadId &&
    current.runtimeSessionId === target.runtimeSessionId &&
    current.providerKey === target.providerKey
  );
}
