import { type GeminiSettings, type ModelSelection, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  makeGeminiClient,
  resolveGeminiApiKey,
  type GeminiClientFactory,
} from "../provider/GeminiClient.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildFetchExplorationPrompt,
  buildPlanParallelismReviewPrompt,
  buildPromptImprovementPrompt,
  buildPrContentPrompt,
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

const GEMINI_TEXT_GENERATION_TIMEOUT_MS = 180_000;
const isTextGenerationError = Schema.is(TextGenerationError);

function failureDetail(cause: unknown): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message.trim()
    : "Gemini API request failed.";
}

export const makeGeminiTextGeneration = Effect.fn("makeGeminiTextGeneration")((
  settings: GeminiSettings,
  environment: NodeJS.ProcessEnv = process.env,
  clientFactory: GeminiClientFactory = makeGeminiClient,
) => {
  const runGeminiJson = <S extends Schema.Top>({
    operation,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle"
      | "translateTranscriptToEnglish"
      | "improvePrompt"
      | "reviewPlanParallelism"
      | "planFetchExploration";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      if (!settings.enabled) {
        return yield* new TextGenerationError({
          operation,
          detail: "Gemini is disabled in this provider instance.",
        });
      }
      const credential = resolveGeminiApiKey(environment);
      if (!credential) {
        return yield* new TextGenerationError({
          operation,
          detail: "Set GOOGLE_API_KEY or GEMINI_API_KEY in this provider instance's environment.",
        });
      }
      const client = clientFactory(credential.apiKey);
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          client.models.generateContent({
            model: modelSelection.model,
            contents: prompt,
            config: {
              abortSignal: signal,
              responseMimeType: "application/json",
              responseJsonSchema: toJsonSchemaObject(outputSchemaJson),
              temperature: 0.2,
            },
          }),
        catch: (cause) =>
          new TextGenerationError({
            operation,
            detail: failureDetail(cause),
            cause,
          }),
      }).pipe(
        Effect.timeoutOption(GEMINI_TEXT_GENERATION_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({ operation, detail: "Gemini API request timed out." }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
      const text = response.text?.trim();
      if (!text) {
        return yield* new TextGenerationError({
          operation,
          detail: "Gemini returned empty structured output.",
        });
      }
      return yield* Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))(
        extractJsonObject(text),
      ).pipe(
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Gemini returned invalid structured output.",
                cause,
              }),
            ),
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: "Gemini text generation failed.",
              cause,
            }),
      ),
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("GeminiTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runGeminiJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("GeminiTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runGeminiJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("GeminiTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runGeminiJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("GeminiTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      const generated = yield* runGeminiJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  const translateTranscriptToEnglish: TextGeneration.TextGeneration["Service"]["translateTranscriptToEnglish"] =
    Effect.fn("GeminiTextGeneration.translateTranscriptToEnglish")(function* (input) {
      const { prompt, outputSchema } = buildTranscriptTranslationPrompt({ text: input.text });
      const generated = yield* runGeminiJson({
        operation: "translateTranscriptToEnglish",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { text: generated.text.trim() };
    });

  const improvePrompt: TextGeneration.TextGeneration["Service"]["improvePrompt"] = Effect.fn(
    "GeminiTextGeneration.improvePrompt",
  )(function* (input) {
    const { prompt, outputSchema } = buildPromptImprovementPrompt({ text: input.text });
    const generated = yield* runGeminiJson({
      operation: "improvePrompt",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });
    return { text: generated.text.trim() };
  });

  const reviewPlanParallelism: TextGeneration.TextGeneration["Service"]["reviewPlanParallelism"] =
    Effect.fn("GeminiTextGeneration.reviewPlanParallelism")(function* (input) {
      const { prompt, outputSchema } = buildPlanParallelismReviewPrompt(input);
      const generated = yield* runGeminiJson({
        operation: "reviewPlanParallelism",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { recommendedSubagents: generated.recommendedSubagents };
    });

  const planFetchExploration: TextGeneration.TextGeneration["Service"]["planFetchExploration"] =
    Effect.fn("GeminiTextGeneration.planFetchExploration")(function* (input) {
      const { prompt, outputSchema } = buildFetchExplorationPrompt(input);
      return yield* runGeminiJson({
        operation: "planFetchExploration",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
    });

  return Effect.succeed({
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    translateTranscriptToEnglish,
    improvePrompt,
    reviewPlanParallelism,
    planFetchExploration,
  } satisfies TextGeneration.TextGeneration["Service"]);
});
