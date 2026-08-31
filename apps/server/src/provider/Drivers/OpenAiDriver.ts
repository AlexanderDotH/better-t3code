import { OpenAiSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
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
import { SubagentResourceGovernor } from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeOpenAiTextGeneration } from "../../textGeneration/OpenAiTextGeneration.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeOpenAiAdapter } from "../openai/OpenAiAdapter.ts";
import { makeOpenAiAuthentication } from "../openai/auth/OpenAiAuthentication.ts";
import { makeOpenAiCredentialStore } from "../openai/auth/OpenAiCredentialStore.ts";
import { makeOpenAiKeyValidator } from "../openai/auth/OpenAiKeyValidation.ts";
import { checkOpenAiProviderStatus, makePendingOpenAiProvider } from "../openai/OpenAiProvider.ts";
import {
  completeOpenAiText,
  makeOpenAiTransport,
  OpenAiAuthenticationError,
} from "../openai/OpenAiTransport.ts";
import { makeOpenAiTurnAdmission } from "../openai/OpenAiTurnAdmission.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { makeNativeProviderMcpToolBridge } from "../nativeHarness/NativeProviderMcpToolBridge.ts";
import { makeNativeProviderHarness } from "../nativeHarness/NativeProviderHarness.ts";
import { nativeHarnessCommandEnvironment } from "../nativeHarness/NativeHarnessTools.ts";
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

const DRIVER_KIND = ProviderDriverKind.make("openai");
const decodeSettings = Schema.decodeSync(OpenAiSettings);
const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type OpenAiDriverEnv =
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

export const OpenAiDriver: ProviderDriver<OpenAiSettings, OpenAiDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "OpenAI Responses",
    supportsMultipleInstances: true,
  },
  configSchema: OpenAiSettings,
  defaultConfig: (): OpenAiSettings => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const resourceGovernor = yield* SubagentResourceGovernor;
      const mcpConfigEngine = yield* McpConfigEngine;
      const processEnvironment = mergeProviderInstanceEnvironment(environment);
      const toolEnvironment = nativeHarnessCommandEnvironment(processEnvironment);
      const effectiveConfig = { ...config, enabled } satisfies OpenAiSettings;

      const credentialStore = yield* makeOpenAiCredentialStore({ instanceId, environment });
      const transport = yield* makeOpenAiTransport({
        resolveApiKey: credentialStore.resolve.pipe(
          Effect.map((credential) => credential.apiKey),
          Effect.mapError(
            () =>
              new OpenAiAuthenticationError({
                message:
                  "Set an OpenAI API key or configure OPENAI_API_KEY in this provider instance's environment.",
              }),
          ),
        ),
      });
      const keyValidator = yield* makeOpenAiKeyValidator();
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
      const adapter = yield* makeOpenAiAdapter(effectiveConfig, {
        instanceId,
        environment: toolEnvironment,
        transport,
        harness,
        admission: makeOpenAiTurnAdmission(resourceGovernor),
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
          displayName: displayName ?? "OpenAI Responses",
          capabilities: NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
        }),
        reason: "OpenAI Responses history is already stored by T3 Code.",
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const checkProvider = checkOpenAiProviderStatus(effectiveConfig, {
        resolveCredential: credentialStore.resolveOption,
        listModels: transport.listModels,
      }).pipe(Effect.map(stampIdentity));
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<OpenAiSettings>>({
        maintenanceCapabilities: MAINTENANCE,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          makePendingOpenAiProvider(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build OpenAI Responses snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const textGeneration = makeOpenAiTextGeneration(
        effectiveConfig,
        (request) =>
          completeOpenAiText(transport, {
            model: request.model,
            instructions: request.instructions,
            history: [
              {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: request.prompt }],
              },
            ],
            tools: [],
            responseFormat: request.responseFormat,
            ...(request.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: request.reasoningEffort }),
          }),
        {
          isModelAvailable: (model) =>
            transport.listModels.pipe(
              Effect.map((catalog) => catalog.some((candidate) => candidate.id === model)),
            ),
        },
      );
      const authentication = makeOpenAiAuthentication({
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
