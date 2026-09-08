import type { McpMutationResult, McpServerDefinition, ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  discoverAgentImportSources,
  importMcpServersFromAgentSources,
} from "../agentImportSources.ts";
import { redactServerSettingsForClient, ServerSettingsService } from "../serverSettings.ts";
import { exportCursorMcpServersJson, importCursorMcpServers } from "./McpCursorInterop.ts";
import type { McpConfigEngineShape } from "./McpConfigService.ts";
import { McpConfigurationReconciler } from "./McpConfigurationReconciler.ts";
import { getMcpProviderStatuses } from "./McpProviderConfigProjection.ts";
import {
  configuredMcpProviderInstanceIds,
  isMcpConfigError,
  mcpConfigError,
  resolveActiveMcpServers,
  updateMcpProviderRouting,
  validateMcpServers,
} from "./McpServerResolution.ts";

function toClientResult(
  settings: ServerSettings,
  liveApplyResults: McpMutationResult["liveApplyResults"] = [],
): McpMutationResult {
  return {
    servers: redactServerSettingsForClient(settings).mcp.servers,
    liveApplyResults,
  };
}

export const makeMcpConfigEngine = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const reconciler = Option.getOrUndefined(yield* Effect.serviceOption(McpConfigurationReconciler));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const provideCaptured = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const updateServers = <R>(
    modify: (
      settings: ServerSettings,
    ) => Effect.Effect<ReadonlyArray<McpServerDefinition>, ReturnType<typeof mcpConfigError>, R>,
  ) =>
    serverSettings
      .modifySettings((settings) =>
        modify(settings).pipe(
          Effect.tap((servers) =>
            Effect.try({
              try: () => validateMcpServers(servers),
              catch: (cause) =>
                isMcpConfigError(cause) ? cause : mcpConfigError("Invalid MCP servers.", cause),
            }),
          ),
          Effect.map((servers) => ({
            ...settings,
            mcp: { ...settings.mcp, servers: [...servers] },
          })),
        ),
      )
      .pipe(
        Effect.flatMap((settings) =>
          (reconciler?.reconcileCurrent ?? Effect.succeed([])).pipe(
            Effect.map((liveApplyResults) => toClientResult(settings, liveApplyResults)),
          ),
        ),
        Effect.mapError((cause) =>
          isMcpConfigError(cause)
            ? cause
            : mcpConfigError(cause.message || "Failed to update MCP settings.", cause),
        ),
      );

  const readSettings = serverSettings.getSettings.pipe(
    Effect.mapError((cause) => mcpConfigError(cause.message, cause)),
  );

  return {
    list: readSettings.pipe(Effect.map((settings) => toClientResult(settings))),
    create: (server) =>
      updateServers((settings) => {
        if (settings.mcp.servers.some((candidate) => candidate.id === server.id)) {
          return Effect.fail(mcpConfigError(`MCP server '${server.id}' already exists.`));
        }
        return Effect.succeed([...settings.mcp.servers, server]);
      }),
    update: (server) =>
      updateServers((settings) => {
        const index = settings.mcp.servers.findIndex((candidate) => candidate.id === server.id);
        if (index < 0) {
          return Effect.fail(mcpConfigError(`MCP server '${server.id}' was not found.`));
        }
        const servers = [...settings.mcp.servers];
        const current = servers[index]!;
        servers[index] = {
          ...server,
          providerRouting: server.providerRouting ?? current.providerRouting,
        } as McpServerDefinition;
        return Effect.succeed(servers);
      }),
    delete: (id) =>
      updateServers((settings) =>
        Effect.succeed(settings.mcp.servers.filter((server) => server.id !== id)),
      ),
    setEnabled: (id, enabled) =>
      updateServers((settings) =>
        Effect.succeed(
          settings.mcp.servers.map((server) =>
            server.id === id ? { ...server, enabled } : server,
          ),
        ),
      ),
    setProviderEnabled: (input) =>
      updateServers((settings) => {
        const index = settings.mcp.servers.findIndex((server) => server.id === input.serverId);
        if (index < 0) {
          return Effect.fail(mcpConfigError(`MCP server '${input.serverId}' was not found.`));
        }
        const servers = [...settings.mcp.servers];
        const server = servers[index]!;
        servers[index] = {
          ...server,
          providerRouting: updateMcpProviderRouting({
            routing: server.providerRouting,
            providerInstanceId: input.providerInstanceId,
            enabled: input.enabled,
            configuredInstanceIds: configuredMcpProviderInstanceIds(settings),
          }),
        };
        return Effect.succeed(servers);
      }),
    importCursorJson: (input) =>
      updateServers((settings) =>
        Effect.try({
          try: () =>
            importCursorMcpServers({
              json: input.json,
              providerRouting: input.providerRouting,
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
              : mcpConfigError("Failed to import Cursor MCP JSON.", cause),
        }).pipe(
          Effect.map((imported) =>
            input.replace ? imported : [...settings.mcp.servers, ...imported],
          ),
        ),
      ),
    discoverImportSources: provideCaptured(
      readSettings.pipe(
        Effect.flatMap((settings) => discoverAgentImportSources({ settings })),
        Effect.mapError((cause) =>
          mcpConfigError("Failed to discover agent import sources.", cause),
        ),
      ),
    ),
    importSources: (input) =>
      provideCaptured(
        updateServers((settings) =>
          importMcpServersFromAgentSources({
            sourceIds: input.sourceIds,
            providerRouting: input.providerRouting,
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
            Effect.map((imported) =>
              input.replace ? imported : [...settings.mcp.servers, ...imported],
            ),
          ),
        ),
      ),
    exportCursorJson: (input) =>
      readSettings.pipe(
        Effect.map((settings) => exportCursorMcpServersJson(settings.mcp.servers, input)),
      ),
    providerStatus: (providers, input = {}, providerCapability) =>
      readSettings.pipe(
        Effect.flatMap((settings) =>
          Effect.forEach(providers, (provider) =>
            (
              providerCapability?.(provider.instanceId) ??
              reconciler?.providerCapability(provider.instanceId) ??
              Effect.succeed("unsupported" as const)
            ).pipe(
              Effect.map(
                (capability) =>
                  getMcpProviderStatuses({
                    providers: [provider],
                    activeServerCount: resolveActiveMcpServers(settings, {
                      ...input,
                      providerInstanceId: provider.instanceId,
                    }).length,
                    capabilities: new Map([[provider.instanceId, capability]]),
                  })[0]!,
              ),
            ),
          ),
        ),
        Effect.map((providerStatuses) => ({ providers: providerStatuses })),
      ),
    resolveActiveServers: (input) =>
      readSettings.pipe(Effect.map((settings) => resolveActiveMcpServers(settings, input))),
  } satisfies McpConfigEngineShape;
});
