import type { Model } from "@google/genai";
import {
  GEMINI_DEFAULT_MODEL,
  type GeminiSettings,
  type ModelCapabilities,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import {
  makeGeminiClient,
  resolveGeminiApiKey,
  type GeminiClientFactory,
} from "../GeminiClient.ts";
import { buildServerProvider, providerModelsFromSettings } from "../providerSnapshot.ts";

export { GEMINI_DEFAULT_MODEL };
export { resolveGeminiApiKey } from "../GeminiClient.ts";

const GEMINI_MODEL_DISCOVERY_TIMEOUT_MS = 12_000;

class GeminiModelDiscoveryError extends Data.TaggedError("GeminiModelDiscoveryError")<{
  readonly cause: unknown;
}> {}

const GEMINI_PRESENTATION = {
  displayName: "Gemini",
  showInteractionModeToggle: true,
  fetchWorkers: {
    maxRecommendedWorkers: 8,
    commandExecutionPolicy: "deny",
  },
} as const;

const GEMINI_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const BUILT_IN_GEMINI_MODELS = [
  { slug: GEMINI_DEFAULT_MODEL, name: "Gemini 3.6 Flash", isDefault: true, isCustom: false },
  { slug: "gemini-3.5-flash", name: "Gemini 3.5 Flash", isCustom: false },
  { slug: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", isCustom: false },
  { slug: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", isCustom: false },
  { slug: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", isCustom: false },
].map(
  (model): ServerProviderModel => ({
    ...model,
    capabilities: GEMINI_MODEL_CAPABILITIES,
  }),
);

function normalizedModelSlug(name: string | undefined): string | undefined {
  const slug = name?.replace(/^models\//u, "").trim();
  return slug && slug.startsWith("gemini-") ? slug : undefined;
}

function discoveredGeminiModels(models: ReadonlyArray<Model>): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  return models.flatMap((model): ReadonlyArray<ServerProviderModel> => {
    const slug = normalizedModelSlug(model.name);
    if (!slug || seen.has(slug) || !model.supportedActions?.includes("generateContent")) return [];
    seen.add(slug);
    return [
      {
        slug,
        name: model.displayName?.trim() || slug,
        ...(slug === GEMINI_DEFAULT_MODEL ? { isDefault: true as const } : {}),
        isCustom: false,
        capabilities: GEMINI_MODEL_CAPABILITIES,
      },
    ];
  });
}

export function geminiModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  discoveredModels: ReadonlyArray<ServerProviderModel> = BUILT_IN_GEMINI_MODELS,
): ReadonlyArray<ServerProviderModel> {
  const models = providerModelsFromSettings(
    discoveredModels.length > 0 ? discoveredModels : BUILT_IN_GEMINI_MODELS,
    customModels ?? [],
    GEMINI_MODEL_CAPABILITIES,
  );
  if (models.some((model) => model.isDefault)) return models;
  return models.map((model, index) => (index === 0 ? { ...model, isDefault: true } : model));
}

export const makePendingGeminiProvider = Effect.fn("makePendingGeminiProvider")(function* (
  settings: GeminiSettings,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = geminiModelsFromSettings(settings.customModels);
  if (!settings.enabled) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Gemini is disabled in T3 Code settings.",
      },
    });
  }
  return buildServerProvider({
    presentation: GEMINI_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Checking Gemini API access...",
    },
  });
});

export const checkGeminiProviderStatus = Effect.fn("checkGeminiProviderStatus")(function* (
  settings: GeminiSettings,
  environment: NodeJS.ProcessEnv = process.env,
  clientFactory: GeminiClientFactory = makeGeminiClient,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = geminiModelsFromSettings(settings.customModels);

  if (!settings.enabled) {
    return yield* makePendingGeminiProvider(settings);
  }

  const credential = resolveGeminiApiKey(environment);
  if (!credential) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unauthenticated", type: "api-key" },
        message: "Set GOOGLE_API_KEY or GEMINI_API_KEY in this provider instance's environment.",
      },
    });
  }

  const discovery = yield* Effect.tryPromise({
    try: async () => {
      const pager = await clientFactory(credential.apiKey).models.list({
        config: { pageSize: 100 },
      });
      return discoveredGeminiModels(pager.page);
    },
    catch: (cause) => new GeminiModelDiscoveryError({ cause }),
  }).pipe(Effect.timeoutOption(GEMINI_MODEL_DISCOVERY_TIMEOUT_MS), Effect.exit);

  if (Exit.isFailure(discovery)) {
    yield* Effect.logWarning("Gemini API model discovery failed", {
      provider: "gemini",
    });
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unauthenticated", type: "api-key", label: credential.source },
        message: "Gemini API authentication or model discovery failed.",
      },
    });
  }

  if (Option.isNone(discovery.value)) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown", type: "api-key", label: credential.source },
        message: "Gemini API model discovery timed out.",
      },
    });
  }

  const models = geminiModelsFromSettings(settings.customModels, discovery.value.value);
  return buildServerProvider({
    presentation: GEMINI_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated", type: "api-key", label: credential.source },
    },
  });
});
