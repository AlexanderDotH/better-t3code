import {
  KnowledgeGraphSemanticModelOutputV1,
  KnowledgeGraphSemanticModelRequestV1,
  type ModelSelection,
  type OpenAiSettings,
  TextGenerationError,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { OpenAiReasoningEffort } from "../provider/openai/OpenAiProtocol.ts";
import { OpenAiHttpError } from "../provider/openai/OpenAiTransport.ts";
import { buildAutoReasoningPrompt, validateAutoReasoningDecision } from "./AutoReasoning.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildFetchExplorationPrompt,
  buildPlanParallelismReviewPrompt,
  buildPromptImprovementPrompt,
  buildPrContentPrompt,
  buildThreadMetadataPrompt,
  buildThreadTitlePrompt,
  buildTranscriptTranslationPrompt,
} from "./TextGenerationPrompts.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";

const OPENAI_TEXT_GENERATION_TIMEOUT_MS = 180_000;
const isOpenAiReasoningEffort = Schema.is(
  Schema.Literals(["none", "low", "medium", "high", "xhigh", "max"]),
);
const isOpenAiHttpError = Schema.is(OpenAiHttpError);
const encodeKnowledgeGraphSemanticRequest = Schema.encodeSync(
  Schema.fromJsonString(KnowledgeGraphSemanticModelRequestV1),
);

export interface OpenAiTextCompletionError {
  readonly _tag: string;
  readonly message: string;
}

export interface OpenAiTextCompletionRequest {
  readonly model: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly responseFormat: {
    readonly name: string;
    readonly schema: Readonly<Record<string, unknown>>;
  };
  readonly reasoningEffort?: OpenAiReasoningEffort;
}

export type OpenAiTextCompletion = (
  request: OpenAiTextCompletionRequest,
) => Effect.Effect<{ readonly text: string }, OpenAiTextCompletionError>;

export interface OpenAiTextGenerationOptions {
  readonly isModelAvailable?:
    | ((model: string) => Effect.Effect<boolean, OpenAiTextCompletionError>)
    | undefined;
}

type TextGenerationOperation =
  | "decideAutoReasoning"
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadMetadata"
  | "generateThreadTitle"
  | "translateTranscriptToEnglish"
  | "improvePrompt"
  | "reviewPlanParallelism"
  | "planFetchExploration"
  | "enrichKnowledgeGraph";

const responseFormatName: Record<TextGenerationOperation, string> = {
  decideAutoReasoning: "auto_reasoning",
  generateCommitMessage: "commit_message",
  generatePrContent: "pull_request_content",
  generateBranchName: "branch_name",
  generateThreadMetadata: "thread_metadata",
  generateThreadTitle: "thread_title",
  translateTranscriptToEnglish: "transcript_translation",
  improvePrompt: "improved_prompt",
  reviewPlanParallelism: "plan_parallelism_review",
  planFetchExploration: "fetch_exploration_plan",
  enrichKnowledgeGraph: "knowledge_graph_semantic_edges",
};

function safeRetryAt(now: number, retryAfterSeconds: number | undefined): number | undefined {
  if (!Number.isSafeInteger(retryAfterSeconds) || (retryAfterSeconds ?? -1) < 0) return undefined;
  const retryAt = now + (retryAfterSeconds as number) * 1_000;
  return Number.isSafeInteger(retryAt) ? retryAt : undefined;
}

function modelFailureReason(
  cause: OpenAiTextCompletionError,
): "model-unavailable" | "entitlement" | undefined {
  if (!isOpenAiHttpError(cause)) return undefined;
  if (cause.category === "not-found") return "model-unavailable";
  if (cause.category === "forbidden") return "entitlement";
  return undefined;
}

const mapCompletionError = Effect.fn("OpenAiTextGeneration.mapCompletionError")(function* (
  operation: TextGenerationOperation,
  cause: OpenAiTextCompletionError,
) {
  if (isOpenAiHttpError(cause) && cause.category === "rate-limit") {
    const retryAt = safeRetryAt(yield* Clock.currentTimeMillis, cause.retryAfterSeconds);
    return yield* new TextGenerationError({
      operation,
      detail: "OpenAI text generation was rate limited.",
      reason: "rate-limited",
      ...(retryAt === undefined ? {} : { retryAt }),
    });
  }
  const reason = modelFailureReason(cause);
  return yield* new TextGenerationError({
    operation,
    detail: "OpenAI text generation request failed.",
    ...(reason === undefined ? {} : { reason }),
  });
});

const mapModelAvailabilityError = Effect.fn("OpenAiTextGeneration.mapModelAvailabilityError")(
  function* (operation: TextGenerationOperation, cause: OpenAiTextCompletionError) {
    if (isOpenAiHttpError(cause) && cause.category === "rate-limit") {
      return yield* mapCompletionError(operation, cause);
    }
    const reason = modelFailureReason(cause);
    return yield* new TextGenerationError({
      operation,
      detail: "OpenAI could not verify the selected model.",
      ...(reason === undefined ? {} : { reason }),
    });
  },
);

export function makeOpenAiTextGeneration(
  settings: OpenAiSettings,
  complete: OpenAiTextCompletion,
  options?: OpenAiTextGenerationOptions,
): TextGeneration.TextGeneration["Service"] {
  const runJson = Effect.fn("OpenAiTextGeneration.runJson")(function* <
    S extends Schema.Top,
  >(input: {
    readonly operation: TextGenerationOperation;
    readonly instructions?: string;
    readonly prompt: string;
    readonly outputSchema: S;
    readonly modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    if (!settings.enabled) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "OpenAI Responses is disabled in this provider instance.",
      });
    }
    const model = input.modelSelection.model.trim();
    if (!model) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "Select an OpenAI model before using text generation.",
        reason: "model-unavailable",
      });
    }
    if (options?.isModelAvailable) {
      const available = yield* options
        .isModelAvailable(model)
        .pipe(Effect.catch((cause) => mapModelAvailabilityError(input.operation, cause)));
      if (!available) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: "The selected OpenAI model is no longer available.",
          reason: "model-unavailable",
        });
      }
    }
    const reasoningEffort = getModelSelectionStringOptionValue(
      input.modelSelection,
      "reasoningEffort",
    );
    const completion = yield* complete({
      model,
      instructions:
        input.instructions ??
        "Return exactly one JSON object matching the requested shape. Do not use markdown fences or explanatory text.",
      prompt: input.prompt,
      responseFormat: {
        name: responseFormatName[input.operation],
        schema: toJsonSchemaObject(input.outputSchema) as Readonly<Record<string, unknown>>,
      },
      ...(isOpenAiReasoningEffort(reasoningEffort) ? { reasoningEffort } : {}),
    }).pipe(
      Effect.catch((cause) => mapCompletionError(input.operation, cause)),
      Effect.timeoutOption(OPENAI_TEXT_GENERATION_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({
                operation: input.operation,
                detail: "OpenAI text generation request timed out.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (!completion.text.trim()) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "OpenAI returned no completed structured output.",
      });
    }
    // oxlint-disable-next-line t3code/no-inline-schema-compile -- Each operation supplies a distinct output schema.
    return yield* Schema.decodeEffect(Schema.fromJsonString(input.outputSchema))(
      extractJsonObject(completion.text),
    ).pipe(
      Effect.mapError(
        () =>
          new TextGenerationError({
            operation: input.operation,
            detail: "OpenAI returned invalid structured output.",
          }),
      ),
    );
  });

  return {
    decideAutoReasoning: Effect.fn("OpenAiTextGeneration.decideAutoReasoning")(function* (input) {
      const { prompt, outputSchema } = buildAutoReasoningPrompt(input);
      const generated = yield* runJson({
        operation: "decideAutoReasoning",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return yield* validateAutoReasoningDecision(input.allowedEfforts, generated);
    }),
    generateCommitMessage: Effect.fn("OpenAiTextGeneration.generateCommitMessage")(
      function* (input) {
        const { prompt, outputSchema } = buildCommitMessagePrompt({
          branch: input.branch,
          stagedSummary: input.stagedSummary,
          stagedPatch: input.stagedPatch,
          includeBranch: input.includeBranch === true,
          policy: input.policy,
        });
        const generated = yield* runJson({
          operation: "generateCommitMessage",
          prompt,
          outputSchema,
          modelSelection: input.modelSelection,
        });
        return {
          subject: sanitizeCommitSubject(generated.subject),
          body: generated.body.trim(),
          ...("branch" in generated && typeof generated.branch === "string"
            ? { branch: sanitizeFeatureBranchName(generated.branch) }
            : {}),
        };
      },
    ),
    generatePrContent: Effect.fn("OpenAiTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt(input);
      const generated = yield* runJson({
        operation: "generatePrContent",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    }),
    generateBranchName: Effect.fn("OpenAiTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt(input);
      const generated = yield* runJson({
        operation: "generateBranchName",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    }),
    generateThreadTitle: Effect.fn("OpenAiTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt(input);
      const generated = yield* runJson({
        operation: "generateThreadTitle",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    }),
    generateThreadMetadata: Effect.fn("OpenAiTextGeneration.generateThreadMetadata")(
      function* (input) {
        const { prompt, outputSchema } = buildThreadMetadataPrompt(input);
        const generated = yield* runJson({
          operation: "generateThreadMetadata",
          prompt,
          outputSchema,
          modelSelection: input.modelSelection,
        });
        return {
          title: sanitizeThreadTitle(generated.title),
          branch: sanitizeBranchFragment(generated.branch),
        };
      },
    ),
    translateTranscriptToEnglish: Effect.fn("OpenAiTextGeneration.translateTranscriptToEnglish")(
      function* (input) {
        const { prompt, outputSchema } = buildTranscriptTranslationPrompt({ text: input.text });
        const generated = yield* runJson({
          operation: "translateTranscriptToEnglish",
          prompt,
          outputSchema,
          modelSelection: input.modelSelection,
        });
        return { text: generated.text.trim() };
      },
    ),
    improvePrompt: Effect.fn("OpenAiTextGeneration.improvePrompt")(function* (input) {
      const { prompt, outputSchema } = buildPromptImprovementPrompt({ text: input.text });
      const generated = yield* runJson({
        operation: "improvePrompt",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { text: generated.text.trim() };
    }),
    reviewPlanParallelism: Effect.fn("OpenAiTextGeneration.reviewPlanParallelism")(
      function* (input) {
        const { prompt, outputSchema } = buildPlanParallelismReviewPrompt(input);
        const generated = yield* runJson({
          operation: "reviewPlanParallelism",
          prompt,
          outputSchema,
          modelSelection: input.modelSelection,
        });
        return { recommendedSubagents: generated.recommendedSubagents };
      },
    ),
    planFetchExploration: Effect.fn("OpenAiTextGeneration.planFetchExploration")(function* (input) {
      const { prompt, outputSchema } = buildFetchExplorationPrompt(input);
      return yield* runJson({
        operation: "planFetchExploration",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
    }),
    enrichKnowledgeGraph: Effect.fn("OpenAiTextGeneration.enrichKnowledgeGraph")(function* (input) {
      return yield* runJson({
        operation: "enrichKnowledgeGraph",
        instructions:
          "Return exactly one JSON object containing semantic edges. Use only candidate pairs and evidence IDs present in the request. Omit uncertain relationships. Never invent nodes, evidence, paths, or commentary.",
        prompt: encodeKnowledgeGraphSemanticRequest(input.request),
        outputSchema: KnowledgeGraphSemanticModelOutputV1,
        modelSelection: input.modelSelection,
      }).pipe(
        Effect.withSpan("OpenAiTextGeneration.enrichKnowledgeGraph", {
          attributes: {
            "knowledge_graph.scope_id": input.request.scopeId,
            "knowledge_graph.base_revision": input.request.baseRevision,
            "knowledge_graph.model_generation": input.request.modelGeneration,
          },
        }),
      );
    }),
  };
}
