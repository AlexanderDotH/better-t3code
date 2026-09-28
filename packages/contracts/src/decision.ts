import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

const NonEmptyDecisionRecord = Schema.makeFilter(
  (record: Readonly<Record<string, unknown>>) => Object.keys(record).length > 0,
  { message: "Expected at least one decision entry" },
);

export const DecisionCriteria = Schema.Record(TrimmedNonEmptyString, TrimmedNonEmptyString).check(
  NonEmptyDecisionRecord,
);
export type DecisionCriteria = typeof DecisionCriteria.Type;

export const DecisionQuestion = Schema.Struct({
  instructions: TrimmedNonEmptyString,
  criteria: DecisionCriteria,
});
export type DecisionQuestion = typeof DecisionQuestion.Type;

export const DecisionQuestions = Schema.Record(TrimmedNonEmptyString, DecisionQuestion).check(
  NonEmptyDecisionRecord,
);
export type DecisionQuestions = typeof DecisionQuestions.Type;

export const DecisionGenerationInput = Schema.Struct({
  modelSelection: ModelSelection,
  state: Schema.String,
  questions: DecisionQuestions,
});
export type DecisionGenerationInput = typeof DecisionGenerationInput.Type;

const DecisionProbability = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);

export const DecisionAnswer = Schema.Struct({
  choice: TrimmedNonEmptyString,
  probabilities: Schema.optional(Schema.Record(TrimmedNonEmptyString, DecisionProbability)),
  confidence: Schema.optional(DecisionProbability),
});
export type DecisionAnswer = typeof DecisionAnswer.Type;

const NonNegativeFiniteNumber = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);

export const DecisionUsage = Schema.Struct({
  inputTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.optional(NonNegativeInt),
  totalTokens: Schema.optional(NonNegativeInt),
  costUsd: Schema.optional(NonNegativeFiniteNumber),
});
export type DecisionUsage = typeof DecisionUsage.Type;

export const DecisionGenerationResult = Schema.Struct({
  model: TrimmedNonEmptyString,
  answers: Schema.Record(TrimmedNonEmptyString, DecisionAnswer).check(NonEmptyDecisionRecord),
  usage: Schema.optional(DecisionUsage),
});
export type DecisionGenerationResult = typeof DecisionGenerationResult.Type;

export const DecisionGenerationFailureReason = Schema.Literals([
  "provider-not-found",
  "unsupported-model",
  "invalid-input",
  "invalid-response",
  "provider-failed",
  "timeout",
]);
export type DecisionGenerationFailureReason = typeof DecisionGenerationFailureReason.Type;

export class DecisionGenerationError extends Schema.TaggedError<DecisionGenerationError>()(
  "DecisionGenerationError",
  {
    operation: Schema.Literal("decide"),
    reason: DecisionGenerationFailureReason,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Decision generation failed in ${this.operation}: ${this.detail}`;
  }
}
