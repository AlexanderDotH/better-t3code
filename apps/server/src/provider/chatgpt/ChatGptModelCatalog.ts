import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const ReasoningEffort = Schema.Literals([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const RawReasoningEffort = Schema.Union([
  ReasoningEffort,
  Schema.Struct({ effort: ReasoningEffort }),
]);
const RawServiceTier = Schema.Struct({
  id: NonEmptyString,
  name: Schema.optionalKey(NonEmptyString),
  display_name: Schema.optionalKey(NonEmptyString),
});
const RawModel = Schema.Struct({
  slug: Schema.optionalKey(NonEmptyString),
  id: Schema.optionalKey(NonEmptyString),
  display_name: Schema.optionalKey(NonEmptyString),
  title: Schema.optionalKey(NonEmptyString),
  name: Schema.optionalKey(NonEmptyString),
  description: Schema.optionalKey(Schema.String),
  context_window: Schema.optionalKey(Schema.Number),
  max_context_window: Schema.optionalKey(Schema.Number),
  default_reasoning_level: Schema.optionalKey(ReasoningEffort),
  supported_reasoning_levels: Schema.optionalKey(Schema.Array(RawReasoningEffort)),
  service_tiers: Schema.optionalKey(Schema.Array(RawServiceTier)),
  visibility: Schema.optionalKey(Schema.String),
});
const RawCatalog = Schema.Union([
  Schema.Array(RawModel),
  Schema.Struct({ models: Schema.Array(RawModel) }),
  Schema.Struct({ data: Schema.Array(RawModel) }),
]);
const decodeRawCatalog = Schema.decodeUnknownEffect(RawCatalog);

export type ChatGptReasoningEffort = typeof ReasoningEffort.Type;

export interface ChatGptSubscriptionModel {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly contextWindowTokens: number;
  readonly defaultReasoningEffort: ChatGptReasoningEffort;
  readonly reasoningEfforts: ReadonlyArray<ChatGptReasoningEffort>;
  readonly serviceTiers: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}

export class ChatGptModelCatalogError extends Schema.TaggedErrorClass<ChatGptModelCatalogError>()(
  "ChatGptModelCatalogError",
  { message: Schema.String },
) {}

type RawModelValue = typeof RawModel.Type;
const isRawModelRows = Schema.is(Schema.Array(RawModel));
const isChatGptModelCatalogError = Schema.is(ChatGptModelCatalogError);

const selectableRows = (catalog: typeof RawCatalog.Type): ReadonlyArray<RawModelValue> => {
  if (isRawModelRows(catalog)) return catalog;
  if ("models" in catalog) return catalog.models;
  return catalog.data;
};

const normalizeReasoningEfforts = (
  efforts: ReadonlyArray<typeof RawReasoningEffort.Type>,
): ReadonlyArray<ChatGptReasoningEffort> => {
  const seen = new Set<ChatGptReasoningEffort>();
  const normalized: Array<ChatGptReasoningEffort> = [];
  for (const raw of efforts) {
    const effort = typeof raw === "string" ? raw : raw.effort;
    if (seen.has(effort)) continue;
    seen.add(effort);
    normalized.push(effort);
  }
  return normalized;
};

const normalizeModel = (raw: RawModelValue): ChatGptSubscriptionModel | undefined => {
  const visibility = raw.visibility?.trim().toLowerCase();
  if (visibility === "hidden" || visibility === "hide") return undefined;
  const id = raw.slug?.trim() || raw.id?.trim();
  const contextWindowTokens = raw.context_window ?? raw.max_context_window;
  const reasoningEfforts = raw.supported_reasoning_levels
    ? normalizeReasoningEfforts(raw.supported_reasoning_levels)
    : [];
  if (
    id === undefined ||
    !Number.isSafeInteger(contextWindowTokens) ||
    contextWindowTokens === undefined ||
    contextWindowTokens <= 0 ||
    raw.default_reasoning_level === undefined ||
    reasoningEfforts.length === 0
  ) {
    throw new ChatGptModelCatalogError({
      message: "ChatGPT live model catalog schema is missing required capability metadata",
    });
  }
  return {
    id,
    displayName: raw.display_name?.trim() || raw.title?.trim() || raw.name?.trim() || id,
    ...(raw.description === undefined ? {} : { description: raw.description }),
    contextWindowTokens,
    defaultReasoningEffort: raw.default_reasoning_level,
    reasoningEfforts,
    serviceTiers: (raw.service_tiers ?? []).map((tier) => ({
      id: tier.id,
      label: tier.name ?? tier.display_name ?? tier.id,
    })),
  };
};

export const decodeChatGptModelCatalog = Effect.fn("decodeChatGptModelCatalog")(function* (
  input: unknown,
) {
  const decoded = yield* decodeRawCatalog(input).pipe(
    Effect.mapError(
      () =>
        new ChatGptModelCatalogError({
          message: "ChatGPT live model catalog schema is invalid",
        }),
    ),
  );
  const models = yield* Effect.try({
    try: () =>
      selectableRows(decoded)
        .map(normalizeModel)
        .filter((model) => model !== undefined),
    catch: (cause) =>
      isChatGptModelCatalogError(cause)
        ? cause
        : new ChatGptModelCatalogError({
            message: "ChatGPT live model catalog schema is invalid",
          }),
  });
  const unique = new Map(models.map((model) => [model.id.toLowerCase(), model]));
  if (unique.size === 0) {
    return yield* new ChatGptModelCatalogError({
      message: "ChatGPT live model catalog returned no selectable models",
    });
  }
  return Array.from(unique.values());
});
