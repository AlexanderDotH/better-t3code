import {
  McpRuntimeError,
  McpServerName,
  type McpRuntimeResource,
  type McpRuntimeResourceTemplate,
  type McpRuntimeServer,
  type McpRuntimeSnapshotInput,
  type McpRuntimeTool,
} from "@t3tools/contracts";

import { sanitizeMcpRuntimeText } from "./McpRuntimeSanitizer.ts";

export const MAX_RUNTIME_INVENTORY_DETAILS = 256;

export function mcpRuntimeErrorDetail(error: unknown): string {
  if (typeof error === "object" && error !== null && Object.hasOwn(error, "message")) {
    return sanitizeMcpRuntimeText((error as { readonly message?: unknown }).message);
  }
  return sanitizeMcpRuntimeText(error);
}

export function makeMcpRuntimeError(
  code: McpRuntimeError["code"],
  detail: string,
): McpRuntimeError {
  return new McpRuntimeError({ code, detail: sanitizeMcpRuntimeText(detail) });
}

export function sanitizeMcpRuntimeServer(
  server: McpRuntimeServer,
  target: McpRuntimeSnapshotInput,
): McpRuntimeServer {
  return {
    ...(server.serverId === undefined ? {} : { serverId: server.serverId }),
    providerKey: server.providerKey,
    source: server.source,
    providerInstanceId: target.providerInstanceId,
    threadId: target.threadId,
    runtimeSessionId: target.runtimeSessionId,
    name: McpServerName.make(sanitizeMcpRuntimeText(server.name).slice(0, 128)),
    ...(server.transport === undefined ? {} : { transport: server.transport }),
    state: server.state,
    statusSource: server.statusSource,
    observedAt: server.observedAt,
    authState: server.authState,
    availableActions: Array.from(new Set(server.availableActions)),
    reportsTools: server.reportsTools,
    ...(server.serverInfo === undefined
      ? {}
      : {
          serverInfo: {
            name: sanitizeMcpRuntimeText(server.serverInfo.name).slice(0, 512),
            ...(server.serverInfo.version === undefined
              ? {}
              : { version: sanitizeMcpRuntimeText(server.serverInfo.version).slice(0, 512) }),
          },
        }),
    ...(server.toolCount === undefined ? {} : { toolCount: Math.max(0, server.toolCount) }),
    ...(server.resourceCount === undefined
      ? {}
      : { resourceCount: Math.max(0, server.resourceCount) }),
    ...(server.templateCount === undefined
      ? {}
      : { templateCount: Math.max(0, server.templateCount) }),
    ...(server.issue === undefined
      ? {}
      : {
          issue: {
            ...(server.issue.code === undefined
              ? {}
              : { code: sanitizeMcpRuntimeText(server.issue.code).slice(0, 256) }),
            message: sanitizeMcpRuntimeText(server.issue.message),
          },
        }),
    configDrift: server.configDrift,
  };
}

export function sanitizeMcpRuntimeTool(tool: McpRuntimeTool): McpRuntimeTool {
  return {
    name: sanitizeMcpRuntimeText(tool.name),
    ...(tool.title === undefined ? {} : { title: sanitizeMcpRuntimeText(tool.title) }),
    ...(tool.description === undefined
      ? {}
      : { description: sanitizeMcpRuntimeText(tool.description) }),
    ...(tool.readOnly === undefined ? {} : { readOnly: tool.readOnly }),
    ...(tool.destructive === undefined ? {} : { destructive: tool.destructive }),
    ...(tool.openWorld === undefined ? {} : { openWorld: tool.openWorld }),
  };
}

export function sanitizeMcpRuntimeResource(resource: McpRuntimeResource): McpRuntimeResource {
  return {
    uri: sanitizeMcpRuntimeText(resource.uri).slice(0, 8_192),
    name: sanitizeMcpRuntimeText(resource.name).slice(0, 512),
    ...(resource.title === undefined
      ? {}
      : { title: sanitizeMcpRuntimeText(resource.title).slice(0, 512) }),
    ...(resource.description === undefined
      ? {}
      : { description: sanitizeMcpRuntimeText(resource.description).slice(0, 65_536) }),
    ...(resource.mimeType === undefined
      ? {}
      : { mimeType: sanitizeMcpRuntimeText(resource.mimeType).slice(0, 512) }),
    ...(resource.size === undefined ? {} : { size: Math.max(0, resource.size) }),
  };
}

export function sanitizeMcpRuntimeResourceTemplate(
  template: McpRuntimeResourceTemplate,
): McpRuntimeResourceTemplate {
  return {
    uriTemplate: sanitizeMcpRuntimeText(template.uriTemplate).slice(0, 8_192),
    name: sanitizeMcpRuntimeText(template.name).slice(0, 512),
    ...(template.title === undefined
      ? {}
      : { title: sanitizeMcpRuntimeText(template.title).slice(0, 512) }),
    ...(template.description === undefined
      ? {}
      : { description: sanitizeMcpRuntimeText(template.description).slice(0, 65_536) }),
    ...(template.mimeType === undefined
      ? {}
      : { mimeType: sanitizeMcpRuntimeText(template.mimeType).slice(0, 512) }),
  };
}
