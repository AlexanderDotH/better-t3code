import {
  CODEX_REASONING_EFFORT_OPTION_ID,
  DecisionAnswer as DecisionAnswerSchema,
  DecisionGenerationError,
  type DecisionGenerationResult,
  type DecisionQuestion,
  type OpenRouterSettings,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { DecisionGenerationProvider } from "../../decisionGeneration/DecisionGenerationProvider.ts";
import type { OpenRouterCatalogModel } from "./OpenRouterModelCatalog.ts";
import {
  completeOpenRouterText,
  OpenRouterHttpError,
  type OpenRouterTransport,
} from "./OpenRouterTransport.ts";

const PromptedDecisionPayload = Schema.Struct({
  answers: Schema.Record(Schema.String, DecisionAnswerSchema),
});
const decodePromptedDecisionPayload = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PromptedDecisionPayload),
);
const isOpenRouterHttpError = Schema.is(OpenRouterHttpError);
const isOpenRouterReasoningEffort = Schema.is(
  Schema.Literals(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
);

function decisionError(
  reason: DecisionGenerationError["reason"],
  detail: string,
): DecisionGenerationError {
  return new DecisionGenerationError({ operation: "decide", reason, detail });
}

function mapProviderError(error: unknown): DecisionGenerationError {
  return decisionError(
    isOpenRouterHttpError(error) && error.category === "timeout" ? "timeout" : "provider-failed",
    "OpenRouter decision generation failed.",
  );
}

function promptedResponseSchema(questions: Readonly<Record<string, DecisionQuestion>>) {
  const answerProperties = Object.fromEntries(
    Object.entries(questions).map(([questionId, question]) => [
      questionId,
      {
        type: "object",
        additionalProperties: false,
        required: ["choice"],
        properties: {
          choice: { type: "string", enum: Object.keys(question.criteria) },
          probabilities: {
            type: "object",
            additionalProperties: { type: "number", minimum: 0, maximum: 1 },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    ]),
  );
  return {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: {
      answers: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(questions),
        properties: answerProperties,
      },
    },
  } as const;
}

function promptedDecisionPrompt(
  state: string,
  questions: Readonly<Record<string, DecisionQuestion>>,
): string {
  return JSON.stringify({ state, questions }, null, 2);
}

function findSelectedModel(
  catalog: ReadonlyArray<OpenRouterCatalogModel>,
  model: string,
): OpenRouterCatalogModel | undefined {
  return catalog.find((candidate) => candidate.id === model);
}

export function makeOpenRouterDecisionGeneration(
  settings: OpenRouterSettings,
  transport: OpenRouterTransport,
): DecisionGenerationProvider {
  const decideNative = Effect.fn("OpenRouterDecisionGeneration.decideNative")(function* (
    input: Parameters<DecisionGenerationProvider["decide"]>[0],
  ): Effect.fn.Return<DecisionGenerationResult, DecisionGenerationError> {
    const result = yield* transport
      .decide({
        model: input.modelSelection.model,
        state: input.state,
        questions: Object.fromEntries(
          Object.entries(input.questions).map(([questionId, question]) => [
            questionId,
            { type: "choice" as const, ...question },
          ]),
        ),
      })
      .pipe(Effect.mapError(mapProviderError));
    return {
      model: result.model,
      answers: Object.fromEntries(
        Object.entries(result.answers).map(([questionId, answer]) => [
          questionId,
          {
            choice: answer.choice,
            ...(answer.probabilities === undefined ? {} : { probabilities: answer.probabilities }),
            ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
          },
        ]),
      ),
      usage: {
        ...(result.usage.input_tokens === undefined
          ? {}
          : { inputTokens: result.usage.input_tokens }),
        ...(result.usage.output_tokens === undefined
          ? {}
          : { outputTokens: result.usage.output_tokens }),
        ...(result.usage.input_tokens === undefined || result.usage.output_tokens === undefined
          ? {}
          : { totalTokens: result.usage.input_tokens + result.usage.output_tokens }),
        ...(result.usage.cost === undefined ? {} : { costUsd: result.usage.cost }),
      },
    };
  });

  const decidePrompted = Effect.fn("OpenRouterDecisionGeneration.decidePrompted")(function* (
    input: Parameters<DecisionGenerationProvider["decide"]>[0],
  ): Effect.fn.Return<DecisionGenerationResult, DecisionGenerationError> {
    const selectedEffort = getModelSelectionStringOptionValue(
      input.modelSelection,
      CODEX_REASONING_EFFORT_OPTION_ID,
    );
    const completion = yield* completeOpenRouterText(transport, {
      model: input.modelSelection.model,
      instructions:
        "Evaluate every choice question against the supplied state. Return exactly one JSON object matching the response schema and no explanatory text.",
      history: [
        {
          type: "user",
          content: promptedDecisionPrompt(input.state, input.questions),
        },
      ],
      tools: [],
      settings,
      responseFormat: {
        type: "json-schema",
        name: "t3_decisions",
        schema: promptedResponseSchema(input.questions),
        strict: true,
      },
      ...(isOpenRouterReasoningEffort(selectedEffort) ? { reasoningEffort: selectedEffort } : {}),
    }).pipe(Effect.mapError(mapProviderError));
    const payload = yield* decodePromptedDecisionPayload(extractJsonObject(completion.text)).pipe(
      Effect.mapError(() =>
        decisionError("invalid-response", "OpenRouter returned invalid prompted decision output."),
      ),
    );
    return {
      model: completion.model,
      answers: payload.answers,
      ...((completion.usage !== undefined || completion.totalCostUsd !== undefined) && {
        usage: {
          ...(completion.usage === undefined
            ? {}
            : {
                inputTokens: completion.usage.inputTokens,
                outputTokens: completion.usage.outputTokens,
                totalTokens: completion.usage.totalTokens,
              }),
          ...(completion.totalCostUsd === undefined ? {} : { costUsd: completion.totalCostUsd }),
        },
      }),
    };
  });

  return {
    decide: Effect.fn("OpenRouterDecisionGeneration.decide")(function* (input) {
      if (!settings.enabled) {
        return yield* decisionError("provider-failed", "OpenRouter is disabled.");
      }
      const catalog = yield* transport
        .listModels(settings.customModels)
        .pipe(Effect.mapError(mapProviderError));
      const model = findSelectedModel(catalog, input.modelSelection.model);
      if (!model || model.selectionSupport.decision === "none") {
        return yield* decisionError(
          "unsupported-model",
          `OpenRouter model '${input.modelSelection.model}' does not support decisions.`,
        );
      }
      const decision =
        model.selectionSupport.decision === "native" ? decideNative(input) : decidePrompted(input);
      return yield* decision;
    }),
  };
}
