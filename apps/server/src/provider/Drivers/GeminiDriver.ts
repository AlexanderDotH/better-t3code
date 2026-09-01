import { GeminiSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { make as makeProcessRunner } from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeGeminiTextGeneration } from "../../textGeneration/GeminiTextGeneration.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeGeminiAdapter } from "../Layers/GeminiAdapter.ts";
import { makeGeminiHarnessToolExecutor } from "../Layers/GeminiHarness.ts";
import { checkGeminiProviderStatus, makePendingGeminiProvider } from "../Layers/GeminiProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import {
  makeAlreadyLocalProviderHistorySync,
  makeInstanceHistorySyncSource,
  NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
} from "../Services/ProviderHistorySync.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const DRIVER_KIND = ProviderDriverKind.make("gemini");
const decodeGeminiSettings = Schema.decodeSync(GeminiSettings);
const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: "@google/genai",
});

export type GeminiDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig
  | ServerSettingsService
  | WorkspaceContext.WorkspaceContext
  | WorkspaceFileSystem.WorkspaceFileSystem;

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

export const GeminiDriver: ProviderDriver<GeminiSettings, GeminiDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Gemini",
    supportsMultipleInstances: true,
  },
  configSchema: GeminiSettings,
  defaultConfig: (): GeminiSettings => decodeGeminiSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies GeminiSettings;
      const historySync = makeAlreadyLocalProviderHistorySync({
        source: makeInstanceHistorySyncSource({
          driverKind: DRIVER_KIND,
          instanceId,
          continuationKey: continuationIdentity.continuationKey,
          displayName: displayName ?? "Gemini",
          capabilities: NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
        }),
        reason: "Gemini history is already stored by T3 Code.",
      });
      const processRunner = yield* makeProcessRunner();
      const toolExecutor = yield* makeGeminiHarnessToolExecutor(processRunner);
      const adapter = yield* makeGeminiAdapter(effectiveConfig, {
        environment: processEnv,
        instanceId,
        toolExecutor,
      });
      const textGeneration = yield* makeGeminiTextGeneration(effectiveConfig, processEnv);
      const checkProvider = checkGeminiProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
      );
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<GeminiSettings>>({
        maintenanceCapabilities: MAINTENANCE,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          makePendingGeminiProvider(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Gemini snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
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
