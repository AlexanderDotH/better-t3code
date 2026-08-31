import * as Generated from "@effect/ai-openrouter/Generated";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { OpenRouterReasoningEffort } from "./OpenRouterProtocol.ts";

const decodeGeneratedCatalog = Schema.decodeUnknownEffect(Generated.ModelsListResponse);

export interface OpenRouterCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextWindowTokens?: number;
  readonly inputModalities: ReadonlyArray<string>;
  readonly outputModalities: ReadonlyArray<string>;
  readonly promptPriceUsdPerMillion?: number;
  readonly completionPriceUsdPerMillion?: number;
  readonly reasoningEfforts: ReadonlyArray<OpenRouterReasoningEffort>;
  readonly defaultReasoningEffort?: OpenRouterReasoningEffort;
  readonly toolCapabilities: {
    readonly tools: boolean;
    readonly parallelToolCalls: boolean;
    readonly toolChoice: boolean;
  };
  readonly incompatibilityReason?: string;
  readonly isCustom: boolean;
  readonly isVerified: boolean;
}

export class OpenRouterModelCatalogError extends Schema.TaggedErrorClass<OpenRouterModelCatalogError>()(
  "OpenRouterModelCatalogError",
  { message: Schema.String },
) {}

const perMillion = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number * 1_000_000 : undefined;
};

const outputIncludesText = (raw: Generated.Model): boolean =>
  raw.architecture.output_modalities.includes("text");

const supportsTools = (raw: Generated.Model): boolean =>
  raw.supported_parameters.some((parameter) => parameter.trim().toLowerCase() === "tools");

const ALL_REASONING_EFFORTS = [
  "max",
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
] as const satisfies ReadonlyArray<OpenRouterReasoningEffort>;

const normalizeModel = (raw: Generated.Model): OpenRouterCatalogModel | undefined => {
  const id = raw.id.trim();
  if (!id) return undefined;
  const contextWindowTokens = raw.context_length;
  const inputModalities = raw.architecture.input_modalities.map((value) => value.toLowerCase());
  const outputModalities = raw.architecture.output_modalities.map((value) => value.toLowerCase());
  const promptPriceUsdPerMillion = perMillion(raw.pricing.prompt);
  const completionPriceUsdPerMillion = perMillion(raw.pricing.completion);
  const supportedEfforts = raw.reasoning?.supported_efforts;
  const reasoningEfforts =
    supportedEfforts === null
      ? ALL_REASONING_EFFORTS
      : (supportedEfforts ?? []).filter(
          (effort): effort is OpenRouterReasoningEffort => effort !== null,
        );
  const defaultReasoningEffort = raw.reasoning?.default_effort;
  const parameters = new Set(
    raw.supported_parameters.map((parameter) => parameter.trim().toLowerCase()),
  );
  const hasTextOutput = outputIncludesText(raw);
  const hasTools = supportsTools(raw);
  const incompatibilityReason = !hasTextOutput
    ? "This model does not produce text responses required by T3 Code."
    : !hasTools
      ? "This model does not support the tool calling required by T3 Code."
      : undefined;
  return {
    id,
    name: raw.name.trim() || id,
    ...(raw.description?.trim() ? { description: raw.description.trim() } : {}),
    ...(contextWindowTokens !== null &&
    contextWindowTokens !== undefined &&
    Number.isSafeInteger(contextWindowTokens) &&
    contextWindowTokens > 0
      ? { contextWindowTokens }
      : {}),
    inputModalities,
    outputModalities,
    ...(promptPriceUsdPerMillion === undefined ? {} : { promptPriceUsdPerMillion }),
    ...(completionPriceUsdPerMillion === undefined ? {} : { completionPriceUsdPerMillion }),
    reasoningEfforts,
    ...(defaultReasoningEffort == null ? {} : { defaultReasoningEffort }),
    toolCapabilities: {
      tools: hasTools,
      parallelToolCalls: parameters.has("parallel_tool_calls"),
      toolChoice: parameters.has("tool_choice"),
    },
    ...(incompatibilityReason ? { incompatibilityReason } : {}),
    isCustom: false,
    isVerified: true,
  };
};

export const decodeOpenRouterModelCatalog = Effect.fn("decodeOpenRouterModelCatalog")(function* (
  input: unknown,
) {
  const catalog = yield* decodeGeneratedCatalog(input, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(
      () =>
        new OpenRouterModelCatalogError({
          message: "OpenRouter model catalog schema is invalid",
        }),
    ),
  );
  const unique = new Map<string, OpenRouterCatalogModel>();
  for (const raw of catalog.data) {
    const model = normalizeModel(raw);
    if (model === undefined) continue;
    const key = model.id.toLowerCase();
    if (!unique.has(key)) unique.set(key, model);
  }
  return Array.from(unique.values());
});

export const mergeOpenRouterCustomModels = (
  catalog: ReadonlyArray<OpenRouterCatalogModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<OpenRouterCatalogModel> => {
  const result = [...catalog];
  const seen = new Set(catalog.map((model) => model.id.toLowerCase()));
  for (const raw of customModels) {
    const id = raw.trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key)) continue;
    seen.add(key);
    result.push({
      id,
      name: id,
      inputModalities: ["text"],
      outputModalities: ["text"],
      reasoningEfforts: [],
      toolCapabilities: { tools: true, parallelToolCalls: false, toolChoice: false },
      isCustom: true,
      isVerified: false,
    });
  }
  return result;
};
