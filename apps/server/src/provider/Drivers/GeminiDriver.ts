import { type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeGeminiAdapter } from "../Layers/GeminiAdapter.ts";
import {
  buildInitialGeminiProviderSnapshot,
  checkGeminiProviderStatus,
} from "../Layers/GeminiProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import {
  decodeGeminiSettings,
  GEMINI_DRIVER_KIND,
  GeminiSettings,
  type GeminiSettings as GeminiSettingsType,
} from "./GeminiConfig.ts";
import { makeGeminiTextGeneration } from "./GeminiTextGeneration.ts";

const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: GEMINI_DRIVER_KIND,
  packageName: null,
});

export type GeminiDriverEnv =
  | ServerSettingsService
  | Crypto.Crypto
  | FileSystem.FileSystem
  | ServerConfig;

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
    driver: GEMINI_DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const GeminiDriver: ProviderDriver<GeminiSettingsType, GeminiDriverEnv> = {
  driverKind: GEMINI_DRIVER_KIND,
  metadata: {
    displayName: "Gemini",
    supportsMultipleInstances: true,
  },
  configSchema: GeminiSettings,
  defaultConfig: (): GeminiSettingsType => decodeGeminiSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: GEMINI_DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies GeminiSettingsType;

      const adapter = yield* makeGeminiAdapter(effectiveConfig, processEnv, { instanceId });
      const textGeneration = yield* makeGeminiTextGeneration(effectiveConfig, processEnv);

      const checkProvider = checkGeminiProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<GeminiSettingsType>
      >({
        maintenanceCapabilities: MAINTENANCE_CAPABILITIES,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialGeminiProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider,
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: GEMINI_DRIVER_KIND,
              instanceId,
              detail: `Failed to build Gemini snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: GEMINI_DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
