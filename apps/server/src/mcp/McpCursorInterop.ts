import type {
  McpCursorJsonResult,
  McpExportCursorJsonInput,
  McpProviderRouting,
  McpSecretValue,
  McpServerDefinition,
  McpServerId,
  McpServerScope,
  ProjectId,
} from "@t3tools/contracts";

import {
  isMcpProviderMatch,
  mcpConfigError,
  normalizeMcpPath,
  validateMcpServers,
} from "./McpServerResolution.ts";

type CursorMcpServerInput = {
  readonly command?: unknown;
  readonly args?: unknown;
  readonly cwd?: unknown;
  readonly env?: unknown;
  readonly url?: unknown;
  readonly headers?: unknown;
  readonly type?: unknown;
  readonly transport?: unknown;
};

interface CursorMcpJsonInput {
  readonly mcpServers?: unknown;
}

function safeJsonParse(json: string): CursorMcpJsonInput {
  try {
    return JSON.parse(json) as CursorMcpJsonInput;
  } catch (cause) {
    throw mcpConfigError("Cursor MCP JSON is not valid JSON.", cause);
  }
}

function cursorValueMapToSecretMap(input: unknown): Record<string, McpSecretValue> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const values: Record<string, McpSecretValue> = {};
  for (const [name, rawValue] of Object.entries(input)) {
    if (typeof rawValue === "string") {
      values[name] = { value: rawValue, sensitive: true };
      continue;
    }
    if (!rawValue || typeof rawValue !== "object" || !Object.hasOwn(rawValue, "value")) continue;
    const record = rawValue as { readonly value?: unknown; readonly sensitive?: unknown };
    values[name] = {
      value: typeof record.value === "string" ? record.value : "",
      sensitive: record.sensitive !== false,
    };
  }
  return values;
}

function cursorArgs(input: unknown): ReadonlyArray<string> {
  return Array.isArray(input)
    ? input.filter((value): value is string => typeof value === "string")
    : [];
}

function slugFromCursorName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const withPrefix = /^[a-zA-Z]/.test(normalized) ? normalized : `mcp_${normalized}`;
  return (withPrefix || "mcp_server").slice(0, 96);
}

function uniqueServerId(name: string, reservedIds: Set<string>): McpServerId {
  const base = slugFromCursorName(name);
  let candidate = base;
  let suffix = 2;
  while (reservedIds.has(candidate)) {
    const nextSuffix = `_${suffix}`;
    candidate = `${base.slice(0, 96 - nextSuffix.length)}${nextSuffix}`;
    suffix += 1;
  }
  reservedIds.add(candidate);
  return candidate as McpServerId;
}

function cursorTransport(raw: CursorMcpServerInput): "sse" | "http" {
  return raw.type === "sse" || raw.transport === "sse" ? "sse" : "http";
}

export function importCursorMcpServers(input: {
  readonly json: string;
  readonly providerRouting: McpProviderRouting;
  readonly scope: McpServerScope;
  readonly projectId?: ProjectId | undefined;
  readonly projectCwd?: string | undefined;
  readonly reservedIds?: ReadonlySet<string>;
}): ReadonlyArray<McpServerDefinition> {
  const parsed = safeJsonParse(input.json);
  if (
    !parsed.mcpServers ||
    typeof parsed.mcpServers !== "object" ||
    Array.isArray(parsed.mcpServers)
  ) {
    throw mcpConfigError("Cursor MCP JSON must contain an object named 'mcpServers'.");
  }
  const reservedIds = new Set(input.reservedIds ?? []);
  const servers: McpServerDefinition[] = [];
  for (const [name, rawServer] of Object.entries(parsed.mcpServers)) {
    if (!rawServer || typeof rawServer !== "object" || Array.isArray(rawServer)) continue;
    const serverInput = rawServer as CursorMcpServerInput;
    const id = uniqueServerId(name, reservedIds);
    const base = {
      id,
      name: name.trim() || id,
      enabled: true,
      providerRouting: input.providerRouting,
      scope: input.scope,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
    };
    if (typeof serverInput.command === "string" && serverInput.command.trim()) {
      servers.push({
        ...base,
        transport: "stdio",
        command: serverInput.command.trim(),
        args: cursorArgs(serverInput.args),
        ...(typeof serverInput.cwd === "string" && serverInput.cwd.trim()
          ? { cwd: serverInput.cwd.trim() }
          : {}),
        env: cursorValueMapToSecretMap(serverInput.env),
      } satisfies McpServerDefinition);
      continue;
    }
    if (typeof serverInput.url !== "string" || !serverInput.url.trim()) continue;
    const transport = cursorTransport(serverInput);
    const remote = {
      ...base,
      transport,
      url: serverInput.url.trim(),
      headers: cursorValueMapToSecretMap(serverInput.headers),
    } as const;
    servers.push(remote satisfies McpServerDefinition);
  }
  if (servers.length === 0) {
    throw mcpConfigError("Cursor MCP JSON did not contain any supported MCP servers.");
  }
  validateMcpServers(servers);
  return servers;
}

function secretMapToCursorValues(values: Record<string, McpSecretValue>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.value]));
}

function isExportMatch(server: McpServerDefinition, input: McpExportCursorJsonInput): boolean {
  if (!input.includeDisabled && !server.enabled) return false;
  if (input.scope && server.scope !== input.scope) return false;
  if (input.projectId && server.projectId !== input.projectId) return false;
  if (
    input.projectCwd &&
    normalizeMcpPath(server.projectCwd) !== normalizeMcpPath(input.projectCwd)
  ) {
    return false;
  }
  return !input.providerInstanceId || isMcpProviderMatch(server, input.providerInstanceId);
}

export function exportCursorMcpServersJson(
  servers: ReadonlyArray<McpServerDefinition>,
  input: McpExportCursorJsonInput,
): McpCursorJsonResult {
  const exportedServers = servers.filter((server) => isExportMatch(server, input));
  const mcpServers = Object.fromEntries(
    exportedServers.map((server) => {
      switch (server.transport) {
        case "stdio":
          return [
            server.id,
            {
              command: server.command,
              args: server.args,
              ...(server.cwd ? { cwd: server.cwd } : {}),
              env: secretMapToCursorValues(server.env),
            },
          ] as const;
        case "sse":
        case "http":
          return [
            server.id,
            {
              type: server.transport,
              url: server.url,
              headers: secretMapToCursorValues(server.headers),
            },
          ] as const;
      }
    }),
  );
  return {
    json: JSON.stringify({ mcpServers }, null, 2),
    servers: exportedServers,
  };
}
