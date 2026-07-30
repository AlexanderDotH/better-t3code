import { type ModelCapabilities, type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  type GeminiSettings,
  GEMINI_DRIVER_KIND,
  resolveGeminiApiKey,
} from "../Drivers/GeminiConfig.ts";
import {
  deriveGeminiReasoningEffortSteps,
  GEMINI_REASONING_EFFORT_LABELS,
} from "../Drivers/GeminiThinkingConfig.ts";
import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const GEMINI_PRESENTATION = {
  displayName: "Gemini",
  badgeLabel: "Direct API",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const GEMINI_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    isCustom: false,
    capabilities: buildGeminiModelCapabilities("gemini-2.5-pro"),
  },
  {
    slug: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    isCustom: false,
    capabilities: buildGeminiModelCapabilities("gemini-2.5-flash"),
  },
  {
    slug: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    isCustom: false,
    capabilities: buildGeminiModelCapabilities("gemini-2.5-flash-lite"),
  },
  {
    slug: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  },
  {
    slug: "gemini-3-flash-preview",
    name: "Gemini 3 Flash (preview)",
    isCustom: false,
    capabilities: buildGeminiModelCapabilities("gemini-3-flash-preview"),
  },
  {
    slug: "gemini-3-pro-preview",
    name: "Gemini 3 Pro (preview)",
    isCustom: false,
    capabilities: buildGeminiModelCapabilities("gemini-3-pro-preview"),
  },
];

export function buildGeminiModelCapabilities(apiModelId: string): ModelCapabilities {
  const steps = deriveGeminiReasoningEffortSteps(apiModelId);
  if (steps.length === 0) {
    return EMPTY_CAPABILITIES;
  }

  return createModelCapabilities({
    optionDescriptors: [
      buildSelectOptionDescriptor({
        id: "reasoningEffort",
        label: "Reasoning",
        options: steps.map((effort) => ({
          value: effort,
          label: GEMINI_REASONING_EFFORT_LABELS[effort],
          ...(effort === "medium" ? { isDefault: true } : {}),
        })),
      }),
    ],
  });
}

export function geminiModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set(GEMINI_BUILT_IN_MODELS.map((model) => model.slug));
  const customEntries: ServerProviderModel[] = [];

  for (const candidate of customModels ?? []) {
    const slug = candidate.trim();
    if (slug.length === 0 || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    customEntries.push({
      slug,
      name: slug,
      isCustom: true,
      capabilities: buildGeminiModelCapabilities(slug),
    });
  }

  return [...GEMINI_BUILT_IN_MODELS, ...customEntries];
}

export function buildInitialGeminiProviderSnapshot(
  geminiSettings: GeminiSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = geminiModelsFromSettings(geminiSettings.customModels);

    if (!geminiSettings.enabled) {
      return buildServerProvider({
        presentation: GEMINI_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
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
        auth: { status: "unknown", type: "apiKey", label: "Google AI API Key" },
        message: "Checking Gemini API key availability...",
      },
    });
  });
}

export const checkGeminiProviderStatus = Effect.fn("checkGeminiProviderStatus")(function* (
  geminiSettings: GeminiSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = geminiModelsFromSettings(geminiSettings.customModels);

  if (!geminiSettings.enabled) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown", type: "apiKey", label: "Google AI API Key" },
        message: "Gemini is disabled in T3 Code settings.",
      },
    });
  }

  const apiKey = resolveGeminiApiKey(geminiSettings, environment);
  if (!apiKey) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unauthenticated", type: "apiKey", label: "Google AI API Key" },
        message:
          "Configure a Gemini API key on this provider instance or set GEMINI_API_KEY / GOOGLE_API_KEY.",
      },
    });
  }

  return buildServerProvider({
    driver: GEMINI_DRIVER_KIND,
    presentation: GEMINI_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated", type: "apiKey", label: "Google AI API Key" },
    },
  });
});
