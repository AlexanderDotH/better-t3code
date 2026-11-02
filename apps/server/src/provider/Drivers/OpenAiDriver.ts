import {
  makeAlreadyLocalProviderHistorySync,
  makeInstanceHistorySyncSource,
  NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
} from "@t3tools/provider-core/server/ProviderHistorySync";
import { IdAllocatorV2 } from "@t3tools/provider-core/server/IdAllocator";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import { OpenAiSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

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
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import { makeNativeProviderMcpToolBridge } from "../nativeHarness/NativeProviderMcpToolBridge.ts";
import { makeNativeProviderHarness } from "../nativeHarness/NativeProviderHarness.ts";
import { nativeHarnessCommandEnvironment } from "../nativeHarness/NativeHarnessTools.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { makeManualOnlyProviderMaintenanceCapabilities } from "@t3tools/provider-core/server/maintenanceResolver";
import type { ServerProviderDraft } from "@t3tools/provider-core/server/snapshotProbe";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";

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
  | IdAllocatorV2
  | ProviderHost
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
  create: Effect.fn("OpenAiDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const resourceGovernor = yield* SubagentResourceGovernor;
    const mcpConfigEngine = yield* McpConfigEngine;
    const processEnvironment = yield* mergeProviderInstanceEnvironment(
      environment,
      yield* HostProcess.Environment,
    );
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
    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<OpenAiSettings>>({
      resolveMaintenance: () => Effect.succeed(MAINTENANCE),
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
      orchestrationAdapter: adapter,
      historySync: makeAlreadyLocalProviderHistorySync({
        source: makeInstanceHistorySyncSource({
          driverKind: DRIVER_KIND,
          instanceId,
          continuationKey: continuationIdentity.continuationKey,
          displayName: displayName ?? "OpenAi",
          capabilities: NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
        }),
        reason: "Conversation history is already stored by T3 Code.",
      }),
      textGeneration,
      authentication,
    } satisfies ProviderInstance;
  }),
};
