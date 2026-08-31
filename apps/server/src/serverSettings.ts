/**
 * ServerSettings - Server-authoritative settings service.
 *
 * Owns persistence, validation, and change notification of settings that affect
 * server-side behavior (binary paths, streaming mode, env mode, custom models,
 * text generation model selection).
 *
 * Follows the same pattern as `keybindings.ts`: JSON file + Cache + PubSub +
 * Semaphore + FileSystem.watch for concurrency and external edit detection.
 *
 * @module ServerSettings
 */
import {
  BetterT3SettingsV1,
  bootstrapBetterT3SettingsV1,
  DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type McpEnvironment,
  type McpHeaders,
  type McpSecretValue,
  type McpServerDefinition,
  type ModelSelection,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerSettings,
  ServerSettingsError,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { writeFileStringAtomically } from "./atomicWrite.ts";
import * as ServerConfig from "./config.ts";
import { type DeepPartial, deepMerge } from "@t3tools/shared/Struct";
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import {
  applyServerSettingsPatch,
  isModelSelectionProviderEnabled,
} from "@t3tools/shared/serverSettings";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import { prepareLegacyOpenRouterSettingsMigration } from "./openRouterLegacySettingsMigration.ts";
import { openRouterApiKeySecretName } from "./provider/openrouter/auth/OpenRouterCredentialStore.ts";

export {
  resolveSourceControlWriterModelSelection,
  resolveVoiceTranslationModelSelection,
} from "@t3tools/shared/serverSettings";

const encodeServerSettings = Schema.encodeEffect(ServerSettings);
const encodeServerSettingsJson = Schema.encodeUnknownEffect(fromJsonStringPretty(ServerSettings));
const decodeServerSettings = Schema.decodeUnknownEffect(ServerSettings);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const secretSettingsErrorOperation = (detail: string) => {
  if (detail.includes("read")) return "read-secret" as const;
  if (detail.includes("remove stale")) return "remove-stale-secret" as const;
  if (detail.includes("remove")) return "remove-secret" as const;
  return "write-secret" as const;
};

const toSettingsError = (detail: string, cause: unknown) =>
  new ServerSettingsError({
    settingsPath: "<secret-store>",
    operation: secretSettingsErrorOperation(detail),
    cause,
  });

/**
 * Fold the legacy in-config `enabled` flag into the envelope-level
 * `ProviderInstanceConfig.enabled` and strip it from the config blob, so
 * explicit provider instances carry exactly one enabled flag. Old settings
 * files can hold both flags with conflicting values; an explicit false on
 * either side wins so a user's disable is never silently undone. Runs on
 * every load and update — the file converges on the next write.
 */
const foldProviderInstanceEnabledFlags = (settings: ServerSettings): ServerSettings => {
  let changed = false;
  const providerInstances: Record<string, ProviderInstanceConfig> = {};
  for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
    const config = instance.config;
    // Only fold boolean flags: a malformed `enabled` (e.g. `"false"`) must
    // stay in the blob so driver schema validation flags it instead of the
    // fold silently repairing the config.
    if (
      config === null ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      typeof (config as { readonly enabled?: unknown }).enabled !== "boolean"
    ) {
      providerInstances[instanceId] = instance;
      continue;
    }
    const { enabled: configEnabled, ...restConfig } = config as Record<string, unknown> & {
      readonly enabled: boolean;
    };
    const resolved =
      instance.enabled === false || configEnabled === false
        ? false
        : (instance.enabled ?? configEnabled);
    changed = true;
    providerInstances[instanceId] = {
      ...instance,
      enabled: resolved,
      config: restConfig,
    } satisfies ProviderInstanceConfig;
  }
  if (!changed) {
    return settings;
  }
  return {
    ...settings,
    providerInstances: providerInstances as ServerSettings["providerInstances"],
  };
};

const normalizeServerSettings = (
  settings: ServerSettings,
): Effect.Effect<ServerSettings, ServerSettingsError> =>
  encodeServerSettings(settings).pipe(
    Effect.flatMap(decodeServerSettings),
    Effect.map(foldProviderInstanceEnabledFlags),
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath: "<memory>",
          operation: "normalize",
          cause,
        }),
    ),
  );

function providerEnvironmentSecretName(input: {
  readonly instanceId: string;
  readonly name: string;
}): string {
  return `provider-env-${Buffer.from(input.instanceId, "utf8").toString("base64url")}-${Buffer.from(input.name, "utf8").toString("base64url")}`;
}

function mcpSecretName(input: {
  readonly serverId: string;
  readonly kind: "env" | "header";
  readonly name: string;
}): string {
  return `mcp-${input.kind}-${Buffer.from(input.serverId, "utf8").toString("base64url")}-${Buffer.from(input.name, "utf8").toString("base64url")}`;
}

const ASSEMBLY_AI_API_KEY_SECRET_NAME = "speech-transcription-assembly-ai-api-key";

function redactProviderEnvironmentVariable(
  variable: ProviderInstanceEnvironmentVariable,
): ProviderInstanceEnvironmentVariable {
  if (!variable.sensitive) {
    const { valueRedacted: _omit, ...rest } = variable;
    return rest;
  }
  return {
    ...variable,
    value: "",
    ...(variable.value.length > 0 || variable.valueRedacted ? { valueRedacted: true } : {}),
  };
}

function redactMcpSecretValue(value: McpSecretValue): McpSecretValue {
  if (!value.sensitive) {
    const { valueRedacted: _omit, ...rest } = value;
    return rest;
  }
  return {
    ...value,
    value: "",
    ...(value.value.length > 0 || value.valueRedacted ? { valueRedacted: true } : {}),
  };
}

function redactMcpSecretMap<T extends Record<string, McpSecretValue>>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, redactMcpSecretValue(value)]),
  ) as T;
}

function redactMcpServerDefinition(server: McpServerDefinition): McpServerDefinition {
  switch (server.transport) {
    case "stdio":
      return { ...server, env: redactMcpSecretMap(server.env) };
    case "sse":
    case "http":
      return { ...server, headers: redactMcpSecretMap(server.headers) };
  }
}

function redactOpenRouterInstanceConfig(instance: ProviderInstanceConfig): ProviderInstanceConfig {
  if (
    instance.driver !== "openrouter" ||
    instance.config === null ||
    typeof instance.config !== "object" ||
    Array.isArray(instance.config) ||
    !Object.hasOwn(instance.config, "apiKey")
  ) {
    return instance;
  }
  const { apiKey: _omit, ...config } = instance.config as Record<string, unknown>;
  return { ...instance, config };
}

function redactSpeechTranscriptionSettings(
  settings: ServerSettings["speechTranscription"],
): ServerSettings["speechTranscription"] {
  const apiKey = settings.assemblyAi.apiKey;
  return {
    ...settings,
    assemblyAi: {
      ...settings.assemblyAi,
      apiKey: {
        value: "",
        ...(apiKey.value.length > 0 || apiKey.valueRedacted ? { valueRedacted: true } : {}),
      },
    },
  };
}

export function redactServerSettingsForClient(settings: ServerSettings): ServerSettings {
  const providerInstances = Object.fromEntries(
    Object.entries(settings.providerInstances).map(([instanceId, instance]) => [
      instanceId,
      redactOpenRouterInstanceConfig(
        instance.environment
          ? {
              ...instance,
              environment: instance.environment.map(redactProviderEnvironmentVariable),
            }
          : instance,
      ),
    ]),
  );
  return {
    ...settings,
    enableAssistantStreaming: settings.enableLegacyTokenStreaming,
    providerInstances,
    mcp: {
      ...settings.mcp,
      servers: settings.mcp.servers.map(redactMcpServerDefinition),
    },
    speechTranscription: redactSpeechTranscriptionSettings(settings.speechTranscription),
  };
}

export class ServerSettingsService extends Context.Service<
  ServerSettingsService,
  {
    /** Start the settings runtime and attach file watching. */
    readonly start: Effect.Effect<void, ServerSettingsError>;

    /** Await settings runtime readiness. */
    readonly ready: Effect.Effect<void, ServerSettingsError>;

    /** Read the current settings. */
    readonly getSettings: Effect.Effect<ServerSettings, ServerSettingsError>;

    /** Patch settings and persist. Returns the new full settings object. */
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => Effect.Effect<ServerSettings, ServerSettingsError>;

    /**
     * Atomically read, transform, validate, and persist the latest settings.
     *
     * Use this for read-modify-write operations whose transform must observe
     * all previously committed mutations. The callback runs while the
     * settings write semaphore is held and must not call this service again.
     */
    readonly modifySettings: <E, R>(
      modify: (current: ServerSettings) => Effect.Effect<ServerSettings, E, R>,
    ) => Effect.Effect<ServerSettings, E | ServerSettingsError, R>;

    /** Stream of settings change events. */
    readonly streamChanges: Stream.Stream<ServerSettings>;

    /**
     * Acquire a settings change subscription synchronously in the current
     * fiber. Use this before reading a snapshot when changes between the
     * snapshot and a lazily started stream must not be lost.
     */
    readonly subscribeChanges: Effect.Effect<Stream.Stream<ServerSettings>, never, Scope.Scope>;
  }
>()("t3/serverSettings/ServerSettingsService") {
  /** @deprecated Import and use `layerTest` from this module. */
  static readonly layerTest = (overrides: DeepPartial<ServerSettings> = {}) => layerTest(overrides);
}

export type ServerSettingsShape = ServerSettingsService["Service"];

const makeTest = (overrides: DeepPartial<ServerSettings> = {}) =>
  Effect.gen(function* () {
    const { automaticGitFetchInterval, providerHealthRefreshInterval, ...overridesForMerge } =
      overrides;
    const merged = deepMerge(DEFAULT_SERVER_SETTINGS, overridesForMerge);
    const initialSettings = yield* normalizeServerSettings({
      ...merged,
      ...(automaticGitFetchInterval !== undefined
        ? { automaticGitFetchInterval: automaticGitFetchInterval as Duration.Duration }
        : {}),
      ...(providerHealthRefreshInterval !== undefined
        ? { providerHealthRefreshInterval: providerHealthRefreshInterval as Duration.Duration }
        : {}),
    });
    const currentSettingsRef = yield* Ref.make<ServerSettings>(initialSettings);
    const writeSemaphore = yield* Semaphore.make(1);
    const changesPubSub = yield* PubSub.unbounded<ServerSettings>();

    const modifySettings: ServerSettingsService["Service"]["modifySettings"] = (modify) =>
      writeSemaphore.withPermits(1)(
        Ref.get(currentSettingsRef).pipe(
          Effect.flatMap(modify),
          Effect.flatMap(normalizeServerSettings),
          Effect.tap((nextSettings) => Ref.set(currentSettingsRef, nextSettings)),
          Effect.tap((nextSettings) => PubSub.publish(changesPubSub, nextSettings)),
          Effect.map(resolveTextGenerationProvider),
        ),
      );

    return {
      start: Effect.void,
      ready: Effect.void,
      getSettings: Ref.get(currentSettingsRef).pipe(Effect.map(resolveTextGenerationProvider)),
      updateSettings: (patch) =>
        modifySettings((currentSettings) =>
          Effect.succeed(applyServerSettingsPatch(currentSettings, patch)),
        ),
      modifySettings,
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
      get subscribeChanges() {
        return PubSub.subscribe(changesPubSub).pipe(
          Effect.map((subscription) => Stream.fromSubscription(subscription)),
        );
      },
    } satisfies ServerSettingsService["Service"];
  });

export const layerTest = (overrides: DeepPartial<ServerSettings> = {}) =>
  Layer.effect(ServerSettingsService, makeTest(overrides));

const LenientJsonUnknown = fromLenientJson(Schema.Unknown);
const decodeLenientJsonUnknownExit = Schema.decodeUnknownExit(LenientJsonUnknown);
const decodeServerSettingsExit = Schema.decodeUnknownExit(ServerSettings);
const isBetterT3SettingsV1 = Schema.is(BetterT3SettingsV1);

function readExplicitLegacyDeepThinkingEnabled(
  settings: Readonly<Record<string, unknown>>,
): boolean | undefined {
  const agentEnhancement = settings.agentEnhancement;
  if (
    agentEnhancement === null ||
    typeof agentEnhancement !== "object" ||
    Array.isArray(agentEnhancement)
  ) {
    return undefined;
  }
  const deepThinking = (agentEnhancement as Record<string, unknown>).deepThinking;
  if (deepThinking === null || typeof deepThinking !== "object" || Array.isArray(deepThinking)) {
    return undefined;
  }
  const enabled = (deepThinking as Record<string, unknown>).enabled;
  return typeof enabled === "boolean" ? enabled : undefined;
}

function normalizeBetterT3Compatibility(settings: Readonly<Record<string, unknown>>): unknown {
  const persisted = settings.betterT3Environment;
  if (Object.hasOwn(settings, "betterT3Environment") && !isBetterT3SettingsV1(persisted)) {
    return persisted;
  }
  const legacyDeepThinkingEnabled = readExplicitLegacyDeepThinkingEnabled(settings);
  return bootstrapBetterT3SettingsV1({
    version: 1,
    initialization: "existing-install-migration",
    persistedSettings: isBetterT3SettingsV1(persisted) ? persisted : null,
    compatibilityFlags:
      legacyDeepThinkingEnabled === undefined
        ? []
        : [{ featureId: "agent.deepThinking", enabled: legacyDeepThinkingEnabled }],
  });
}

function needsDeepThinkingCompatibilityWrite(settings: Readonly<Record<string, unknown>>): boolean {
  if (readExplicitLegacyDeepThinkingEnabled(settings) === undefined) return false;
  const persisted = settings.betterT3Environment;
  return isBetterT3SettingsV1(persisted) && !Object.hasOwn(persisted.flags, "agent.deepThinking");
}

function normalizePersistedSettingsCompatibility(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const settings = input as Record<string, unknown>;
  const { enableAssistantStreaming, ...canonicalSettings } = settings;
  const nextSettings: Record<string, unknown> = {
    ...canonicalSettings,
    betterT3Environment: normalizeBetterT3Compatibility(settings),
  };
  const legacyLocale = settings.interfaceLanguageSyncRecord;
  if (
    !Object.hasOwn(settings, "interfaceLocaleSyncRecordV1") &&
    legacyLocale !== null &&
    typeof legacyLocale === "object" &&
    !Array.isArray(legacyLocale)
  ) {
    nextSettings.interfaceLocaleSyncRecordV1 = { version: 1, ...legacyLocale };
  }
  if (
    !Object.hasOwn(settings, "enableLegacyTokenStreaming") &&
    typeof enableAssistantStreaming === "boolean"
  ) {
    return {
      ...nextSettings,
      enableLegacyTokenStreaming: enableAssistantStreaming,
    };
  }
  return nextSettings;
}

function persistedSettingsNeedsCompatibilityWrite(input: unknown): boolean {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const settings = input as Record<string, unknown>;
  return (
    !Object.hasOwn(settings, "betterT3Environment") ||
    needsDeepThinkingCompatibilityWrite(settings) ||
    (Object.hasOwn(settings, "interfaceLanguageSyncRecord") &&
      !Object.hasOwn(settings, "interfaceLocaleSyncRecordV1")) ||
    (Object.hasOwn(settings, "enableAssistantStreaming") &&
      !Object.hasOwn(settings, "enableLegacyTokenStreaming"))
  );
}

const decodePersistedServerSettingsExit = (input: unknown) =>
  decodeServerSettingsExit(normalizePersistedSettingsCompatibility(input));

const PersistedOptionalProviderSettings = Schema.Struct({
  providers: Schema.optionalKey(
    Schema.Struct({
      cursor: Schema.optionalKey(Schema.Struct({ enabled: Schema.optionalKey(Schema.Boolean) })),
      grok: Schema.optionalKey(Schema.Struct({ enabled: Schema.optionalKey(Schema.Boolean) })),
      opencode: Schema.optionalKey(Schema.Struct({ enabled: Schema.optionalKey(Schema.Boolean) })),
    }),
  ),
});
const decodePersistedOptionalProviderSettingsJsonExit = Schema.decodeUnknownExit(
  fromLenientJson(PersistedOptionalProviderSettings),
);

function restoreUsedProviders(
  settings: ServerSettings,
  persisted: typeof PersistedOptionalProviderSettings.Type,
  providerHistory: ReadonlyArray<{
    readonly providerName: string;
    readonly providerInstanceId: string | null;
  }>,
): ServerSettings {
  const usedProviders = new Set(providerHistory.map(({ providerName }) => providerName));
  const usedProviderInstances = new Set(
    providerHistory.map(
      ({ providerName, providerInstanceId }) => providerInstanceId ?? providerName,
    ),
  );
  const providerInstances = Object.fromEntries(
    Object.entries(settings.providerInstances).map(([instanceId, instance]) => [
      instanceId,
      instance.enabled === undefined &&
      (instance.driver === "cursor" ||
        instance.driver === "grok" ||
        instance.driver === "opencode") &&
      usedProviderInstances.has(instanceId)
        ? { ...instance, enabled: true }
        : instance,
    ]),
  );

  return {
    ...settings,
    providers: {
      ...settings.providers,
      cursor: {
        ...settings.providers.cursor,
        enabled: persisted.providers?.cursor?.enabled ?? usedProviders.has("cursor"),
      },
      grok: {
        ...settings.providers.grok,
        enabled: persisted.providers?.grok?.enabled ?? usedProviders.has("grok"),
      },
      opencode: {
        ...settings.providers.opencode,
        enabled: persisted.providers?.opencode?.enabled ?? usedProviders.has("opencode"),
      },
    },
    providerInstances,
  };
}

function resolveTextGenerationProvider(settings: ServerSettings): ServerSettings {
  return isModelSelectionProviderEnabled(settings, settings.textGenerationModelSelection)
    ? settings
    : fallbackTextGenerationProvider(settings);
}

function fallbackTextGenerationProvider(settings: ServerSettings): ServerSettings {
  const fallbackEntry = Object.entries(settings.providers).find(([, provider]) => provider.enabled);
  const fallback = fallbackEntry ? ProviderDriverKind.make(fallbackEntry[0]) : undefined;
  if (!fallback) {
    return settings;
  }

  return {
    ...settings,
    textGenerationModelSelection: {
      instanceId: ProviderInstanceId.make(fallback),
      model:
        DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[fallback] ??
        DEFAULT_MODEL_BY_PROVIDER[fallback] ??
        DEFAULT_TEXT_GENERATION_MODEL,
    } satisfies ModelSelection,
  };
}

// Values under these keys are compared as a whole — never stripped field-by-field.
const ATOMIC_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  "betterT3Environment",
  "backgroundActivity",
  "automaticGitFetchInterval",
  "providerHealthRefreshInterval",
  "sourceControlWriterModelSelection",
  "textGenerationModelSelection",
  "autoReasoningModelSelection",
  "voiceTranslationModelSelection",
  "parallelPlanReviewModelSelection",
]);

// Preserve both enabled states because provider history cannot recover a new opt-in.
const PERSISTED_SERVER_SETTINGS_DEFAULTS = {
  ...DEFAULT_SERVER_SETTINGS,
  providers: {
    ...DEFAULT_SERVER_SETTINGS.providers,
    cursor: { ...DEFAULT_SERVER_SETTINGS.providers.cursor, enabled: undefined },
    grok: { ...DEFAULT_SERVER_SETTINGS.providers.grok, enabled: undefined },
    opencode: { ...DEFAULT_SERVER_SETTINGS.providers.opencode, enabled: undefined },
  },
};

function stripDefaultServerSettings(current: unknown, defaults: unknown): unknown | undefined {
  if (Array.isArray(current) || Array.isArray(defaults)) {
    return Equal.equals(current, defaults) ? undefined : current;
  }

  if (
    current !== null &&
    defaults !== null &&
    typeof current === "object" &&
    typeof defaults === "object"
  ) {
    const currentRecord = current as Record<string, unknown>;
    const defaultsRecord = defaults as Record<string, unknown>;
    const next: Record<string, unknown> = {};

    for (const key of Object.keys(currentRecord)) {
      if (ATOMIC_SETTINGS_KEYS.has(key)) {
        if (!Equal.equals(currentRecord[key], defaultsRecord[key])) {
          next[key] = currentRecord[key];
        }
      } else {
        const stripped = stripDefaultServerSettings(currentRecord[key], defaultsRecord[key]);
        if (stripped !== undefined) {
          next[key] = stripped;
        }
      }
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }

  return Object.is(current, defaults) ? undefined : current;
}

const make = Effect.gen(function* () {
  const { settingsPath } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const sql = yield* SqlClient.SqlClient;
  const writeSemaphore = yield* Semaphore.make(1);
  const cacheKey = "settings" as const;
  const changesPubSub = yield* PubSub.unbounded<ServerSettings>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, ServerSettingsError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const emitChange = (settings: ServerSettings) =>
    PubSub.publish(changesPubSub, settings).pipe(Effect.asVoid);

  const readConfigExists = fs.exists(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          operation: "check-exists",
          cause,
        }),
    ),
  );

  const readRawConfig = fs.readFileString(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          operation: "read-file",
          cause,
        }),
    ),
  );

  const persistLegacyOpenRouterCredentials = Effect.fn(
    "ServerSettings.persistLegacyOpenRouterCredentials",
  )(function* (
    credentials: ReturnType<typeof prepareLegacyOpenRouterSettingsMigration>["credentials"],
  ) {
    for (const credential of credentials) {
      yield* secretStore
        .create(
          openRouterApiKeySecretName(credential.instanceId),
          textEncoder.encode(credential.apiKey),
        )
        .pipe(
          Effect.catch((cause) => {
            if (ServerSecretStore.isSecretAlreadyExistsError(cause)) return Effect.void;
            return Effect.fail(
              new ServerSettingsError({
                settingsPath,
                operation: "write-secret",
                providerInstanceId: credential.instanceId,
                cause,
              }),
            );
          }),
        );
    }
  });

  const sanitizeOpenRouterProviderInstances = Effect.fn(
    "ServerSettings.sanitizeOpenRouterProviderInstances",
  )(function* (settings: ServerSettings) {
    const migration = prepareLegacyOpenRouterSettingsMigration({
      providerInstances: settings.providerInstances,
    });
    if (!migration.changed) return settings;
    yield* persistLegacyOpenRouterCredentials(migration.credentials);
    if (
      migration.settings === null ||
      typeof migration.settings !== "object" ||
      Array.isArray(migration.settings) ||
      !("providerInstances" in migration.settings)
    ) {
      return settings;
    }
    return {
      ...settings,
      providerInstances: migration.settings
        .providerInstances as ServerSettings["providerInstances"],
    };
  });

  const loadSettingsFromDisk = Effect.gen(function* () {
    let settings = DEFAULT_SERVER_SETTINGS;
    let persisted: typeof PersistedOptionalProviderSettings.Type = {};
    let openRouterMigration:
      | ReturnType<typeof prepareLegacyOpenRouterSettingsMigration>
      | undefined;
    let compatibilityMigrationChanged = false;

    const settingsFileExists = yield* readConfigExists;
    if (settingsFileExists) {
      settings = {
        ...DEFAULT_SERVER_SETTINGS,
        betterT3Environment: DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
      };
      const raw = yield* readRawConfig;
      const parsed = decodeLenientJsonUnknownExit(raw);
      const persistedSettings = decodePersistedOptionalProviderSettingsJsonExit(raw);
      if (persistedSettings._tag === "Success") {
        persisted = persistedSettings.value;
      }
      if (parsed._tag === "Failure" || persistedSettings._tag === "Failure") {
        const failure = parsed._tag === "Failure" ? parsed : persistedSettings;
        if (failure._tag === "Failure") {
          yield* Effect.logWarning("failed to parse settings.json, using defaults", {
            path: settingsPath,
            issues: Cause.pretty(failure.cause),
            cause: failure.cause,
          });
        }
      } else {
        const compatibilityWriteNeeded = persistedSettingsNeedsCompatibilityWrite(parsed.value);
        openRouterMigration = prepareLegacyOpenRouterSettingsMigration(parsed.value);
        const decoded = decodePersistedServerSettingsExit(openRouterMigration.settings);
        if (decoded._tag === "Failure") {
          yield* Effect.logWarning("failed to decode settings.json, using defaults", {
            path: settingsPath,
            issues: Cause.pretty(decoded.cause),
            cause: decoded.cause,
          });
        } else {
          settings = decoded.value;
          compatibilityMigrationChanged = compatibilityWriteNeeded;
        }
      }
    }

    const providerHistory = yield* sql<{
      readonly providerName: string;
      readonly providerInstanceId: string | null;
    }>`
      SELECT DISTINCT
        provider_name AS "providerName",
        provider_instance_id AS "providerInstanceId"
      FROM projection_thread_sessions
      WHERE provider_name IN ('cursor', 'grok', 'opencode')
      UNION
      SELECT DISTINCT
        provider_name AS "providerName",
        provider_instance_id AS "providerInstanceId"
      FROM provider_session_runtime
      WHERE provider_name IN ('cursor', 'grok', 'opencode')
    `.pipe(
      Effect.mapError(
        (cause) =>
          new ServerSettingsError({
            settingsPath,
            operation: "read-provider-history",
            cause,
          }),
      ),
    );

    const restoredSettings = foldProviderInstanceEnabledFlags(
      restoreUsedProviders(settings, persisted, providerHistory),
    );
    if (openRouterMigration?.changed) {
      yield* persistLegacyOpenRouterCredentials(openRouterMigration.credentials);
    }
    if (openRouterMigration?.changed || compatibilityMigrationChanged) {
      yield* writeSettingsAtomically(restoredSettings);
    }
    return restoredSettings;
  });

  const settingsCache = yield* Cache.make<typeof cacheKey, ServerSettings, ServerSettingsError>({
    capacity: 1,
    lookup: () => loadSettingsFromDisk,
  });

  const getSettingsFromCache = Cache.get(settingsCache, cacheKey);

  const materializeProviderEnvironmentSecrets = (
    settings: ServerSettings,
  ): Effect.Effect<ServerSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const providerInstances: Record<string, ProviderInstanceConfig> = {
        ...settings.providerInstances,
      };
      for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
        if (!instance.environment) continue;
        const environment: ProviderInstanceEnvironmentVariable[] = [];
        for (const variable of instance.environment) {
          if (!variable.sensitive || !variable.valueRedacted) {
            environment.push(variable);
            continue;
          }
          const secret = yield* secretStore
            .get(providerEnvironmentSecretName({ instanceId, name: variable.name }))
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ServerSettingsError({
                    settingsPath,
                    operation: "read-secret",
                    providerInstanceId: instanceId,
                    environmentVariable: variable.name,
                    cause,
                  }),
              ),
            );
          environment.push({
            ...variable,
            value: Option.isSome(secret) ? textDecoder.decode(secret.value) : "",
          });
        }
        providerInstances[instanceId] = {
          ...instance,
          environment,
        } satisfies ProviderInstanceConfig;
      }
      return {
        ...settings,
        providerInstances: providerInstances as ServerSettings["providerInstances"],
      };
    });

  const materializeChanges = (changes: Stream.Stream<ServerSettings>) =>
    changes.pipe(
      Stream.mapEffect((settings) =>
        materializeProviderEnvironmentSecrets(settings).pipe(
          Effect.flatMap(materializeMcpSecretValues),
          Effect.flatMap(materializeSpeechTranscriptionSecrets),
          Effect.catch((error: ServerSettingsError) =>
            Effect.logWarning("failed to materialize server settings secrets", {
              operation: error.operation,
              providerInstanceId: error.providerInstanceId,
              environmentVariable: error.environmentVariable,
              cause: error.cause,
            }).pipe(Effect.as(settings)),
          ),
        ),
      ),
      Stream.map(resolveTextGenerationProvider),
    );

  const materializeMcpSecretValues = (
    settings: ServerSettings,
  ): Effect.Effect<ServerSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const materializeSecretMap = (input: {
        readonly serverId: string;
        readonly kind: "env" | "header";
        readonly values: Record<string, McpSecretValue>;
      }): Effect.Effect<Record<string, McpSecretValue>, ServerSettingsError> =>
        Effect.gen(function* () {
          const values: Record<string, McpSecretValue> = {};
          for (const [name, value] of Object.entries(input.values)) {
            if (!value.sensitive || !value.valueRedacted) {
              values[name] = value;
              continue;
            }
            const secret = yield* secretStore
              .get(mcpSecretName({ serverId: input.serverId, kind: input.kind, name }))
              .pipe(
                Effect.mapError((cause) =>
                  toSettingsError(`failed to read MCP ${input.kind} secret ${name}`, cause),
                ),
              );
            values[name] = {
              ...value,
              value: Option.match(secret, {
                onNone: () => "",
                onSome: (bytes) => textDecoder.decode(bytes),
              }),
            };
          }
          return values;
        });

      const materializeServer = (
        server: McpServerDefinition,
      ): Effect.Effect<McpServerDefinition, ServerSettingsError> => {
        switch (server.transport) {
          case "stdio":
            return materializeSecretMap({
              serverId: server.id,
              kind: "env",
              values: server.env,
            }).pipe(
              Effect.map(
                (env) => ({ ...server, env: env as McpEnvironment }) satisfies McpServerDefinition,
              ),
            );
          case "sse":
          case "http":
            return materializeSecretMap({
              serverId: server.id,
              kind: "header",
              values: server.headers,
            }).pipe(
              Effect.map(
                (headers) =>
                  ({ ...server, headers: headers as McpHeaders }) satisfies McpServerDefinition,
              ),
            );
        }
      };

      const servers = yield* Effect.forEach(settings.mcp.servers, materializeServer);

      return {
        ...settings,
        mcp: {
          ...settings.mcp,
          servers,
        },
      };
    });

  const materializeSpeechTranscriptionSecrets = (
    settings: ServerSettings,
  ): Effect.Effect<ServerSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const apiKey = settings.speechTranscription.assemblyAi.apiKey;
      if (!apiKey.valueRedacted) {
        return settings;
      }
      const secret = yield* secretStore
        .get(ASSEMBLY_AI_API_KEY_SECRET_NAME)
        .pipe(
          Effect.mapError((cause) =>
            toSettingsError("failed to read AssemblyAI API key secret", cause),
          ),
        );
      return {
        ...settings,
        speechTranscription: {
          ...settings.speechTranscription,
          assemblyAi: {
            ...settings.speechTranscription.assemblyAi,
            apiKey: {
              ...apiKey,
              value: Option.match(secret, {
                onNone: () => "",
                onSome: (bytes) => textDecoder.decode(bytes),
              }),
            },
          },
        },
      };
    });

  const persistProviderEnvironmentSecrets = (
    current: ServerSettings,
    next: ServerSettings,
  ): Effect.Effect<ServerSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const providerInstances: Record<string, ProviderInstanceConfig> = {
        ...next.providerInstances,
      };

      const nextSecretKeys = new Set<string>();
      for (const [instanceId, instance] of Object.entries(next.providerInstances)) {
        if (!instance.environment) continue;
        const environment: ProviderInstanceEnvironmentVariable[] = [];
        for (const variable of instance.environment) {
          const secretName = providerEnvironmentSecretName({ instanceId, name: variable.name });
          if (!variable.sensitive) {
            yield* secretStore.remove(secretName).pipe(
              Effect.mapError(
                (cause) =>
                  new ServerSettingsError({
                    settingsPath,
                    operation: "remove-secret",
                    providerInstanceId: instanceId,
                    environmentVariable: variable.name,
                    cause,
                  }),
              ),
            );
            environment.push(redactProviderEnvironmentVariable(variable));
            continue;
          }

          nextSecretKeys.add(secretName);
          if (!variable.valueRedacted) {
            if (variable.value.length > 0) {
              yield* secretStore.set(secretName, textEncoder.encode(variable.value)).pipe(
                Effect.mapError(
                  (cause) =>
                    new ServerSettingsError({
                      settingsPath,
                      operation: "write-secret",
                      providerInstanceId: instanceId,
                      environmentVariable: variable.name,
                      cause,
                    }),
                ),
              );
              environment.push({ ...variable, value: "", valueRedacted: true });
            } else {
              yield* secretStore.remove(secretName).pipe(
                Effect.mapError(
                  (cause) =>
                    new ServerSettingsError({
                      settingsPath,
                      operation: "remove-secret",
                      providerInstanceId: instanceId,
                      environmentVariable: variable.name,
                      cause,
                    }),
                ),
              );
              const { valueRedacted: _omit, ...rest } = variable;
              environment.push(rest);
            }
            continue;
          }

          environment.push(redactProviderEnvironmentVariable(variable));
        }
        providerInstances[instanceId] = {
          ...instance,
          environment,
        } satisfies ProviderInstanceConfig;
      }

      for (const [instanceId, instance] of Object.entries(current.providerInstances)) {
        for (const variable of instance.environment ?? []) {
          if (!variable.sensitive) continue;
          const secretName = providerEnvironmentSecretName({ instanceId, name: variable.name });
          if (nextSecretKeys.has(secretName)) continue;
          yield* secretStore.remove(secretName).pipe(
            Effect.mapError(
              (cause) =>
                new ServerSettingsError({
                  settingsPath,
                  operation: "remove-stale-secret",
                  providerInstanceId: instanceId,
                  environmentVariable: variable.name,
                  cause,
                }),
            ),
          );
        }
      }

      return {
        ...next,
        providerInstances: providerInstances as ServerSettings["providerInstances"],
      };
    });

  const persistMcpSecretValues = (
    current: ServerSettings,
    next: ServerSettings,
  ): Effect.Effect<ServerSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const nextSecretKeys = new Set<string>();
      const persistSecretMap = (input: {
        readonly serverId: string;
        readonly kind: "env" | "header";
        readonly values: Record<string, McpSecretValue>;
      }): Effect.Effect<Record<string, McpSecretValue>, ServerSettingsError> =>
        Effect.gen(function* () {
          const values: Record<string, McpSecretValue> = {};
          for (const [name, value] of Object.entries(input.values)) {
            const secretName = mcpSecretName({
              serverId: input.serverId,
              kind: input.kind,
              name,
            });
            if (!value.sensitive) {
              yield* secretStore
                .remove(secretName)
                .pipe(
                  Effect.mapError((cause) =>
                    toSettingsError(`failed to remove MCP ${input.kind} secret ${name}`, cause),
                  ),
                );
              values[name] = redactMcpSecretValue(value);
              continue;
            }

            nextSecretKeys.add(secretName);
            if (!value.valueRedacted) {
              if (value.value.length > 0) {
                yield* secretStore
                  .set(secretName, textEncoder.encode(value.value))
                  .pipe(
                    Effect.mapError((cause) =>
                      toSettingsError(`failed to persist MCP ${input.kind} secret ${name}`, cause),
                    ),
                  );
                values[name] = { ...value, value: "", valueRedacted: true };
              } else {
                yield* secretStore
                  .remove(secretName)
                  .pipe(
                    Effect.mapError((cause) =>
                      toSettingsError(`failed to remove MCP ${input.kind} secret ${name}`, cause),
                    ),
                  );
                const { valueRedacted: _omit, ...rest } = value;
                values[name] = rest;
              }
              continue;
            }

            values[name] = redactMcpSecretValue(value);
          }
          return values;
        });

      const persistServer = (
        server: McpServerDefinition,
      ): Effect.Effect<McpServerDefinition, ServerSettingsError> => {
        switch (server.transport) {
          case "stdio":
            return persistSecretMap({
              serverId: server.id,
              kind: "env",
              values: server.env,
            }).pipe(
              Effect.map(
                (env) => ({ ...server, env: env as McpEnvironment }) satisfies McpServerDefinition,
              ),
            );
          case "sse":
          case "http":
            return persistSecretMap({
              serverId: server.id,
              kind: "header",
              values: server.headers,
            }).pipe(
              Effect.map(
                (headers) =>
                  ({
                    ...server,
                    headers: headers as McpHeaders,
                  }) satisfies McpServerDefinition,
              ),
            );
        }
      };

      const servers = yield* Effect.forEach(next.mcp.servers, persistServer);

      for (const server of current.mcp.servers) {
        const staleValues =
          server.transport === "stdio"
            ? Object.entries(server.env).map(([name, value]) => ({
                kind: "env" as const,
                name,
                value,
              }))
            : Object.entries(server.headers).map(([name, value]) => ({
                kind: "header" as const,
                name,
                value,
              }));

        for (const { kind, name, value } of staleValues) {
          if (!value.sensitive) continue;
          const secretName = mcpSecretName({ serverId: server.id, kind, name });
          if (nextSecretKeys.has(secretName)) continue;
          yield* secretStore
            .remove(secretName)
            .pipe(
              Effect.mapError((cause) =>
                toSettingsError(`failed to remove stale MCP ${kind} secret ${name}`, cause),
              ),
            );
        }
      }

      return {
        ...next,
        mcp: {
          ...next.mcp,
          servers,
        },
      };
    });

  const persistSpeechTranscriptionSecrets = (
    next: ServerSettings,
  ): Effect.Effect<ServerSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const apiKey = next.speechTranscription.assemblyAi.apiKey;
      if (apiKey.value.length > 0) {
        yield* secretStore
          .set(ASSEMBLY_AI_API_KEY_SECRET_NAME, textEncoder.encode(apiKey.value))
          .pipe(
            Effect.mapError((cause) =>
              toSettingsError("failed to persist AssemblyAI API key secret", cause),
            ),
          );
        return {
          ...next,
          speechTranscription: redactSpeechTranscriptionSettings({
            ...next.speechTranscription,
            assemblyAi: {
              ...next.speechTranscription.assemblyAi,
              apiKey: { value: apiKey.value, valueRedacted: true },
            },
          }),
        };
      }
      if (apiKey.valueRedacted) {
        return {
          ...next,
          speechTranscription: redactSpeechTranscriptionSettings(next.speechTranscription),
        };
      }
      yield* secretStore
        .remove(ASSEMBLY_AI_API_KEY_SECRET_NAME)
        .pipe(
          Effect.mapError((cause) =>
            toSettingsError("failed to remove AssemblyAI API key secret", cause),
          ),
        );
      return {
        ...next,
        speechTranscription: {
          ...next.speechTranscription,
          assemblyAi: {
            ...next.speechTranscription.assemblyAi,
            apiKey: { value: "" },
          },
        },
      };
    });

  const writeSettingsAtomically = Effect.fnUntraced(
    function* (settings: ServerSettings) {
      const sparseSettingsJson = yield* encodeServerSettingsJson(
        stripDefaultServerSettings(settings, PERSISTED_SERVER_SETTINGS_DEFAULTS) ?? {},
      );

      return yield* writeFileStringAtomically({
        filePath: settingsPath,
        contents: `${sparseSettingsJson}\n`,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
      );
    },
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          operation: "write-file",
          cause,
        }),
    ),
  );

  const revalidateAndEmit = writeSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(settingsCache, cacheKey);
      const settings = yield* getSettingsFromCache;
      yield* emitChange(settings);
    }),
  );

  const startWatcher = Effect.gen(function* () {
    const settingsDir = pathService.dirname(settingsPath);
    const settingsFile = pathService.basename(settingsPath);
    const settingsPathResolved = pathService.resolve(settingsPath);

    yield* fs.makeDirectory(settingsDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ServerSettingsError({
            settingsPath,
            operation: "prepare-directory",
            cause,
          }),
      ),
    );

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));

    // Debounce watch events so the file is fully written before we read it.
    // Editors emit multiple events per save (truncate, write, rename) and
    // `fs.watch` can fire before the content has been flushed to disk.
    const debouncedSettingsEvents = fs.watch(settingsDir).pipe(
      Stream.filter((event) => {
        return (
          event.path === settingsFile ||
          event.path === settingsPath ||
          pathService.resolve(settingsDir, event.path) === settingsPathResolved
        );
      }),
      Stream.debounce(Duration.millis(100)),
    );

    yield* Stream.runForEach(debouncedSettingsEvents, () => revalidateAndEmitSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );
  });

  const start = Effect.gen(function* () {
    const shouldStart = yield* Ref.modify(startedRef, (started) => [!started, true]);
    if (!shouldStart) {
      return yield* Deferred.await(startedDeferred);
    }

    const startup = Effect.gen(function* () {
      yield* startWatcher;
      yield* Cache.invalidate(settingsCache, cacheKey);
      yield* getSettingsFromCache;
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  const modifySettings: ServerSettingsService["Service"]["modifySettings"] = (modify) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* getSettingsFromCache;
        const requested = yield* modify(current);
        const sanitizedRequested = yield* sanitizeOpenRouterProviderInstances(requested);
        const nextWithProviderSecrets = yield* persistProviderEnvironmentSecrets(
          current,
          sanitizedRequested,
        );
        const nextWithMcpSecrets = yield* persistMcpSecretValues(current, nextWithProviderSecrets);
        const nextPersisted = yield* persistSpeechTranscriptionSecrets(nextWithMcpSecrets);
        const next = yield* normalizeServerSettings(nextPersisted);
        yield* writeSettingsAtomically(next);
        yield* Cache.set(settingsCache, cacheKey, next);
        yield* emitChange(next);
        const materialized = yield* materializeProviderEnvironmentSecrets(next).pipe(
          Effect.flatMap(materializeMcpSecretValues),
          Effect.flatMap(materializeSpeechTranscriptionSecrets),
        );
        return resolveTextGenerationProvider(materialized);
      }),
    );

  return {
    start,
    ready: Deferred.await(startedDeferred),
    getSettings: getSettingsFromCache.pipe(
      Effect.flatMap(materializeProviderEnvironmentSecrets),
      Effect.flatMap(materializeMcpSecretValues),
      Effect.flatMap(materializeSpeechTranscriptionSecrets),
      Effect.map(resolveTextGenerationProvider),
    ),
    updateSettings: (patch) =>
      modifySettings((current) => Effect.succeed(applyServerSettingsPatch(current, patch))),
    modifySettings,
    get streamChanges() {
      return materializeChanges(Stream.fromPubSub(changesPubSub));
    },
    get subscribeChanges() {
      return PubSub.subscribe(changesPubSub).pipe(
        Effect.map((subscription) => materializeChanges(Stream.fromSubscription(subscription))),
      );
    },
  } satisfies ServerSettingsService["Service"];
});

export const layer = Layer.effect(ServerSettingsService, make);
