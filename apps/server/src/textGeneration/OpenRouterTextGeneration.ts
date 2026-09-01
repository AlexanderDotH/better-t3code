import {
  type OpenRouterSettings,
  type ModelSelection,
  TextGenerationError,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { OpenRouterReasoningEffort } from "../provider/openrouter/OpenRouterProtocol.ts";
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
import { buildAutoReasoningPrompt, validateAutoReasoningDecision } from "./AutoReasoning.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const OPENROUTER_TEXT_GENERATION_TIMEOUT_MS = 180_000;
const isOpenRouterReasoningEffort = Schema.is(
  Schema.Literals(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
);

export interface OpenRouterTextCompletionError {
  readonly _tag: string;
  readonly message: string;
}

export interface OpenRouterTextCompletionRequest {
  readonly model: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly reasoningEffort?: OpenRouterReasoningEffort;
}

export type OpenRouterTextCompletion = (
  request: OpenRouterTextCompletionRequest,
) => Effect.Effect<{ readonly text: string }, OpenRouterTextCompletionError>;

export interface OpenRouterTextGenerationOptions {
  readonly isModelAvailable?:
    | ((model: string) => Effect.Effect<boolean, OpenRouterTextCompletionError>)
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
  | "planFetchExploration";

export function makeOpenRouterTextGeneration(
  settings: OpenRouterSettings,
  complete: OpenRouterTextCompletion,
  options?: OpenRouterTextGenerationOptions,
): TextGeneration.TextGeneration["Service"] {
  const runJson = Effect.fn("OpenRouterTextGeneration.runJson")(function* <
    S extends Schema.Top,
  >(input: {
    readonly operation: TextGenerationOperation;
    readonly prompt: string;
    readonly outputSchema: S;
    readonly modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    if (!settings.enabled) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "OpenRouter is disabled in this provider instance.",
      });
    }
    const model = settings.defaultModel.trim();
    if (!model) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "Select an explicit OpenRouter default model before using text generation.",
      });
    }
    if (options?.isModelAvailable) {
      const available = yield* options.isModelAvailable(model).pipe(
        Effect.mapError(
          () =>
            new TextGenerationError({
              operation: input.operation,
              detail: "OpenRouter could not verify the configured default model.",
            }),
        ),
      );
      if (!available) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail:
            "The configured OpenRouter default model is no longer available. Select another model before using text generation.",
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
        "Return exactly one JSON object matching the requested shape. Do not use markdown fences or explanatory text.",
      prompt: input.prompt,
      ...(isOpenRouterReasoningEffort(reasoningEffort) ? { reasoningEffort } : {}),
    }).pipe(
      Effect.mapError(
        () =>
          new TextGenerationError({
            operation: input.operation,
            detail: "OpenRouter text generation request failed.",
          }),
      ),
      Effect.timeoutOption(OPENROUTER_TEXT_GENERATION_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({
                operation: input.operation,
                detail: "OpenRouter text generation request timed out.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (!completion.text.trim()) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "OpenRouter returned no completed structured output.",
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
            detail: "OpenRouter returned invalid structured output.",
          }),
      ),
    );
  });

  return {
    decideAutoReasoning: Effect.fn("OpenRouterTextGeneration.decideAutoReasoning")(
      function* (input) {
        const { prompt, outputSchema } = buildAutoReasoningPrompt(input);
        const generated = yield* runJson({
          operation: "decideAutoReasoning",
          prompt,
          outputSchema,
          modelSelection: input.modelSelection,
        });
        return yield* validateAutoReasoningDecision(input.allowedEfforts, generated);
      },
    ),
    generateCommitMessage: Effect.fn("OpenRouterTextGeneration.generateCommitMessage")(
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
    generatePrContent: Effect.fn("OpenRouterTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt(input);
      const generated = yield* runJson({
        operation: "generatePrContent",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    }),
    generateBranchName: Effect.fn("OpenRouterTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt(input);
      const generated = yield* runJson({
        operation: "generateBranchName",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    }),
    generateThreadTitle: Effect.fn("OpenRouterTextGeneration.generateThreadTitle")(
      function* (input) {
        const { prompt, outputSchema } = buildThreadTitlePrompt(input);
        const generated = yield* runJson({
          operation: "generateThreadTitle",
          prompt,
          outputSchema,
          modelSelection: input.modelSelection,
        });
        return { title: sanitizeThreadTitle(generated.title) };
      },
    ),
    generateThreadMetadata: Effect.fn("OpenRouterTextGeneration.generateThreadMetadata")(
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
    translateTranscriptToEnglish: Effect.fn(
      "OpenRouterTextGeneration.translateTranscriptToEnglish",
    )(function* (input) {
      const { prompt, outputSchema } = buildTranscriptTranslationPrompt({ text: input.text });
      const generated = yield* runJson({
        operation: "translateTranscriptToEnglish",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { text: generated.text.trim() };
    }),
    improvePrompt: Effect.fn("OpenRouterTextGeneration.improvePrompt")(function* (input) {
      const { prompt, outputSchema } = buildPromptImprovementPrompt({ text: input.text });
      const generated = yield* runJson({
        operation: "improvePrompt",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { text: generated.text.trim() };
    }),
    reviewPlanParallelism: Effect.fn("OpenRouterTextGeneration.reviewPlanParallelism")(
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
    planFetchExploration: Effect.fn("OpenRouterTextGeneration.planFetchExploration")(
      function* (input) {
        const { prompt, outputSchema } = buildFetchExplorationPrompt(input);
        return yield* runJson({
          operation: "planFetchExploration",
          prompt,
          outputSchema,
          modelSelection: input.modelSelection,
        });
      },
    ),
    enrichKnowledgeGraph: TextGeneration.unsupportedKnowledgeGraphEnrichment("OpenRouter"),
  } satisfies TextGeneration.TextGeneration["Service"];
}
