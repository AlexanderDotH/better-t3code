// @effect-diagnostics globalFetch:off
import {
  KIRO_AMAZON_Q_DRIVER_KIND,
  LOCAL_OPENAI_DRIVER_KIND,
  NVIDIA_NIM_DRIVER_KIND,
  OPENROUTER_DRIVER_KIND,
  OPENCODE_GO_DRIVER_KIND,
  OPENCODE_ZEN_DRIVER_KIND,
  type KiroAmazonQSettings,
  type LocalOpenAiSettings,
  type NvidiaNimSettings,
  type OpenCodeGoSettings,
  type OpenCodeZenSettings,
  type OpenRouterSettings,
  KiroAmazonQSettings as KiroAmazonQSettingsSchema,
  LocalOpenAiSettings as LocalOpenAiSettingsSchema,
  NvidiaNimSettings as NvidiaNimSettingsSchema,
  OpenCodeGoSettings as OpenCodeGoSettingsSchema,
  OpenCodeZenSettings as OpenCodeZenSettingsSchema,
  OpenRouterSettings as OpenRouterSettingsSchema,
  type ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { makeUnsupportedTextGeneration } from "../../textGeneration/UnsupportedTextGeneration.ts";
import {
  ProviderAdapterRequestError,
  ProviderDriverError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { makeHttpChatAdapter, type HttpChatAdapterExecuteTurn } from "../Layers/HttpChatAdapter.ts";
import {
  fetchKiroChatModelCatalog,
  fetchMergedLocalOpenAiModelCatalog,
  fetchNvidiaNimModelCatalog,
  fetchOpencodeGoChatModelCatalog,
  fetchOpencodeZenChatModelCatalog,
  fetchOpenRouterModelCatalog,
  KIRO_AMAZON_Q_PROVIDER,
  LOCAL_OPENAI_PROVIDER,
  NVIDIA_NIM_PROVIDER,
  OPENCODE_GO_PROVIDER,
  OPENCODE_ZEN_PROVIDER,
  OPENROUTER_PROVIDER,
  type FetchLike,
  type OpenAiCompatibleCatalogModel,
  type OpenAiCompatibleModelListRow,
  type OpenAiCompatibleProviderDefinition,
  buildOpenAiCompatibleProviderSnapshot,
} from "../Layers/OpenAiCompatibleProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  NVIDIA_NIM_BODY_POLICY,
  OPENROUTER_BODY_POLICY,
  STRICT_OPENAI_BODY_POLICY,
  applyOpenAiCompletionBodyPolicies,
  extractOpenAiTextContent,
  extractOpenRouterReasoningPayload,
  parseOpenAiSseDataLine,
  toOpenAiMessages,
  type OpenAiReasoningEffort,
  type OpenAiCompatibleBodyPolicy,
} from "../llm/OpenAiCompatibleChat.ts";

const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

type Settings =
  | OpenRouterSettings
  | NvidiaNimSettings
  | LocalOpenAiSettings
  | OpenCodeZenSettings
  | OpenCodeGoSettings
  | KiroAmazonQSettings;

type OpenAiRuntimeSettings =
  | OpenRouterSettings
  | NvidiaNimSettings
  | LocalOpenAiSettings
  | OpenCodeZenSettings
  | OpenCodeGoSettings;

type DriverEnv = Crypto.Crypto | ServerSettingsService;

interface DriverSpec<Config extends Settings> {
  readonly driverKind: ProviderDriverKind;
  readonly provider: OpenAiCompatibleProviderDefinition;
  readonly configSchema: Schema.Codec<Config, unknown>;
  readonly decodeConfig: (input: unknown) => Config;
  readonly packageName: string | null;
  readonly defaultModel: string;
  readonly bodyPolicy: OpenAiCompatibleBodyPolicy;
  readonly resolveApiKey: (config: Config, env: NodeJS.ProcessEnv) => string;
  readonly resolveBaseUrl: (config: Config) => string;
  readonly fetchCatalog: (input: {
    readonly config: Config;
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly fetchImpl: FetchLike;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<ReadonlyArray<OpenAiCompatibleCatalogModel | OpenAiCompatibleModelListRow>>;
  readonly runtimeKind: "openai-chat-completions" | "unsupported";
}

const decodeOpenRouter = Schema.decodeUnknownSync(OpenRouterSettingsSchema);
const decodeNvidiaNim = Schema.decodeUnknownSync(NvidiaNimSettingsSchema);
const decodeLocalOpenAi = Schema.decodeUnknownSync(LocalOpenAiSettingsSchema);
const decodeOpenCodeZen = Schema.decodeUnknownSync(OpenCodeZenSettingsSchema);
const decodeOpenCodeGo = Schema.decodeUnknownSync(OpenCodeGoSettingsSchema);
const decodeKiro = Schema.decodeUnknownSync(KiroAmazonQSettingsSchema);

const globalFetchLike: FetchLike = (url, init) =>
  globalThis.fetch(url, init as RequestInit) as Promise<Response>;

function configuredApiKey(
  configured: string,
  env: NodeJS.ProcessEnv,
  ...envNames: ReadonlyArray<string>
): string {
  const direct = configured.trim();
  if (direct) return direct;
  for (const envName of envNames) {
    const value = env[envName]?.trim();
    if (value) return value;
  }
  return "";
}

function mergeCatalogWithCustomModels(
  catalogModels: ReadonlyArray<OpenAiCompatibleCatalogModel | OpenAiCompatibleModelListRow>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<OpenAiCompatibleCatalogModel | OpenAiCompatibleModelListRow> {
  const output = [...catalogModels];
  const seen = new Set(output.map((model) => model.id));
  for (const candidate of customModels) {
    const id = candidate.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({ id });
  }
  return output;
}

function compactError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error).trim() || "Unknown error";
}

function responseChoiceText(json: unknown): string {
  const choices =
    json && typeof json === "object" ? (json as { choices?: unknown }).choices : undefined;
  if (!Array.isArray(choices)) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const record = first as Record<string, unknown>;
  const message =
    record.message && typeof record.message === "object"
      ? (record.message as Record<string, unknown>)
      : record.delta && typeof record.delta === "object"
        ? (record.delta as Record<string, unknown>)
        : record;
  return extractOpenAiTextContent(message.content);
}

function responseChoiceReasoning(json: unknown): string {
  const choices =
    json && typeof json === "object" ? (json as { choices?: unknown }).choices : undefined;
  if (!Array.isArray(choices)) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const record = first as Record<string, unknown>;
  const message =
    record.message && typeof record.message === "object"
      ? (record.message as Record<string, unknown>)
      : record.delta && typeof record.delta === "object"
        ? (record.delta as Record<string, unknown>)
        : record;
  return extractOpenRouterReasoningPayload(message);
}

function parseReasoningEffort(raw: string | undefined): OpenAiReasoningEffort | undefined {
  switch (raw) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return raw;
    default:
      return undefined;
  }
}

async function readOpenAiResponseText(
  response: Response,
  emitAssistantDelta: (delta: string) => Effect.Effect<void, ProviderAdapterError>,
  emitReasoningDelta: (delta: string) => Effect.Effect<void, ProviderAdapterError>,
): Promise<{ readonly text: string; readonly reasoning: string }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const json = await response.json().catch(() => null);
    const reasoning = responseChoiceReasoning(json);
    if (reasoning) await Effect.runPromise(emitReasoningDelta(reasoning));
    return { text: responseChoiceText(json), reasoning };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseOpenAiSseDataLine(line);
        if (parsed.type === "done") return { text, reasoning };
        if (parsed.type !== "json") continue;
        const deltaText = responseChoiceText(parsed.value);
        const deltaReasoning = responseChoiceReasoning(parsed.value);
        if (deltaReasoning) {
          reasoning += deltaReasoning;
          await Effect.runPromise(emitReasoningDelta(deltaReasoning));
        }
        if (deltaText) {
          text += deltaText;
          await Effect.runPromise(emitAssistantDelta(deltaText));
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text, reasoning };
}

function makeExecuteTurn<Config extends OpenAiRuntimeSettings>(
  spec: DriverSpec<Config>,
  config: Config,
  env: NodeJS.ProcessEnv,
): HttpChatAdapterExecuteTurn {
  return (input) =>
    Effect.tryPromise({
      try: async () => {
        const apiKey = spec.resolveApiKey(config, env);
        const baseUrl = spec.resolveBaseUrl(config).replace(/\/+$/, "");
        if (!baseUrl) {
          throw new Error(`${spec.provider.displayName} base URL is not configured.`);
        }
        if (spec.provider.requiresApiKey && !apiKey) {
          throw new Error(`${spec.provider.displayName} API key is not configured.`);
        }

        const reasoningEffort = parseReasoningEffort(
          getModelSelectionStringOptionValue(input.input.modelSelection, "reasoningEffort"),
        );
        const contextCompressionSelection = getModelSelectionBooleanOptionValue(
          input.input.modelSelection,
          "contextCompression",
        );
        const model = input.input.modelSelection?.model ?? input.session.model ?? spec.defaultModel;
        const messages = toOpenAiMessages(
          input.session.cwd ? `Workspace: ${input.session.cwd}` : "",
          input.messages.map((message) => ({
            role: message.role === "user" ? "user" : "assistant",
            parts: [{ text: message.content }],
          })),
        );
        const body: Record<string, unknown> = {
          model,
          messages,
          stream: true,
        };

        applyOpenAiCompletionBodyPolicies({
          body,
          bodyPolicy: spec.bodyPolicy,
          contextCompressionEnabled:
            contextCompressionSelection ??
            ("contextCompression" in config ? config.contextCompression : false),
          reasoning: reasoningEffort
            ? {
                storedModelId: model,
                effort: reasoningEffort,
              }
            : undefined,
        });

        // @effect-diagnostics-next-line globalFetchInEffect:off - Provider adapters run at the Node HTTP boundary.
        const response = await globalThis.fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          // @effect-diagnostics-next-line preferSchemaOverJson:off - OpenAI-compatible provider bodies are open extension objects.
          body: JSON.stringify(body),
          signal: input.signal,
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(
            `${spec.provider.displayName} chat request failed (${response.status}): ${detail.slice(0, 400)}`,
          );
        }
        const result = await readOpenAiResponseText(
          response,
          input.emitAssistantDelta,
          input.emitReasoningDelta,
        );
        return {
          assistantText: result.text,
          ...(result.reasoning ? { reasoningText: result.reasoning } : {}),
        };
      },
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: spec.driverKind,
          method: "chat.completions",
          detail: compactError(cause),
          cause,
        }),
    });
}

function unsupportedRuntime<Config extends Settings>(
  spec: DriverSpec<Config>,
): HttpChatAdapterExecuteTurn {
  return () =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: spec.driverKind,
        method: "sendTurn",
        detail: `${spec.provider.displayName} model catalog and settings are integrated, but its non-OpenAI agent runtime is not implemented yet.`,
      }),
    );
}

function makeInitialSnapshot<Config extends Settings>(
  spec: DriverSpec<Config>,
  config: Config,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    return yield* buildOpenAiCompatibleProviderSnapshot({
      provider: spec.provider,
      enabled: config.enabled,
      checkedAt,
      apiKey: "",
      baseUrl: spec.resolveBaseUrl(config),
      catalogModels: mergeCatalogWithCustomModels([], config.customModels),
    });
  });
}

function checkProvider<Config extends Settings>(
  spec: DriverSpec<Config>,
  config: Config,
  env: NodeJS.ProcessEnv,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const apiKey = spec.resolveApiKey(config, env);
    const baseUrl = spec.resolveBaseUrl(config);
    let catalogModels: ReadonlyArray<OpenAiCompatibleCatalogModel | OpenAiCompatibleModelListRow> =
      [];
    let catalogError: string | null = null;
    if (
      config.enabled &&
      (!spec.provider.requiresApiKey || apiKey) &&
      (!spec.provider.requiresBaseUrl || baseUrl)
    ) {
      const catalogResult = yield* Effect.promise(() =>
        spec
          .fetchCatalog({
            config,
            apiKey,
            baseUrl,
            fetchImpl: globalFetchLike,
          })
          .then((models) => ({ _tag: "success" as const, models }))
          .catch((error: unknown) => ({ _tag: "failure" as const, message: compactError(error) })),
      );
      if (catalogResult._tag === "success") {
        catalogModels = catalogResult.models;
      } else {
        catalogError = catalogResult.message;
      }
    }

    return yield* buildOpenAiCompatibleProviderSnapshot({
      provider: spec.provider,
      enabled: config.enabled,
      checkedAt,
      apiKey,
      baseUrl,
      catalogModels: mergeCatalogWithCustomModels(catalogModels, config.customModels),
      catalogError,
    });
  });
}

const withInstanceIdentity =
  (input: {
    readonly driverKind: ProviderDriverKind;
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: input.driverKind,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

function makeDriver<Config extends Settings>(
  spec: DriverSpec<Config>,
): ProviderDriver<Config, DriverEnv> {
  const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
    provider: spec.driverKind,
    packageName: spec.packageName,
  });

  return {
    driverKind: spec.driverKind,
    metadata: {
      displayName: spec.provider.displayName,
      supportsMultipleInstances: true,
    },
    configSchema: spec.configSchema,
    defaultConfig: () => spec.decodeConfig({}),
    create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsService;
        const env = { ...process.env };
        for (const variable of environment ?? []) {
          env[variable.name] = variable.value;
        }
        const effectiveConfig = { ...config, enabled } as Config;
        const continuationIdentity = defaultProviderContinuationIdentity({
          driverKind: spec.driverKind,
          instanceId,
        });
        const stampIdentity = withInstanceIdentity({
          driverKind: spec.driverKind,
          instanceId,
          displayName,
          accentColor,
          continuationGroupKey: continuationIdentity.continuationKey,
        });
        const adapter = yield* makeHttpChatAdapter({
          provider: spec.driverKind,
          providerInstanceId: instanceId,
          executeTurn:
            spec.runtimeKind === "openai-chat-completions"
              ? makeExecuteTurn(
                  spec as unknown as DriverSpec<OpenAiRuntimeSettings>,
                  effectiveConfig as OpenAiRuntimeSettings,
                  env,
                )
              : unsupportedRuntime(spec),
        });
        const textGeneration = makeUnsupportedTextGeneration(spec.provider.displayName);
        const snapshotSettings = makeProviderSnapshotSettingsSource(
          effectiveConfig,
          serverSettings,
        );
        const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<Config>>({
          maintenanceCapabilities,
          getSettings: snapshotSettings.getSettings,
          streamSettings: snapshotSettings.streamSettings,
          haveSettingsChanged: haveProviderSnapshotSettingsChanged,
          initialSnapshot: (settings) =>
            makeInitialSnapshot(spec, settings.provider).pipe(Effect.map(stampIdentity)),
          checkProvider: checkProvider(spec, effectiveConfig, env).pipe(Effect.map(stampIdentity)),
          refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: spec.driverKind,
                instanceId,
                detail: `Failed to build ${spec.provider.displayName} snapshot: ${cause.message ?? String(cause)}`,
                cause,
              }),
          ),
        );

        return {
          instanceId,
          driverKind: spec.driverKind,
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
}

export const OpenRouterDriver = makeDriver<OpenRouterSettings>({
  driverKind: OPENROUTER_DRIVER_KIND,
  provider: OPENROUTER_PROVIDER,
  configSchema: OpenRouterSettingsSchema,
  decodeConfig: decodeOpenRouter,
  packageName: null,
  defaultModel: "openai/gpt-5",
  bodyPolicy: OPENROUTER_BODY_POLICY,
  resolveApiKey: (config, env) => configuredApiKey(config.apiKey, env, "OPENROUTER_API_KEY"),
  resolveBaseUrl: (config) => config.baseUrl,
  fetchCatalog: ({ apiKey, baseUrl, fetchImpl, signal }) =>
    fetchOpenRouterModelCatalog({
      apiKey,
      baseUrl,
      fetchImpl,
      ...(signal ? { signal } : {}),
    }),
  runtimeKind: "openai-chat-completions",
});

export const NvidiaNimDriver = makeDriver<NvidiaNimSettings>({
  driverKind: NVIDIA_NIM_DRIVER_KIND,
  provider: NVIDIA_NIM_PROVIDER,
  configSchema: NvidiaNimSettingsSchema,
  decodeConfig: decodeNvidiaNim,
  packageName: null,
  defaultModel: "z-ai/glm-4.5",
  bodyPolicy: NVIDIA_NIM_BODY_POLICY,
  resolveApiKey: (config, env) => configuredApiKey(config.apiKey, env, "NVIDIA_API_KEY"),
  resolveBaseUrl: (config) => config.baseUrl,
  fetchCatalog: ({ apiKey, baseUrl, fetchImpl, signal }) =>
    fetchNvidiaNimModelCatalog({
      apiKey,
      baseUrl,
      fetchImpl,
      ...(signal ? { signal } : {}),
    }),
  runtimeKind: "openai-chat-completions",
});

export const LocalOpenAiDriver = makeDriver<LocalOpenAiSettings>({
  driverKind: LOCAL_OPENAI_DRIVER_KIND,
  provider: LOCAL_OPENAI_PROVIDER,
  configSchema: LocalOpenAiSettingsSchema,
  decodeConfig: decodeLocalOpenAi,
  packageName: null,
  defaultModel: "llama3.1",
  bodyPolicy: STRICT_OPENAI_BODY_POLICY,
  resolveApiKey: (config, env) => configuredApiKey(config.apiKey, env, "LOCAL_OPENAI_API_KEY"),
  resolveBaseUrl: (config) => config.v1BaseUrl,
  fetchCatalog: ({ config, apiKey, fetchImpl, signal }) =>
    fetchMergedLocalOpenAiModelCatalog({
      configuredBaseUrl: config.v1BaseUrl,
      apiKey,
      fetchImpl,
      ...(signal ? { signal } : {}),
    }).then((result) => result.models),
  runtimeKind: "openai-chat-completions",
});

export const OpenCodeZenDriver = makeDriver<OpenCodeZenSettings>({
  driverKind: OPENCODE_ZEN_DRIVER_KIND,
  provider: OPENCODE_ZEN_PROVIDER,
  configSchema: OpenCodeZenSettingsSchema,
  decodeConfig: decodeOpenCodeZen,
  packageName: null,
  defaultModel: "big-pickle",
  bodyPolicy: STRICT_OPENAI_BODY_POLICY,
  resolveApiKey: (config, env) => configuredApiKey(config.apiKey, env, "OPENCODE_ZEN_API_KEY"),
  resolveBaseUrl: (config) => config.baseUrl,
  fetchCatalog: ({ apiKey, baseUrl, fetchImpl, signal }) =>
    fetchOpencodeZenChatModelCatalog({
      apiKey,
      baseUrl,
      fetchImpl,
      ...(signal ? { signal } : {}),
    }),
  runtimeKind: "openai-chat-completions",
});

export const OpenCodeGoDriver = makeDriver<OpenCodeGoSettings>({
  driverKind: OPENCODE_GO_DRIVER_KIND,
  provider: OPENCODE_GO_PROVIDER,
  configSchema: OpenCodeGoSettingsSchema,
  decodeConfig: decodeOpenCodeGo,
  packageName: null,
  defaultModel: "deepseek-v4-pro",
  bodyPolicy: STRICT_OPENAI_BODY_POLICY,
  resolveApiKey: (config, env) => configuredApiKey(config.apiKey, env, "OPENCODE_GO_API_KEY"),
  resolveBaseUrl: (config) => config.baseUrl,
  fetchCatalog: ({ apiKey, baseUrl, fetchImpl, signal }) =>
    fetchOpencodeGoChatModelCatalog({
      apiKey,
      baseUrl,
      fetchImpl,
      ...(signal ? { signal } : {}),
    }),
  runtimeKind: "openai-chat-completions",
});

export const KiroAmazonQDriver = makeDriver<KiroAmazonQSettings>({
  driverKind: KIRO_AMAZON_Q_DRIVER_KIND,
  provider: KIRO_AMAZON_Q_PROVIDER,
  configSchema: KiroAmazonQSettingsSchema,
  decodeConfig: decodeKiro,
  packageName: null,
  defaultModel: "amazon.nova-pro-v1:0",
  bodyPolicy: STRICT_OPENAI_BODY_POLICY,
  resolveApiKey: (config, env) => configuredApiKey(config.apiKey, env, "KIRO_API_KEY"),
  resolveBaseUrl: (config) => config.apiHost,
  fetchCatalog: ({ config, apiKey, fetchImpl, signal }) =>
    fetchKiroChatModelCatalog({
      accessToken: apiKey,
      profileArn: config.profileArn,
      fetchImpl,
      ...(signal ? { signal } : {}),
    }).then((result) => result.models),
  runtimeKind: "unsupported",
});

export type OpenAiCompatibleDriversEnv = DriverEnv;
