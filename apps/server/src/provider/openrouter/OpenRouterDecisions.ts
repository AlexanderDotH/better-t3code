import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const Probability = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);
const NonNegativeFiniteNumber = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);
const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const OpenRouterDecisionQuestion = Schema.Struct({
  type: Schema.Literal("choice"),
  instructions: Schema.String,
  criteria: Schema.Record(Schema.String, Schema.String),
});
export type OpenRouterDecisionQuestion = typeof OpenRouterDecisionQuestion.Type;

export const OpenRouterDecisionsRequestBody = Schema.Struct({
  model: Schema.String,
  state: Schema.Json,
  questions: Schema.Record(Schema.String, OpenRouterDecisionQuestion),
});
export type OpenRouterDecisionsRequestBody = typeof OpenRouterDecisionsRequestBody.Type;

export interface OpenRouterDecisionsRequest extends OpenRouterDecisionsRequestBody {
  readonly signal?: AbortSignal;
}

export const OpenRouterDecisionChoiceAnswer = Schema.Struct({
  type: Schema.Literal("choice"),
  choice: Schema.String,
  probabilities: Schema.optionalKey(Schema.Record(Schema.String, Probability)),
  confidence: Schema.optionalKey(Probability),
});
export type OpenRouterDecisionChoiceAnswer = typeof OpenRouterDecisionChoiceAnswer.Type;

export const OpenRouterDecisionsUsage = Schema.Struct({
  input_tokens: Schema.optionalKey(NonNegativeInteger),
  output_tokens: Schema.optionalKey(NonNegativeInteger),
  cost: Schema.optionalKey(NonNegativeFiniteNumber),
});
export type OpenRouterDecisionsUsage = typeof OpenRouterDecisionsUsage.Type;

export const OpenRouterDecisionsResponse = Schema.Struct({
  answers: Schema.Record(Schema.String, OpenRouterDecisionChoiceAnswer),
  model: Schema.String,
  usage: OpenRouterDecisionsUsage,
  id: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
});
export type OpenRouterDecisionsResponse = typeof OpenRouterDecisionsResponse.Type;

export class OpenRouterDecisionsSchemaError extends Schema.TaggedError<OpenRouterDecisionsSchemaError>()(
  "OpenRouterDecisionsSchemaError",
  { message: Schema.String },
) {}

const decodeRequestBody = Schema.decodeUnknownEffect(OpenRouterDecisionsRequestBody);
const decodeResponse = Schema.decodeUnknownEffect(OpenRouterDecisionsResponse);

export const decodeOpenRouterDecisionsRequestBody = Effect.fn(
  "decodeOpenRouterDecisionsRequestBody",
)(function* (input: unknown) {
  return yield* decodeRequestBody(input, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(
      () =>
        new OpenRouterDecisionsSchemaError({
          message: "OpenRouter Decisions request schema is invalid",
        }),
    ),
  );
});

export const decodeOpenRouterDecisionsResponse = Effect.fn("decodeOpenRouterDecisionsResponse")(
  function* (input: unknown) {
    return yield* decodeResponse(input, { onExcessProperty: "ignore" }).pipe(
      Effect.mapError(
        () =>
          new OpenRouterDecisionsSchemaError({
            message: "OpenRouter Decisions response schema is invalid",
          }),
      ),
    );
  },
);
