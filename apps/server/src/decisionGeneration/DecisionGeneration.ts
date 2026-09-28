import {
  DecisionGenerationError,
  DecisionGenerationInput as DecisionGenerationInputSchema,
  DecisionGenerationResult as DecisionGenerationResultSchema,
  type DecisionAnswer,
  type DecisionGenerationResult,
  type DecisionQuestion,
  type ModelSelection,
  type ProviderInstanceId,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { resolveModelSelectionSupport } from "@t3tools/shared/model";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ServerProviderShape } from "../provider/Services/ServerProvider.ts";
import type {
  DecisionGenerationProvider,
  DecisionGenerationRequest,
} from "./DecisionGenerationProvider.ts";

export type { DecisionGenerationRequest } from "./DecisionGenerationProvider.ts";

export const DECISION_GENERATION_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 16_384;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const FIXED_PROMPT_RESERVE_TOKENS = 768;
const RESPONSE_BASE_RESERVE_TOKENS = 128;
const RESPONSE_PER_QUESTION_RESERVE_TOKENS = 64;
const RESPONSE_PER_CHOICE_RESERVE_TOKENS = 24;
const MIDDLE_TRUNCATION_MARKER = "\n[... decision state truncated ...]\n";

export interface DecisionGenerationProviderInstance {
  readonly snapshot: Pick<ServerProviderShape, "getSnapshot">;
  readonly decisionGeneration?: DecisionGenerationProvider;
  readonly textGeneration?: {
    readonly decisionGeneration?: DecisionGenerationProvider;
  };
}

export interface DecisionGenerationProviderRegistry {
  readonly getInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<DecisionGenerationProviderInstance | undefined>;
}

interface ResolvedDecisionTarget {
  readonly provider: DecisionGenerationProvider;
  readonly contextWindowTokens: number;
}

interface CombinedDecisionRequest {
  readonly request: DecisionGenerationRequest;
  readonly answerIdsByRequest: ReadonlyArray<Readonly<Record<string, string>>>;
}

const decodeDecisionInput = Schema.decodeEffect(DecisionGenerationInputSchema);
const decodeDecisionResult = Schema.decodeEffect(DecisionGenerationResultSchema);

function decisionError(
  reason: DecisionGenerationError["reason"],
  detail: string,
  cause?: unknown,
): DecisionGenerationError {
  return new DecisionGenerationError({
    operation: "decide",
    reason,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function findSelectedModel(
  models: ReadonlyArray<ServerProviderModel>,
  selection: ModelSelection,
): ServerProviderModel | undefined {
  return models.find(
    (model) => model.slug === selection.model || model.aliases?.includes(selection.model) === true,
  );
}

function resolveContextWindowTokens(model: ServerProviderModel): number {
  const contextWindow = model.capabilities?.contextWindow;
  if (!contextWindow) return DEFAULT_CONTEXT_WINDOW_TOKENS;
  const effectivePercent = contextWindow.effectivePercent ?? 100;
  return Math.max(1, Math.floor(contextWindow.defaultTokens * (effectivePercent / 100)));
}

function questionReserveTokens(questions: Readonly<Record<string, DecisionQuestion>>): number {
  const entries = Object.values(questions);
  const choiceCount = entries.reduce(
    (total, question) => total + Object.keys(question.criteria).length,
    0,
  );
  return (
    RESPONSE_BASE_RESERVE_TOKENS +
    entries.length * RESPONSE_PER_QUESTION_RESERVE_TOKENS +
    choiceCount * RESPONSE_PER_CHOICE_RESERVE_TOKENS
  );
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= MIDDLE_TRUNCATION_MARKER.length) return value.slice(0, maxChars);
  const contentChars = maxChars - MIDDLE_TRUNCATION_MARKER.length;
  const headChars = Math.ceil(contentChars / 2);
  const tailChars = Math.floor(contentChars / 2);
  return `${value.slice(0, headChars)}${MIDDLE_TRUNCATION_MARKER}${value.slice(-tailChars)}`;
}

export function boundDecisionState(
  request: DecisionGenerationRequest,
  contextWindowTokens: number,
): Effect.Effect<DecisionGenerationRequest, DecisionGenerationError> {
  const questionChars = JSON.stringify(request.questions).length;
  const reservedTokens = FIXED_PROMPT_RESERVE_TOKENS + questionReserveTokens(request.questions);
  const availableStateChars =
    (contextWindowTokens - reservedTokens) * ESTIMATED_CHARS_PER_TOKEN - questionChars;
  if (availableStateChars < 0) {
    return Effect.fail(
      decisionError(
        "invalid-input",
        "The decision questions and response schema exceed the selected model's context window.",
      ),
    );
  }
  return Effect.succeed({
    ...request,
    state: truncateMiddle(request.state, availableStateChars),
  });
}

export function normalizedModelSelectionKey(selection: ModelSelection): string {
  const options = [...(selection.options ?? [])].sort((left, right) => {
    const byId = left.id.localeCompare(right.id);
    if (byId !== 0) return byId;
    return String(left.value).localeCompare(String(right.value));
  });
  return JSON.stringify({
    instanceId: selection.instanceId,
    model: selection.model,
    options,
  });
}

function validateRequest(
  input: DecisionGenerationRequest,
): Effect.Effect<DecisionGenerationRequest, DecisionGenerationError> {
  if (input.cwd.trim().length === 0) {
    return Effect.fail(
      decisionError("invalid-input", "Decision generation requires a working directory."),
    );
  }
  return decodeDecisionInput(input).pipe(
    Effect.map((decoded) => ({ ...decoded, cwd: input.cwd })),
    Effect.mapError((cause) =>
      decisionError("invalid-input", "The decision request is invalid.", cause),
    ),
  );
}

function validateResult(
  request: DecisionGenerationRequest,
  rawResult: DecisionGenerationResult,
): Effect.Effect<DecisionGenerationResult, DecisionGenerationError> {
  return decodeDecisionResult(rawResult).pipe(
    Effect.mapError((cause) =>
      decisionError(
        "invalid-response",
        "The decision provider returned an invalid response.",
        cause,
      ),
    ),
    Effect.flatMap((result) => {
      const questionIds = Object.keys(request.questions);
      const answerIds = Object.keys(result.answers);
      if (
        answerIds.length !== questionIds.length ||
        answerIds.some((answerId) => !Object.hasOwn(request.questions, answerId))
      ) {
        return Effect.fail(
          decisionError(
            "invalid-response",
            "The decision provider returned missing or unexpected answers.",
          ),
        );
      }

      for (const questionId of questionIds) {
        const answer = result.answers[questionId];
        const question = request.questions[questionId];
        if (!answer || !question || !Object.hasOwn(question.criteria, answer.choice)) {
          return Effect.fail(
            decisionError(
              "invalid-response",
              `The decision provider returned an unsupported choice for question '${questionId}'.`,
            ),
          );
        }
        if (
          answer.probabilities &&
          Object.keys(answer.probabilities).some(
            (choice) => !Object.hasOwn(question.criteria, choice),
          )
        ) {
          return Effect.fail(
            decisionError(
              "invalid-response",
              `The decision provider returned probabilities for an unsupported choice in question '${questionId}'.`,
            ),
          );
        }
      }
      return Effect.succeed(result);
    }),
  );
}

function combineDecisionRequests(
  requests: ReadonlyArray<DecisionGenerationRequest>,
): CombinedDecisionRequest {
  if (requests.length === 1) {
    const request = requests[0]!;
    return {
      request,
      answerIdsByRequest: [
        Object.fromEntries(
          Object.keys(request.questions).map((questionId) => [questionId, questionId]),
        ),
      ],
    };
  }

  const combinedQuestions: Record<string, DecisionQuestion> = {};
  const answerIdsByRequest = requests.map((request, requestIndex) =>
    Object.fromEntries(
      Object.entries(request.questions).map(([questionId, question], questionIndex) => {
        const combinedQuestionId = `request_${requestIndex}_question_${questionIndex}`;
        combinedQuestions[combinedQuestionId] = {
          ...question,
          instructions: [
            `Use only the decisionRequests state entry whose id is "${requestIndex}" for this question.`,
            question.instructions,
          ].join("\n"),
        };
        return [questionId, combinedQuestionId];
      }),
    ),
  );
  const state = JSON.stringify(
    {
      decisionRequests: requests.map((request, requestIndex) => ({
        id: String(requestIndex),
        state: request.state,
      })),
    },
    null,
    2,
  );
  return {
    request: {
      cwd: requests[0]!.cwd,
      modelSelection: requests[0]!.modelSelection,
      state,
      questions: combinedQuestions,
    },
    answerIdsByRequest,
  };
}

function splitCombinedResult(
  combined: CombinedDecisionRequest,
  result: DecisionGenerationResult,
): ReadonlyArray<DecisionGenerationResult> {
  return combined.answerIdsByRequest.map((answerIds) => {
    const answers: Record<string, DecisionAnswer> = {};
    for (const [questionId, combinedQuestionId] of Object.entries(answerIds)) {
      answers[questionId] = result.answers[combinedQuestionId]!;
    }
    return {
      model: result.model,
      answers,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  });
}

export function makeDecisionGenerationFromRegistry(
  registry: DecisionGenerationProviderRegistry,
): DecisionGeneration["Service"] {
  const resolveTarget = Effect.fn("DecisionGeneration.resolveTarget")(function* (
    selection: ModelSelection,
  ): Effect.fn.Return<ResolvedDecisionTarget, DecisionGenerationError> {
    const instance = yield* registry.getInstance(selection.instanceId);
    if (!instance) {
      return yield* decisionError(
        "provider-not-found",
        `Decision provider instance '${selection.instanceId}' was not found.`,
      );
    }
    const snapshot = yield* instance.snapshot.getSnapshot;
    const model = findSelectedModel(snapshot.models, selection);
    const decisionSupport = model ? resolveModelSelectionSupport(model).decision : "none";
    if (!model || decisionSupport === "none") {
      return yield* decisionError(
        "unsupported-model",
        `Model '${selection.model}' is not available for decision generation.`,
      );
    }
    const provider =
      decisionSupport === "native"
        ? instance.decisionGeneration
        : (instance.textGeneration?.decisionGeneration ?? instance.decisionGeneration);
    if (!provider) {
      return yield* decisionError(
        "unsupported-model",
        `Provider instance '${selection.instanceId}' does not support decision generation.`,
      );
    }
    return {
      provider,
      contextWindowTokens: resolveContextWindowTokens(model),
    };
  });

  const decideValidated = Effect.fn("DecisionGeneration.decideValidated")(function* (
    request: DecisionGenerationRequest,
  ): Effect.fn.Return<DecisionGenerationResult, DecisionGenerationError> {
    const target = yield* resolveTarget(request.modelSelection);
    const bounded = yield* boundDecisionState(request, target.contextWindowTokens);
    const rawResult = yield* target.provider.decide(bounded).pipe(
      Effect.timeoutOption(DECISION_GENERATION_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              decisionError(
                "timeout",
                `Decision generation timed out after ${DECISION_GENERATION_TIMEOUT_MS}ms.`,
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    return yield* validateResult(bounded, rawResult);
  });

  const decide = Effect.fn("DecisionGeneration.decide")(function* (
    input: DecisionGenerationRequest,
  ): Effect.fn.Return<DecisionGenerationResult, DecisionGenerationError> {
    const request = yield* validateRequest(input);
    return yield* decideValidated(request);
  });

  const decideMany = Effect.fn("DecisionGeneration.decideMany")(function* (
    inputs: ReadonlyArray<DecisionGenerationRequest>,
  ): Effect.fn.Return<ReadonlyArray<DecisionGenerationResult>, DecisionGenerationError> {
    if (inputs.length === 0) return [];
    const requests = yield* Effect.forEach(inputs, validateRequest);
    const grouped = new Map<
      string,
      Array<{ readonly index: number; readonly request: DecisionGenerationRequest }>
    >();
    requests.forEach((request, index) => {
      const key = normalizedModelSelectionKey(request.modelSelection);
      const group = grouped.get(key) ?? [];
      group.push({ index, request });
      grouped.set(key, group);
    });

    const groupedResults = yield* Effect.forEach(
      [...grouped.values()],
      Effect.fn("DecisionGeneration.decideGroup")(function* (group) {
        const combined = combineDecisionRequests(group.map(({ request }) => request));
        const result = yield* decideValidated(combined.request);
        return {
          indexes: group.map(({ index }) => index),
          results: splitCombinedResult(combined, result),
        };
      }),
      { concurrency: "unbounded" },
    );
    const results: Array<DecisionGenerationResult> = [];
    for (const group of groupedResults) {
      group.indexes.forEach((index, resultIndex) => {
        results[index] = group.results[resultIndex]!;
      });
    }
    return results;
  });

  return DecisionGeneration.of({ decide, decideMany });
}

export class DecisionGeneration extends Context.Service<
  DecisionGeneration,
  {
    readonly decide: (
      input: DecisionGenerationRequest,
    ) => Effect.Effect<DecisionGenerationResult, DecisionGenerationError>;
    readonly decideMany: (
      inputs: ReadonlyArray<DecisionGenerationRequest>,
    ) => Effect.Effect<ReadonlyArray<DecisionGenerationResult>, DecisionGenerationError>;
  }
>()("t3/decisionGeneration/DecisionGeneration") {}

export const layer = Layer.effect(
  DecisionGeneration,
  Effect.map(ProviderInstanceRegistry.ProviderInstanceRegistry, makeDecisionGenerationFromRegistry),
);
