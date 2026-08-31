import {
  ChatGptSettings,
  ProviderAuthOperationError,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { McpConfigEngine } from "../../mcp/McpConfigEngine.ts";
import { make as makeProcessRunner } from "../../processRunner.ts";
import { SubagentResourceGovernor } from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeChatGptTextGeneration } from "../../textGeneration/ChatGptTextGeneration.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import { ProviderDriverError } from "../Errors.ts";
import {
  chatGptAuthBrokerEnvironment,
  makeChatGptAuthBroker,
} from "../chatgpt/ChatGptAuthBroker.ts";
import { makeChatGptCredentialStore } from "../chatgpt/ChatGptCredentialStore.ts";
import { makeChatGptSubscriptionTransport } from "../chatgpt/ChatGptSubscriptionTransport.ts";
import { ChatGptAdapterBoundaryError, makeChatGptAdapter } from "../Layers/ChatGptAdapter.ts";
import { makeChatGptNativeHarness } from "../Layers/ChatGptNativeHarness.ts";
import { makeNativeProviderMcpToolBridge } from "../nativeHarness/NativeProviderMcpToolBridge.ts";
import {
  checkChatGptProviderStatus,
  makePendingChatGptProvider,
} from "../Layers/ChatGptProvider.ts";
import { makeChatGptAdapterTransport } from "../Layers/ChatGptTransportBridge.ts";
import { makeChatGptTurnAdmission } from "../Layers/ChatGptTurnAdmission.ts";
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

const DRIVER_KIND = ProviderDriverKind.make("chatgpt");
const decodeSettings = Schema.decodeSync(ChatGptSettings);
const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: "@openai/codex",
});

export type ChatGptDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | McpConfigEngine
  | Path.Path
  | ServerConfig
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

export const ChatGptDriver: ProviderDriver<ChatGptSettings, ChatGptDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "ChatGPT Subscription",
    supportsMultipleInstances: true,
  },
  configSchema: ChatGptSettings,
  defaultConfig: (): ChatGptSettings => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig;
      const serverSettings = yield* ServerSettingsService;
      const resourceGovernor = yield* SubagentResourceGovernor;
      const mcpConfigEngine = yield* McpConfigEngine;
      const processEnvironment = mergeProviderInstanceEnvironment(environment);
      const credentialStore = yield* makeChatGptCredentialStore(instanceId);
      yield* credentialStore.prepare.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: cause.message,
              cause,
            }),
        ),
      );
      const authEnvironment = chatGptAuthBrokerEnvironment(
        credentialStore.home,
        processEnvironment,
      );
      const authBroker = yield* makeChatGptAuthBroker({
        credentialStore,
        binaryPath: config.binaryPath,
        cwd: serverConfig.cwd,
        environment: authEnvironment,
      });
      const subscriptionTransport = yield* makeChatGptSubscriptionTransport({
        credentialStore,
        authBroker,
      });
      const transport = makeChatGptAdapterTransport(subscriptionTransport);
      const processRunner = yield* makeProcessRunner();
      const mcpTools = yield* makeNativeProviderMcpToolBridge({
        instanceId,
        environment: processEnvironment,
        resolveActiveServers: mcpConfigEngine.resolveActiveServers,
      });
      const harness = yield* makeChatGptNativeHarness(processRunner, {
        extensionForThread: mcpTools.extensionForThread,
        releaseThread: mcpTools.releaseThread,
      });
      let authBlocked = false;
      const effectiveConfig = { ...config, enabled } satisfies ChatGptSettings;
      const adapter = yield* makeChatGptAdapter(effectiveConfig, {
        instanceId,
        environment: processEnvironment,
        transport,
        harness,
        admission: makeChatGptTurnAdmission(resourceGovernor),
        authorize: Effect.suspend(() =>
          authBlocked
            ? Effect.succeed(false)
            : credentialStore.read.pipe(
                Effect.map(Option.isSome),
                Effect.mapError(
                  (cause) =>
                    new ChatGptAdapterBoundaryError({
                      operation: "authentication/status",
                      detail: cause.message,
                      cause,
                    }),
                ),
              ),
        ),
        resolveMcpServers: ({ cwd }) =>
          mcpConfigEngine.resolveActiveServers({ cwd, providerInstanceId: instanceId }).pipe(
            Effect.mapError(
              (cause) =>
                new ChatGptAdapterBoundaryError({
                  operation: "mcp/configuration",
                  detail: cause.detail,
                  cause,
                }),
            ),
          ),
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
          displayName: displayName ?? "ChatGPT Subscription",
          capabilities: NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
        }),
        reason: "ChatGPT Subscription history is already stored by T3 Code.",
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const checkProvider = checkChatGptProviderStatus(effectiveConfig, authBroker, transport).pipe(
        Effect.map(stampIdentity),
      );
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<ChatGptSettings>>({
        maintenanceCapabilities: MAINTENANCE,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          makePendingChatGptProvider(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build ChatGPT Subscription snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );
      const authentication = {
        connect: (input) => {
          if (input.instanceId !== instanceId) {
            return Stream.fail(
              new ProviderAuthOperationError({
                instanceId,
                operation: "connect",
                code: "provider-not-found",
                reason: `Expected provider instance '${instanceId}'.`,
                retryable: false,
              }),
            );
          }
          return authBroker.connect(input.flow).pipe(
            Stream.tap((event) =>
              event.type === "connected"
                ? Effect.sync(() => {
                    authBlocked = false;
                  })
                : Effect.void,
            ),
          );
        },
        disconnect: (input) => {
          if (input.instanceId !== instanceId) {
            return Effect.fail(
              new ProviderAuthOperationError({
                instanceId,
                operation: "disconnect",
                code: "provider-not-found",
                reason: `Expected provider instance '${instanceId}'.`,
                retryable: false,
              }),
            );
          }
          return Effect.sync(() => {
            authBlocked = true;
          }).pipe(
            Effect.andThen(
              adapter.stopAll().pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAuthOperationError({
                      instanceId,
                      operation: "disconnect",
                      code: "disconnect-conflict",
                      reason: cause.message,
                      retryable: true,
                    }),
                ),
              ),
            ),
            Effect.andThen(
              authBroker.disconnect.pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAuthOperationError({
                      instanceId,
                      operation: "disconnect",
                      code: cause.code,
                      reason: cause.reason,
                      retryable: cause.retryable,
                    }),
                ),
              ),
            ),
            Effect.map((auth) => ({ instanceId, auth })),
          );
        },
      } satisfies NonNullable<ProviderInstance["authentication"]>;

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
        textGeneration: makeChatGptTextGeneration(subscriptionTransport),
        authentication,
      } satisfies ProviderInstance;
    }),
};
