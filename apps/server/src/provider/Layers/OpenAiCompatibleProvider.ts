import {
  ProviderDriverKind,
  type ModelCapabilities,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderAuthStatus,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { buildServerProvider, type ServerProviderDraft } from "../providerSnapshot.ts";

export type OpenAiCompatibleCatalogSource =
  | "openrouter"
  | "nvidia-nim"
  | "local-openai"
  | "opencode-zen"
  | "opencode-go"
  | "kiro-amazon-q";

export type ThinkingStrength = "none" | "low" | "medium" | "high";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface OpenAiCompatibleProviderDefinition {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly source: OpenAiCompatibleCatalogSource;
  readonly subProvider: string;
  readonly defaultBaseUrl: string | null;
  readonly requiresApiKey: boolean;
  readonly requiresBaseUrl: boolean;
  readonly authType: string | null;
  readonly missingAuthMessage: string | null;
  readonly missingBaseUrlMessage: string | null;
}

export interface OpenAiCompatibleModelListRow {
  readonly id: string;
  readonly name?: string;
}

export interface OpenAiCompatibleCatalogModel extends OpenAiCompatibleModelListRow {
  readonly source: OpenAiCompatibleCatalogSource;
  readonly subProvider?: string;
  readonly description?: string;
  readonly contextLength?: number;
  readonly catalogContextTokens?: number;
  readonly promptPerMillionUsd?: number | null;
  readonly completionPerMillionUsd?: number | null;
  readonly hasVisionInput: boolean;
  readonly visionCapable: boolean;
  readonly isThinkingModel: boolean;
  readonly thinkingStrength: ThinkingStrength;
  readonly supportedParameters: ReadonlyArray<string>;
  readonly supportsReasoningEffort: boolean;
  readonly freeTier?: boolean;
  readonly priceLabel?: string;
  readonly capabilities: ModelCapabilities;
}

export interface OpenAiCompatibleProviderSnapshotInput {
  readonly provider: OpenAiCompatibleProviderDefinition;
  readonly enabled: boolean;
  readonly checkedAt?: string;
  readonly apiKey?: string | null;
  readonly baseUrl?: string | null;
  readonly catalogModels?: ReadonlyArray<
    OpenAiCompatibleCatalogModel | OpenAiCompatibleModelListRow
  >;
  readonly catalogError?: string | null;
  readonly authStatus?: ServerProviderAuthStatus;
  readonly version?: string | null;
}

export interface OpenAiCompatibleServerProviderSnapshotInput extends OpenAiCompatibleProviderSnapshotInput {
  readonly instanceId: ProviderInstanceId;
  readonly displayName?: string | undefined;
  readonly accentColor?: string | undefined;
  readonly continuationGroupKey?: string | undefined;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

export interface FetchRequestLike {
  readonly method: "GET";
  readonly headers: Record<string, string>;
  readonly signal?: AbortSignal;
}

export type FetchLike = (url: string, init: FetchRequestLike) => Promise<FetchResponseLike>;

export interface CatalogFetchOptions {
  readonly fetchImpl: FetchLike;
  readonly signal?: AbortSignal;
}

export interface ApiKeyCatalogFetchOptions extends CatalogFetchOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export interface OptionalApiKeyCatalogFetchOptions extends CatalogFetchOptions {
  readonly apiKey?: string | null;
  readonly baseUrl?: string;
}

export interface KiroCatalogFetchOptions extends CatalogFetchOptions {
  readonly accessToken: string;
  readonly profileArn?: string | null;
}

export interface KiroChatModelCatalogResult {
  readonly models: ReadonlyArray<OpenAiCompatibleCatalogModel>;
  readonly profileArn: string | null;
}

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

export const OPENROUTER_PROVIDER = {
  driverKind: ProviderDriverKind.make("openrouter"),
  displayName: "OpenRouter",
  source: "openrouter",
  subProvider: "OpenRouter",
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  requiresApiKey: true,
  requiresBaseUrl: false,
  authType: "bearer",
  missingAuthMessage: "OpenRouter API key is required before the model catalog can be used.",
  missingBaseUrlMessage: null,
} as const satisfies OpenAiCompatibleProviderDefinition;

export const NVIDIA_NIM_PROVIDER = {
  driverKind: ProviderDriverKind.make("nvidiaNim"),
  displayName: "NVIDIA NIM",
  source: "nvidia-nim",
  subProvider: "NVIDIA NIM",
  defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
  requiresApiKey: true,
  requiresBaseUrl: false,
  authType: "bearer",
  missingAuthMessage: "NVIDIA API key is required before the NIM model catalog can be used.",
  missingBaseUrlMessage: null,
} as const satisfies OpenAiCompatibleProviderDefinition;

export const LOCAL_OPENAI_PROVIDER = {
  driverKind: ProviderDriverKind.make("localOpenAi"),
  displayName: "Local OpenAI",
  source: "local-openai",
  subProvider: "Local OpenAI",
  defaultBaseUrl: null,
  requiresApiKey: false,
  requiresBaseUrl: true,
  authType: null,
  missingAuthMessage: null,
  missingBaseUrlMessage: "Local OpenAI needs a /v1 base URL before catalog refresh can run.",
} as const satisfies OpenAiCompatibleProviderDefinition;

export const OPENCODE_ZEN_PROVIDER = {
  driverKind: ProviderDriverKind.make("opencodeZen"),
  displayName: "OpenCode Zen",
  source: "opencode-zen",
  subProvider: "OpenCode Zen",
  defaultBaseUrl: "https://opencode.ai/zen/v1",
  requiresApiKey: true,
  requiresBaseUrl: false,
  authType: "bearer",
  missingAuthMessage: "OpenCode Zen API key is required before the model catalog can be used.",
  missingBaseUrlMessage: null,
} as const satisfies OpenAiCompatibleProviderDefinition;

export const OPENCODE_GO_PROVIDER = {
  driverKind: ProviderDriverKind.make("opencodeGo"),
  displayName: "OpenCode Go",
  source: "opencode-go",
  subProvider: "OpenCode Go",
  defaultBaseUrl: "https://opencode.ai/zen/go/v1",
  requiresApiKey: true,
  requiresBaseUrl: false,
  authType: "bearer",
  missingAuthMessage: "OpenCode Go API key is required before the model catalog can be used.",
  missingBaseUrlMessage: null,
} as const satisfies OpenAiCompatibleProviderDefinition;

export const KIRO_AMAZON_Q_PROVIDER = {
  driverKind: ProviderDriverKind.make("kiroAmazonQ"),
  displayName: "Kiro / Amazon Q",
  source: "kiro-amazon-q",
  subProvider: "Kiro / Amazon Q",
  defaultBaseUrl: "https://q.us-east-1.amazonaws.com",
  requiresApiKey: true,
  requiresBaseUrl: false,
  authType: "bearer",
  missingAuthMessage:
    "Kiro / Amazon Q access token is required before the model catalog can be used.",
  missingBaseUrlMessage: null,
} as const satisfies OpenAiCompatibleProviderDefinition;

export const OPENAI_COMPATIBLE_PROVIDER_DEFINITIONS = [
  OPENROUTER_PROVIDER,
  NVIDIA_NIM_PROVIDER,
  LOCAL_OPENAI_PROVIDER,
  OPENCODE_ZEN_PROVIDER,
  OPENCODE_GO_PROVIDER,
  KIRO_AMAZON_Q_PROVIDER,
] as const;

const REASONING_EFFORT_STEPS: ReadonlyArray<ReasoningEffort> = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very high",
};

function makeEmptyCatalogModel(input: {
  readonly id: string;
  readonly name?: string;
  readonly source: OpenAiCompatibleCatalogSource;
  readonly subProvider?: string;
  readonly priceLabel?: string;
}): OpenAiCompatibleCatalogModel {
  const model: OpenAiCompatibleCatalogModel = {
    id: input.id,
    name: input.name ?? input.id,
    source: input.source,
    hasVisionInput: false,
    visionCapable: false,
    isThinkingModel: false,
    thinkingStrength: "none",
    supportedParameters: [],
    supportsReasoningEffort: false,
    capabilities: EMPTY_CAPABILITIES,
  };
  return {
    ...model,
    ...(input.subProvider ? { subProvider: input.subProvider } : {}),
    ...(input.priceLabel ? { priceLabel: input.priceLabel } : {}),
  };
}

function makeReasoningCapabilities(steps: ReadonlyArray<ReasoningEffort>): ModelCapabilities {
  if (steps.length === 0) {
    return EMPTY_CAPABILITIES;
  }
  const currentValue = steps.includes("medium") ? "medium" : steps[0];
  const options = steps.map((step) =>
    step === currentValue
      ? { id: step, label: REASONING_EFFORT_LABELS[step], isDefault: true }
      : { id: step, label: REASONING_EFFORT_LABELS[step] },
  );
  return createModelCapabilities({
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        options,
        ...(currentValue ? { currentValue } : {}),
      },
    ],
  });
}

function normalizeSupportedParameters(params: unknown): ReadonlyArray<string> {
  if (!Array.isArray(params)) {
    return [];
  }
  return params.map((value) => String(value).toLowerCase());
}

function coercePositiveContextLength(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 256) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 256) {
      return parsed;
    }
  }
  return undefined;
}

function parseUsdNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function tokenPriceToPerMillion(usdPerToken: number | null): number | null {
  return usdPerToken === null ? null : usdPerToken * 1_000_000;
}

function normalizeToUsdPerMillion(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) {
    return null;
  }
  if (raw === 0) {
    return 0;
  }
  if (raw < 0) {
    return null;
  }
  if (raw >= 0.25 && raw <= 500) {
    return raw;
  }
  if (raw < 0.000001) {
    return null;
  }
  if (raw < 0.25) {
    return raw * 1_000_000;
  }
  return raw;
}

function parseReasoningEffort(raw: unknown): ReasoningEffort | null {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  return REASONING_EFFORT_STEPS.includes(normalized as ReasoningEffort)
    ? (normalized as ReasoningEffort)
    : null;
}

function parseCatalogReasoningEffortSteps(
  defaultParameters: Record<string, unknown> | undefined,
): ReadonlyArray<ReasoningEffort> | null {
  const reasoningRaw = defaultParameters?.reasoning;
  if (!reasoningRaw || typeof reasoningRaw !== "object") {
    return null;
  }
  const effortRaw = (reasoningRaw as Record<string, unknown>).effort;
  if (!Array.isArray(effortRaw)) {
    return null;
  }
  const parsed = new Set(
    effortRaw.flatMap((value) => {
      const effort = parseReasoningEffort(value);
      return effort ? [effort] : [];
    }),
  );
  const sorted = REASONING_EFFORT_STEPS.filter((step) => parsed.has(step));
  return sorted.length > 0 ? sorted : null;
}

function getThinkingStrengthFromParams(
  params: ReadonlyArray<string> | undefined,
): ThinkingStrength {
  const normalized = new Set((params ?? []).map((value) => value.toLowerCase()));
  if (normalized.has("reasoning_effort")) {
    return "high";
  }
  if (normalized.has("reasoning")) {
    return "medium";
  }
  if (normalized.has("include_reasoning")) {
    return "low";
  }
  return "none";
}

function thinkingStrengthHeuristic(id: string, name?: string): ThinkingStrength {
  const text = `${id} ${name ?? ""}`.trim().toLowerCase();
  if (
    /(^|\/)o3[^a-z0-9]|\/o4[^a-z0-9]|o1-pro|o3-mini-high|gpt-5\.|gpt-5[^a-z0-9]/.test(text) ||
    /\bo3\b/.test(text)
  ) {
    return "high";
  }
  if (
    /\/o1[^a-z0-9]|\/o4-mini|o1-mini|o3-mini|deepseek-r1|deepseek-chat-v3\.1|qwq|qwen.*thinking/.test(
      text,
    )
  ) {
    return "medium";
  }
  if (/\bqwen3\b|\bqwen[-.]?2\.5\b|coder-next|huihui.*qwen3/.test(text)) {
    return "medium";
  }
  if (
    /\bz-ai\/glm|\/glm[-.]?[45]|\/glm5\b|\/glm4\b|chatglm|thudm\/glm|internlm3|magistral/.test(text)
  ) {
    return "medium";
  }
  if (/\/o1$|reasoning|think\b|r1-distill/.test(text)) {
    return "low";
  }
  return "none";
}

function inferSupportsReasoningEffort(input: {
  readonly supportedParameters: ReadonlyArray<string>;
  readonly id: string;
  readonly name?: string;
}): boolean {
  if (input.supportedParameters.includes("reasoning_effort")) {
    return true;
  }
  if (input.supportedParameters.includes("reasoning")) {
    return true;
  }
  if (input.supportedParameters.includes("include_reasoning")) {
    return true;
  }
  if (input.supportedParameters.length > 0) {
    return false;
  }
  return thinkingStrengthHeuristic(input.id, input.name) !== "none";
}

function reasoningEffortStepsForModel(input: {
  readonly id: string;
  readonly supportedParameters: ReadonlyArray<string>;
  readonly explicitSteps?: ReadonlyArray<ReasoningEffort> | null;
}): ReadonlyArray<ReasoningEffort> {
  if (input.explicitSteps && input.explicitSteps.length > 0) {
    return input.explicitSteps;
  }
  if (input.id.trim().toLowerCase().startsWith("anthropic/")) {
    return REASONING_EFFORT_STEPS;
  }
  if (input.supportedParameters.includes("reasoning_effort")) {
    return REASONING_EFFORT_STEPS;
  }
  if (input.supportedParameters.includes("reasoning")) {
    return ["low", "medium", "high", "xhigh"];
  }
  if (input.supportedParameters.includes("include_reasoning")) {
    return ["low", "medium", "high"];
  }
  return REASONING_EFFORT_STEPS;
}

interface OpenRouterModelRow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextLength?: number;
  readonly supportedParameters: ReadonlyArray<string>;
  readonly defaultParameters?: Record<string, unknown>;
  readonly architecture?: {
    readonly modality?: string;
    readonly inputModalities?: ReadonlyArray<string>;
    readonly outputModalities?: ReadonlyArray<string>;
  };
  readonly promptPerMillionUsd: number | null;
  readonly completionPerMillionUsd: number | null;
}

function normalizeOpenRouterModelRowFromApi(raw: unknown): OpenRouterModelRow | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  if (!id) {
    return null;
  }
  const rawName = row.name;
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : id;
  const topProvider =
    row.top_provider && typeof row.top_provider === "object"
      ? (row.top_provider as Record<string, unknown>)
      : null;
  const contextLength =
    coercePositiveContextLength(row.context_length) ??
    coercePositiveContextLength(topProvider?.context_length);
  const pricing =
    row.pricing && typeof row.pricing === "object"
      ? (row.pricing as Record<string, unknown>)
      : null;
  const defaultParameters =
    row.default_parameters && typeof row.default_parameters === "object"
      ? (row.default_parameters as Record<string, unknown>)
      : undefined;
  const architecture = normalizeOpenRouterArchitecture(row.architecture);
  const promptPerMillionUsd = tokenPriceToPerMillion(parseUsdNumber(pricing?.prompt));
  const completionPerMillionUsd = tokenPriceToPerMillion(parseUsdNumber(pricing?.completion));

  return {
    id,
    name,
    ...(typeof row.description === "string" && row.description.trim()
      ? { description: row.description.trim() }
      : {}),
    ...(contextLength !== undefined ? { contextLength } : {}),
    supportedParameters: normalizeSupportedParameters(row.supported_parameters),
    ...(defaultParameters ? { defaultParameters } : {}),
    ...(architecture ? { architecture } : {}),
    promptPerMillionUsd,
    completionPerMillionUsd,
  };
}

function normalizeOpenRouterArchitecture(
  raw: unknown,
): OpenRouterModelRow["architecture"] | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const architecture = raw as Record<string, unknown>;
  const inputModalities = Array.isArray(architecture.input_modalities)
    ? architecture.input_modalities.map((value) => String(value))
    : undefined;
  const outputModalities = Array.isArray(architecture.output_modalities)
    ? architecture.output_modalities.map((value) => String(value))
    : undefined;
  return {
    ...(architecture.modality !== undefined ? { modality: String(architecture.modality) } : {}),
    ...(inputModalities ? { inputModalities } : {}),
    ...(outputModalities ? { outputModalities } : {}),
  };
}

function modelSupportsVisionText(row: OpenRouterModelRow): boolean {
  const architecture = row.architecture;
  if (!architecture) {
    return false;
  }
  const inputs = architecture.inputModalities ?? [];
  const outputs = architecture.outputModalities ?? [];
  const hasImageInput = inputs.some((value) => value.toLowerCase() === "image");
  const hasTextOutput = outputs.some((value) => value.toLowerCase() === "text");
  if (hasImageInput && hasTextOutput) {
    return true;
  }
  const modality = String(architecture.modality ?? "").toLowerCase();
  return modality.includes("image") && modality.includes("->") && modality.includes("text");
}

function modelSupportsImageAndTextInput(row: OpenRouterModelRow): boolean {
  if (!modelSupportsVisionText(row)) {
    return false;
  }
  const inputs = row.architecture?.inputModalities ?? [];
  return (
    inputs.some((value) => value.toLowerCase() === "image") &&
    inputs.some((value) => value.toLowerCase() === "text")
  );
}

function modelHasTextOutput(row: OpenRouterModelRow): boolean {
  const architecture = row.architecture;
  if (!architecture) {
    return true;
  }
  const outputs = architecture.outputModalities ?? [];
  if (outputs.length === 0) {
    return true;
  }
  if (outputs.some((value) => value.toLowerCase() === "text")) {
    return true;
  }
  return String(architecture.modality ?? "")
    .toLowerCase()
    .includes("text");
}

function openRouterCatalogModel(row: OpenRouterModelRow): OpenAiCompatibleCatalogModel {
  let thinkingStrength = getThinkingStrengthFromParams(row.supportedParameters);
  if (thinkingStrength === "none") {
    thinkingStrength = thinkingStrengthHeuristic(row.id, row.name);
  }
  const supportsReasoningEffort = inferSupportsReasoningEffort({
    id: row.id,
    name: row.name,
    supportedParameters: row.supportedParameters,
  });
  const explicitSteps = parseCatalogReasoningEffortSteps(row.defaultParameters);
  const effortSteps = supportsReasoningEffort
    ? reasoningEffortStepsForModel({
        id: row.id,
        supportedParameters: row.supportedParameters,
        explicitSteps,
      })
    : [];

  return {
    id: row.id,
    name: row.name,
    source: "openrouter",
    subProvider: providerSlugFromModelId(row.id),
    ...(row.description ? { description: row.description } : {}),
    ...(row.contextLength !== undefined ? { contextLength: row.contextLength } : {}),
    promptPerMillionUsd: row.promptPerMillionUsd,
    completionPerMillionUsd: row.completionPerMillionUsd,
    hasVisionInput: modelSupportsImageAndTextInput(row),
    visionCapable: modelSupportsVisionText(row),
    isThinkingModel: thinkingStrength !== "none",
    thinkingStrength,
    supportedParameters: row.supportedParameters,
    supportsReasoningEffort,
    capabilities: makeReasoningCapabilities(effortSteps),
  };
}

export function normalizeOpenRouterModelsResponse(
  json: unknown,
): ReadonlyArray<OpenAiCompatibleCatalogModel> {
  if (!json || typeof json !== "object") {
    return [];
  }
  const rows = Array.isArray((json as { data?: unknown }).data)
    ? (json as { data: ReadonlyArray<unknown> }).data
    : [];
  return rows
    .map((row) => normalizeOpenRouterModelRowFromApi(row))
    .filter((row): row is OpenRouterModelRow => row !== null)
    .filter((row) => modelHasTextOutput(row))
    .filter((row) => {
      const strengthFromParams = getThinkingStrengthFromParams(row.supportedParameters);
      const thinkingStrength =
        strengthFromParams === "none"
          ? thinkingStrengthHeuristic(row.id, row.name)
          : strengthFromParams;
      return modelSupportsVisionText(row) || thinkingStrength !== "none";
    })
    .map(openRouterCatalogModel)
    .toSorted((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id));
}

function providerSlugFromModelId(id: string): string {
  const index = id.indexOf("/");
  return index > 0 ? id.slice(0, index) : "other";
}

function extractNvidiaSupportedParameters(raw: unknown): ReadonlyArray<string> {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const row = raw as Record<string, unknown>;
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : null;
  const direct = normalizeSupportedParameters(row.supported_parameters);
  if (direct.length > 0) {
    return direct;
  }
  return normalizeSupportedParameters(metadata?.supported_parameters);
}

function extractNvidiaModelContextTokens(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : null;
  const candidates = [
    row.context_length,
    row.max_tokens,
    row.max_model_len,
    row.max_sequence_length,
    row.context_window,
    row.context_window_tokens,
    metadata?.context_length,
    metadata?.max_tokens,
    metadata?.max_sequence_length,
    metadata?.context_window,
    metadata?.num_ctx,
    metadata?.context_size,
    metadata?.max_position_embeddings,
  ];
  for (const candidate of candidates) {
    const contextLength = coercePositiveContextLength(candidate);
    if (contextLength !== undefined) {
      return contextLength;
    }
  }
  return null;
}

function extractNvidiaModelPricingUsd(raw: unknown): {
  readonly promptPerMillionUsd: number | null;
  readonly completionPerMillionUsd: number | null;
} {
  if (!raw || typeof raw !== "object") {
    return { promptPerMillionUsd: null, completionPerMillionUsd: null };
  }
  const row = raw as Record<string, unknown>;
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : null;
  const pricing =
    row.pricing && typeof row.pricing === "object"
      ? (row.pricing as Record<string, unknown>)
      : metadata?.pricing && typeof metadata.pricing === "object"
        ? (metadata.pricing as Record<string, unknown>)
        : null;
  const directPairs = [
    ["promptPerMillionUsd", "completionPerMillionUsd"],
    ["input_cost_per_million_usd", "output_cost_per_million_usd"],
    ["input_cost_per_million", "output_cost_per_million"],
  ] as const;

  for (const [promptKey, completionKey] of directPairs) {
    const prompt = normalizeToUsdPerMillion(parseUsdNumber(row[promptKey]));
    const completion = normalizeToUsdPerMillion(parseUsdNumber(row[completionKey]));
    if (prompt !== null || completion !== null) {
      return { promptPerMillionUsd: prompt, completionPerMillionUsd: completion };
    }
    const metadataPrompt = normalizeToUsdPerMillion(parseUsdNumber(metadata?.[promptKey]));
    const metadataCompletion = normalizeToUsdPerMillion(parseUsdNumber(metadata?.[completionKey]));
    if (metadataPrompt !== null || metadataCompletion !== null) {
      return {
        promptPerMillionUsd: metadataPrompt,
        completionPerMillionUsd: metadataCompletion,
      };
    }
  }

  const prompt = normalizeToUsdPerMillion(
    parseUsdNumber(pricing?.prompt) ?? parseUsdNumber(pricing?.input),
  );
  const completion = normalizeToUsdPerMillion(
    parseUsdNumber(pricing?.completion) ?? parseUsdNumber(pricing?.output),
  );
  return { promptPerMillionUsd: prompt, completionPerMillionUsd: completion };
}

const NVIDIA_MINIMAL_LIST_KEYS = new Set(["id", "object", "created", "owned_by", "name"]);

function isNvidiaIntegrateMinimalCatalogRow(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const row = raw as Record<string, unknown>;
  return (
    row.object === "model" &&
    typeof row.id === "string" &&
    row.id.length > 0 &&
    Object.keys(row).every((key) => NVIDIA_MINIMAL_LIST_KEYS.has(key))
  );
}

function nvidiaCatalogRowIndicatesPaid(raw: Record<string, unknown>): boolean {
  const pricing = extractNvidiaModelPricingUsd(raw);
  if (
    (pricing.promptPerMillionUsd !== null && pricing.promptPerMillionUsd > 0) ||
    (pricing.completionPerMillionUsd !== null && pricing.completionPerMillionUsd > 0)
  ) {
    return true;
  }
  const billing = String(raw.billing ?? raw.billing_type ?? "").toLowerCase();
  if (
    billing.includes("paid") ||
    billing.includes("meter") ||
    billing.includes("consumption") ||
    billing.includes("enterprise")
  ) {
    return true;
  }
  const tier = String(raw.tier ?? "").toLowerCase();
  return tier.includes("paid") || tier.includes("premium");
}

function inferNvidiaModelFreeTier(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const row = raw as Record<string, unknown>;
  if (nvidiaCatalogRowIndicatesPaid(row)) {
    return false;
  }
  if (row.is_free === true || row.isFree === true) {
    return true;
  }
  const billing = String(row.billing ?? row.billing_type ?? "").toLowerCase();
  if (billing === "free" || billing === "free_tier" || /\bfree\b/.test(billing)) {
    return true;
  }
  if (String(row.tier ?? "").toLowerCase() === "free") {
    return true;
  }
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : null;
  if (metadata?.free === true) {
    return true;
  }
  if (String(metadata?.tier ?? "").toLowerCase() === "free") {
    return true;
  }
  if (/\bfree\b/.test(String(metadata?.billing ?? "").toLowerCase())) {
    return true;
  }
  const id = String(row.id ?? "").toLowerCase();
  const name = String(row.name ?? "").toLowerCase();
  if (id.includes("/free") || id.includes("-free") || /\bfree\b/.test(name)) {
    return true;
  }
  const pricing = extractNvidiaModelPricingUsd(raw);
  if (
    pricing.promptPerMillionUsd === 0 &&
    pricing.completionPerMillionUsd === 0 &&
    (row.pricing !== undefined || metadata?.pricing !== undefined)
  ) {
    return true;
  }
  return isNvidiaIntegrateMinimalCatalogRow(raw);
}

function architectureBlockFromRoot(root: Record<string, unknown>): Record<string, unknown> | null {
  if (root.architecture && typeof root.architecture === "object") {
    return root.architecture as Record<string, unknown>;
  }
  const metadata =
    root.metadata && typeof root.metadata === "object"
      ? (root.metadata as Record<string, unknown>)
      : null;
  return metadata?.architecture && typeof metadata.architecture === "object"
    ? (metadata.architecture as Record<string, unknown>)
    : null;
}

function modalityStringsLower(root: Record<string, unknown>): ReadonlyArray<string> {
  const values: Array<string> = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      values.push(value.toLowerCase());
    }
  };
  push(root.modality);
  const metadata =
    root.metadata && typeof root.metadata === "object"
      ? (root.metadata as Record<string, unknown>)
      : null;
  push(metadata?.modality);
  push(metadata?.model_type);
  return values;
}

function stringListLower(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value) ? value.map((entry) => String(entry).toLowerCase()) : [];
}

function nvidiaVisionTextLikeArchitecture(architecture: Record<string, unknown>): boolean {
  const inputs = stringListLower(architecture.input_modalities);
  const outputs = stringListLower(architecture.output_modalities);
  const hasImageInput = inputs.includes("image");
  const hasTextOutput = outputs.includes("text");
  if (hasImageInput && hasTextOutput) {
    return true;
  }
  const modality = String(architecture.modality ?? "").toLowerCase();
  return modality.includes("image") && modality.includes("->") && modality.includes("text");
}

function extractNvidiaCatalogVisionCapableLoose(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const row = raw as Record<string, unknown>;
  const architecture = architectureBlockFromRoot(row);
  if (architecture && nvidiaVisionTextLikeArchitecture(architecture)) {
    return true;
  }
  const flatInputs = stringListLower(row.input_modalities);
  const flatOutputs = stringListLower(row.output_modalities);
  if (flatInputs.includes("image") && (flatOutputs.length === 0 || flatOutputs.includes("text"))) {
    return true;
  }
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : null;
  const metadataInputs = stringListLower(metadata?.input_modalities);
  const metadataOutputs = stringListLower(metadata?.output_modalities);
  if (
    metadataInputs.includes("image") &&
    (metadataOutputs.length === 0 || metadataOutputs.includes("text"))
  ) {
    return true;
  }
  return modalityStringsLower(row).some(
    (value) => value.includes("multimodal") && value.includes("image"),
  );
}

function extractNvidiaCatalogHasVisionTextInput(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const row = raw as Record<string, unknown>;
  const architecture = architectureBlockFromRoot(row);
  if (architecture && nvidiaVisionTextLikeArchitecture(architecture)) {
    const inputs = stringListLower(architecture.input_modalities);
    if (inputs.includes("image") && inputs.includes("text")) {
      return true;
    }
  }
  const flatInputs = stringListLower(row.input_modalities);
  const flatOutputs = stringListLower(row.output_modalities);
  if (
    flatInputs.includes("image") &&
    flatInputs.includes("text") &&
    (flatOutputs.length === 0 || flatOutputs.includes("text"))
  ) {
    return true;
  }
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : null;
  const metadataInputs = stringListLower(metadata?.input_modalities);
  const metadataOutputs = stringListLower(metadata?.output_modalities);
  if (
    metadataInputs.includes("image") &&
    metadataInputs.includes("text") &&
    (metadataOutputs.length === 0 || metadataOutputs.includes("text"))
  ) {
    return true;
  }
  return modalityStringsLower(row).some(
    (value) => value.includes("multimodal") && value.includes("image") && value.includes("text"),
  );
}

function nvidiaCatalogModel(raw: unknown): OpenAiCompatibleCatalogModel | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  if (!id) {
    return null;
  }
  const rawName = row.name;
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : id;
  const supportedParameters = extractNvidiaSupportedParameters(raw);
  let thinkingStrength = getThinkingStrengthFromParams(supportedParameters);
  if (thinkingStrength === "none") {
    thinkingStrength = thinkingStrengthHeuristic(id, name);
  }
  const contextLength = extractNvidiaModelContextTokens(raw);
  const pricing = extractNvidiaModelPricingUsd(raw);
  const supportsReasoningEffort = inferSupportsReasoningEffort({
    id,
    name,
    supportedParameters,
  });
  const effortSteps = supportsReasoningEffort
    ? reasoningEffortStepsForModel({ id, supportedParameters })
    : [];

  return {
    id,
    name,
    source: "nvidia-nim",
    subProvider: NVIDIA_NIM_PROVIDER.subProvider,
    ...(contextLength !== null ? { contextLength, catalogContextTokens: contextLength } : {}),
    promptPerMillionUsd: pricing.promptPerMillionUsd,
    completionPerMillionUsd: pricing.completionPerMillionUsd,
    hasVisionInput: extractNvidiaCatalogHasVisionTextInput(raw),
    visionCapable: extractNvidiaCatalogVisionCapableLoose(raw),
    isThinkingModel: thinkingStrength !== "none",
    thinkingStrength,
    supportedParameters,
    supportsReasoningEffort,
    freeTier: inferNvidiaModelFreeTier(raw),
    capabilities: makeReasoningCapabilities(effortSteps),
  };
}

export function normalizeNvidiaNimModelsResponse(
  json: unknown,
): ReadonlyArray<OpenAiCompatibleCatalogModel> {
  if (!json || typeof json !== "object") {
    return [];
  }
  const rows = Array.isArray((json as { data?: unknown }).data)
    ? (json as { data: ReadonlyArray<unknown> }).data
    : [];
  return rows
    .map(nvidiaCatalogModel)
    .filter((model): model is OpenAiCompatibleCatalogModel => model !== null)
    .toSorted((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id));
}

export const PRESET_LOCAL_OPENAI_OLLAMA = "http://127.0.0.1:11434/v1";
export const PRESET_LOCAL_OPENAI_LM_STUDIO = "http://127.0.0.1:1234/v1";
const PROBE_LOCAL_OPENAI_OLLAMA_LOCALHOST = "http://localhost:11434/v1";
const PROBE_LOCAL_OPENAI_LM_STUDIO_LOCALHOST = "http://localhost:1234/v1";

export function normalizeLocalOpenAiV1Base(raw: string): string {
  let base = raw.trim().replace(/\/+$/, "");
  if (!base) {
    return base;
  }
  if (!/\/v1$/i.test(base)) {
    base = `${base}/v1`;
  }
  return base.replace(/\/+$/, "");
}

export function localOpenAiV1BasesForCatalogProbe(
  configuredBaseRaw: string,
): ReadonlyArray<string> {
  const ordered: Array<string> = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const normalized = normalizeLocalOpenAiV1Base(raw);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    ordered.push(normalized);
  };
  add(configuredBaseRaw);
  add(PRESET_LOCAL_OPENAI_OLLAMA);
  add(PRESET_LOCAL_OPENAI_LM_STUDIO);
  add(PROBE_LOCAL_OPENAI_OLLAMA_LOCALHOST);
  add(PROBE_LOCAL_OPENAI_LM_STUDIO_LOCALHOST);
  return ordered;
}

export function parseOpenAiCompatibleModelsListJson(
  json: unknown,
): ReadonlyArray<OpenAiCompatibleModelListRow> {
  const rows = extractOpenAiModelsListRows(json);
  const output: Array<OpenAiCompatibleModelListRow> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = rowIdFromOpenAiModelRow(row);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = rowDisplayNameFromOpenAiModelRow(row, id);
    output.push(name ? { id, name } : { id });
  }
  return output.toSorted((left, right) => left.id.localeCompare(right.id));
}

function extractOpenAiModelsListRows(json: unknown): ReadonlyArray<unknown> {
  if (!json) {
    return [];
  }
  if (Array.isArray(json)) {
    return json;
  }
  if (typeof json !== "object") {
    return [];
  }
  const root = json as Record<string, unknown>;
  for (const key of ["data", "models", "model_list", "items"] as const) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function rowIdFromOpenAiModelRow(row: unknown): string {
  if (typeof row === "string") {
    return row.trim();
  }
  if (!row || typeof row !== "object") {
    return "";
  }
  const record = row as Record<string, unknown>;
  const picked = record.id ?? record.model ?? record.name ?? record.root;
  if (typeof picked === "string") {
    return picked.trim();
  }
  if (typeof picked === "number" || typeof picked === "boolean") {
    return String(picked).trim();
  }
  return "";
}

function rowDisplayNameFromOpenAiModelRow(row: unknown, id: string): string | undefined {
  if (!row || typeof row !== "object") {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  for (const key of ["title", "name", "alias"] as const) {
    const raw = record[key];
    if (typeof raw !== "string") {
      continue;
    }
    const displayName = raw.trim();
    if (displayName && displayName !== id) {
      return displayName;
    }
  }
  return undefined;
}

function modelListRowToCatalogModel(input: {
  readonly row: OpenAiCompatibleModelListRow;
  readonly source: OpenAiCompatibleCatalogSource;
  readonly subProvider?: string;
  readonly priceLabel?: string;
}): OpenAiCompatibleCatalogModel {
  return makeEmptyCatalogModel({
    id: input.row.id,
    name: input.row.name ?? input.row.id,
    source: input.source,
    ...(input.subProvider ? { subProvider: input.subProvider } : {}),
    ...(input.priceLabel ? { priceLabel: input.priceLabel } : {}),
  });
}

export function normalizeLocalOpenAiModelCatalogResponse(
  json: unknown,
): ReadonlyArray<OpenAiCompatibleCatalogModel> {
  return parseOpenAiCompatibleModelsListJson(json).map((row) =>
    modelListRowToCatalogModel({
      row,
      source: "local-openai",
      subProvider: LOCAL_OPENAI_PROVIDER.subProvider,
    }),
  );
}

export function isZenOpenAiChatCompletionsModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) {
    return false;
  }
  if (id.startsWith("gpt-")) {
    return false;
  }
  if (id.startsWith("claude-")) {
    return false;
  }
  return !id.startsWith("gemini-");
}

function zenPriceLabel(modelId: string): string {
  const id = modelId.trim().toLowerCase();
  return id === "big-pickle" || id.endsWith("-free") ? "Zen - $0 promo" : "Zen - metered";
}

export function normalizeOpencodeZenModelsResponse(
  json: unknown,
): ReadonlyArray<OpenAiCompatibleCatalogModel> {
  return parseOpenAiCompatibleModelsListJson(json)
    .filter((row) => isZenOpenAiChatCompletionsModelId(row.id))
    .map((row) =>
      modelListRowToCatalogModel({
        row,
        source: "opencode-zen",
        subProvider: OPENCODE_ZEN_PROVIDER.subProvider,
        priceLabel: zenPriceLabel(row.id),
      }),
    );
}

const GO_MESSAGES_ROUTE_MODEL_IDS = new Set([
  "minimax-m2.5",
  "minimax-m2.7",
  "minimax-m3",
  "qwen3.6-plus",
  "qwen3.7-plus",
  "qwen3.7-max",
]);

export function isOpencodeGoChatCompletionsModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return id.length > 0 && !GO_MESSAGES_ROUTE_MODEL_IDS.has(id);
}

export function normalizeOpencodeGoModelsResponse(
  json: unknown,
): ReadonlyArray<OpenAiCompatibleCatalogModel> {
  return parseOpenAiCompatibleModelsListJson(json)
    .filter((row) => isOpencodeGoChatCompletionsModelId(row.id))
    .map((row) =>
      modelListRowToCatalogModel({
        row,
        source: "opencode-go",
        subProvider: OPENCODE_GO_PROVIDER.subProvider,
        priceLabel: "Go - subscription limits",
      }),
    );
}

export function normalizeKiroProfilesResponse(json: unknown): string | null {
  if (!json || typeof json !== "object") {
    return null;
  }
  const profiles = (json as { profiles?: unknown }).profiles;
  if (!Array.isArray(profiles)) {
    return null;
  }
  for (const profile of profiles) {
    if (!profile || typeof profile !== "object") {
      continue;
    }
    const arn = (profile as { arn?: unknown }).arn;
    if (typeof arn === "string" && arn.trim()) {
      return arn.trim();
    }
  }
  return null;
}

export function normalizeKiroChatModelCatalogResponse(
  json: unknown,
): ReadonlyArray<OpenAiCompatibleCatalogModel> {
  if (!json || typeof json !== "object") {
    return [];
  }
  const models = (json as { models?: unknown }).models;
  if (!Array.isArray(models)) {
    return [];
  }
  const output: Array<OpenAiCompatibleCatalogModel> = [];
  for (const model of models) {
    if (!model || typeof model !== "object") {
      continue;
    }
    const record = model as Record<string, unknown>;
    const id = String(record.modelId ?? record.id ?? "").trim();
    if (!id) {
      continue;
    }
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : id;
    output.push(
      modelListRowToCatalogModel({
        row: { id, name },
        source: "kiro-amazon-q",
        subProvider: KIRO_AMAZON_Q_PROVIDER.subProvider,
        priceLabel: "Kiro - Amazon Q usage",
      }),
    );
  }
  return output;
}

export function openRouterAuthHeaders(apiKey: string): Record<string, string> {
  return bearerJsonHeaders(apiKey);
}

export function nvidiaNimAuthHeaders(apiKey: string): Record<string, string> {
  return bearerJsonHeaders(apiKey);
}

export function opencodeZenAuthHeaders(apiKey: string): Record<string, string> {
  return bearerJsonHeaders(apiKey);
}

export function opencodeGoAuthHeaders(apiKey: string): Record<string, string> {
  return opencodeZenAuthHeaders(apiKey);
}

export function kiroAmazonQAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken.trim()}`,
    "User-Agent": "aws-sdk-js/2.0.0",
    "x-amz-user-agent": "aws-sdk-js/2.0.0 T3-Code",
    "x-amzn-codewhisperer-optout": "true",
    "x-amzn-kiro-agent-mode": "vibe",
  };
}

function bearerJsonHeaders(apiKey: string): Record<string, string> {
  const trimmed = apiKey.trim();
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(trimmed ? { Authorization: `Bearer ${trimmed}` } : {}),
  };
}

async function fetchJson(input: {
  readonly fetchImpl: FetchLike;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly errorLabel: string;
}): Promise<unknown> {
  const response = await input.fetchImpl(input.url, {
    method: "GET",
    headers: input.headers,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${input.errorLabel} failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return response.json().catch(() => null);
}

export async function fetchOpenRouterModelCatalog(
  options: ApiKeyCatalogFetchOptions,
): Promise<ReadonlyArray<OpenAiCompatibleCatalogModel>> {
  const baseUrl = (options.baseUrl ?? OPENROUTER_PROVIDER.defaultBaseUrl ?? "").replace(/\/+$/, "");
  const json = await fetchJson({
    fetchImpl: options.fetchImpl,
    url: `${baseUrl}/models`,
    headers: openRouterAuthHeaders(options.apiKey),
    ...(options.signal ? { signal: options.signal } : {}),
    errorLabel: "OpenRouter models",
  });
  return normalizeOpenRouterModelsResponse(json);
}

export async function fetchNvidiaNimModelCatalog(
  options: ApiKeyCatalogFetchOptions,
): Promise<ReadonlyArray<OpenAiCompatibleCatalogModel>> {
  const baseUrl = (options.baseUrl ?? NVIDIA_NIM_PROVIDER.defaultBaseUrl ?? "").replace(/\/+$/, "");
  const json = await fetchJson({
    fetchImpl: options.fetchImpl,
    url: `${baseUrl}/models`,
    headers: nvidiaNimAuthHeaders(options.apiKey),
    ...(options.signal ? { signal: options.signal } : {}),
    errorLabel: "NVIDIA models",
  });
  return normalizeNvidiaNimModelsResponse(json);
}

export async function fetchLocalOpenAiModelCatalog(
  options: OptionalApiKeyCatalogFetchOptions & { readonly baseUrl: string },
): Promise<ReadonlyArray<OpenAiCompatibleCatalogModel>> {
  const baseUrl = normalizeLocalOpenAiV1Base(options.baseUrl);
  if (!baseUrl) {
    return [];
  }
  const json = await fetchJson({
    fetchImpl: options.fetchImpl,
    url: `${baseUrl}/models`,
    headers: {
      Accept: "application/json",
      ...(options.apiKey?.trim() ? { Authorization: `Bearer ${options.apiKey.trim()}` } : {}),
    },
    ...(options.signal ? { signal: options.signal } : {}),
    errorLabel: "Local models",
  });
  return normalizeLocalOpenAiModelCatalogResponse(json);
}

export async function fetchMergedLocalOpenAiModelCatalog(options: {
  readonly fetchImpl: FetchLike;
  readonly configuredBaseUrl: string;
  readonly apiKey?: string | null;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly models: ReadonlyArray<OpenAiCompatibleCatalogModel>;
  readonly fetchErrors: ReadonlyArray<string>;
}> {
  const chunks = await Promise.all(
    localOpenAiV1BasesForCatalogProbe(options.configuredBaseUrl).map(async (baseUrl) => {
      try {
        const models = await fetchLocalOpenAiModelCatalog({
          fetchImpl: options.fetchImpl,
          baseUrl,
          ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        return { ok: true as const, baseUrl, models };
      } catch (error: unknown) {
        return {
          ok: false as const,
          baseUrl,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const byId = new Map<string, OpenAiCompatibleCatalogModel>();
  const fetchErrors: Array<string> = [];
  for (const chunk of chunks) {
    if (!chunk.ok) {
      fetchErrors.push(`${chunk.baseUrl}: ${chunk.message}`);
      continue;
    }
    for (const model of chunk.models) {
      if (!byId.has(model.id)) {
        byId.set(model.id, model);
      }
    }
  }
  return {
    models: Array.from(byId.values()).toSorted((left, right) => left.id.localeCompare(right.id)),
    fetchErrors,
  };
}

export async function fetchOpencodeZenChatModelCatalog(
  options: OptionalApiKeyCatalogFetchOptions,
): Promise<ReadonlyArray<OpenAiCompatibleCatalogModel>> {
  const baseUrl = (options.baseUrl ?? OPENCODE_ZEN_PROVIDER.defaultBaseUrl ?? "").replace(
    /\/+$/,
    "",
  );
  const json = await fetchJson({
    fetchImpl: options.fetchImpl,
    url: `${baseUrl}/models`,
    headers: opencodeZenAuthHeaders(options.apiKey ?? ""),
    ...(options.signal ? { signal: options.signal } : {}),
    errorLabel: "OpenCode Zen models",
  });
  return normalizeOpencodeZenModelsResponse(json);
}

export async function fetchOpencodeGoChatModelCatalog(
  options: OptionalApiKeyCatalogFetchOptions,
): Promise<ReadonlyArray<OpenAiCompatibleCatalogModel>> {
  const baseUrl = (options.baseUrl ?? OPENCODE_GO_PROVIDER.defaultBaseUrl ?? "").replace(
    /\/+$/,
    "",
  );
  const json = await fetchJson({
    fetchImpl: options.fetchImpl,
    url: `${baseUrl}/models`,
    headers: opencodeGoAuthHeaders(options.apiKey ?? ""),
    ...(options.signal ? { signal: options.signal } : {}),
    errorLabel: "OpenCode Go models",
  });
  return normalizeOpencodeGoModelsResponse(json);
}

export async function fetchKiroChatModelCatalog(
  options: KiroCatalogFetchOptions,
): Promise<KiroChatModelCatalogResult> {
  const accessToken = options.accessToken.trim();
  if (!accessToken) {
    return { models: [], profileArn: null };
  }

  let profileArn =
    typeof options.profileArn === "string" && options.profileArn.trim()
      ? options.profileArn.trim()
      : null;
  if (!profileArn) {
    profileArn = await fetchKiroProfileArn({
      fetchImpl: options.fetchImpl,
      accessToken,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  const query = profileArn
    ? `origin=AI_EDITOR&profileArn=${encodeURIComponent(profileArn)}`
    : "origin=AI_EDITOR";
  const json = await fetchJson({
    fetchImpl: options.fetchImpl,
    url: `${KIRO_AMAZON_Q_PROVIDER.defaultBaseUrl}/ListAvailableModels?${query}`,
    headers: kiroAmazonQAuthHeaders(accessToken),
    ...(options.signal ? { signal: options.signal } : {}),
    errorLabel: "Kiro models",
  });
  return {
    models: normalizeKiroChatModelCatalogResponse(json),
    profileArn,
  };
}

async function fetchKiroProfileArn(input: {
  readonly fetchImpl: FetchLike;
  readonly accessToken: string;
  readonly signal?: AbortSignal;
}): Promise<string | null> {
  const response = await input.fetchImpl(
    `${KIRO_AMAZON_Q_PROVIDER.defaultBaseUrl}/ListAvailableProfiles`,
    {
      method: "GET",
      headers: kiroAmazonQAuthHeaders(input.accessToken),
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
  if (!response.ok) {
    return null;
  }
  const json = await response.json().catch(() => null);
  return normalizeKiroProfilesResponse(json);
}

function toCatalogModel(
  provider: OpenAiCompatibleProviderDefinition,
  model: OpenAiCompatibleCatalogModel | OpenAiCompatibleModelListRow,
): OpenAiCompatibleCatalogModel {
  if ("capabilities" in model) {
    return model;
  }
  return modelListRowToCatalogModel({
    row: model,
    source: provider.source,
    subProvider: provider.subProvider,
  });
}

function toServerProviderModel(
  provider: OpenAiCompatibleProviderDefinition,
  model: OpenAiCompatibleCatalogModel | OpenAiCompatibleModelListRow,
): ServerProviderModel {
  const catalogModel = toCatalogModel(provider, model);
  return {
    slug: catalogModel.id,
    name: catalogModel.name ?? catalogModel.id,
    isCustom: false,
    ...((catalogModel.subProvider ?? provider.subProvider)
      ? { subProvider: catalogModel.subProvider ?? provider.subProvider }
      : {}),
    capabilities: catalogModel.capabilities,
  };
}

function hasRequiredApiKey(input: OpenAiCompatibleProviderSnapshotInput): boolean {
  if (!input.provider.requiresApiKey) {
    return true;
  }
  return typeof input.apiKey === "string" && input.apiKey.trim().length > 0;
}

function hasRequiredBaseUrl(input: OpenAiCompatibleProviderSnapshotInput): boolean {
  if (!input.provider.requiresBaseUrl) {
    return true;
  }
  return typeof input.baseUrl === "string" && input.baseUrl.trim().length > 0;
}

function compactErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 400) {
    return trimmed;
  }
  return `${trimmed.slice(0, 397)}...`;
}

function providerStatus(input: {
  readonly snapshotInput: OpenAiCompatibleProviderSnapshotInput;
  readonly models: ReadonlyArray<ServerProviderModel>;
}): {
  readonly installed: boolean;
  readonly status: "ready" | "warning" | "error";
  readonly authStatus: ServerProviderAuthStatus;
  readonly message: string;
} {
  const { snapshotInput, models } = input;
  if (!hasRequiredBaseUrl(snapshotInput)) {
    return {
      installed: false,
      status: "warning",
      authStatus: "unknown",
      message:
        snapshotInput.provider.missingBaseUrlMessage ??
        `${snapshotInput.provider.displayName} needs a base URL before catalog refresh can run.`,
    };
  }
  if (!hasRequiredApiKey(snapshotInput)) {
    return {
      installed: true,
      status: "warning",
      authStatus: "unauthenticated",
      message:
        snapshotInput.provider.missingAuthMessage ??
        `${snapshotInput.provider.displayName} needs credentials before catalog refresh can run.`,
    };
  }
  if (snapshotInput.catalogError?.trim()) {
    return {
      installed: true,
      status: "error",
      authStatus: snapshotInput.authStatus ?? "unknown",
      message: `Failed to load ${snapshotInput.provider.displayName} model catalog: ${compactErrorMessage(
        snapshotInput.catalogError,
      )}`,
    };
  }
  if (models.length === 0) {
    return {
      installed: true,
      status: "warning",
      authStatus: snapshotInput.authStatus ?? authStatusForConfiguredProvider(snapshotInput),
      message: `${snapshotInput.provider.displayName} is configured, but no catalog models were found.`,
    };
  }
  return {
    installed: true,
    status: "ready",
    authStatus: snapshotInput.authStatus ?? authStatusForConfiguredProvider(snapshotInput),
    message: `${snapshotInput.provider.displayName} catalog loaded (${models.length} model${
      models.length === 1 ? "" : "s"
    }).`,
  };
}

function authStatusForConfiguredProvider(
  input: OpenAiCompatibleProviderSnapshotInput,
): ServerProviderAuthStatus {
  if (input.provider.requiresApiKey) {
    return "authenticated";
  }
  return input.apiKey?.trim() ? "authenticated" : "unknown";
}

export function buildOpenAiCompatibleProviderSnapshot(
  input: OpenAiCompatibleProviderSnapshotInput,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = input.checkedAt ?? DateTime.formatIso(yield* DateTime.now);
    const models = (input.catalogModels ?? []).map((model) =>
      toServerProviderModel(input.provider, model),
    );

    if (!input.enabled) {
      return buildServerProvider({
        presentation: { displayName: input.provider.displayName, showInteractionModeToggle: false },
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: input.version ?? null,
          status: "warning",
          auth: { status: "unknown" },
          message: `${input.provider.displayName} is disabled in T3 Code settings.`,
        },
      });
    }

    const status = providerStatus({ snapshotInput: input, models });
    return buildServerProvider({
      presentation: { displayName: input.provider.displayName, showInteractionModeToggle: false },
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: status.installed,
        version: input.version ?? null,
        status: status.status,
        auth: {
          status: status.authStatus,
          ...(input.provider.authType ? { type: input.provider.authType } : {}),
        },
        message: status.message,
      },
    });
  });
}

export function buildOpenAiCompatibleServerProviderSnapshot(
  input: OpenAiCompatibleServerProviderSnapshotInput,
): Effect.Effect<ServerProvider> {
  return Effect.gen(function* () {
    const draft = yield* buildOpenAiCompatibleProviderSnapshot(input);
    return {
      ...draft,
      instanceId: input.instanceId,
      driver: input.provider.driverKind,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.accentColor ? { accentColor: input.accentColor } : {}),
      continuation: {
        groupKey:
          input.continuationGroupKey ?? `${input.provider.driverKind}:instance:${input.instanceId}`,
      },
    };
  });
}
