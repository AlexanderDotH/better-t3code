/**
 * ClaudeDriver — `ProviderDriver` for the Claude Agent SDK runtime.
 *
 * Mirrors `CodexDriver`: a plain value whose `create()` returns one
 * `ProviderInstance` bundling `snapshot` / `adapter` / `textGeneration`
 * closures captured over the per-instance `ClaudeSettings`.
 *
 * Unlike Codex, the Claude snapshot probe may invoke a secondary probe
 * (`probeClaudeCapabilities`) to read Anthropic account + slash-command
 * metadata. That probe is per-instance and keyed by binary + resolved HOME so
 * two concurrent Claude instances don't cross-contaminate account metadata.
 *
 * @module provider/Drivers/ClaudeDriver
 */
import { ClaudeSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeClaudeTextGeneration } from "../../textGeneration/ClaudeTextGeneration.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { McpConfigEngine, toClaudeMcpServers } from "../../mcp/McpConfigEngine.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeClaudeAdapter } from "../Layers/ClaudeAdapter.ts";
import {
  makeClaudeHistorySyncAdapter,
  makeClaudeHomeSessionStore,
} from "../history/ClaudeHistorySync.ts";
import {
  checkClaudeProviderStatus,
  makePendingClaudeProvider,
  probeClaudeCapabilities,
} from "../Layers/ClaudeProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import * as ModelManifest from "../ModelManifest.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import {
  makeInstanceHistorySyncSource,
  makeSupportedProviderHistorySync,
} from "../Services/ProviderHistorySync.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import type { ClaudeDiscoveredModel } from "./ClaudeDiscoveredModels.ts";
import {
  type ClaudeGatewayCatalog,
  loadClaudeGatewayCatalog,
  resolveClaudeGatewayDiscoveredModelProfile,
  resolveClaudeGatewayModelProfile,
} from "./ClaudeGatewayCatalog.ts";
import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  resolveClaudeConfigDir,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";
const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

const DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const HISTORY_SYNC_CAPABILITIES = {
  search: true,
  archived: false,
  resume: true,
  activity: false,
} as const;
const CAPABILITIES_PROBE_TTL = Duration.minutes(5);
const OPAQUE_GATEWAY_MODEL_IDS = new Set(["default"]);

export function enrichClaudeGatewayCatalogAliases(
  catalog: ClaudeGatewayCatalog,
  discoveredModels: ReadonlyArray<ClaudeDiscoveredModel>,
): ClaudeGatewayCatalog {
  let changed = false;
  const profiles = catalog.profiles.map((profile) => {
    const aliases = new Set(profile.aliases);
    for (const discovered of discoveredModels) {
      const value = discovered.value.trim();
      if (!value || OPAQUE_GATEWAY_MODEL_IDS.has(value)) continue;
      const resolvedProfile = resolveClaudeGatewayDiscoveredModelProfile(catalog, discovered);
      if (resolvedProfile !== profile || aliases.has(value)) {
        continue;
      }
      aliases.add(value);
      changed = true;
    }
    return aliases.size === profile.aliases.length
      ? profile
      : { ...profile, aliases: [...aliases] };
  });
  return changed ? { profiles } : catalog;
}

function isClaudeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.local/bin/claude") ||
    normalized.endsWith("/.local/bin/claude.exe") ||
    normalized.includes("/.local/share/claude/")
  );
}

const UPDATE = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "@anthropic-ai/claude-code",
  homebrewFormula: "claude-code",
  nativeUpdate: {
    executable: "claude",
    args: ["update"],
    lockKey: "claude-native",
    isCommandPath: isClaudeNativeCommandPath,
  },
});

export type ClaudeDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | McpConfigEngine
  | ModelManifest.ModelManifest
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const ClaudeDriver: ProviderDriver<ClaudeSettings, ClaudeDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Claude",
    supportsMultipleInstances: true,
  },
  configSchema: ClaudeSettings,
  defaultConfig: (): ClaudeSettings => decodeClaudeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { cwd } = yield* ServerConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const serverSettings = yield* ServerSettingsService;
      const eventLoggers = yield* ProviderEventLoggers;
      const mcpConfigEngine = yield* McpConfigEngine;
      const modelManifest = yield* ModelManifest.ModelManifest;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const fallbackContinuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const effectiveConfig = { ...config, enabled } satisfies ClaudeSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });
      const continuationGroupKey = yield* makeClaudeContinuationGroupKey(effectiveConfig);
      const historySource = makeInstanceHistorySyncSource({
        driverKind: DRIVER_KIND,
        instanceId,
        continuationKey: continuationGroupKey,
        displayName: displayName ?? "Claude",
        capabilities: HISTORY_SYNC_CAPABILITIES,
      });
      const historyConfigDir = yield* resolveClaudeConfigDir(effectiveConfig);
      const historyStore = yield* makeClaudeHomeSessionStore(historyConfigDir);
      const historySync = makeSupportedProviderHistorySync({
        source: historySource,
        adapter: makeClaudeHistorySyncAdapter({
          sourceId: historySource.sourceId,
          sessionStore: historyStore,
        }),
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey,
      });

      // One cache entry owns both discovery sources for this provider instance.
      // Runtime profile lookups and provider snapshots therefore observe the
      // same catalog, including aliases learned from the SDK initialization.
      const resolvedHomePath = yield* resolveClaudeHomePath(effectiveConfig);
      const combinedProbeCache = yield* Cache.make({
        capacity: 1,
        timeToLive: CAPABILITIES_PROBE_TTL,
        lookup: () =>
          Effect.all(
            {
              capabilities: probeClaudeCapabilities(effectiveConfig, processEnv, cwd).pipe(
                Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                Effect.provideService(Path.Path, path),
              ),
              gatewayCatalog: loadClaudeGatewayCatalog({
                environment: processEnv,
                homePath: resolvedHomePath,
              }).pipe(
                Effect.provideService(FileSystem.FileSystem, fileSystem),
                Effect.provideService(HttpClient.HttpClient, httpClient),
                Effect.provideService(Path.Path, path),
              ),
            },
            { concurrency: "unbounded" },
          ).pipe(
            Effect.map(({ capabilities, gatewayCatalog }) => ({
              capabilities,
              gatewayCatalog: enrichClaudeGatewayCatalogAliases(
                gatewayCatalog,
                capabilities?.models ?? [],
              ),
            })),
          ),
      });
      const combinedProbeCacheKey = yield* makeClaudeCapabilitiesCacheKey(effectiveConfig, cwd);
      const resolveCombinedProbe = () => Cache.get(combinedProbeCache, combinedProbeCacheKey);
      const resolveGatewayCatalog = () =>
        resolveCombinedProbe().pipe(Effect.map(({ gatewayCatalog }) => gatewayCatalog));
      const resolveGatewayProfile = (modelId: string | null | undefined) =>
        resolveGatewayCatalog().pipe(
          Effect.map((catalog) => resolveClaudeGatewayModelProfile(catalog, modelId)),
        );

      const adapterOptions = {
        instanceId,
        environment: processEnv,
        resolveGatewayProfile,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        resolveMcpServers: ({ cwd }: { readonly cwd: string }) =>
          mcpConfigEngine.resolveActiveServers({ cwd, providerInstanceId: instanceId }).pipe(
            Effect.map(toClaudeMcpServers),
            Effect.catch((cause) =>
              Effect.logWarning("Failed to resolve MCP servers for Claude session", {
                detail: cause.detail,
              }).pipe(Effect.as(toClaudeMcpServers([]))),
            ),
          ),
      };
      const adapter = yield* makeClaudeAdapter(effectiveConfig, adapterOptions);
      const textGeneration = yield* makeClaudeTextGeneration(effectiveConfig, processEnv, {
        resolveGatewayModelProfile: resolveGatewayProfile,
      });

      // Kick the TTL-gated manifest refresh in the background and classify
      // with the in-memory manifest, so a slow or hung fetch never delays the
      // provider check. A refresh that lands mid-probe applies on the next one.
      const checkProvider = modelManifest.refreshInBackground.pipe(
        Effect.andThen(
          Effect.zipWith(
            checkClaudeProviderStatus(
              effectiveConfig,
              () => resolveCombinedProbe().pipe(Effect.map(({ capabilities }) => capabilities)),
              processEnv,
              cwd,
              resolveGatewayCatalog,
            ),
            modelManifest.current,
            (draft, manifest) =>
              stampIdentity(ModelManifest.applyModelManifest(draft, manifest, DRIVER_KIND)),
            { concurrent: true },
          ),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<ClaudeSettings>>({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          Effect.zipWith(
            makePendingClaudeProvider(settings.provider),
            modelManifest.current,
            (draft, manifest) =>
              stampIdentity(ModelManifest.applyModelManifest(draft, manifest, DRIVER_KIND)),
          ),
        checkProvider,
        enrichSnapshot: ({ settings, snapshot, publishSnapshot }) =>
          enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities, {
            enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
          }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
          ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Claude snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity: {
          ...fallbackContinuationIdentity,
          continuationKey: continuationGroupKey,
        },
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        historySync,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
