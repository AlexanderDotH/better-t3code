import {
  type LmStudioSettings,
  type ModelSelection,
  type OpenAiCompatibleSettings,
  TextGenerationError,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  resolveOpenAiCompatibleModel,
  type OpenAiCompatibleAdapterOptions,
} from "../provider/openaiCompatible/OpenAiCompatibleAdapter.ts";
import { completeOpenAiCompatibleText } from "../provider/openaiCompatible/OpenAiCompatibleTransport.ts";
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

const TEXT_GENERATION_TIMEOUT_MS = 180_000;

type TextGenerationOperation = Exclude<
  keyof TextGeneration.TextGeneration["Service"],
  "enrichKnowledgeGraph"
>;

export function makeOpenAiCompatibleTextGeneration(
  settings: OpenAiCompatibleSettings | LmStudioSettings,
  options: Pick<OpenAiCompatibleAdapterOptions, "driverKind" | "instanceId" | "transport">,
): TextGeneration.TextGeneration["Service"] {
  const name = options.driverKind === "lmstudio" ? "LM Studio" : "OpenAI Compatible";
  const runJson = Effect.fn("OpenAiCompatibleTextGeneration.runJson")(function* <
    S extends Schema.Top,
  >(input: {
    readonly operation: TextGenerationOperation;
    readonly prompt: string;
    readonly outputSchema: S;
    readonly modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const resolution = resolveOpenAiCompatibleModel(
      settings,
      input.modelSelection.instanceId === options.instanceId
        ? input.modelSelection.model
        : undefined,
    );
    if (!resolution.ok) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: resolution.issue,
      });
    }
    // Generic endpoints do not reliably advertise structured-output support; validate JSON locally.
    const completion = yield* completeOpenAiCompatibleText(options.transport, {
      model: resolution.model,
      instructions:
        "Return exactly one JSON object matching the requested shape. Do not use markdown fences or explanatory text.",
      history: [{ type: "user", content: input.prompt }],
      tools: [],
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: `${name} text generation request failed: ${cause.message}`,
          }),
      ),
      Effect.timeoutOption(TEXT_GENERATION_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({
                operation: input.operation,
                detail: `${name} text generation request timed out.`,
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (!completion.text.trim()) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: `${name} returned no completed structured output.`,
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
            detail: `${name} returned invalid structured output.`,
          }),
      ),
    );
  });

  return {
    decideAutoReasoning: Effect.fn("OpenAiCompatibleTextGeneration.decideAutoReasoning")(
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
    generateCommitMessage: Effect.fn("OpenAiCompatibleTextGeneration.generateCommitMessage")(
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
    generatePrContent: Effect.fn("OpenAiCompatibleTextGeneration.generatePrContent")(
      function* (input) {
        const { prompt, outputSchema } = buildPrContentPrompt(input);
        const generated = yield* runJson({
          operation: "generatePrContent",
          prompt,
          outputSchema,
          modelSelection: input.modelSelection,
        });
        return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
      },
    ),
    generateBranchName: Effect.fn("OpenAiCompatibleTextGeneration.generateBranchName")(
      function* (input) {
        const { prompt, outputSchema } = buildBranchNamePrompt(input);
        const generated = yield* runJson({
          operation: "generateBranchName",
          prompt,
          outputSchema,
          modelSelection: input.modelSelection,
        });
        return { branch: sanitizeBranchFragment(generated.branch) };
      },
    ),
    generateThreadTitle: Effect.fn("OpenAiCompatibleTextGeneration.generateThreadTitle")(
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
    generateThreadMetadata: Effect.fn("OpenAiCompatibleTextGeneration.generateThreadMetadata")(
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
      "OpenAiCompatibleTextGeneration.translateTranscriptToEnglish",
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
    improvePrompt: Effect.fn("OpenAiCompatibleTextGeneration.improvePrompt")(function* (input) {
      const { prompt, outputSchema } = buildPromptImprovementPrompt({ text: input.text });
      const generated = yield* runJson({
        operation: "improvePrompt",
        prompt,
        outputSchema,
        modelSelection: input.modelSelection,
      });
      return { text: generated.text.trim() };
    }),
    reviewPlanParallelism: Effect.fn("OpenAiCompatibleTextGeneration.reviewPlanParallelism")(
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
    planFetchExploration: Effect.fn("OpenAiCompatibleTextGeneration.planFetchExploration")(
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
    enrichKnowledgeGraph: TextGeneration.unsupportedKnowledgeGraphEnrichment(name),
  } satisfies TextGeneration.TextGeneration["Service"];
}
