import { ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { makeUnsupportedTextGeneration } from "../../textGeneration/UnsupportedTextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeHyperagentAdapter } from "../Layers/HyperagentAdapter.ts";
import {
  checkHyperagentProviderStatus,
  makePendingHyperagentProvider,
} from "../Layers/HyperagentProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { HyperagentSettings } from "../hyperagent/HyperagentSettings.ts";

const DRIVER_KIND = ProviderDriverKind.make("hyperagent");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);
const decodeHyperagentSettings = Schema.decodeSync(HyperagentSettings);
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type HyperagentDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | Crypto.Crypto
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

export const HyperagentDriver: ProviderDriver<HyperagentSettings, HyperagentDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Hyperagent",
    supportsMultipleInstances: true,
  },
  configSchema: HyperagentSettings,
  defaultConfig: (): HyperagentSettings => decodeHyperagentSettings({}),
  create: ({ instanceId, displayName, accentColor, enabled, config }) =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const effectiveConfig = { ...config, enabled } satisfies HyperagentSettings;
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

      const adapter = yield* makeHyperagentAdapter(effectiveConfig, { instanceId });
      const textGeneration = makeUnsupportedTextGeneration("Hyperagent");
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<HyperagentSettings>
      >({
        maintenanceCapabilities: MAINTENANCE_CAPABILITIES,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          makePendingHyperagentProvider(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: checkHyperagentProviderStatus(effectiveConfig).pipe(
          Effect.map(stampIdentity),
        ),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Hyperagent snapshot: ${cause.message ?? String(cause)}`,
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
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
