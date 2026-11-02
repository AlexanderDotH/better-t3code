import {
  makeAlreadyLocalProviderHistorySync,
  makeInstanceHistorySyncSource,
  NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
} from "@t3tools/provider-core/server/ProviderHistorySync";
import { IdAllocatorV2 } from "@t3tools/provider-core/server/IdAllocator";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
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
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

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
import { ChatGptAdapterBoundaryError, makeChatGptAdapter } from "../ChatGptAdapter.ts";
import { makeChatGptNativeHarness } from "../ChatGptNativeHarness.ts";
import { makeNativeProviderMcpToolBridge } from "../nativeHarness/NativeProviderMcpToolBridge.ts";
import { checkChatGptProviderStatus, makePendingChatGptProvider } from "../ChatGptProvider.ts";
import { makeChatGptAdapterTransport } from "../ChatGptTransportBridge.ts";
import { makeChatGptTurnAdmission } from "../ChatGptTurnAdmission.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
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

export const ChatGptDriver: ProviderDriver<ChatGptSettings, ChatGptDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "ChatGPT Subscription",
    supportsMultipleInstances: true,
  },
  configSchema: ChatGptSettings,
  defaultConfig: (): ChatGptSettings => decodeSettings({}),
  create: Effect.fn("ChatGptDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const serverConfig = yield* ServerConfig;
    const resourceGovernor = yield* SubagentResourceGovernor;
    const mcpConfigEngine = yield* McpConfigEngine;
    const processEnvironment = yield* mergeProviderInstanceEnvironment(
      environment,
      yield* HostProcess.Environment,
    );
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
    const authEnvironment = chatGptAuthBrokerEnvironment(credentialStore.home, processEnvironment);
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
    const stampIdentity = withInstanceIdentity({
      instanceId,
      displayName,
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const checkProvider = checkChatGptProviderStatus(effectiveConfig, authBroker, transport).pipe(
      Effect.map(stampIdentity),
    );
    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<ChatGptSettings>>({
      resolveMaintenance: () => Effect.succeed(MAINTENANCE),
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
          Effect.andThen(adapter.stopAll()),
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
      orchestrationAdapter: adapter,
      historySync: makeAlreadyLocalProviderHistorySync({
        source: makeInstanceHistorySyncSource({
          driverKind: DRIVER_KIND,
          instanceId,
          continuationKey: continuationIdentity.continuationKey,
          displayName: displayName ?? "ChatGpt",
          capabilities: NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
        }),
        reason: "Conversation history is already stored by T3 Code.",
      }),
      textGeneration: makeChatGptTextGeneration(subscriptionTransport),
      authentication,
    } satisfies ProviderInstance;
  }),
};
