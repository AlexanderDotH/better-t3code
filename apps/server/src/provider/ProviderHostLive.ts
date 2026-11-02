import { makeProviderMcpConfigurationResolver } from "../mcp/ProviderMcpConfigurationResolver.ts";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { ProviderCredentialError } from "@t3tools/provider-core/server/errors";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpRuntimeRegistry } from "../mcp/McpRuntimeRegistry.ts";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as DocumentText from "./DocumentText.ts";
import * as ProviderCredentialStore from "./ProviderCredentialStore.ts";

type ProviderHostMcpRuntime = NonNullable<ProviderHost.ProviderHost["Service"]["mcpRuntime"]>;
const liveMcpRuntimeRegistry = Effect.gen(function* () {
  const registry = yield* Effect.serviceOption(McpRuntimeRegistry);
  if (Option.isNone(registry))
    return yield* Effect.die(
      new Error("ProviderHost MCP runtime calls require the active server registry."),
    );
  return registry.value;
});

export const providerMcpRuntime: ProviderHostMcpRuntime = {
  registerAdapter: Effect.fn("ProviderHost.mcpRuntime.registerAdapter")(function* (
    ...parameters: Parameters<ProviderHostMcpRuntime["registerAdapter"]>
  ) {
    const registry = yield* liveMcpRuntimeRegistry;
    yield* registry.registerAdapter(...parameters);
  }),
  registerSession: Effect.fn("ProviderHost.mcpRuntime.registerSession")(function* (
    session: Parameters<ProviderHostMcpRuntime["registerSession"]>[0],
  ) {
    const registry = yield* liveMcpRuntimeRegistry;
    yield* registry.registerSession(session);
  }),
  endSession: Effect.fn("ProviderHost.mcpRuntime.endSession")(function* (
    target: Parameters<ProviderHostMcpRuntime["endSession"]>[0],
  ) {
    const registry = yield* liveMcpRuntimeRegistry;
    yield* registry.endSession(target);
  }),
};

export const layer = Layer.effect(
  ProviderHost.ProviderHost,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const resolveMcpServers = yield* makeProviderMcpConfigurationResolver;
    const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    return ProviderHost.ProviderHost.of({
      paths: {
        cwd: config.cwd,
        baseDir: config.baseDir,
        stateDir: config.stateDir,
        providerStatusCacheDir: config.providerStatusCacheDir,
        attachmentsDir: config.attachmentsDir,
      },
      settings: {
        get: serverSettings.getSettings,
        withSnapshot: serverSettings.withSettingsSnapshot,
        changes: serverSettings.streamChanges,
        subscribe: serverSettings.subscribeChanges,
      },
      shouldRunBackgroundWork: backgroundPolicy.shouldRunScopeWork,
      resolveMcpServers,
      mcpRuntime: providerMcpRuntime,
      resolveAttachmentPath: (attachment) =>
        resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment }),
      // DocumentText owns the path-resolution span.
      resolveExtractedTextPath: Effect.fnUntraced(
        function* (path) {
          return yield* DocumentText.resolveExtractedTextPath(path);
        },
        Effect.provideService(FileSystem.FileSystem, fileSystem),
      ),
      credentials: Effect.fn("ProviderHost.credentials")(function (namespace, bindingId) {
        return ProviderCredentialStore.make(namespace, bindingId).pipe(
          Effect.map((store) => ({
            binding: store.binding,
            get: store.get.pipe(
              Effect.mapError((cause) => new ProviderCredentialError({ operation: "get", cause })),
            ),
            set: (credentials: Uint8Array) =>
              store
                .set(credentials)
                .pipe(
                  Effect.mapError(
                    (cause) => new ProviderCredentialError({ operation: "set", cause }),
                  ),
                ),
            remove: store.remove.pipe(
              Effect.mapError(
                (cause) => new ProviderCredentialError({ operation: "remove", cause }),
              ),
            ),
          })),
          Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
          Effect.provideService(Crypto.Crypto, crypto),
        );
      }),
    });
  }),
);
