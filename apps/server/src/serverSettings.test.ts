import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  McpServerId,
  ProviderDriverKind,
  ProviderInstanceId,
  resolveBetterT3FeatureFlag,
  resolveProviderInstanceEnabled,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as ServerConfig from "./config.ts";
import { openRouterApiKeySecretName } from "./provider/openrouter/auth/OpenRouterCredentialStore.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import * as ServerSettingsModule from "./serverSettings.ts";
import { redactServerSettingsForClient, ServerSettingsService } from "./serverSettings.ts";

const decodeSettingsPatch = Schema.decodeUnknownEffect(ServerSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownEffect(ServerSettings);

const makeServerSettingsLayer = () =>
  ServerSettingsModule.layer.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-test-",
        }),
      ),
    ),
  );

const makeFailingSecretStoreLayer = (cause: ServerSecretStore.SecretStoreError) =>
  Layer.succeed(
    ServerSecretStore.ServerSecretStore,
    ServerSecretStore.ServerSecretStore.of({
      get: () => Effect.fail(cause),
      set: () => Effect.void,
      create: () => Effect.void,
      getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
      remove: () => Effect.void,
    }),
  );

const makeCreateFailingSecretStoreLayer = (cause: ServerSecretStore.SecretStoreError) =>
  Layer.succeed(
    ServerSecretStore.ServerSecretStore,
    ServerSecretStore.ServerSecretStore.of({
      get: () => Effect.succeed(Option.none()),
      set: () => Effect.void,
      create: () => Effect.fail(cause),
      getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
      remove: () => Effect.void,
    }),
  );

const recordProviderUsage = (provider: string, instanceId: string | null = provider) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_thread_sessions (
        thread_id,
        status,
        provider_name,
        provider_instance_id,
        updated_at
      )
      VALUES (
        ${`thread-${instanceId ?? provider}`},
        ${"ready"},
        ${provider},
        ${instanceId},
        ${"2026-08-25T00:00:00.000Z"}
      )
    `;
  });

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("preserves context when reading a provider environment secret fails", () => {
    const platformCause = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "readFile",
      pathOrDescriptor: "provider environment secret",
      description: "Secret backend unavailable.",
    });
    const cause = new ServerSecretStore.SecretStoreReadError({
      resource: "provider environment secret",
      cause: platformCause,
    });
    const configLayer = Layer.fresh(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3code-server-settings-secret-failure-test-",
      }),
    );
    const settingsLayer = ServerSettingsModule.layer.pipe(
      Layer.provide(makeFailingSecretStoreLayer(cause)),
      Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
      Layer.provideMerge(configLayer),
    );

    return Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providerInstances":{"codex_personal":{"driver":"codex","environment":[{"name":"OPENROUTER_API_KEY","value":"","sensitive":true,"valueRedacted":true}],"config":{}}}}',
      );

      const error = yield* Effect.flip(serverSettings.getSettings);

      assert.deepInclude(error, {
        _tag: "ServerSettingsError",
        operation: "read-secret",
        providerInstanceId: "codex_personal",
        environmentVariable: "OPENROUTER_API_KEY",
      });
      assert.strictEqual(error.cause, cause);
      assert.notInclude(error.message, cause.message);
    }).pipe(Effect.provide(settingsLayer));
  });

  it.effect("identifies provider history query failures", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DROP TABLE projection_thread_sessions`;

      const error = yield* Effect.flip(serverSettings.getSettings);

      assert.deepInclude(error, {
        _tag: "ServerSettingsError",
        operation: "read-provider-history",
        settingsPath: serverConfig.settingsPath,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("decodes nested settings patches", () =>
    Effect.gen(function* () {
      const legacySettings = yield* decodeServerSettings({});
      assert.deepEqual(legacySettings.speechTranscription, {
        assemblyAi: { apiKey: { value: "" } },
      });
      assert.equal(legacySettings.voiceTranslationModelSelection, null);

      assert.deepEqual(
        yield* decodeSettingsPatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }),
        {
          providers: { codex: { binaryPath: "/tmp/codex" } },
        },
      );

      assert.deepEqual(
        yield* decodeSettingsPatch({
          textGenerationModelSelection: {
            options: [{ id: "fastMode", value: false }],
          },
        }),
        {
          textGenerationModelSelection: {
            options: [{ id: "fastMode", value: false }],
          },
        },
      );

      assert.deepEqual(
        yield* decodeSettingsPatch({
          projectThreadPreviewSyncRecord: {
            count: 6,
            updatedAt: 1_777_000_001_000,
            updateId: "device-b:replacement",
          },
        }),
        {
          projectThreadPreviewSyncRecord: {
            count: 6,
            updatedAt: 1_777_000_001_000,
            updateId: "device-b:replacement",
          },
        },
      );
    }),
  );

  it.effect("maps the former persisted streaming key unless the current key is present", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsService;

      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"enableAssistantStreaming":true}',
      );
      const settings = yield* serverSettings.getSettings;
      assert.isTrue(settings.enableLegacyTokenStreaming);
      assert.isUndefined(settings.enableAssistantStreaming);
      assert.isTrue(redactServerSettingsForClient(settings).enableAssistantStreaming);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("prefers the current persisted streaming key over the former key", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsService;

      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"enableAssistantStreaming":true,"enableLegacyTokenStreaming":false}',
      );
      assert.isFalse((yield* serverSettings.getSettings).enableLegacyTokenStreaming);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("uses clean Better T3 defaults only when no settings file exists", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const settings = yield* serverSettings.getSettings;

      assert.equal(settings.betterT3Environment.initialization, "clean-install");
      assert.isFalse(
        resolveBetterT3FeatureFlag(settings.betterT3Environment, "resource.adaptiveAdmission"),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("migrates an existing sparse settings file to its implicit Better T3 behavior", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsService;
      yield* fileSystem.writeFileString(serverConfig.settingsPath, "{}");

      const settings = yield* serverSettings.getSettings;

      assert.equal(settings.betterT3Environment.initialization, "existing-install-migration");
      assert.isTrue(
        resolveBetterT3FeatureFlag(settings.betterT3Environment, "resource.adaptiveAdmission"),
      );
      assert.isTrue(
        resolveBetterT3FeatureFlag(settings.betterT3Environment, "resource.processSuspension"),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("seeds Deep Thinking from an explicitly persisted legacy setting", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify({ agentEnhancement: { deepThinking: { enabled: true } } }),
      );

      const settings = yield* serverSettings.getSettings;

      assert.isTrue(resolveBetterT3FeatureFlag(settings.betterT3Environment, "agent.deepThinking"));
      assert.isTrue(settings.agentEnhancement.deepThinking.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("keeps an explicit Better T3 Deep Thinking flag over its legacy mirror", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify({
          betterT3Environment: {
            version: 1,
            initialization: "existing-install-migration",
            flags: { "agent.deepThinking": false },
          },
          agentEnhancement: { deepThinking: { enabled: true } },
        }),
      );

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(
        resolveBetterT3FeatureFlag(settings.betterT3Environment, "agent.deepThinking"),
      );
      assert.isTrue(settings.agentEnhancement.deepThinking.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves explicit Better T3 disables while patching individual flags", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify({
          betterT3Environment: {
            version: 1,
            initialization: "existing-install-migration",
            flags: { "resource.processSuspension": false },
          },
        }),
      );

      const initial = yield* serverSettings.getSettings;
      const updated = yield* serverSettings.updateSettings({
        betterT3Environment: {
          flags: { "resource.adaptiveAdmission": false },
        },
      });

      assert.isFalse(
        resolveBetterT3FeatureFlag(initial.betterT3Environment, "resource.processSuspension"),
      );
      assert.isFalse(
        resolveBetterT3FeatureFlag(updated.betterT3Environment, "resource.processSuspension"),
      );
      assert.isFalse(
        resolveBetterT3FeatureFlag(updated.betterT3Environment, "resource.adaptiveAdmission"),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("bridges legacy locale records without ever writing French into the legacy field", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsService;
      const legacy = {
        preference: "de" as const,
        updatedAt: 1_787_178_400_000,
        updateId: "legacy:de",
      };
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify({ interfaceLanguageSyncRecord: legacy }),
      );

      const migrated = yield* serverSettings.getSettings;
      assert.deepEqual(migrated.interfaceLocaleSyncRecordV1, { version: 1, ...legacy });

      const french = yield* serverSettings.updateSettings({
        interfaceLocaleSyncRecordV1: {
          version: 1,
          preference: "fr",
          updatedAt: legacy.updatedAt + 1,
          updateId: "new:fr",
        },
      });
      assert.equal(french.interfaceLocaleSyncRecordV1?.preference, "fr");
      assert.deepEqual(french.interfaceLanguageSyncRecord, legacy);

      const english = yield* serverSettings.updateSettings({
        interfaceLocaleSyncRecordV1: {
          version: 1,
          preference: "en",
          updatedAt: legacy.updatedAt + 2,
          updateId: "new:en",
        },
      });
      assert.deepEqual(english.interfaceLanguageSyncRecord, {
        preference: "en",
        updatedAt: legacy.updatedAt + 2,
        updateId: "new:en",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("migrates legacy single-instance OpenRouter settings and extracts its API key", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const serverSettings = yield* ServerSettingsService;
      const legacyApiKey = "sk-or-legacy-single";

      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify({
          providers: {
            openrouter: {
              enabled: true,
              apiKey: legacyApiKey,
              baseUrl: "https://openrouter.ai/api/v1",
              preferredMaxCatalogContextTokens: "200000",
              contextCompression: true,
              customModels: ["anthropic/claude-custom"],
            },
          },
        }),
      );

      const settings = yield* serverSettings.getSettings;
      const instanceId = ProviderInstanceId.make("openrouter");
      assert.deepEqual(settings.providerInstances[instanceId], {
        driver: ProviderDriverKind.make("openrouter"),
        enabled: true,
        config: {
          defaultModel: "",
          contextCompression: true,
          customModels: ["anthropic/claude-custom"],
        },
      });

      const stored = yield* secretStore.get(openRouterApiKeySecretName(instanceId));
      assert.isTrue(Option.isSome(stored));
      if (Option.isSome(stored)) {
        assert.equal(new TextDecoder().decode(stored.value), legacyApiKey);
      }

      const persisted = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.notInclude(persisted, legacyApiKey);
      assert.notInclude(persisted, "apiKey");
      assert.notInclude(persisted, "preferredMaxCatalogContextTokens");
      assert.notInclude(persisted, "baseUrl");
      assert.isUndefined(JSON.parse(persisted).providers?.openrouter);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "extracts and redacts a legacy OpenRouter key submitted through the opaque instance map",
    () =>
      Effect.gen(function* () {
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const secretStore = yield* ServerSecretStore.ServerSecretStore;
        const serverSettings = yield* ServerSettingsService;
        const instanceId = ProviderInstanceId.make("openrouter_legacy_client");
        const legacyApiKey = "sk-or-legacy-client-plaintext";

        const clientProjection = redactServerSettingsForClient({
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("openrouter"),
              config: { apiKey: legacyApiKey, defaultModel: "" },
            },
          },
        });
        assert.notInclude(JSON.stringify(clientProjection), legacyApiKey);
        assert.notProperty(clientProjection.providerInstances[instanceId]?.config ?? {}, "apiKey");

        const saved = yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("openrouter"),
              enabled: true,
              config: {
                apiKey: legacyApiKey,
                contextCompression: false,
                customModels: ["@preset/legacy-client"],
              },
            },
          },
        });

        assert.deepEqual(saved.providerInstances[instanceId]?.config, {
          defaultModel: "",
          contextCompression: false,
          customModels: ["@preset/legacy-client"],
        });
        assert.notInclude(JSON.stringify(redactServerSettingsForClient(saved)), legacyApiKey);

        const stored = yield* secretStore.get(openRouterApiKeySecretName(instanceId));
        assert.isTrue(Option.isSome(stored));
        if (Option.isSome(stored)) {
          assert.equal(new TextDecoder().decode(stored.value), legacyApiKey);
        }

        const persisted = yield* fileSystem.readFileString(serverConfig.settingsPath);
        assert.notInclude(persisted, legacyApiKey);
        assert.notInclude(persisted, '"apiKey"');
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "sanitizes explicit OpenRouter instances without replacing a newer stored credential",
    () =>
      Effect.gen(function* () {
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const secretStore = yield* ServerSecretStore.ServerSecretStore;
        const serverSettings = yield* ServerSettingsService;
        const instanceId = ProviderInstanceId.make("openrouter_work");
        const storedApiKey = "sk-or-newer-stored";
        const legacyApiKey = "sk-or-stale-settings";

        yield* secretStore.set(
          openRouterApiKeySecretName(instanceId),
          new TextEncoder().encode(storedApiKey),
        );
        yield* fileSystem.writeFileString(
          serverConfig.settingsPath,
          JSON.stringify({
            providerInstances: {
              [instanceId]: {
                driver: "openrouter",
                enabled: true,
                config: {
                  enabled: false,
                  apiKey: legacyApiKey,
                  baseUrl: "https://gateway.example.test/v1",
                  preferredMaxCatalogContextTokens: "100000",
                  contextCompression: false,
                  customModels: ["@preset/work"],
                },
              },
            },
          }),
        );

        const settings = yield* serverSettings.getSettings;
        assert.deepEqual(settings.providerInstances[instanceId], {
          driver: ProviderDriverKind.make("openrouter"),
          enabled: false,
          config: {
            defaultModel: "",
            contextCompression: false,
            customModels: ["@preset/work"],
            legacyBaseUrlIncompatible: true,
          },
        });

        const stored = yield* secretStore.get(openRouterApiKeySecretName(instanceId));
        assert.isTrue(Option.isSome(stored));
        if (Option.isSome(stored)) {
          assert.equal(new TextDecoder().decode(stored.value), storedApiKey);
        }

        const persisted = yield* fileSystem.readFileString(serverConfig.settingsPath);
        assert.notInclude(persisted, legacyApiKey);
        assert.notInclude(persisted, "gateway.example.test");
        assert.notInclude(persisted, "preferredMaxCatalogContextTokens");
        assert.include(persisted, '"legacyBaseUrlIncompatible": true');
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("does not synthesize a default OpenRouter instance when an explicit one exists", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const serverSettings = yield* ServerSettingsService;
      const instanceId = ProviderInstanceId.make("openrouter_personal");

      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify({
          providers: {
            openrouter: {
              enabled: true,
              apiKey: "sk-or-legacy-mirror",
              contextCompression: true,
              customModels: ["legacy/model"],
            },
          },
          providerInstances: {
            [instanceId]: {
              driver: "openrouter",
              config: { defaultModel: "openai/gpt-explicit" },
            },
          },
        }),
      );

      const settings = yield* serverSettings.getSettings;
      assert.isUndefined(settings.providerInstances[ProviderInstanceId.make("openrouter")]);
      assert.deepEqual(settings.providerInstances[instanceId]?.config, {
        defaultModel: "openai/gpt-explicit",
      });
      const stored = yield* secretStore.get(openRouterApiKeySecretName(instanceId));
      assert.isTrue(Option.isSome(stored));
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("leaves plaintext settings intact when legacy credential extraction fails", () => {
    const platformCause = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "open",
      pathOrDescriptor: "OpenRouter credential secret",
      description: "Secret backend unavailable.",
    });
    const cause = new ServerSecretStore.SecretStorePersistError({
      resource: "OpenRouter credential secret",
      cause: platformCause,
    });
    const configLayer = Layer.fresh(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3code-openrouter-migration-failure-test-",
      }),
    );
    const settingsLayer = ServerSettingsModule.layer.pipe(
      Layer.provide(makeCreateFailingSecretStoreLayer(cause)),
      Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
      Layer.provideMerge(configLayer),
    );

    return Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsService;
      const legacyApiKey = "sk-or-must-stay-on-disk";
      const original = JSON.stringify({
        providerInstances: {
          openrouter: {
            driver: "openrouter",
            config: { apiKey: legacyApiKey },
          },
        },
      });
      yield* fileSystem.writeFileString(serverConfig.settingsPath, original);

      const error = yield* Effect.flip(serverSettings.getSettings);

      assert.deepInclude(error, {
        _tag: "ServerSettingsError",
        operation: "write-secret",
        providerInstanceId: "openrouter",
      });
      assert.strictEqual(error.cause, cause);
      assert.notInclude(error.message, legacyApiKey);
      assert.notInclude(JSON.stringify(error), legacyApiKey);
      assert.equal(yield* fileSystem.readFileString(serverConfig.settingsPath), original);
    }).pipe(Effect.provide(settingsLayer));
  });

  it.effect(
    "decodes legacy object-shaped textGenerationModelSelection.options from settings.json",
    () =>
      Effect.gen(function* () {
        const decoded = yield* decodeServerSettings({
          textGenerationModelSelection: {
            provider: ProviderDriverKind.make("codex"),
            model: "gpt-5.4-mini",
            options: { reasoningEffort: "low" },
          },
        });

        assert.deepEqual(decoded.textGenerationModelSelection, {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4-mini",
          options: [{ id: "reasoningEffort", value: "low" }],
        });
      }),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/julius/.codex",
          },
          claudeAgent: {
            binaryPath: "/usr/local/bin/claude",
            customModels: ["claude-custom"],
          },
        },
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: createModelSelection(
            ProviderInstanceId.make("codex"),
            DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
            [
              { id: "reasoningEffort", value: "high" },
              { id: "fastMode", value: true },
            ],
          ).options!,
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        textGenerationModelSelection: {
          options: [{ id: "fastMode", value: false }],
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/julius/.codex",
        shadowHomePath: "",
        launchArgs: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/usr/local/bin/claude",
        homePath: "",
        customModels: ["claude-custom"],
        launchArgs: "",
        autoCompactWindow: "",
      });
      assert.deepEqual(
        next.textGenerationModelSelection,
        createModelSelection(
          ProviderInstanceId.make("codex"),
          DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          [
            { id: "reasoningEffort", value: "high" },
            { id: "fastMode", value: false },
          ],
        ),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("serializes concurrent settings modifiers against the latest catalog", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const firstId = McpServerId.make("first_server");
      const secondId = McpServerId.make("second_server");

      const appendServer = (id: typeof firstId) =>
        serverSettings.modifySettings((current) =>
          Effect.succeed({
            ...current,
            mcp: {
              ...current.mcp,
              servers: [
                ...current.mcp.servers,
                {
                  id,
                  name: id,
                  enabled: true,
                  providerRouting: { mode: "all" as const },
                  scope: "global" as const,
                  transport: "http" as const,
                  url: `https://${id}.example.com/mcp`,
                  headers: {},
                },
              ],
            },
          }),
        );

      yield* Effect.all([appendServer(firstId), appendServer(secondId)], {
        concurrency: "unbounded",
      });

      const settings = yield* serverSettings.getSettings;
      assert.deepEqual(settings.mcp.servers.map((server) => server.id).sort(), [firstId, secondId]);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("buffers changes after a subscription is acquired but before it is consumed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const changes = yield* serverSettings.subscribeChanges;

        yield* serverSettings.updateSettings({
          providers: {
            codex: {
              binaryPath: "/usr/local/bin/codex-next",
            },
          },
        });

        const firstChange = yield* changes.pipe(Stream.runHead, Effect.timeout("1 second"));
        assert.equal(
          Option.getOrUndefined(firstChange)?.providers.codex.binaryPath,
          "/usr/local/bin/codex-next",
        );
      }),
    ).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via textGenerationModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      // Start with Claude text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-4-6",
          options: createModelSelection(
            ProviderInstanceId.make("claudeAgent"),
            "claude-sonnet-4-6",
            [{ id: "effort", value: "high" }],
          ).options!,
        },
      });

      // Switch to Codex — the stale Claude "effort" in options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
          options: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
            { id: "reasoningEffort", value: "high" },
          ]).options!,
        },
      });

      assert.deepEqual(
        next.textGenerationModelSelection,
        createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
          { id: "reasoningEffort", value: "high" },
        ]),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves custom provider instance text generation selections", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [ProviderInstanceId.make("claude_openrouter")]: {
            driver: ProviderDriverKind.make("claudeAgent"),
            enabled: true,
            config: { customModels: ["openai/gpt-5.5"] },
          },
        },
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("claude_openrouter"),
          model: "openai/gpt-5.5",
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: ProviderInstanceId.make("claude_openrouter"),
        model: "openai/gpt-5.5",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "uses explicit provider instance enabled state over legacy provider enabled state",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const instanceId = ProviderInstanceId.make("claude_openrouter");

        const next = yield* serverSettings.updateSettings({
          providers: {
            claudeAgent: {
              enabled: false,
            },
          },
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              enabled: true,
              config: { customModels: ["openai/gpt-5.5"] },
            },
          },
          textGenerationModelSelection: {
            instanceId,
            model: "openai/gpt-5.5",
          },
        });

        assert.deepEqual(next.textGenerationModelSelection, {
          instanceId,
          model: "openai/gpt-5.5",
        });
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves enabled text generation selections for non-built-in drivers", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const instanceId = ProviderInstanceId.make("openrouter_text");

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("openrouter"),
            enabled: true,
            config: { customModels: ["openai/gpt-5.5"] },
          },
        },
        textGenerationModelSelection: {
          instanceId,
          model: "openai/gpt-5.5",
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId,
        model: "openai/gpt-5.5",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "preserves the source control writer selection when its provider instance is disabled",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const instanceId = ProviderInstanceId.make("codex_writer");
        const sourceControlWriterModelSelection = {
          instanceId,
          model: "gpt-5.4-mini",
        };

        yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              config: {},
            },
          },
          sourceControlWriterModelSelection,
        });

        const next = yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: false,
              config: {},
            },
          },
        });

        assert.deepEqual(next.sourceControlWriterModelSelection, sourceControlWriterModelSelection);
        assert.deepEqual(
          ServerSettingsModule.resolveSourceControlWriterModelSelection(next),
          next.textGenerationModelSelection,
        );
        assert.deepEqual(
          (yield* serverSettings.getSettings).sourceControlWriterModelSelection,
          sourceControlWriterModelSelection,
        );

        const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
        assert.deepEqual(
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          JSON.parse(raw).sourceControlWriterModelSelection,
          sourceControlWriterModelSelection,
        );

        const restored = yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              config: {},
            },
          },
        });
        assert.deepEqual(
          ServerSettingsModule.resolveSourceControlWriterModelSelection(restored),
          sourceControlWriterModelSelection,
        );
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("drops stale text generation options when resetting model selection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: createModelSelection(
            ProviderInstanceId.make("codex"),
            DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
            [
              { id: "reasoningEffort", value: "high" },
              { id: "fastMode", value: true },
            ],
          ).options!,
        },
      });

      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("replaces provider instance maps when clearing optional fields", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const codexId = ProviderInstanceId.make("codex");

      yield* serverSettings.updateSettings({
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            accentColor: "#7c3aed",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      });

      assert.deepEqual(next.providerInstances[codexId], {
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex Work",
        enabled: true,
        config: { homePath: "~/.codex" },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("enables previously used providers from sparse settings files", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providers":{"opencode":{"serverUrl":"http://127.0.0.1:4096"}}}',
      );
      yield* recordProviderUsage("opencode");

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.grok.enabled);
      assert.isTrue(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
      assert.equal(settings.providers.opencode.serverUrl, "http://127.0.0.1:4096");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves existing provider instances without explicit enabled flags", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providerInstances":{"cursor_work":{"driver":"cursor","config":{}},"grok":{"driver":"grok","config":{}},"opencode_work":{"driver":"opencode","config":{"serverUrl":"http://127.0.0.1:4096"}},"opencode_unused":{"driver":"opencode","config":{}}}}',
      );
      yield* recordProviderUsage("cursor", "cursor_work");
      yield* recordProviderUsage("grok", null);
      yield* recordProviderUsage("opencode", "opencode_work");

      const settings = yield* serverSettings.getSettings;

      assert.isTrue(settings.providers.cursor.enabled);
      assert.isTrue(settings.providerInstances[ProviderInstanceId.make("cursor_work")]?.enabled);
      assert.isTrue(settings.providerInstances[ProviderInstanceId.make("grok")]?.enabled);
      assert.isTrue(settings.providerInstances[ProviderInstanceId.make("opencode_work")]?.enabled);
      const unused = settings.providerInstances[ProviderInstanceId.make("opencode_unused")];
      assert.isDefined(unused);
      assert.isFalse(resolveProviderInstanceEnabled(unused));
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves explicit provider disables in existing settings files", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providers":{"grok":{"enabled":false},"opencode":{"enabled":false},"cursor":{"enabled":false}},"providerInstances":{"grok":{"driver":"grok","enabled":false,"config":{}},"opencode":{"driver":"opencode","config":{"enabled":false}},"cursor":{"driver":"cursor","enabled":false,"config":{}}}}',
      );
      yield* recordProviderUsage("grok");
      yield* recordProviderUsage("opencode");
      yield* recordProviderUsage("cursor");

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
      assert.isFalse(settings.providerInstances[ProviderInstanceId.make("grok")]?.enabled);
      assert.isFalse(settings.providerInstances[ProviderInstanceId.make("opencode")]?.enabled);
      assert.isFalse(settings.providerInstances[ProviderInstanceId.make("cursor")]?.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("keeps unused providers disabled in existing sparse settings files", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(serverConfig.settingsPath, "{}");

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves provider history when no settings file exists", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* recordProviderUsage("grok");

      const settings = yield* serverSettings.getSettings;

      assert.isTrue(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves provider history when the settings file is invalid", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(serverConfig.settingsPath, "{invalid json");
      yield* recordProviderUsage("cursor");

      const settings = yield* serverSettings.getSettings;

      assert.isTrue(settings.providers.cursor.enabled);
      assert.isFalse(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "does not overwrite a decodable settings document when compatibility decoding fails",
    () =>
      Effect.gen(function* () {
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const persisted = JSON.stringify({
          addProjectBaseDirectory: 42,
          interfaceLanguageSyncRecord: {
            preference: "de",
            updatedAt: 10,
            updateId: "legacy:de",
          },
        });
        yield* fileSystem.writeFileString(serverConfig.settingsPath, persisted);

        yield* serverSettings.getSettings;

        assert.equal(yield* fileSystem.readFileString(serverConfig.settingsPath), persisted);
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves valid provider flags when another settings field is invalid", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"addProjectBaseDirectory":42,"providers":{"cursor":{"enabled":false},"grok":{"enabled":true}}}',
      );
      yield* recordProviderUsage("cursor");

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.cursor.enabled);
      assert.isTrue(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("restores providers from persisted runtime sessions", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          provider_instance_id,
          adapter_key,
          status,
          last_seen_at
        )
        VALUES (
          ${"thread-opencode-runtime"},
          ${"opencode"},
          ${"opencode"},
          ${"opencode"},
          ${"ready"},
          ${"2026-08-25T00:00:00.000Z"}
        )
      `;

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.grok.enabled);
      assert.isTrue(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists explicit disables after a provider has been used", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* recordProviderUsage("grok");

      assert.isTrue((yield* serverSettings.getSettings).providers.grok.enabled);

      const settings = yield* serverSettings.updateSettings({
        providers: { grok: { enabled: false } },
      });
      assert.isFalse(settings.providers.grok.enabled);

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.isFalse(JSON.parse(raw).providers.grok.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists explicit provider enables before their first use", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          cursor: { enabled: true },
          grok: { enabled: true },
          opencode: { enabled: true },
        },
      });
      yield* serverSettings.updateSettings({ addProjectBaseDirectory: "~/Development" });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const persisted = JSON.parse(raw);
      assert.isTrue(persisted.providers.cursor.enabled);
      assert.isTrue(persisted.providers.grok.enabled);
      assert.isTrue(persisted.providers.opencode.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("keeps optional providers disabled after a new installation writes settings", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const initial = yield* serverSettings.getSettings;
      assert.isFalse(initial.providers.grok.enabled);
      assert.isFalse(initial.providers.opencode.enabled);
      assert.isFalse(initial.providers.cursor.enabled);

      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
        providerInstances: {
          [ProviderInstanceId.make("grok")]: {
            driver: ProviderDriverKind.make("grok"),
            config: {},
          },
        },
      });

      assert.isFalse(next.providers.grok.enabled);
      assert.isFalse(next.providers.opencode.enabled);
      assert.isFalse(next.providers.cursor.enabled);
      const grok = next.providerInstances[ProviderInstanceId.make("grok")];
      assert.isDefined(grok);
      assert.isFalse(resolveProviderInstanceEnabled(grok));

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const persisted = JSON.parse(raw);
      assert.isFalse(persisted.providers.cursor.enabled);
      assert.isFalse(persisted.providers.grok.enabled);
      assert.isFalse(persisted.providers.opencode.enabled);
      assert.isUndefined(persisted.providerInstances.grok.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("folds a legacy in-config enabled flag into the envelope on load", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      // Old settings files can carry both flags with conflicting values.
      // The explicit false must win so a user's disable sticks.
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providerInstances":{"grok":{"driver":"grok","enabled":true,"config":{"enabled":false}},"codex_work":{"driver":"codex","config":{"enabled":true,"homePath":"~/.codex"}},"cursor":{"driver":"cursor","config":{"enabled":"nope"}}}}',
      );

      const settings = yield* serverSettings.getSettings;

      const grokId = ProviderInstanceId.make("grok");
      const codexWorkId = ProviderInstanceId.make("codex_work");
      assert.deepEqual(settings.providerInstances[grokId], {
        driver: ProviderDriverKind.make("grok"),
        enabled: false,
        config: {},
      });
      // A lone in-config flag is lifted to the envelope and stripped.
      assert.deepEqual(settings.providerInstances[codexWorkId], {
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        config: { homePath: "~/.codex" },
      });
      // A malformed flag is left alone so driver schema validation can
      // surface it instead of the fold silently repairing the config.
      assert.deepEqual(settings.providerInstances[ProviderInstanceId.make("cursor")], {
        driver: ProviderDriverKind.make("cursor"),
        config: { enabled: "nope" },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("folds in-config enabled flags arriving through updates", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const grokId = ProviderInstanceId.make("grok");

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [grokId]: {
            driver: ProviderDriverKind.make("grok"),
            enabled: true,
            config: { enabled: false, binaryPath: "/opt/grok" },
          },
        },
      });

      assert.deepEqual(next.providerInstances[grokId], {
        driver: ProviderDriverKind.make("grok"),
        enabled: false,
        config: { binaryPath: "/opt/grok" },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          claudeAgent: {
            binaryPath: "  /opt/homebrew/bin/claude  ",
          },
          opencode: {
            binaryPath: "  /opt/homebrew/bin/opencode  ",
            serverUrl: "  http://127.0.0.1:4096  ",
            serverPassword: "  secret-password  ",
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        shadowHomePath: "",
        launchArgs: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/claude",
        homePath: "",
        customModels: [],
        launchArgs: "",
        autoCompactWindow: "",
      });
      assert.deepEqual(next.providers.opencode, {
        // OpenCode remains opt-in; this update only touches paths.
        enabled: false,
        binaryPath: "/opt/homebrew/bin/opencode",
        serverUrl: "http://127.0.0.1:4096",
        serverPassword: "secret-password",
        customModels: [],
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims observability settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "  ~/Development  ",
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.equal(next.addProjectBaseDirectory, "~/Development");
      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          claudeAgent: {
            binaryPath: "",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.claudeAgent.binaryPath, "claude");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes non-default settings and explicit optional provider defaults to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
          opencode: {
            serverUrl: "http://127.0.0.1:4096",
            serverPassword: "secret-password",
          },
        },
        automaticGitFetchInterval: Duration.seconds(10),
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepEqual(JSON.parse(raw), {
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
          cursor: {
            enabled: false,
          },
          grok: {
            enabled: false,
          },
          opencode: {
            enabled: false,
            serverUrl: "http://127.0.0.1:4096",
            serverPassword: "secret-password",
          },
        },
        backgroundActivity: {
          schemaVersion: 1,
          profile: "custom",
          baseProfile: "balanced",
          overrides: {
            automaticGitFetchInterval: 10_000,
          },
        },
        automaticGitFetchInterval: 10_000,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists the plan review model selection as one atomic value", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const selection = {
        instanceId: DEFAULT_SERVER_SETTINGS.parallelPlanReviewModelSelection.instanceId,
        model: DEFAULT_SERVER_SETTINGS.parallelPlanReviewModelSelection.model,
        options: [{ id: "reasoningEffort", value: "medium" as const }],
      };

      yield* serverSettings.updateSettings({ parallelPlanReviewModelSelection: selection });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const persisted = JSON.parse(raw);
      assert.deepEqual(persisted.parallelPlanReviewModelSelection, selection);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists and clears the Auto Reasoning decision model", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const selection = createModelSelection(
        ProviderInstanceId.make("openai_work"),
        "gpt-5.6-luna",
        [{ id: "reasoningEffort", value: "low" }],
      );

      const saved = yield* serverSettings.updateSettings({
        autoReasoningModelSelection: selection,
      });
      assert.deepEqual(saved.autoReasoningModelSelection, selection);
      const savedRaw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(savedRaw).autoReasoningModelSelection, selection);

      const reset = yield* serverSettings.updateSettings({ autoReasoningModelSelection: null });
      assert.equal(reset.autoReasoningModelSelection, null);
      const resetRaw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.equal(JSON.parse(resetRaw).autoReasoningModelSelection, undefined);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists and replaces the project thread preview sync record", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const initial = {
        count: 3,
        updatedAt: 1_777_000_000_000,
        updateId: "device-a:initial",
      };
      const replacement = {
        count: 6,
        updatedAt: 1_777_000_001_000,
        updateId: "device-b:replacement",
      };

      const saved = yield* serverSettings.updateSettings({
        projectThreadPreviewSyncRecord: initial,
      });
      const afterUnrelatedPatch = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
      });
      const replaced = yield* serverSettings.updateSettings({
        projectThreadPreviewSyncRecord: replacement,
      });

      assert.deepEqual(saved.projectThreadPreviewSyncRecord, initial);
      assert.deepEqual(
        redactServerSettingsForClient(saved).projectThreadPreviewSyncRecord,
        initial,
      );
      assert.deepEqual(afterUnrelatedPatch.projectThreadPreviewSyncRecord, initial);
      assert.deepEqual(replaced.projectThreadPreviewSyncRecord, replacement);

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const persisted = JSON.parse(raw);
      assert.deepEqual(persisted.projectThreadPreviewSyncRecord, replacement);
      assert.deepEqual(
        (yield* decodeServerSettings(persisted)).projectThreadPreviewSyncRecord,
        replacement,
      );
      assert.equal(persisted.addProjectBaseDirectory, "~/Development");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists, replaces, and exposes the chat visual mode sync record", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const initial = {
        mode: "current" as const,
        updatedAt: 1_777_000_000_000,
        updateId: "device-a:current",
      };
      const replacement = {
        mode: "classic" as const,
        updatedAt: 1_777_000_001_000,
        updateId: "device-b:classic",
      };

      const saved = yield* serverSettings.updateSettings({ chatVisualModeSyncRecord: initial });
      const afterUnrelatedPatch = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
      });
      const replaced = yield* serverSettings.updateSettings({
        chatVisualModeSyncRecord: replacement,
      });

      assert.deepEqual(saved.chatVisualModeSyncRecord, initial);
      assert.deepEqual(redactServerSettingsForClient(saved).chatVisualModeSyncRecord, initial);
      assert.deepEqual(afterUnrelatedPatch.chatVisualModeSyncRecord, initial);
      assert.deepEqual(replaced.chatVisualModeSyncRecord, replacement);

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const persisted = JSON.parse(raw);
      assert.deepEqual(persisted.chatVisualModeSyncRecord, replacement);
      assert.deepEqual(
        (yield* decodeServerSettings(persisted)).chatVisualModeSyncRecord,
        replacement,
      );
      assert.equal(persisted.addProjectBaseDirectory, "~/Development");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("stores sensitive provider instance environment values outside settings.json", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const instanceId = ProviderInstanceId.make("codex_personal");

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("codex"),
            environment: [
              { name: "OPENROUTER_API_KEY", value: "sk-or-secret", sensitive: true },
              { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
            ],
            config: {},
          },
        },
      });

      assert.deepEqual(next.providerInstances[instanceId]?.environment, [
        {
          name: "OPENROUTER_API_KEY",
          value: "sk-or-secret",
          sensitive: true,
          valueRedacted: true,
        },
        { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
      ]);

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.notInclude(raw, "sk-or-secret");
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepEqual(JSON.parse(raw).providerInstances.codex_personal.environment, [
        {
          name: "OPENROUTER_API_KEY",
          value: "",
          sensitive: true,
          valueRedacted: true,
        },
        { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
      ]);

      const roundTripped = yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Personal",
            environment: [
              { name: "OPENROUTER_API_KEY", value: "", sensitive: true, valueRedacted: true },
              { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
            ],
            config: {},
          },
        },
      });

      assert.equal(
        roundTripped.providerInstances[instanceId]?.environment?.[0]?.value,
        "sk-or-secret",
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("stores sensitive MCP env and header values outside settings.json", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      const next = yield* serverSettings.updateSettings({
        mcp: {
          servers: [
            {
              id: McpServerId.make("github"),
              name: "GitHub",
              enabled: true,
              scope: "global",
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              env: {
                GITHUB_TOKEN: {
                  value: "ghp-secret",
                  sensitive: true,
                },
              },
            },
            {
              id: McpServerId.make("remote_docs"),
              name: "Remote Docs",
              enabled: true,
              scope: "global",
              transport: "http",
              url: "https://example.com/mcp",
              headers: {
                Authorization: {
                  value: "Bearer secret",
                  sensitive: true,
                },
              },
            },
          ],
        },
      });

      const github = next.mcp.servers[0];
      const remoteDocs = next.mcp.servers[1];
      assert.equal(github?.transport, "stdio");
      assert.equal(remoteDocs?.transport, "http");
      if (github?.transport !== "stdio" || remoteDocs?.transport !== "http") {
        return;
      }
      assert.deepEqual(github.env.GITHUB_TOKEN, {
        value: "ghp-secret",
        sensitive: true,
        valueRedacted: true,
      });
      assert.deepEqual(remoteDocs.headers.Authorization, {
        value: "Bearer secret",
        sensitive: true,
        valueRedacted: true,
      });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.notInclude(raw, "ghp-secret");
      assert.notInclude(raw, "Bearer secret");
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const persisted = JSON.parse(raw);
      assert.equal(persisted.mcp.servers[0].env.GITHUB_TOKEN.value, "");
      assert.equal(persisted.mcp.servers[1].headers.Authorization.value, "");

      const roundTripped = yield* serverSettings.updateSettings({
        mcp: {
          servers: [
            {
              ...github,
              env: {
                GITHUB_TOKEN: {
                  value: "",
                  sensitive: true,
                  valueRedacted: true,
                },
              },
            },
            {
              ...remoteDocs,
              headers: {
                Authorization: {
                  value: "",
                  sensitive: true,
                  valueRedacted: true,
                },
              },
            },
          ],
        },
      });

      const roundTrippedGithub = roundTripped.mcp.servers[0];
      const roundTrippedRemoteDocs = roundTripped.mcp.servers[1];
      assert.equal(roundTrippedGithub?.transport, "stdio");
      assert.equal(roundTrippedRemoteDocs?.transport, "http");
      if (
        roundTrippedGithub?.transport !== "stdio" ||
        roundTrippedRemoteDocs?.transport !== "http"
      ) {
        return;
      }
      assert.equal(roundTrippedGithub.env.GITHUB_TOKEN?.value, "ghp-secret");
      assert.equal(roundTrippedRemoteDocs.headers.Authorization?.value, "Bearer secret");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("stores, preserves, replaces, redacts, and removes the AssemblyAI API key", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      const saved = yield* serverSettings.updateSettings({
        speechTranscription: {
          assemblyAi: { apiKey: { value: "assembly-secret-one", valueRedacted: false } },
        },
      });
      assert.deepEqual(saved.speechTranscription.assemblyAi.apiKey, {
        value: "assembly-secret-one",
        valueRedacted: true,
      });
      assert.deepEqual(redactServerSettingsForClient(saved).speechTranscription.assemblyAi.apiKey, {
        value: "",
        valueRedacted: true,
      });

      const firstRaw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.notInclude(firstRaw, "assembly-secret-one");

      const preserved = yield* serverSettings.updateSettings({
        speechTranscription: {
          assemblyAi: { apiKey: { value: "", valueRedacted: true } },
        },
      });
      assert.equal(preserved.speechTranscription.assemblyAi.apiKey.value, "assembly-secret-one");

      const replaced = yield* serverSettings.updateSettings({
        speechTranscription: {
          assemblyAi: { apiKey: { value: "assembly-secret-two", valueRedacted: false } },
        },
      });
      assert.equal(replaced.speechTranscription.assemblyAi.apiKey.value, "assembly-secret-two");
      const replacedRaw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.notInclude(replacedRaw, "assembly-secret-one");
      assert.notInclude(replacedRaw, "assembly-secret-two");

      const reset = yield* serverSettings.updateSettings({
        speechTranscription: {
          assemblyAi: { apiKey: { value: "", valueRedacted: false } },
        },
      });
      assert.deepEqual(reset.speechTranscription.assemblyAi.apiKey, { value: "" });

      const afterResetRoundTrip = yield* serverSettings.updateSettings({
        speechTranscription: {
          assemblyAi: { apiKey: { value: "", valueRedacted: true } },
        },
      });
      assert.equal(afterResetRoundTrip.speechTranscription.assemblyAi.apiKey.value, "");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists and clears the atomic Fetch model selection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const selection = createModelSelection(
        ProviderInstanceId.make("claude_work"),
        "claude-opus-4-6",
        [
          { id: "effort", value: "high" },
          { id: "serviceTier", value: "priority" },
        ],
      );

      const saved = yield* serverSettings.updateSettings({ fetchModelSelection: selection });
      assert.deepEqual(saved.fetchModelSelection, selection);
      const savedRaw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(savedRaw).fetchModelSelection, selection);

      const reset = yield* serverSettings.updateSettings({ fetchModelSelection: null });
      assert.equal(reset.fetchModelSelection, null);
      const resetRaw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.equal(JSON.parse(resetRaw).fetchModelSelection, undefined);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("stores and clears the dedicated voice translation model", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-luna", [
        { id: "reasoningEffort", value: "low" },
      ]);

      const saved = yield* serverSettings.updateSettings({
        voiceTranslationModelSelection: selection,
      });
      assert.deepEqual(saved.voiceTranslationModelSelection, selection);
      const savedRaw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(savedRaw).voiceTranslationModelSelection, selection);

      const reset = yield* serverSettings.updateSettings({ voiceTranslationModelSelection: null });
      assert.equal(reset.voiceTranslationModelSelection, null);
      const resetRaw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.equal(JSON.parse(resetRaw).voiceTranslationModelSelection, undefined);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
