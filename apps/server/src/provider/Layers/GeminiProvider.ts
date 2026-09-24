import { ThinkingLevel, type Model, type ThinkingConfig } from "@google/genai";
import {
  GEMINI_DEFAULT_MODEL,
  type GeminiSettings,
  type ModelCapabilities,
  type ProviderOptionDescriptor,
  type SelectProviderOptionDescriptor,
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

export const GEMINI_REASONING_EFFORT_OPTION_ID = "reasoningEffort";

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

export type GeminiReasoningLevel = "minimal" | "low" | "medium" | "high";

export interface GeminiReasoningProfile {
  readonly defaultLevel: GeminiReasoningLevel;
  readonly levels: ReadonlyArray<GeminiReasoningLevel>;
}

const GEMINI_REASONING_DESCRIPTIONS: Readonly<Record<GeminiReasoningLevel, string>> = {
  minimal: "Minimal reasoning for simple tasks",
  low: "Fast responses with lighter reasoning",
  medium: "Balanced reasoning",
  high: "Deep reasoning for complex problems",
};

const KNOWN_GEMINI_REASONING_PROFILES: Readonly<Record<string, GeminiReasoningProfile>> = {
  // Gemini 3.6
  "gemini-3.6-flash": { defaultLevel: "medium", levels: ["minimal", "low", "medium", "high"] },
  // Gemini 3.5
  "gemini-3.5-flash": { defaultLevel: "medium", levels: ["minimal", "low", "medium", "high"] },
  "gemini-3.5-flash-lite": {
    defaultLevel: "minimal",
    levels: ["minimal", "low", "medium", "high"],
  },
  // Gemini 3.1
  "gemini-3.1-pro-preview": { defaultLevel: "high", levels: ["low", "medium", "high"] },
  "gemini-3.1-flash-lite": {
    defaultLevel: "minimal",
    levels: ["minimal", "low", "medium", "high"],
  },
  "gemini-3.1-flash-lite-preview": {
    defaultLevel: "minimal",
    levels: ["minimal", "low", "medium", "high"],
  },
  // Gemini 3.0
  "gemini-3-flash-preview": { defaultLevel: "high", levels: ["minimal", "low", "medium", "high"] },
  "gemini-3-pro-preview": { defaultLevel: "high", levels: ["low", "high"] },
  // Gemini 3.7 / 3.8
  "gemini-3.7-flash": { defaultLevel: "medium", levels: ["low", "medium", "high"] },
  "gemini-3.8-flash": { defaultLevel: "medium", levels: ["low", "medium", "high"] },
  "gemini-3.8-live-extended-thinking": { defaultLevel: "high", levels: ["low", "medium", "high"] },
  // Gemini 2.5
  "gemini-2.5-pro": { defaultLevel: "medium", levels: ["low", "medium", "high"] },
  "gemini-2.5-flash": { defaultLevel: "medium", levels: ["low", "medium", "high"] },
  "gemini-2.5-flash-lite": { defaultLevel: "low", levels: ["low", "medium", "high"] },
};

export function isGemini3OrLater(slug: string): boolean {
  return /^gemini-(?:[3-9]|\d{2,})/i.test(slug);
}

function baseSlugForReasoning(slug: string): string {
  return slug
    .replace(/-preview(-\d{2}-\d{4}|-\d{4})?$/i, "")
    .replace(/(-\d{2}-\d{4}|-\d{3,4})$/i, "");
}

export function resolveGeminiReasoningProfile(
  slug: string,
  model?: Model,
): GeminiReasoningProfile | undefined {
  if (model?.thinking === false) {
    return undefined;
  }

  const direct = KNOWN_GEMINI_REASONING_PROFILES[slug];
  if (direct) return direct;

  const baseSlug = baseSlugForReasoning(slug);
  const base = KNOWN_GEMINI_REASONING_PROFILES[baseSlug];
  if (base) return base;

  if (model?.thinking === true) {
    return { defaultLevel: "medium", levels: ["minimal", "low", "medium", "high"] };
  }

  if (slug.includes("thinking") || /^gemini-(?:2\.5|[3-9]|\d{2,})/i.test(slug)) {
    return { defaultLevel: "medium", levels: ["minimal", "low", "medium", "high"] };
  }

  return undefined;
}

export function createGeminiReasoningOptionDescriptor(
  levels: ReadonlyArray<GeminiReasoningLevel>,
  defaultLevel: GeminiReasoningLevel,
): SelectProviderOptionDescriptor {
  const effectiveDefault = levels.includes(defaultLevel) ? defaultLevel : (levels[0] ?? "medium");
  return {
    id: GEMINI_REASONING_EFFORT_OPTION_ID,
    label: "Reasoning",
    type: "select",
    options: levels.map((level) => ({
      id: level,
      label: level.charAt(0).toUpperCase() + level.slice(1),
      description: GEMINI_REASONING_DESCRIPTIONS[level],
      ...(level === effectiveDefault ? { isDefault: true as const } : {}),
    })),
    currentValue: effectiveDefault,
  };
}

export function createGeminiModelCapabilities(slug: string, model?: Model): ModelCapabilities {
  const profile = resolveGeminiReasoningProfile(slug, model);
  const optionDescriptors: ReadonlyArray<ProviderOptionDescriptor> = profile
    ? [createGeminiReasoningOptionDescriptor(profile.levels, profile.defaultLevel)]
    : [];

  return createModelCapabilities({
    optionDescriptors,
    ...(model?.inputTokenLimit && model.inputTokenLimit > 0
      ? {
          contextWindow: {
            defaultTokens: model.inputTokenLimit,
            maxTokens: model.inputTokenLimit,
          },
        }
      : {}),
  });
}

export function resolveGeminiThinkingConfig(
  reasoningEffort: string | undefined,
  modelSlug?: string,
): ThinkingConfig | undefined {
  const profile = modelSlug ? resolveGeminiReasoningProfile(modelSlug) : undefined;
  const effectiveEffort = reasoningEffort ?? profile?.defaultLevel;
  if (!effectiveEffort) return undefined;

  const normalized = effectiveEffort.trim().toLowerCase();
  const isV3OrLater = modelSlug ? isGemini3OrLater(modelSlug) : true;

  if (normalized === "none" || normalized === "off") {
    if (isV3OrLater) {
      return { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true };
    }
    return { thinkingBudget: 0, includeThoughts: false };
  }

  if (isV3OrLater) {
    switch (normalized) {
      case "minimal":
        return { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true };
      case "low":
        return { thinkingLevel: ThinkingLevel.LOW, includeThoughts: true };
      case "medium":
        return { thinkingLevel: ThinkingLevel.MEDIUM, includeThoughts: true };
      case "high":
      case "xhigh":
      case "max":
        return { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true };
      default:
        return undefined;
    }
  }

  switch (normalized) {
    case "minimal":
      return { thinkingBudget: 1024, includeThoughts: true };
    case "low":
      return { thinkingBudget: 2048, includeThoughts: true };
    case "medium":
      return { thinkingBudget: 8192, includeThoughts: true };
    case "high":
    case "xhigh":
    case "max":
      return { thinkingBudget: 24576, includeThoughts: true };
    default:
      return undefined;
  }
}

export function geminiModelSupportsTextOutput(
  model: Model,
  slug: string = normalizedModelSlug(model.name) ?? "",
): boolean {
  if (model.outputTokenLimit !== undefined && model.outputTokenLimit <= 0) {
    return false;
  }

  const supportedActions =
    model.supportedActions ??
    (model as unknown as Record<string, unknown>).supportedGenerationMethods;
  if (Array.isArray(supportedActions) && supportedActions.length > 0) {
    if (!supportedActions.includes("generateContent")) {
      return false;
    }
  }

  const anyModel = model as unknown as Record<string, unknown>;
  for (const field of ["outputModalities", "supportedOutputModalities", "responseModalities"]) {
    const modalities = anyModel[field];
    if (Array.isArray(modalities) && modalities.length > 0) {
      const hasText = modalities.some(
        (modality) => typeof modality === "string" && modality.trim().toLowerCase() === "text",
      );
      if (!hasText) return false;
    }
  }

  const normalizedSlug = slug.toLowerCase();
  if (
    /(?:^|[-_])(?:image|images|imagen|image-generation|tts|audio|speech|lyria|music|video|veo|embedding|embed|robotics)(?:[-_]|$)/i.test(
      normalizedSlug,
    ) ||
    normalizedSlug === "nano-banana-pro-preview"
  ) {
    return false;
  }

  const displayName = (model.displayName ?? "").toLowerCase();
  const description = (model.description ?? "").toLowerCase();

  const nonTextPatterns = [
    /\b(tts|text[- ]to[- ]speech|speech[- ]to[- ]text)\b/i,
    /\b(text[- ]to[- ]image|image[- ]generation|generates?[- ]images?)\b/i,
    /\b(text[- ]to[- ]video|video[- ]generation|generates?[- ]videos?)\b/i,
    /\b(text[- ]to[- ]audio|audio[- ]generation|generates?[- ]audio|music[- ]generation)\b/i,
    /\b(text[- ]embedding|generate[- ]embeddings?|semantic[- ]search[- ]embeddings?)\b/i,
  ];

  for (const pattern of nonTextPatterns) {
    if (pattern.test(displayName) || pattern.test(description)) {
      return false;
    }
  }

  return true;
}

export const GEMINI_MODEL_CAPABILITIES: ModelCapabilities =
  createGeminiModelCapabilities(GEMINI_DEFAULT_MODEL);

const BUILT_IN_GEMINI_MODELS: ReadonlyArray<ServerProviderModel> = [
  { slug: GEMINI_DEFAULT_MODEL, name: "Gemini 3.6 Flash", isDefault: true, isCustom: false },
  { slug: "gemini-3.5-flash", name: "Gemini 3.5 Flash", isCustom: false },
  { slug: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", isCustom: false },
  { slug: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", isCustom: false },
  { slug: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", isCustom: false },
].map((model): ServerProviderModel => ({
  ...model,
  capabilities: createGeminiModelCapabilities(model.slug),
}));

export function normalizedModelSlug(name: string | undefined): string | undefined {
  const slug = name?.replace(/^(?:models|tunedModels)\//u, "").trim();
  return slug && slug.length > 0 ? slug : undefined;
}

export function discoveredGeminiModels(
  models: ReadonlyArray<Model>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  return models.flatMap((model): ReadonlyArray<ServerProviderModel> => {
    const slug = normalizedModelSlug(model.name);
    if (!slug || seen.has(slug)) return [];
    if (!geminiModelSupportsTextOutput(model, slug)) return [];
    seen.add(slug);
    return [
      {
        slug,
        name: model.displayName?.trim() || slug,
        ...(slug === GEMINI_DEFAULT_MODEL ? { isDefault: true as const } : {}),
        isCustom: false,
        capabilities: createGeminiModelCapabilities(slug, model),
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
  ).map((model) => {
    if (
      model.isCustom &&
      (!model.capabilities || (model.capabilities.optionDescriptors?.length ?? 0) === 0)
    ) {
      return { ...model, capabilities: createGeminiModelCapabilities(model.slug) };
    }
    return model;
  });
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
      const rawPager: unknown = await clientFactory(credential.apiKey).models.list({
        config: { pageSize: 100 },
      });
      const allModels: Model[] = [];
      if (rawPager && typeof rawPager === "object") {
        if (Symbol.asyncIterator in rawPager) {
          for await (const model of rawPager as AsyncIterable<Model>) {
            allModels.push(model);
          }
        } else if ("page" in rawPager && Array.isArray((rawPager as { page: unknown }).page)) {
          allModels.push(...(rawPager as { page: ReadonlyArray<Model> }).page);
        }
      }
      return discoveredGeminiModels(allModels);
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
