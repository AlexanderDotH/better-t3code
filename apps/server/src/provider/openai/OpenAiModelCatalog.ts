import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const LiveModel = Schema.Struct({
  id: Schema.String,
  object: Schema.Literal("model"),
  created: NonNegativeInteger,
  owned_by: Schema.String,
  shutdown_date: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
});
const LiveModelList = Schema.Struct({
  object: Schema.Literal("list"),
  data: Schema.Array(LiveModel),
});
const decodeLiveModelList = Schema.decodeUnknownEffect(LiveModelList);

export class OpenAiModelCatalogError extends Schema.TaggedErrorClass<OpenAiModelCatalogError>()(
  "OpenAiModelCatalogError",
  { message: Schema.String },
) {}

export interface OpenAiCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly aliasFor?: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly inputModalities: ReadonlyArray<string>;
  readonly outputModalities: ReadonlyArray<string>;
  readonly reasoningEfforts: ReadonlyArray<string>;
  readonly defaultReasoningEffort: string;
  readonly toolCapabilities: {
    readonly tools: boolean;
    readonly parallelToolCalls: boolean;
    readonly toolChoice: boolean;
  };
  readonly isVerified: true;
}

const GPT_5_6_CAPABILITIES = {
  contextWindowTokens: 1_050_000,
  maxOutputTokens: 128_000,
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
  defaultReasoningEffort: "medium",
  toolCapabilities: { tools: true, parallelToolCalls: true, toolChoice: true },
  isVerified: true,
} as const;

const TESTED_MODELS: ReadonlyArray<OpenAiCatalogModel> = [
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", ...GPT_5_6_CAPABILITIES },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", ...GPT_5_6_CAPABILITIES },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", ...GPT_5_6_CAPABILITIES },
];

const SOL_ALIAS: OpenAiCatalogModel = {
  id: "gpt-5.6",
  name: "GPT-5.6 Sol",
  aliasFor: "gpt-5.6-sol",
  ...GPT_5_6_CAPABILITIES,
};

export const decodeOpenAiModelCatalog = Effect.fn("decodeOpenAiModelCatalog")(function* (
  input: unknown,
) {
  const live = yield* decodeLiveModelList(input, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(
      () => new OpenAiModelCatalogError({ message: "OpenAI model catalog response is invalid" }),
    ),
  );
  const available = new Set(live.data.map(({ id }) => id));
  const concrete = TESTED_MODELS.filter(({ id }) => available.has(id));
  if (!available.has("gpt-5.6-sol") && available.has(SOL_ALIAS.id)) {
    return [SOL_ALIAS, ...concrete];
  }
  return concrete;
});
