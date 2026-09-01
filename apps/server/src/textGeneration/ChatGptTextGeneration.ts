import { type ModelSelection, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { ChatGptSubscriptionTransport } from "../provider/chatgpt/ChatGptSubscriptionTransport.ts";
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
} from "./TextGenerationUtils.ts";

const CHATGPT_TEXT_GENERATION_TIMEOUT_MS = 180_000;
const isTextGenerationError = Schema.is(TextGenerationError);

function failureDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = cause.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "ChatGPT subscription request failed.";
}

function outputTextFromItems(items: ReadonlyArray<unknown>): string {
  return items
    .flatMap((item) => {
      if (typeof item !== "object" || item === null || !("type" in item)) return [];
      if (item.type !== "message" || !("content" in item) || !Array.isArray(item.content))
        return [];
      return item.content.flatMap((content) => {
        if (typeof content !== "object" || content === null || !("text" in content)) return [];
        return typeof content.text === "string" ? [content.text] : [];
      });
    })
    .join("");
}

export const makeChatGptTextGeneration = (
  transport: ChatGptSubscriptionTransport,
): TextGeneration.TextGeneration["Service"] => {
  const runJson = <S extends Schema.Top>(input: {
    readonly operation:
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
    readonly prompt: string;
    readonly outputSchema: S;
    readonly modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const reasoningEffort = getModelSelectionStringOptionValue(
        input.modelSelection,
        "reasoningEffort",
      );
      const serviceTier = getModelSelectionStringOptionValue(input.modelSelection, "serviceTier");
      const state = yield* transport
        .streamResponse({
          model: input.modelSelection.model,
          instructions:
            "Return exactly one JSON object matching the requested shape. Do not use markdown fences or explanatory text.",
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: input.prompt }],
            },
          ],
          tools: [],
          ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
          ...(serviceTier === undefined ? {} : { serviceTier }),
        })
        .pipe(
          Stream.runFold(
            (): {
              text: string;
              terminal: boolean;
              failure: string | undefined;
            } => ({ text: "", terminal: false, failure: undefined }),
            (state, event) => {
              if (event.type === "outputTextDelta") {
                return { ...state, text: state.text + event.delta };
              }
              if (event.type === "responseFailed") {
                return { ...state, terminal: true, failure: event.message };
              }
              if (event.type !== "responseCompleted") return state;
              return {
                ...state,
                terminal: true,
                text: state.text || outputTextFromItems(event.outputItems),
                ...(event.status === "completed"
                  ? {}
                  : { failure: `ChatGPT response ended with status '${event.status}'.` }),
              };
            },
          ),
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation: input.operation,
                detail: failureDetail(cause),
                cause,
              }),
          ),
          Effect.timeoutOption(CHATGPT_TEXT_GENERATION_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new TextGenerationError({
                    operation: input.operation,
                    detail: "ChatGPT subscription request timed out.",
                  }),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );
      if (state.failure) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: state.failure,
        });
      }
      if (!state.terminal || !state.text.trim()) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: "ChatGPT returned no completed structured output.",
        });
      }
      // oxlint-disable-next-line t3code/no-inline-schema-compile -- Each operation supplies a distinct output schema.
      return yield* Schema.decodeEffect(Schema.fromJsonString(input.outputSchema))(
        extractJsonObject(state.text),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: input.operation,
              detail: "ChatGPT returned invalid structured output.",
              cause,
            }),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: input.operation,
              detail: "ChatGPT text generation failed.",
              cause,
            }),
      ),
    );

  return {
    decideAutoReasoning: Effect.fn("ChatGptTextGeneration.decideAutoReasoning")(function* (input) {
      const { prompt, outputSchema } = buildAutoReasoningPrompt(input);
      const generated = yield* runJson({
        operation: "decideAutoReasoning",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return yield* validateAutoReasoningDecision(input.allowedEfforts, generated);
    }),
    generateCommitMessage: Effect.fn("ChatGptTextGeneration.generateCommitMessage")(
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
    generatePrContent: Effect.fn("ChatGptTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt(input);
      const generated = yield* runJson({
        operation: "generatePrContent",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    }),
    generateBranchName: Effect.fn("ChatGptTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt(input);
      const generated = yield* runJson({
        operation: "generateBranchName",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    }),
    generateThreadTitle: Effect.fn("ChatGptTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt(input);
      const generated = yield* runJson({
        operation: "generateThreadTitle",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    }),
    generateThreadMetadata: Effect.fn("ChatGptTextGeneration.generateThreadMetadata")(
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
    translateTranscriptToEnglish: Effect.fn("ChatGptTextGeneration.translateTranscriptToEnglish")(
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
    improvePrompt: Effect.fn("ChatGptTextGeneration.improvePrompt")(function* (input) {
      const { prompt, outputSchema } = buildPromptImprovementPrompt({ text: input.text });
      const generated = yield* runJson({
        operation: "improvePrompt",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { text: generated.text.trim() };
    }),
    reviewPlanParallelism: Effect.fn("ChatGptTextGeneration.reviewPlanParallelism")(
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
    planFetchExploration: Effect.fn("ChatGptTextGeneration.planFetchExploration")(
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
    enrichKnowledgeGraph:
      TextGeneration.unsupportedKnowledgeGraphEnrichment("ChatGPT Subscription"),
  } satisfies TextGeneration.TextGeneration["Service"];
};
