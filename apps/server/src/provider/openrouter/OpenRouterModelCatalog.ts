import type { ModelSelectionSupport } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { OpenRouterReasoningEffort } from "./OpenRouterProtocol.ts";

const ALL_REASONING_EFFORTS = [
  "max",
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
] as const satisfies ReadonlyArray<OpenRouterReasoningEffort>;

const OpenRouterReasoningEffortSchema = Schema.Literals(ALL_REASONING_EFFORTS);
const isOpenRouterReasoningEffort = Schema.is(OpenRouterReasoningEffortSchema);
const OpenRouterCatalogEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  context_length: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  architecture: Schema.Struct({
    input_modalities: Schema.Array(Schema.String),
    output_modalities: Schema.Array(Schema.String),
  }),
  pricing: Schema.Struct({
    prompt: Schema.optionalKey(Schema.String),
    completion: Schema.optionalKey(Schema.String),
  }),
  supported_parameters: Schema.Array(Schema.String),
  reasoning: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        supported_efforts: Schema.optionalKey(
          Schema.NullOr(Schema.Array(Schema.NullOr(OpenRouterReasoningEffortSchema))),
        ),
        default_effort: Schema.optionalKey(Schema.NullOr(OpenRouterReasoningEffortSchema)),
      }),
    ),
  ),
});
type OpenRouterCatalogEntry = typeof OpenRouterCatalogEntry.Type;

const OpenRouterCatalogResponse = Schema.Struct({
  data: Schema.Array(OpenRouterCatalogEntry),
});
const decodeCatalog = Schema.decodeUnknownEffect(OpenRouterCatalogResponse);

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
  readonly selectionSupport: ModelSelectionSupport;
  readonly incompatibilityReason?: string;
  readonly isCustom: boolean;
  readonly isVerified: boolean;
}

export class OpenRouterModelCatalogError extends Schema.TaggedError<OpenRouterModelCatalogError>()(
  "OpenRouterModelCatalogError",
  { message: Schema.String },
) {}

const perMillion = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number * 1_000_000 : undefined;
};

const supportsTools = (raw: OpenRouterCatalogEntry): boolean =>
  raw.supported_parameters.some((parameter) => parameter.trim().toLowerCase() === "tools");

const normalizeModel = (raw: OpenRouterCatalogEntry): OpenRouterCatalogModel | undefined => {
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
  const hasTextOutput = outputModalities.includes("text");
  const hasNativeDecisionOutput = outputModalities.includes("decisions");
  const hasTools = supportsTools(raw);
  const selectionSupport = hasNativeDecisionOutput
    ? { agent: false, textGeneration: false, decision: "native" as const }
    : hasTextOutput
      ? {
          agent: hasTools,
          textGeneration: true,
          decision: "prompted" as const,
        }
      : { agent: false, textGeneration: false, decision: "none" as const };
  const incompatibilityReason = hasNativeDecisionOutput
    ? "Only available for decision features."
    : !hasTextOutput
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
    ...(defaultReasoningEffort == null || !isOpenRouterReasoningEffort(defaultReasoningEffort)
      ? {}
      : { defaultReasoningEffort }),
    toolCapabilities: {
      tools: hasTools,
      parallelToolCalls: parameters.has("parallel_tool_calls"),
      toolChoice: parameters.has("tool_choice"),
    },
    selectionSupport,
    ...(incompatibilityReason ? { incompatibilityReason } : {}),
    isCustom: false,
    isVerified: true,
  };
};

export const decodeOpenRouterModelCatalog = Effect.fn("decodeOpenRouterModelCatalog")(function* (
  input: unknown,
) {
  const catalog = yield* decodeCatalog(input, { onExcessProperty: "ignore" }).pipe(
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
      selectionSupport: { agent: true, textGeneration: true, decision: "prompted" },
      isCustom: true,
      isVerified: false,
    });
  }
  return result;
};
