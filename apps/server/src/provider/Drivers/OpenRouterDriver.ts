import {
  OpenRouterDriverSettings,
  OpenRouterSettings,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { McpConfigEngine } from "../../mcp/McpConfigEngine.ts";
import { make as makeProcessRunner } from "../../processRunner.ts";
import type { InProcessCriticalPressureNotice } from "../../resourceProtection/InProcessWorkAdmission.ts";
import { SubagentResourceGovernor } from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeOpenRouterTextGeneration } from "../../textGeneration/OpenRouterTextGeneration.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import { ProviderAdapterRequestError, ProviderDriverError } from "../Errors.ts";
import type { NativeProviderTurnAdmission } from "../nativeHarness/NativeProviderAdapter.ts";
import { makeNativeProviderHarness } from "../nativeHarness/NativeProviderHarness.ts";
import { makeNativeProviderMcpToolBridge } from "../nativeHarness/NativeProviderMcpToolBridge.ts";
import { nativeHarnessCommandEnvironment } from "../nativeHarness/NativeHarnessTools.ts";
import { makeOpenRouterAdapter } from "../openrouter/OpenRouterAdapter.ts";
import { makeOpenRouterAuthentication } from "../openrouter/auth/OpenRouterAuthentication.ts";
import { makeOpenRouterCredentialStore } from "../openrouter/auth/OpenRouterCredentialStore.ts";
import { makeOpenRouterKeyValidator } from "../openrouter/auth/OpenRouterKeyValidation.ts";
import {
  checkOpenRouterProviderStatus,
  makePendingOpenRouterProvider,
} from "../openrouter/OpenRouterProvider.ts";
import {
  completeOpenRouterText,
  makeOpenRouterTransport,
  OpenRouterAuthenticationError,
} from "../openrouter/OpenRouterTransport.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import {
  makeAlreadyLocalProviderHistorySync,
  makeInstanceHistorySyncSource,
  NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
} from "../Services/ProviderHistorySync.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const DRIVER_KIND = ProviderDriverKind.make("openrouter");
const decodeSettings = Schema.decodeSync(OpenRouterSettings);
const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: "@effect/ai-openrouter",
});

export type OpenRouterDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | McpConfigEngine
  | Path.Path
  | ServerConfig
  | ServerSecretStore.ServerSecretStore
  | ServerSettingsService
  | SubagentResourceGovernor
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

function makeOpenRouterTurnAdmission(
  governor: SubagentResourceGovernor["Service"],
): NativeProviderTurnAdmission {
  return {
    withLease: (input, effect) =>
      Effect.gen(function* () {
        const pressure = yield* Deferred.make<InProcessCriticalPressureNotice>();
        const workId = `${input.providerInstanceId}:${input.threadId}:${input.turnId}`;
        const lease = yield* governor.acquireInProcessLease({
          workId,
          threadId: input.threadId,
          provider: DRIVER_KIND,
          providerInstanceId: input.providerInstanceId,
          reservation: {
            serializedHistoryBytes: input.serializedHistoryBytes,
            attachmentBytes: input.attachmentBytes,
            toolBufferBytes: input.toolBufferBytes,
          },
          onCriticalPressure: (notice) => Deferred.succeed(pressure, notice).pipe(Effect.asVoid),
        });
        if (!lease) {
          return yield* new ProviderAdapterRequestError({
            provider: DRIVER_KIND,
            method: "resource/admission",
            detail: "OpenRouter turn admission was cancelled while the server was shutting down.",
          });
        }
        const pressured = Deferred.await(pressure).pipe(
          Effect.flatMap(
            (notice) =>
              new ProviderAdapterRequestError({
                provider: DRIVER_KIND,
                method: "resource/protection",
                detail: `OpenRouter turn '${notice.workId}' was stopped to protect server memory.`,
              }),
          ),
        );
        return yield* Effect.raceFirst(effect, pressured).pipe(Effect.ensuring(lease.release));
      }),
  };
}

export const OpenRouterDriver: ProviderDriver<OpenRouterSettings, OpenRouterDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "OpenRouter",
    supportsMultipleInstances: true,
  },
  configSchema: OpenRouterDriverSettings,
  defaultConfig: (): OpenRouterSettings => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const resourceGovernor = yield* SubagentResourceGovernor;
      const mcpConfigEngine = yield* McpConfigEngine;
      const processEnvironment = mergeProviderInstanceEnvironment(environment);
      const toolEnvironment = nativeHarnessCommandEnvironment(processEnvironment);
      const effectiveConfig = { ...config, enabled } satisfies OpenRouterSettings;

      const credentialStore = yield* makeOpenRouterCredentialStore({ instanceId, environment });
      const keyValidator = yield* makeOpenRouterKeyValidator();
      const transport = yield* makeOpenRouterTransport({
        resolveApiKey: credentialStore.resolve.pipe(
          Effect.map((credential) => credential.apiKey),
          Effect.mapError(
            () =>
              new OpenRouterAuthenticationError({
                message:
                  "Set an OpenRouter API key or configure OPENROUTER_API_KEY in this provider instance's environment.",
              }),
          ),
        ),
      });

      const processRunner = yield* makeProcessRunner();
      const mcpTools = yield* makeNativeProviderMcpToolBridge({
        instanceId,
        environment: toolEnvironment,
        resolveActiveServers: mcpConfigEngine.resolveActiveServers,
      });
      const harness = yield* makeNativeProviderHarness(processRunner, {
        extensionForThread: mcpTools.extensionForThread,
        releaseThread: mcpTools.releaseThread,
      });
      const adapter = yield* makeOpenRouterAdapter(effectiveConfig, {
        instanceId,
        environment: toolEnvironment,
        transport,
        harness,
        admission: makeOpenRouterTurnAdmission(resourceGovernor),
        resolveMcpServers: ({ cwd }) =>
          mcpConfigEngine
            .resolveActiveServers({ cwd, providerInstanceId: instanceId })
            .pipe(Effect.mapError((cause) => ({ detail: cause.detail }))),
      });

      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const historySync = makeAlreadyLocalProviderHistorySync({
        source: makeInstanceHistorySyncSource({
          driverKind: DRIVER_KIND,
          instanceId,
          continuationKey: continuationIdentity.continuationKey,
          displayName: displayName ?? "OpenRouter",
          capabilities: NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
        }),
        reason: "OpenRouter history is already stored by T3 Code.",
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const checkProvider = checkOpenRouterProviderStatus(effectiveConfig, {
        resolveCredential: credentialStore.resolveOption,
        validateKey: keyValidator.validate,
        listModels: transport.listModels,
      }).pipe(Effect.map(stampIdentity));
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<OpenRouterSettings>
      >({
        maintenanceCapabilities: MAINTENANCE,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          makePendingOpenRouterProvider(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build OpenRouter snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const textGeneration = makeOpenRouterTextGeneration(
        effectiveConfig,
        (request) =>
          completeOpenRouterText(transport, {
            model: request.model,
            instructions: request.instructions,
            history: [{ type: "user", content: request.prompt }],
            tools: [],
            settings: effectiveConfig,
            ...(request.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: request.reasoningEffort }),
          }),
        {
          isModelAvailable: (model) =>
            transport
              .listModels(effectiveConfig.customModels)
              .pipe(
                Effect.map((catalog) =>
                  catalog.some(
                    (candidate) =>
                      candidate.id === model && candidate.incompatibilityReason === undefined,
                  ),
                ),
              ),
        },
      );
      const authentication = makeOpenRouterAuthentication({
        instanceId,
        credentialStore,
        keyValidator,
        stopAll: adapter.stopAll(),
        refreshSnapshot: snapshot.refresh,
      });

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
        authentication,
      } satisfies ProviderInstance;
    }),
};
