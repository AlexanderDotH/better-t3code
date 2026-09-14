import { LmStudioSettings, OpenAiCompatibleSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";

import { McpConfigEngine } from "../../mcp/McpConfigEngine.ts";
import { make as makeProcessRunner } from "../../processRunner.ts";
import { SubagentResourceGovernor } from "../../resourceProtection/SubagentResourceGovernor.ts";
import { makeOpenAiCompatibleTextGeneration } from "../../textGeneration/OpenAiCompatibleTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { nativeHarnessCommandEnvironment } from "../nativeHarness/NativeHarnessTools.ts";
import { makeNativeProviderHarness } from "../nativeHarness/NativeProviderHarness.ts";
import { makeNativeProviderMcpToolBridge } from "../nativeHarness/NativeProviderMcpToolBridge.ts";
import { makeSharedNativeProviderTurnAdmission } from "../nativeHarness/NativeProviderTurnAdmission.ts";
import { makeOpenAiCompatibleAdapter } from "../openaiCompatible/OpenAiCompatibleAdapter.ts";
import { makeOpenAiCompatibleAuthentication } from "../openaiCompatible/OpenAiCompatibleAuthentication.ts";
import { makeOpenAiCompatibleCredentialStore } from "../openaiCompatible/OpenAiCompatibleCredentialStore.ts";
import {
  checkOpenAiCompatibleProviderStatus,
  makePendingOpenAiCompatibleProvider,
} from "../openaiCompatible/OpenAiCompatibleProvider.ts";
import {
  makeOpenAiCompatibleTransport,
  OpenAiCompatibleAuthenticationError,
} from "../openaiCompatible/OpenAiCompatibleTransport.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  makeAlreadyLocalProviderHistorySync,
  makeInstanceHistorySyncSource,
  NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
} from "../Services/ProviderHistorySync.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import type { OpenAiDriverEnv } from "./OpenAiDriver.ts";

export type OpenAiCompatibleDriverEnv = OpenAiDriverEnv;

function makeOpenAiCompatibleDriver(input: {
  readonly driverKind: "openaiCompatible" | "lmstudio";
  readonly displayName: string;
  readonly configSchema: Schema.Codec<OpenAiCompatibleSettings, unknown>;
}): ProviderDriver<OpenAiCompatibleSettings, OpenAiCompatibleDriverEnv> {
  const driverKind = ProviderDriverKind.make(input.driverKind);
  const decodeSettings = Schema.decodeSync(input.configSchema);
  const maintenance = makeManualOnlyProviderMaintenanceCapabilities({
    provider: driverKind,
    packageName: null,
  });

  return {
    driverKind,
    metadata: { displayName: input.displayName, supportsMultipleInstances: true },
    configSchema: input.configSchema,
    defaultConfig: () => decodeSettings({}),
    create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
      Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient;
        const resourceGovernor = yield* SubagentResourceGovernor;
        const mcpConfigEngine = yield* McpConfigEngine;
        const toolEnvironment = nativeHarnessCommandEnvironment(
          mergeProviderInstanceEnvironment(environment),
        );
        const effectiveConfig = { ...config, enabled };
        const credentialStore = yield* makeOpenAiCompatibleCredentialStore({
          instanceId,
          baseUrl: config.baseUrl,
        });
        const transport = yield* makeOpenAiCompatibleTransport({
          baseUrl: credentialStore.baseUrl,
          resolveApiKey: credentialStore.readStored.pipe(
            Effect.mapError(
              () =>
                new OpenAiCompatibleAuthenticationError({
                  message: "The endpoint API key could not be read from secure storage.",
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
        const adapter = yield* makeOpenAiCompatibleAdapter(effectiveConfig, {
          driverKind: input.driverKind,
          instanceId,
          environment: toolEnvironment,
          transport,
          harness,
          admission: makeSharedNativeProviderTurnAdmission({
            provider: driverKind,
            governor: resourceGovernor,
          }),
          resolveMcpServers: ({ cwd }) =>
            mcpConfigEngine
              .resolveActiveServers({ cwd, providerInstanceId: instanceId })
              .pipe(Effect.mapError((cause) => ({ detail: cause.detail }))),
        });
        const continuationIdentity = defaultProviderContinuationIdentity({
          driverKind,
          instanceId,
        });
        const stampIdentity = withInstanceIdentity({
          instanceId,
          driverKind,
          displayName,
          accentColor,
          continuationGroupKey: continuationIdentity.continuationKey,
        });
        const snapshot = yield* makeManagedServerProvider({
          resolveMaintenance: () => Effect.succeed(maintenance),
          getSettings: Effect.succeed(effectiveConfig),
          streamSettings: Stream.empty,
          haveSettingsChanged: () => false,
          initialSnapshot: (settings) =>
            makePendingOpenAiCompatibleProvider(settings, input.displayName).pipe(
              Effect.map(stampIdentity),
            ),
          checkProvider: checkOpenAiCompatibleProviderStatus(effectiveConfig, {
            displayName: input.displayName,
            resolveCredential: credentialStore.readStored,
            listModels: transport.listModels,
          }).pipe(Effect.map(stampIdentity)),
        });
        const authentication = makeOpenAiCompatibleAuthentication({
          scope: yield* Scope.Scope,
          instanceId,
          credentialStore,
          validateCredential: (apiKey) =>
            makeOpenAiCompatibleTransport({
              baseUrl: credentialStore.baseUrl,
              resolveApiKey: Effect.succeed(Option.some(apiKey)),
            }).pipe(
              Effect.flatMap((candidate) => candidate.listModels),
              Effect.provideService(HttpClient.HttpClient, httpClient),
            ),
          stopAll: adapter.stopAll(),
          refreshSnapshot: snapshot.refresh,
        });

        return {
          instanceId,
          driverKind,
          continuationIdentity,
          displayName,
          accentColor,
          enabled,
          snapshot,
          refreshModels: () => snapshot.refresh.pipe(Effect.asVoid),
          adapter,
          historySync: makeAlreadyLocalProviderHistorySync({
            source: makeInstanceHistorySyncSource({
              driverKind,
              instanceId,
              continuationKey: continuationIdentity.continuationKey,
              displayName: displayName ?? input.displayName,
              capabilities: NO_PROVIDER_HISTORY_SYNC_CAPABILITIES,
            }),
            reason: `${input.displayName} history is already stored by T3 Code.`,
          }),
          textGeneration: makeOpenAiCompatibleTextGeneration(effectiveConfig, {
            driverKind: input.driverKind,
            instanceId,
            transport,
          }),
          authentication,
        } satisfies ProviderInstance;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: driverKind,
              instanceId,
              detail: `Failed to build ${input.displayName} provider instance.`,
              cause,
            }),
        ),
      ),
  };
}

export const OpenAiCompatibleDriver = makeOpenAiCompatibleDriver({
  driverKind: "openaiCompatible",
  displayName: "OpenAI Compatible",
  configSchema: OpenAiCompatibleSettings,
});

export const LmStudioDriver = makeOpenAiCompatibleDriver({
  driverKind: "lmstudio",
  displayName: "LM Studio",
  configSchema: LmStudioSettings,
});
