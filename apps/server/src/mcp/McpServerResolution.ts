import {
  McpConfigError,
  ProviderInstanceId,
  type McpProviderRouting,
  type McpServerDefinition,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { ResolveActiveMcpServersInput } from "./McpConfigService.ts";

export function mcpConfigError(detail: string, cause?: unknown): McpConfigError {
  return new McpConfigError({ detail, ...(cause === undefined ? {} : { cause }) });
}

export const isMcpConfigError = Schema.is(McpConfigError);

export function normalizeMcpPath(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const drive = /^[A-Za-z]:/.exec(trimmed)?.[0];
  const withoutDrive = drive ? trimmed.slice(drive.length) : trimmed;
  const absolute = withoutDrive.startsWith("/") || withoutDrive.startsWith("\\");
  const segments: string[] = [];
  for (const segment of withoutDrive.split(/[\\/]+/)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
        continue;
      }
      if (!absolute) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  const prefix = drive ? `${drive}/` : absolute ? "/" : "";
  return `${prefix}${segments.join("/")}` || (absolute ? prefix : ".");
}

function validateProjectScope(server: McpServerDefinition): void {
  if (server.scope !== "project") return;
  if (server.projectId || server.projectCwd?.trim()) return;
  throw mcpConfigError("Project-scoped MCP servers must include a project or project path.");
}

export function validateMcpServers(servers: ReadonlyArray<McpServerDefinition>): void {
  const seen = new Set<string>();
  for (const server of servers) {
    validateProjectScope(server);
    if (seen.has(server.id)) throw mcpConfigError(`Duplicate MCP server id '${server.id}'.`);
    seen.add(server.id);
  }
}

function isProjectMatch(server: McpServerDefinition, input: ResolveActiveMcpServersInput): boolean {
  if (server.scope === "global") return true;
  if (server.projectId && input.projectId && server.projectId === input.projectId) return true;
  const serverCwd = normalizeMcpPath(server.projectCwd);
  if (!serverCwd) return false;
  return [normalizeMcpPath(input.projectCwd), normalizeMcpPath(input.cwd)]
    .filter((value): value is string => value !== undefined)
    .some((candidate) => candidate === serverCwd);
}

export function isMcpProviderMatch(
  server: McpServerDefinition,
  providerInstanceId: ProviderInstanceId | null | undefined,
): boolean {
  if (!providerInstanceId || server.providerRouting.mode === "all") return true;
  return server.providerRouting.instanceIds.includes(providerInstanceId);
}

export function resolveActiveMcpServers(
  settings: ServerSettings,
  input: ResolveActiveMcpServersInput,
): ReadonlyArray<McpServerDefinition> {
  return settings.mcp.servers.filter(
    (server) =>
      server.enabled &&
      isProjectMatch(server, input) &&
      isMcpProviderMatch(server, input.providerInstanceId),
  );
}

export function configuredMcpProviderInstanceIds(
  settings: ServerSettings,
): ReadonlyArray<ProviderInstanceId> {
  const ids = new Set<ProviderInstanceId>();
  for (const driver of Object.keys(settings.providers)) ids.add(ProviderInstanceId.make(driver));
  for (const instanceId of Object.keys(settings.providerInstances)) {
    ids.add(ProviderInstanceId.make(instanceId));
  }
  return [...ids];
}

function selectedProviderRouting(instanceIds: Iterable<ProviderInstanceId>): McpProviderRouting {
  return { mode: "selected", instanceIds: [...new Set(instanceIds)] };
}

export function updateMcpProviderRouting(input: {
  readonly routing: McpProviderRouting;
  readonly providerInstanceId: ProviderInstanceId;
  readonly enabled: boolean;
  readonly configuredInstanceIds: ReadonlyArray<ProviderInstanceId>;
}): McpProviderRouting {
  if (input.routing.mode === "all") {
    if (input.enabled) return input.routing;
    return selectedProviderRouting(
      input.configuredInstanceIds.filter((id) => id !== input.providerInstanceId),
    );
  }
  if (!input.enabled) {
    return selectedProviderRouting(
      input.routing.instanceIds.filter((id) => id !== input.providerInstanceId),
    );
  }
  return selectedProviderRouting([...input.routing.instanceIds, input.providerInstanceId]);
}
