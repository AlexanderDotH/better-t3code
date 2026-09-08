import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import { type GrokSettings, type ModelSelection } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import { TextGenerationError } from "@t3tools/contracts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildFetchExplorationPrompt,
  buildPlanParallelismReviewPrompt,
  buildPromptImprovementPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
  buildThreadMetadataPrompt,
  buildTranscriptTranslationPrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";
import {
  applyGrokAcpModelSelection,
  currentGrokModelIdFromSessionSetup,
  currentGrokReasoningEffortFromSessionSetup,
  makeGrokAcpRuntime,
  resolveGrokAcpBaseModelId,
} from "../provider/acp/GrokAcpSupport.ts";
import { buildAutoReasoningPrompt, validateAutoReasoningDecision } from "./AutoReasoning.ts";

const GROK_TIMEOUT_MS = 180_000;

const isTextGenerationError = Schema.is(TextGenerationError);

export const makeGrokTextGeneration = Effect.fn("makeGrokTextGeneration")(function* (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runGrokJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
    environmentOverride,
  }: {
    operation:
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
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
    environmentOverride?: NodeJS.ProcessEnv;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const resolvedModel = resolveGrokAcpBaseModelId(modelSelection.model);
      const outputRef = yield* Ref.make("");
      const runtime = yield* makeGrokAcpRuntime({
        grokSettings,
        environment: environmentOverride ?? environment,
        childProcessSpawner: commandSpawner,
        cwd,
        clientInfo: { name: "t3-code-git-text", version: "0.0.0" },
        ...(operation === "decideAutoReasoning"
          ? { runtimeMode: "approval-required" as const }
          : {}),
      }).pipe(Effect.provideService(Crypto.Crypto, crypto));

      yield* runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate !== "agent_message_chunk") {
          return Effect.void;
        }
        const content = update.content;
        if (content.type !== "text") {
          return Effect.void;
        }
        return Ref.update(outputRef, (current) => current + content.text);
      });

      const promptResult = yield* Effect.gen(function* () {
        const started = yield* runtime.start();
        const requestedReasoningEffort = getModelSelectionStringOptionValue(
          modelSelection,
          "reasoningEffort",
        );
        yield* applyGrokAcpModelSelection({
          runtime,
          currentModelId: currentGrokModelIdFromSessionSetup(started.sessionSetupResult),
          currentReasoningEffort: currentGrokReasoningEffortFromSessionSetup(
            started.sessionSetupResult,
          ),
          requestedModelId: resolvedModel,
          requestedReasoningEffort,
          mapError: (cause) =>
            new TextGenerationError({
              operation,
              detail: "Failed to set Grok ACP base model for text generation.",
              cause,
            }),
        });

        return yield* runtime.prompt({
          prompt: [{ type: "text", text: prompt }],
        });
      }).pipe(
        Effect.timeoutOption(GROK_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({ operation, detail: "Grok ACP request timed out." }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause: EffectAcpErrors.AcpError | TextGenerationError) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation,
                detail: "Grok ACP request failed.",
                cause,
              }),
        ),
      );

      const trimmed = (yield* Ref.get(outputRef)).trim();
      if (!trimmed) {
        return yield* new TextGenerationError({
          operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? "Grok ACP request was cancelled."
              : "Grok Agent returned empty output.",
        });
      }

      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));
      return yield* decodeOutput(extractJsonObject(trimmed)).pipe(
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Grok Agent returned invalid structured output.",
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
              detail: "Grok ACP text generation failed.",
              cause,
            }),
      ),
      Effect.scoped,
    );

  const decideAutoReasoning: TextGeneration.TextGeneration["Service"]["decideAutoReasoning"] =
    Effect.fn("GrokTextGeneration.decideAutoReasoning")(function* (input) {
      return yield* Effect.gen(function* () {
        const cwd = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-auto-reasoning-grok-cwd-",
        });
        const configHome = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-auto-reasoning-grok-config-",
        });
        const { prompt, outputSchema } = buildAutoReasoningPrompt(input);
        const generated = yield* runGrokJson({
          operation: "decideAutoReasoning",
          cwd,
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
          environmentOverride: {
            ...environment,
            HOME: configHome,
            USERPROFILE: configHome,
            XDG_CONFIG_HOME: configHome,
            GROK_HOME: configHome,
          },
        });
        return yield* validateAutoReasoningDecision(input.allowedEfforts, generated);
      }).pipe(
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation: "decideAutoReasoning",
                detail: "Failed to prepare isolated Grok Auto Reasoning.",
                cause,
              }),
        ),
        Effect.scoped,
      );
    });

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("GrokTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });

      const generated = yield* runGrokJson({
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
    Effect.fn("GrokTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });

      const generated = yield* runGrokJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("GrokTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* runGrokJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("GrokTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });

      const generated = yield* runGrokJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      } satisfies TextGeneration.ThreadTitleGenerationResult;
    });

  const generateThreadMetadata: TextGeneration.TextGeneration["Service"]["generateThreadMetadata"] =
    Effect.fn("GrokTextGeneration.generateThreadMetadata")(function* (input) {
      const { prompt, outputSchema } = buildThreadMetadataPrompt(input);
      const generated = yield* runGrokJson({
        operation: "generateThreadMetadata",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        title: sanitizeThreadTitle(generated.title),
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

  const translateTranscriptToEnglish: TextGeneration.TextGeneration["Service"]["translateTranscriptToEnglish"] =
    Effect.fn("GrokTextGeneration.translateTranscriptToEnglish")(function* (input) {
      const { prompt, outputSchema } = buildTranscriptTranslationPrompt({ text: input.text });
      const generated = yield* runGrokJson({
        operation: "translateTranscriptToEnglish",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return { text: generated.text.trim() };
    });

  const improvePrompt: TextGeneration.TextGeneration["Service"]["improvePrompt"] = Effect.fn(
    "GrokTextGeneration.improvePrompt",
  )(function* (input) {
    const { prompt, outputSchema } = buildPromptImprovementPrompt({ text: input.text });
    const generated = yield* runGrokJson({
      operation: "improvePrompt",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return { text: generated.text.trim() };
  });

  const reviewPlanParallelism: TextGeneration.TextGeneration["Service"]["reviewPlanParallelism"] =
    Effect.fn("GrokTextGeneration.reviewPlanParallelism")(function* (input) {
      const { prompt, outputSchema } = buildPlanParallelismReviewPrompt(input);
      const generated = yield* runGrokJson({
        operation: "reviewPlanParallelism",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return { recommendedSubagents: generated.recommendedSubagents };
    });

  const planFetchExploration: TextGeneration.TextGeneration["Service"]["planFetchExploration"] =
    Effect.fn("GrokTextGeneration.planFetchExploration")(function* (input) {
      const { prompt, outputSchema } = buildFetchExplorationPrompt(input);
      return yield* runGrokJson({
        operation: "planFetchExploration",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
    });

  return {
    decideAutoReasoning,
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadMetadata,
    generateThreadTitle,
    translateTranscriptToEnglish,
    improvePrompt,
    reviewPlanParallelism,
    planFetchExploration,
    enrichKnowledgeGraph: TextGeneration.unsupportedKnowledgeGraphEnrichment("Grok"),
  } satisfies TextGeneration.TextGeneration["Service"];
});
