import type {
  McpCursorJsonResult,
  McpDiscoverImportSourcesResult,
  McpExportCursorJsonInput,
  McpImportCursorJsonInput,
  McpImportSourcesInput,
  McpListResult,
  McpMutationResult,
  McpProviderCapability,
  McpProviderStatus,
  McpProviderStatusResult,
  McpSecretValue,
  McpServerDefinition,
  McpServerId,
  McpServerScope,
  ProjectId,
  ProviderDriverKind,
  ServerProvider,
  ServerSettings,
} from "@t3tools/contracts";
import { McpConfigError } from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  discoverAgentImportSources,
  importMcpServersFromAgentSources,
} from "../agentImportSources.ts";
import { redactServerSettingsForClient, ServerSettingsService } from "../serverSettings.ts";

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

export interface ResolveActiveMcpServersInput {
  readonly cwd?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly projectCwd?: string | null | undefined;
}

export interface McpConfigEngineShape {
  readonly list: Effect.Effect<McpListResult, McpConfigError>;
  readonly create: (
    server: McpServerDefinition,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly update: (
    server: McpServerDefinition,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly delete: (id: McpServerId) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly setEnabled: (
    id: McpServerId,
    enabled: boolean,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly importCursorJson: (
    input: McpImportCursorJsonInput,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly discoverImportSources: Effect.Effect<McpDiscoverImportSourcesResult, McpConfigError>;
  readonly importSources: (
    input: McpImportSourcesInput,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly exportCursorJson: (
    input: McpExportCursorJsonInput,
  ) => Effect.Effect<McpCursorJsonResult, McpConfigError>;
  readonly providerStatus: (
    providers: ReadonlyArray<ServerProvider>,
  ) => Effect.Effect<McpProviderStatusResult, McpConfigError>;
  readonly resolveActiveServers: (
    input: ResolveActiveMcpServersInput,
  ) => Effect.Effect<ReadonlyArray<McpServerDefinition>, McpConfigError>;
}

export class McpConfigEngine extends Context.Service<McpConfigEngine, McpConfigEngineShape>()(
  "t3/mcp/McpConfigEngine",
) {}

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

function mcpError(detail: string, cause?: unknown): McpConfigError {
  return new McpConfigError({ detail, ...(cause === undefined ? {} : { cause }) });
}

const isMcpConfigError = Schema.is(McpConfigError);

function normalizePath(value: string | null | undefined): string | undefined {
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
      if (!absolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }
  const prefix = drive ? `${drive}/` : absolute ? "/" : "";
  return `${prefix}${segments.join("/")}` || (absolute ? prefix : ".");
}

function hasProjectScopeTarget(server: McpServerDefinition): boolean {
  return Boolean(server.projectId || server.projectCwd?.trim());
}

function validateProjectScope(server: McpServerDefinition): void {
  if (server.scope !== "project") {
    return;
  }
  if (hasProjectScopeTarget(server)) {
    return;
  }
  throw mcpError("Project-scoped MCP servers must include a project or project path.");
}

function ensureUniqueServerIds(servers: ReadonlyArray<McpServerDefinition>): void {
  const seen = new Set<string>();
  for (const server of servers) {
    if (seen.has(server.id)) {
      throw mcpError(`Duplicate MCP server id '${server.id}'.`);
    }
    seen.add(server.id);
  }
}

function validateServers(servers: ReadonlyArray<McpServerDefinition>): void {
  for (const server of servers) {
    validateProjectScope(server);
  }
  ensureUniqueServerIds(servers);
}

function isProjectMatch(server: McpServerDefinition, input: ResolveActiveMcpServersInput): boolean {
  if (server.scope === "global") {
    return true;
  }

  if (server.projectId && input.projectId && server.projectId === input.projectId) {
    return true;
  }

  const serverCwd = normalizePath(server.projectCwd);
  if (!serverCwd) {
    return false;
  }

  const candidates = [normalizePath(input.projectCwd), normalizePath(input.cwd)].filter(
    (value): value is string => value !== undefined,
  );
  return candidates.some((candidate) => candidate === serverCwd);
}

export function resolveActiveMcpServers(
  settings: ServerSettings,
  input: ResolveActiveMcpServersInput,
): ReadonlyArray<McpServerDefinition> {
  return settings.mcp.servers.filter((server) => server.enabled && isProjectMatch(server, input));
}

function safeJsonParse(json: string): CursorMcpJsonInput {
  try {
    return JSON.parse(json) as CursorMcpJsonInput;
  } catch (cause) {
    throw mcpError("Cursor MCP JSON is not valid JSON.", cause);
  }
}

function cursorValueMapToSecretMap(input: unknown): Record<string, McpSecretValue> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const values: Record<string, McpSecretValue> = {};
  for (const [name, rawValue] of Object.entries(input)) {
    if (typeof rawValue === "string") {
      // Cursor's interchange format has no sensitivity metadata. Treat
      // imported environment and header values as secrets by default so
      // credentials are moved into the server secret store on persistence
      // instead of being copied into settings.json as plaintext.
      values[name] = { value: rawValue, sensitive: true };
      continue;
    }
    if (rawValue && typeof rawValue === "object" && "value" in rawValue) {
      const record = rawValue as { readonly value?: unknown; readonly sensitive?: unknown };
      values[name] = {
        value: typeof record.value === "string" ? record.value : "",
        sensitive: record.sensitive !== false,
      };
    }
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
    throw mcpError("Cursor MCP JSON must contain an object named 'mcpServers'.");
  }

  const reservedIds = new Set(input.reservedIds ?? []);
  const servers: McpServerDefinition[] = [];
  for (const [name, rawServer] of Object.entries(parsed.mcpServers)) {
    if (!rawServer || typeof rawServer !== "object" || Array.isArray(rawServer)) {
      continue;
    }
    const serverInput = rawServer as CursorMcpServerInput;
    const id = uniqueServerId(name, reservedIds);
    const base = {
      id,
      name: name.trim() || id,
      enabled: true,
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

    if (typeof serverInput.url === "string" && serverInput.url.trim()) {
      const transport = cursorTransport(serverInput);
      const url = serverInput.url.trim();
      const headers = cursorValueMapToSecretMap(serverInput.headers);
      servers.push(
        transport === "sse"
          ? ({
              ...base,
              transport: "sse",
              url,
              headers,
            } satisfies McpServerDefinition)
          : ({
              ...base,
              transport: "http",
              url,
              headers,
            } satisfies McpServerDefinition),
      );
    }
  }

  if (servers.length === 0) {
    throw mcpError("Cursor MCP JSON did not contain any supported MCP servers.");
  }
  validateServers(servers);
  return servers;
}

function secretMapToCursorValues(values: Record<string, McpSecretValue>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.value]));
}

function isExportMatch(server: McpServerDefinition, input: McpExportCursorJsonInput): boolean {
  if (!input.includeDisabled && !server.enabled) {
    return false;
  }
  if (input.scope && server.scope !== input.scope) {
    return false;
  }
  if (input.projectId && server.projectId !== input.projectId) {
    return false;
  }
  if (input.projectCwd && normalizePath(server.projectCwd) !== normalizePath(input.projectCwd)) {
    return false;
  }
  return true;
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

export function getProviderMcpCapability(provider: ProviderDriverKind): McpProviderCapability {
  switch (provider) {
    case "cursor":
    case "claudeAgent":
    case "opencode":
      return "sessionConfig";
    case "codex":
      return "nativeConfig";
    default:
      return "unsupported";
  }
}

export function getMcpProviderStatuses(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly activeServerCount: number;
}): ReadonlyArray<McpProviderStatus> {
  return input.providers.map((provider) => {
    const capability = getProviderMcpCapability(provider.driver);
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
          name: server.name,
          command: server.command,
          args: server.args,
          env: Object.entries(server.env).map(([name, value]) => ({
            name,
            value: value.value,
          })),
          ...(server.cwd ? { _meta: { cwd: server.cwd } } : {}),
        } satisfies EffectAcpSchema.McpServer;
      case "sse":
      case "http":
        return {
          type: server.transport,
          name: server.name,
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
      switch (server.transport) {
        case "stdio":
          return [
            server.id,
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
            server.id,
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
      switch (server.transport) {
        case "stdio":
          return [
            server.id,
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
            server.id,
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

function toClientResult(settings: ServerSettings): McpMutationResult {
  return { servers: redactServerSettingsForClient(settings).mcp.servers };
}

const makeMcpConfigEngine = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const provideCaptured = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const updateServers = (servers: ReadonlyArray<McpServerDefinition>) =>
    Effect.try({
      try: () => validateServers(servers),
      catch: (cause) => (isMcpConfigError(cause) ? cause : mcpError("Invalid MCP servers.", cause)),
    }).pipe(
      Effect.flatMap(() =>
        serverSettings.updateSettings({
          mcp: { servers: [...servers] },
        }),
      ),
      Effect.mapError((cause) =>
        isMcpConfigError(cause)
          ? cause
          : mcpError(cause.message || "Failed to update MCP settings.", cause),
      ),
      Effect.map(toClientResult),
    );

  const readSettings = serverSettings.getSettings.pipe(
    Effect.mapError((cause) => mcpError(cause.message, cause)),
  );

  return {
    list: readSettings.pipe(Effect.map((settings) => toClientResult(settings))),
    create: (server) =>
      readSettings.pipe(
        Effect.flatMap((settings) => {
          if (settings.mcp.servers.some((candidate) => candidate.id === server.id)) {
            return Effect.fail(mcpError(`MCP server '${server.id}' already exists.`));
          }
          return updateServers([...settings.mcp.servers, server]);
        }),
      ),
    update: (server) =>
      readSettings.pipe(
        Effect.flatMap((settings) => {
          const index = settings.mcp.servers.findIndex((candidate) => candidate.id === server.id);
          if (index < 0) {
            return Effect.fail(mcpError(`MCP server '${server.id}' was not found.`));
          }
          const servers = [...settings.mcp.servers];
          servers[index] = server;
          return updateServers(servers);
        }),
      ),
    delete: (id) =>
      readSettings.pipe(
        Effect.flatMap((settings) =>
          updateServers(settings.mcp.servers.filter((server) => server.id !== id)),
        ),
      ),
    setEnabled: (id, enabled) =>
      readSettings.pipe(
        Effect.flatMap((settings) =>
          updateServers(
            settings.mcp.servers.map((server) =>
              server.id === id ? { ...server, enabled } : server,
            ),
          ),
        ),
      ),
    importCursorJson: (input) =>
      readSettings.pipe(
        Effect.flatMap((settings) =>
          Effect.try({
            try: () =>
              importCursorMcpServers({
                json: input.json,
                scope: input.scope,
                ...(input.projectId ? { projectId: input.projectId } : {}),
                ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
                reservedIds: input.replace
                  ? new Set()
                  : new Set(settings.mcp.servers.map((server) => server.id)),
              }),
            catch: (cause) =>
              isMcpConfigError(cause)
                ? cause
                : mcpError("Failed to import Cursor MCP JSON.", cause),
          }).pipe(
            Effect.flatMap((imported) =>
              updateServers(input.replace ? imported : [...settings.mcp.servers, ...imported]),
            ),
          ),
        ),
      ),
    discoverImportSources: provideCaptured(
      readSettings.pipe(
        Effect.flatMap((settings) => discoverAgentImportSources({ settings })),
        Effect.mapError((cause) => mcpError("Failed to discover agent import sources.", cause)),
      ),
    ),
    importSources: (input) =>
      provideCaptured(
        readSettings.pipe(
          Effect.flatMap((settings) =>
            importMcpServersFromAgentSources({
              sourceIds: input.sourceIds,
              scope: input.scope,
              ...(input.projectId ? { projectId: input.projectId } : {}),
              ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
              reservedIds: input.replace
                ? new Set()
                : new Set(settings.mcp.servers.map((server) => server.id)),
              existingServers: input.replace ? [] : settings.mcp.servers,
              deduplicate: input.deduplicate,
              settings,
            }).pipe(
              Effect.flatMap((imported) =>
                updateServers(input.replace ? imported : [...settings.mcp.servers, ...imported]),
              ),
            ),
          ),
        ),
      ),
    exportCursorJson: (input) =>
      readSettings.pipe(
        Effect.map((settings) => exportCursorMcpServersJson(settings.mcp.servers, input)),
      ),
    providerStatus: (providers) =>
      readSettings.pipe(
        Effect.map((settings) => ({
          providers: getMcpProviderStatuses({
            providers,
            activeServerCount: resolveActiveMcpServers(settings, { cwd: undefined }).length,
          }),
        })),
      ),
    resolveActiveServers: (input) =>
      readSettings.pipe(Effect.map((settings) => resolveActiveMcpServers(settings, input))),
  } satisfies McpConfigEngineShape;
});

export const McpConfigEngineLive = Layer.effect(McpConfigEngine, makeMcpConfigEngine);
