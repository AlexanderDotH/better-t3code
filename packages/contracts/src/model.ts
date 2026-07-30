import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const ProviderOptionDescriptorType = Schema.Literals(["select", "boolean"]);
export type ProviderOptionDescriptorType = typeof ProviderOptionDescriptorType.Type;

export const ProviderOptionChoice = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  isDefault: Schema.optional(Schema.Boolean),
});
export type ProviderOptionChoice = typeof ProviderOptionChoice.Type;

const ProviderOptionDescriptorBase = {
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
} as const;

export const SelectProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("select"),
  options: Schema.Array(ProviderOptionChoice),
  currentValue: Schema.optional(TrimmedNonEmptyString),
  promptInjectedValues: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type SelectProviderOptionDescriptor = typeof SelectProviderOptionDescriptor.Type;

export const BooleanProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("boolean"),
  currentValue: Schema.optional(Schema.Boolean),
});
export type BooleanProviderOptionDescriptor = typeof BooleanProviderOptionDescriptor.Type;

export const ProviderOptionDescriptor = Schema.Union([
  SelectProviderOptionDescriptor,
  BooleanProviderOptionDescriptor,
]);
export type ProviderOptionDescriptor = typeof ProviderOptionDescriptor.Type;

export const ProviderOptionSelectionValue = Schema.Union([TrimmedNonEmptyString, Schema.Boolean]);
export type ProviderOptionSelectionValue = typeof ProviderOptionSelectionValue.Type;

export const ProviderOptionSelection = Schema.Struct({
  id: TrimmedNonEmptyString,
  value: ProviderOptionSelectionValue,
});
export type ProviderOptionSelection = typeof ProviderOptionSelection.Type;

/**
 * Legacy on-disk shape for provider option selections, kept readable by the
 * decoder so we can tolerate stored data written before the v3 array shape.
 *
 * Persisted historically as `{ effort: "max", fastMode: true, ... }` inside
 * `modelSelection.options`. Migration 026 rewrites stored rows to the
 * canonical array shape, but we still see the legacy form in:
 *   - `settings.json` files from older client builds,
 *   - SQLite databases that have not yet run migration 026,
 *   - any future regression that re-introduces the legacy shape.
 */
const LegacyProviderOptionSelectionsObject = Schema.Record(Schema.String, Schema.Unknown);

const ProviderOptionSelectionsFromLegacyObject = LegacyProviderOptionSelectionsObject.pipe(
  Schema.decodeTo(
    Schema.Array(ProviderOptionSelection),
    SchemaTransformation.transformOrFail({
      decode: (record) => Effect.succeed(coerceLegacyOptionsObjectToArray(record)),
      encode: (selections) => Effect.succeed(canonicalSelectionsToLegacyObject(selections)),
    }),
  ),
);

/**
 * Schema for the `options` field of every `ModelSelection` variant.
 *
 * Accepts both:
 *   - the canonical array shape `Array<{ id, value }>` (preferred), and
 *   - the legacy object shape `Record<string, string | boolean | …>` from
 *     pre-migration data.
 *
 * Always normalizes to the canonical array on decode and re-encodes as the
 * canonical array, so any legacy storage gets cleaned up the next time the
 * containing record is written back.
 */
export const ProviderOptionSelections = Schema.Union([
  Schema.Array(ProviderOptionSelection),
  ProviderOptionSelectionsFromLegacyObject,
]);
export type ProviderOptionSelections = typeof ProviderOptionSelections.Type;

function coerceLegacyOptionsObjectToArray(
  record: Record<string, unknown>,
): ReadonlyArray<ProviderOptionSelection> {
  const entries: Array<ProviderOptionSelection> = [];
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const id = typeof rawKey === "string" ? rawKey.trim() : "";
    if (id.length === 0) continue;
    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      if (trimmed.length > 0) entries.push({ id, value: trimmed });
    } else if (typeof rawValue === "boolean") {
      entries.push({ id, value: rawValue });
    }
    // Drop anything else (numbers, null, nested objects/arrays) to match the
    // permissive normalization performed by migration 026.
  }
  return entries;
}

function canonicalSelectionsToLegacyObject(
  selections: ReadonlyArray<ProviderOptionSelection>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const { id, value } of selections) {
    out[id] = value;
  }
  return out;
}

export const AGENT_REASONING_EFFORT_VALUES = ["minimal", "low", "medium", "high", "xhigh"] as const;
export const AgentReasoningEffort = Schema.Literals(AGENT_REASONING_EFFORT_VALUES);
export type AgentReasoningEffort = typeof AgentReasoningEffort.Type;
export const DEFAULT_AGENT_REASONING_EFFORT: AgentReasoningEffort = "medium";

export const OpenAiCompatibleAgentProviderId = Schema.Literals([
  "openrouter",
  "nvidia",
  "local",
  "zen",
  "go",
  "kiro",
]);
export type OpenAiCompatibleAgentProviderId = typeof OpenAiCompatibleAgentProviderId.Type;

export const AgentModelCatalogProviderId = Schema.Literals([
  "gemini",
  "openrouter",
  "nvidia",
  "local",
  "zen",
  "go",
  "kiro",
  "cursor",
  "hyperagent",
]);
export type AgentModelCatalogProviderId = typeof AgentModelCatalogProviderId.Type;

export const AgentLlmTransportKind = Schema.Literals([
  "gemini-sdk",
  "cursor-agent",
  "hyperagent-agent",
  "openai-compatible",
]);
export type AgentLlmTransportKind = typeof AgentLlmTransportKind.Type;

export const AgentLlmSlotRole = Schema.Literals([
  "implementation",
  "planning",
  "verification",
  "freeChat",
  "customerForm",
  "cvImport",
]);
export type AgentLlmSlotRole = typeof AgentLlmSlotRole.Type;

export const AGENT_MODEL_ID_PREFIX_BY_PROVIDER = {
  gemini: "gemini-direct:",
  nvidia: "nvidia:",
  local: "local:",
  zen: "zen:",
  go: "go:",
  kiro: "kiro:",
  cursor: "cursor:",
  hyperagent: "hyperagent:",
} as const satisfies Partial<Record<AgentModelCatalogProviderId, string>>;

export const AgentSlotSamplingExtras = Schema.Struct({
  temperature: Schema.optionalKey(Schema.Number),
  topP: Schema.optionalKey(Schema.Number),
  maxOutputTokens: Schema.optionalKey(PositiveInt),
  frequencyPenalty: Schema.optionalKey(Schema.Number),
  presencePenalty: Schema.optionalKey(Schema.Number),
});
export type AgentSlotSamplingExtras = typeof AgentSlotSamplingExtras.Type;

export const AgentLlmSlotOverride = Schema.Struct({
  reasoningEffort: Schema.optionalKey(AgentReasoningEffort),
  supportsReasoningEffort: Schema.optionalKey(Schema.Boolean),
  openRouterContextCompression: Schema.optionalKey(Schema.Boolean),
  samplingExtras: Schema.optionalKey(AgentSlotSamplingExtras),
});
export type AgentLlmSlotOverride = typeof AgentLlmSlotOverride.Type;

export const AgentLlmSlotState = Schema.Struct({
  storedModelId: TrimmedNonEmptyString,
  label: Schema.optionalKey(TrimmedNonEmptyString),
  overrides: Schema.optionalKey(AgentLlmSlotOverride),
});
export type AgentLlmSlotState = typeof AgentLlmSlotState.Type;

export const AgentLlmSelectionSettings = Schema.Struct({
  version: Schema.Literal(1),
  slots: Schema.Struct({
    implementation: AgentLlmSlotState,
    verification: AgentLlmSlotState,
    planning: Schema.optionalKey(Schema.NullOr(AgentLlmSlotState)),
    freeChat: Schema.optionalKey(Schema.NullOr(AgentLlmSlotState)),
    customerForm: Schema.optionalKey(Schema.NullOr(AgentLlmSlotState)),
    cvImport: Schema.optionalKey(Schema.NullOr(AgentLlmSlotState)),
  }),
  modelDefaults: Schema.optionalKey(Schema.Record(TrimmedNonEmptyString, AgentLlmSlotOverride)),
});
export type AgentLlmSelectionSettings = typeof AgentLlmSelectionSettings.Type;

export const ModelCapabilities = Schema.Struct({
  optionDescriptors: Schema.optional(Schema.Array(ProviderOptionDescriptor)),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

export const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");
export const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
export const CURSOR_DRIVER_KIND = ProviderDriverKind.make("cursor");
export const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");
export const OPENCODE_DRIVER_KIND = ProviderDriverKind.make("opencode");
export const GEMINI_DRIVER_KIND = ProviderDriverKind.make("gemini");
export const OPENROUTER_DRIVER_KIND = ProviderDriverKind.make("openrouter");
export const NVIDIA_NIM_DRIVER_KIND = ProviderDriverKind.make("nvidiaNim");
export const LOCAL_OPENAI_DRIVER_KIND = ProviderDriverKind.make("localOpenAi");
export const OPENCODE_ZEN_DRIVER_KIND = ProviderDriverKind.make("opencodeZen");
export const OPENCODE_GO_DRIVER_KIND = ProviderDriverKind.make("opencodeGo");
export const KIRO_AMAZON_Q_DRIVER_KIND = ProviderDriverKind.make("kiroAmazonQ");
export const HYPERAGENT_DRIVER_KIND = ProviderDriverKind.make("hyperagent");
export const CURSOR_SDK_DRIVER_KIND = ProviderDriverKind.make("cursorSdk");

export const DEFAULT_MODEL = "gpt-5.6-sol";

/**
 * Codex default-model preference, most preferred first. The provider snapshot
 * marks the first of these present in the live `model/list` response as
 * default; when none are available, Codex's own `isDefault` flag wins.
 */
export const PREFERRED_DEFAULT_CODEX_MODELS: ReadonlyArray<string> = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
];
export const DEFAULT_TEXT_GENERATION_MODEL = "gpt-5.6-luna";
export const DEFAULT_GIT_TEXT_GENERATION_MODEL = DEFAULT_TEXT_GENERATION_MODEL;

export const DEFAULT_MODEL_BY_PROVIDER: Partial<Record<ProviderDriverKind, string>> = {
  [CODEX_DRIVER_KIND]: DEFAULT_MODEL,
  [CLAUDE_DRIVER_KIND]: "claude-sonnet-5",
  [CURSOR_DRIVER_KIND]: "auto",
  [GROK_DRIVER_KIND]: "grok-build",
  [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
  [GEMINI_DRIVER_KIND]: "gemini-2.5-flash",
  [OPENROUTER_DRIVER_KIND]: "openai/gpt-5",
  [NVIDIA_NIM_DRIVER_KIND]: "z-ai/glm-4.5",
  [LOCAL_OPENAI_DRIVER_KIND]: "llama3.1",
  [OPENCODE_ZEN_DRIVER_KIND]: "big-pickle",
  [OPENCODE_GO_DRIVER_KIND]: "deepseek-v4-pro",
  [KIRO_AMAZON_Q_DRIVER_KIND]: "amazon.nova-pro-v1:0",
  [CURSOR_SDK_DRIVER_KIND]: "composer-2",
  [HYPERAGENT_DRIVER_KIND]: "sonnet-latest",
};

/** Per-provider text generation model defaults. */
export const DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, string>
> = {
  [CODEX_DRIVER_KIND]: DEFAULT_TEXT_GENERATION_MODEL,
  [CLAUDE_DRIVER_KIND]: "claude-haiku-4-5",
  [CURSOR_DRIVER_KIND]: "composer-2",
  [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
  [GEMINI_DRIVER_KIND]: "gemini-2.5-flash",
  [HYPERAGENT_DRIVER_KIND]: "sonnet-latest",
};
export const DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER =
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER;

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, Record<string, string>>
> = {
  [CODEX_DRIVER_KIND]: {
    "gpt-5-codex": "gpt-5.4",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  [CLAUDE_DRIVER_KIND]: {
    opus: "claude-opus-5",
    "opus-5": "claude-opus-5",
    "claude-opus-5.0": "claude-opus-5",
    "claude-opus-5-0": "claude-opus-5",
    "opus-4.8": "claude-opus-4-8",
    "claude-opus-4.8": "claude-opus-4-8",
    "opus-4.7": "claude-opus-4-7",
    "claude-opus-4.7": "claude-opus-4-7",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-5",
    "sonnet-5": "claude-sonnet-5",
    "claude-sonnet-5.0": "claude-sonnet-5",
    "claude-sonnet-5-0": "claude-sonnet-5",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
  [CURSOR_DRIVER_KIND]: {
    composer: "composer-2",
    "composer-1.5": "composer-1.5",
    "composer-1": "composer-1.5",
    "opus-4.6-thinking": "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "sonnet-4.6-thinking": "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "opus-4.5-thinking": "claude-opus-4-5",
    "opus-4.5": "claude-opus-4-5",
  },
  [OPENCODE_DRIVER_KIND]: {},
  [HYPERAGENT_DRIVER_KIND]: {},
};

// ── Provider display names ────────────────────────────────────────────

export const PROVIDER_DISPLAY_NAMES: Partial<Record<ProviderDriverKind, string>> = {
  [CODEX_DRIVER_KIND]: "Codex",
  [CLAUDE_DRIVER_KIND]: "Claude",
  [CURSOR_DRIVER_KIND]: "Cursor",
  [GROK_DRIVER_KIND]: "Grok",
  [OPENCODE_DRIVER_KIND]: "OpenCode",
  [GEMINI_DRIVER_KIND]: "Gemini",
  [OPENROUTER_DRIVER_KIND]: "OpenRouter",
  [NVIDIA_NIM_DRIVER_KIND]: "NVIDIA NIM",
  [LOCAL_OPENAI_DRIVER_KIND]: "Local OpenAI",
  [OPENCODE_ZEN_DRIVER_KIND]: "OpenCode Zen",
  [OPENCODE_GO_DRIVER_KIND]: "OpenCode Go",
  [KIRO_AMAZON_Q_DRIVER_KIND]: "Kiro / Amazon Q",
  [HYPERAGENT_DRIVER_KIND]: "Hyperagent",
  [CURSOR_SDK_DRIVER_KIND]: "Cursor SDK",
};
