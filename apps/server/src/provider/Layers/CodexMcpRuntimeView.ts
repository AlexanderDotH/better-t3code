import {
  type IsoDateTime,
  type McpRuntimeAction,
  type McpRuntimeResource,
  type McpRuntimeResourceTemplate,
  type McpRuntimeServer,
  McpRuntimeServerKey,
  type McpRuntimeTool,
  type McpServerDefinition,
  type ProviderEvent,
  type ProviderInstanceId,
  type RuntimeSessionId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import { managedMcpProviderKey } from "../../mcp/McpConfigEngine.ts";
import { sanitizeMcpRuntimeText } from "../../mcp/McpRuntimeSanitizer.ts";
import type { CodexMcpServerStatus } from "./CodexSessionRuntime.ts";

export interface CodexMcpStartupObservation {
  readonly state: EffectCodexSchema.V2McpServerStatusUpdatedNotification__McpServerStartupState;
  readonly failureReason?: EffectCodexSchema.V2McpServerStatusUpdatedNotification__McpServerStartupFailureReason | null;
  readonly error?: string | null;
  readonly observedAt: IsoDateTime;
}

function readPayload<A>(
  schema: Schema.Schema<A>,
  payload: ProviderEvent["payload"],
): A | undefined {
  const isPayload = Schema.is(schema);
  return isPayload(payload) ? payload : undefined;
}

function trimText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function boundedText(value: string | undefined | null, maximumLength: number): string | undefined {
  return trimText(value)?.slice(0, maximumLength);
}

export function codexMcpProviderKey(value: string): McpRuntimeServerKey {
  return McpRuntimeServerKey.make(boundedText(value, 512) ?? "unknown");
}

export function codexManagedMcpServers(
  servers: ReadonlyArray<McpServerDefinition>,
): ReadonlyMap<string, McpServerDefinition> {
  return new Map(servers.map((server) => [managedMcpProviderKey(server.id), server]));
}

function readCodexToolAnnotation(annotations: unknown, key: string): boolean | undefined {
  if (annotations === null || typeof annotations !== "object" || !Object.hasOwn(annotations, key)) {
    return undefined;
  }
  const value = (annotations as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

export function normalizeCodexMcpTool(
  tool: CodexMcpServerStatus["tools"][string],
): McpRuntimeTool | undefined {
  const name = boundedText(tool.name, 512);
  if (!name) {
    return undefined;
  }
  const title = boundedText(tool.title, 512);
  const description = boundedText(tool.description, 65_536);
  const readOnly = readCodexToolAnnotation(tool.annotations, "readOnlyHint");
  const destructive = readCodexToolAnnotation(tool.annotations, "destructiveHint");
  const openWorld = readCodexToolAnnotation(tool.annotations, "openWorldHint");
  return {
    name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(readOnly !== undefined ? { readOnly } : {}),
    ...(destructive !== undefined ? { destructive } : {}),
    ...(openWorld !== undefined ? { openWorld } : {}),
  };
}

export function normalizeCodexMcpResource(
  resource: CodexMcpServerStatus["resources"][number],
): McpRuntimeResource | undefined {
  const uri = boundedText(resource.uri, 8_192);
  const name = boundedText(resource.name, 512);
  if (!uri || !name) return undefined;
  const title = boundedText(resource.title, 512);
  const description = boundedText(resource.description, 65_536);
  const mimeType = boundedText(resource.mimeType, 512);
  const size =
    resource.size === null || resource.size === undefined
      ? undefined
      : Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(resource.size)));
  return {
    uri,
    name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(size === undefined ? {} : { size }),
  };
}

export function normalizeCodexMcpResourceTemplate(
  template: CodexMcpServerStatus["resourceTemplates"][number],
): McpRuntimeResourceTemplate | undefined {
  const uriTemplate = boundedText(template.uriTemplate, 8_192);
  const name = boundedText(template.name, 512);
  if (!uriTemplate || !name) return undefined;
  const title = boundedText(template.title, 512);
  const description = boundedText(template.description, 65_536);
  const mimeType = boundedText(template.mimeType, 512);
  return {
    uriTemplate,
    name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(mimeType ? { mimeType } : {}),
  };
}

export function codexMcpAvailableActions(
  status: CodexMcpServerStatus,
  source: McpRuntimeServer["source"],
): ReadonlyArray<McpRuntimeAction> {
  const actions: Array<McpRuntimeAction> = ["refresh", "reconnect"];
  if (status.authStatus === "notLoggedIn" && source !== "t3-built-in") {
    actions.push("authorize");
  }
  return actions;
}

export function normalizeCodexMcpServer(input: {
  readonly status: CodexMcpServerStatus;
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly observedAt: IsoDateTime;
  readonly managedMcpServers: ReadonlyMap<string, McpServerDefinition>;
  readonly builtInMcpExpected: boolean;
}): McpRuntimeServer {
  const managedServer = input.managedMcpServers.get(input.status.name);
  const source =
    input.status.name === "t3-code" && input.builtInMcpExpected
      ? ("t3-built-in" as const)
      : managedServer
        ? ("t3-managed" as const)
        : ("provider-native" as const);
  const authRequired = input.status.authStatus === "notLoggedIn";
  const advertisedName = boundedText(input.status.serverInfo?.name, 512);
  const advertisedVersion = boundedText(input.status.serverInfo?.version, 512);
  const providerKey = codexMcpProviderKey(input.status.name);
  return {
    ...(managedServer ? { serverId: managedServer.id } : {}),
    providerKey,
    source,
    providerInstanceId: input.providerInstanceId,
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
    name:
      managedServer?.name ??
      boundedText(input.status.serverInfo?.title, 128) ??
      boundedText(input.status.name, 128) ??
      "Unknown MCP server",
    ...(managedServer ? { transport: managedServer.transport } : {}),
    state: authRequired ? "auth-required" : "connected",
    statusSource: "provider-query",
    observedAt: input.observedAt,
    authState: authRequired
      ? "required"
      : input.status.authStatus === "unsupported"
        ? "unsupported"
        : "authenticated",
    availableActions: codexMcpAvailableActions(input.status, source),
    reportsTools: true,
    ...(advertisedName
      ? {
          serverInfo: {
            name: advertisedName,
            ...(advertisedVersion ? { version: advertisedVersion } : {}),
          },
        }
      : {}),
    toolCount: Object.keys(input.status.tools).length,
    resourceCount: input.status.resources.length,
    templateCount: input.status.resourceTemplates.length,
    configDrift: "none",
  };
}

export function findCodexMcpStatus(
  statuses: ReadonlyArray<CodexMcpServerStatus>,
  providerKey: McpRuntimeServerKey,
): CodexMcpServerStatus | undefined {
  return statuses.find((status) => codexMcpProviderKey(status.name) === providerKey);
}

export function applyCodexMcpStartupObservation(
  server: McpRuntimeServer,
  observation: CodexMcpStartupObservation | undefined,
): McpRuntimeServer {
  if (!observation) {
    return server;
  }
  if (observation.state === "ready") {
    return {
      ...server,
      state: "connected",
      statusSource: "provider-event",
      observedAt: observation.observedAt,
    };
  }
  if (observation.state === "starting") {
    return {
      ...server,
      state: "starting",
      statusSource: "provider-event",
      observedAt: observation.observedAt,
    };
  }

  const authorizationRequired = observation.failureReason === "reauthenticationRequired";
  const issueMessage =
    observation.error ??
    (authorizationRequired
      ? "Codex requires this MCP server to be authorized again."
      : observation.state === "cancelled"
        ? "Codex cancelled this MCP server during startup."
        : "Codex could not start this MCP server.");
  const availableActions = Array.from(
    new Set<McpRuntimeAction>([
      ...server.availableActions,
      ...(authorizationRequired && server.source !== "t3-built-in" ? ["authorize" as const] : []),
    ]),
  );
  return {
    ...server,
    state: authorizationRequired ? "auth-required" : "failed",
    statusSource: "provider-event",
    observedAt: observation.observedAt,
    authState: authorizationRequired ? "required" : server.authState,
    availableActions,
    issue: {
      code:
        observation.failureReason ??
        (observation.state === "cancelled" ? "startup-cancelled" : "startup-failed"),
      message: issueMessage,
    },
  };
}

export function normalizeExpectedCodexMcpServer(input: {
  readonly providerKey: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly observedAt: IsoDateTime;
  readonly managedMcpServers: ReadonlyMap<string, McpServerDefinition>;
  readonly builtIn: boolean;
}): McpRuntimeServer {
  const managedServer = input.managedMcpServers.get(input.providerKey);
  return {
    ...(managedServer ? { serverId: managedServer.id } : {}),
    providerKey: codexMcpProviderKey(input.providerKey),
    source: input.builtIn ? "t3-built-in" : managedServer ? "t3-managed" : "provider-native",
    providerInstanceId: input.providerInstanceId,
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
    name:
      managedServer?.name ??
      (input.builtIn
        ? "T3 Code System Server"
        : (boundedText(input.providerKey, 128) ?? "Unknown MCP server")),
    ...(managedServer ? { transport: managedServer.transport } : {}),
    state: "unknown",
    statusSource: "configuration",
    observedAt: input.observedAt,
    authState: "unknown",
    availableActions: ["refresh", "reconnect"],
    reportsTools: true,
    configDrift: "none",
  };
}

export function normalizeCodexMcpSnapshot(input: {
  readonly statuses: ReadonlyArray<CodexMcpServerStatus>;
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly observedAt: IsoDateTime;
  readonly managedMcpServers: ReadonlyMap<string, McpServerDefinition>;
  readonly startupStatuses: ReadonlyMap<string, CodexMcpStartupObservation>;
  readonly builtInMcpExpected: boolean;
}): ReadonlyArray<McpRuntimeServer> {
  const normalized = new Map<string, McpRuntimeServer>();
  for (const status of input.statuses) {
    const server = normalizeCodexMcpServer({
      status,
      providerInstanceId: input.providerInstanceId,
      threadId: input.threadId,
      runtimeSessionId: input.runtimeSessionId,
      observedAt: input.observedAt,
      managedMcpServers: input.managedMcpServers,
      builtInMcpExpected: input.builtInMcpExpected,
    });
    normalized.set(
      status.name,
      applyCodexMcpStartupObservation(server, input.startupStatuses.get(status.name)),
    );
  }

  const expectedKeys = new Set([
    ...input.managedMcpServers.keys(),
    ...input.startupStatuses.keys(),
    ...(input.builtInMcpExpected ? ["t3-code"] : []),
  ]);
  for (const providerKey of expectedKeys) {
    if (normalized.has(providerKey)) {
      continue;
    }
    const server = normalizeExpectedCodexMcpServer({
      providerKey,
      providerInstanceId: input.providerInstanceId,
      threadId: input.threadId,
      runtimeSessionId: input.runtimeSessionId,
      observedAt: input.observedAt,
      managedMcpServers: input.managedMcpServers,
      builtIn: providerKey === "t3-code",
    });
    normalized.set(
      providerKey,
      applyCodexMcpStartupObservation(server, input.startupStatuses.get(providerKey)),
    );
  }
  return Array.from(normalized.values());
}

export function observeCodexMcpEvent(
  event: ProviderEvent,
  startupStatuses: Map<string, CodexMcpStartupObservation>,
): void {
  if (event.method === "mcpServer/startupStatus/updated") {
    const payload = readPayload(
      EffectCodexSchema.V2McpServerStatusUpdatedNotification,
      event.payload,
    );
    if (!payload) {
      return;
    }
    startupStatuses.set(payload.name, {
      state: payload.status,
      observedAt: event.createdAt,
      ...(payload.failureReason ? { failureReason: payload.failureReason } : {}),
      ...(payload.error ? { error: sanitizeMcpRuntimeText(payload.error) } : {}),
    });
    return;
  }
  if (event.method !== "mcpServer/oauthLogin/completed") {
    return;
  }
  const payload = readPayload(
    EffectCodexSchema.V2McpServerOauthLoginCompletedNotification,
    event.payload,
  );
  if (payload?.success === true) {
    startupStatuses.delete(payload.name);
  }
}

export function sanitizeCodexMcpNativeEvent(event: ProviderEvent): ProviderEvent {
  if (event.method === "mcpServer/startupStatus/updated") {
    const payload = readPayload(
      EffectCodexSchema.V2McpServerStatusUpdatedNotification,
      event.payload,
    );
    return {
      ...event,
      payload: payload
        ? {
            threadId: payload.threadId,
            name: payload.name,
            status: payload.status,
            ...(payload.failureReason ? { failureReason: payload.failureReason } : {}),
            ...(payload.error ? { error: sanitizeMcpRuntimeText(payload.error) } : {}),
          }
        : { redacted: true },
    };
  }
  if (event.method === "mcpServer/oauthLogin/completed") {
    const payload = readPayload(
      EffectCodexSchema.V2McpServerOauthLoginCompletedNotification,
      event.payload,
    );
    return {
      ...event,
      payload: payload
        ? {
            threadId: payload.threadId,
            name: payload.name,
            success: payload.success,
            ...(payload.error ? { error: sanitizeMcpRuntimeText(payload.error) } : {}),
          }
        : { redacted: true },
    };
  }
  return event;
}
