import { makeContextSummarizer } from "./contextSummaryGeneration.ts";
import { buildAutoReasoningPrompt, validateAutoReasoningDecision } from "./autoReasoning.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { type ChatAttachment, type ModelSelection, TextGenerationError } from "@t3tools/contracts";
import { formatGeneratedBranchName, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import type { ProviderTextGeneration } from "./textGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildReviewGuidePrompt,
  buildThreadTitlePrompt,
  buildThreadMetadataPrompt,
  buildTranscriptTranslationPrompt,
  buildPromptImprovementPrompt,
  buildPlanParallelismReviewPrompt,
  buildFetchExplorationPrompt,
} from "./textGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./textGenerationUtils.ts";

export type Operation = Exclude<keyof ProviderTextGeneration, "decisionGeneration">;

export interface Request<S extends Schema.Top> {
  readonly operation: Operation;
  readonly cwd: string;
  readonly prompt: string;
  /** Select only after resolving and supplying image inputs to the provider. */
  readonly promptWithImages?: string | undefined;
  readonly outputSchema: S;
  readonly modelSelection: ModelSelection;
  readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** Investigate cwd with read-only tools across turns; fail if the runner cannot guarantee read-only access. */
  readonly investigate?: { readonly timeoutMs: number } | undefined;
}

const INVESTIGATION_TIMEOUT_MS = 15 * 60_000;

export const investigationUnsupported = (operation: Operation, provider: string) =>
  new TextGenerationError({
    operation,
    detail: `${provider} cannot investigate a checkout read-only. Choose another review guide model, or source control writer model when none is set.`,
  });

export type Runner = <S extends Schema.Top>(
  request: Request<S>,
) => Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]>;

export const withoutInvestigation =
  (provider: string, run: Runner): Runner =>
  (request) =>
    request.investigate
      ? Effect.fail(investigationUnsupported(request.operation, provider))
      : run(request);

export const decodeJsonReply = <S extends Schema.Top>(
  request: Pick<Request<S>, "operation" | "outputSchema">,
  provider: string,
  text: string,
) => {
  const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(request.outputSchema));
  return decodeOutput(extractJsonObject(text)).pipe(
    Effect.mapError(
      (cause) =>
        new TextGenerationError({
          operation: request.operation,
          detail: `${provider} returned invalid structured output.`,
          cause,
        }),
    ),
  );
};

export function fromRunner(name: string, run: Runner) {
  const generateCommitMessage: ProviderTextGeneration["generateCommitMessage"] = Effect.fn(
    `${name}.generateCommitMessage`,
  )(function* (input) {
    const generated = yield* run({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      modelSelection: input.modelSelection,
      ...buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      }),
    });
    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: ProviderTextGeneration["generatePrContent"] = Effect.fn(
    `${name}.generatePrContent`,
  )(function* (input) {
    const generated = yield* run({
      operation: "generatePrContent",
      cwd: input.cwd,
      modelSelection: input.modelSelection,
      ...buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
        threadContext: input.threadContext,
      }),
    });
    return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
  });

  const generateBranchName: ProviderTextGeneration["generateBranchName"] = Effect.fn(
    `${name}.generateBranchName`,
  )(function* (input) {
    const generated = yield* run({
      operation: "generateBranchName",
      cwd: input.cwd,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
      promptWithImages: input.attachments?.some((attachment) => attachment.type === "image")
        ? buildBranchNamePrompt({ ...input, imageInputs: true }).prompt
        : undefined,
      ...buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
        naming: input.naming,
      }),
    });
    return { branch: formatGeneratedBranchName(generated.branch, input.naming) };
  });

  const generateThreadTitle: ProviderTextGeneration["generateThreadTitle"] = Effect.fn(
    `${name}.generateThreadTitle`,
  )(function* (input) {
    const generated = yield* run({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
      promptWithImages: input.attachments?.some((attachment) => attachment.type === "image")
        ? buildThreadTitlePrompt({ ...input, imageInputs: true }).prompt
        : undefined,
      ...buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        forkSource: input.forkSource,
        linkedContext: input.linkedContext,
        attachments: input.attachments,
        instructions: input.instructions,
      }),
    });
    return {
      title: sanitizeThreadTitle(generated.title),
      ...(generated.needsRefinement ? { needsRefinement: true } : {}),
    };
  });

  const generateReviewGuide: ProviderTextGeneration["generateReviewGuide"] = Effect.fn(
    `${name}.generateReviewGuide`,
  )(function* (input) {
    return yield* run({
      operation: "generateReviewGuide",
      cwd: input.cwd,
      modelSelection: input.modelSelection,
      investigate: { timeoutMs: INVESTIGATION_TIMEOUT_MS },
      ...buildReviewGuidePrompt(input),
    });
  });

  const summarizeContext = makeContextSummarizer((input) =>
    run({ ...input, operation: "summarizeContext" }),
  );
  const decideAutoReasoning: NonNullable<ProviderTextGeneration["decideAutoReasoning"]> = Effect.fn(
    `${name}.decideAutoReasoning`,
  )(function* (input) {
    const decision = yield* run({
      cwd: input.cwd,
      modelSelection: input.modelSelection,
      operation: "decideAutoReasoning",
      ...buildAutoReasoningPrompt(input),
    });
    return yield* validateAutoReasoningDecision(input.allowedEfforts, decision);
  });
  const generateThreadMetadata: NonNullable<ProviderTextGeneration["generateThreadMetadata"]> =
    Effect.fn(`${name}.generateThreadMetadata`)(function* (input) {
      const { attachments: _attachments, ...request } = input;
      const result = yield* run({
        ...request,
        operation: "generateThreadMetadata",
        ...buildThreadMetadataPrompt(input),
      });
      return {
        title: sanitizeThreadTitle(result.title),
        branch: sanitizeFeatureBranchName(result.branch),
      };
    });
  const translateTranscriptToEnglish: NonNullable<
    ProviderTextGeneration["translateTranscriptToEnglish"]
  > = Effect.fn(`${name}.translateTranscriptToEnglish`)(function* (input) {
    const result = yield* run({
      ...input,
      operation: "translateTranscriptToEnglish",
      ...buildTranscriptTranslationPrompt(input),
    });
    return { text: result.text.trim() };
  });
  const improvePrompt: NonNullable<ProviderTextGeneration["improvePrompt"]> = Effect.fn(
    `${name}.improvePrompt`,
  )(function* (input) {
    const result = yield* run({
      ...input,
      operation: "improvePrompt",
      ...buildPromptImprovementPrompt(input),
    });
    return { text: result.text.trim() };
  });
  const reviewPlanParallelism: NonNullable<ProviderTextGeneration["reviewPlanParallelism"]> =
    Effect.fn(`${name}.reviewPlanParallelism`)(function* (input) {
      return yield* run({
        ...input,
        operation: "reviewPlanParallelism",
        ...buildPlanParallelismReviewPrompt(input),
      });
    });
  const planFetchExploration: NonNullable<ProviderTextGeneration["planFetchExploration"]> =
    Effect.fn(`${name}.planFetchExploration`)(function* (input) {
      return yield* run({
        ...input,
        operation: "planFetchExploration",
        ...buildFetchExplorationPrompt(input),
      });
    });
  return {
    summarizeContext,
    decideAutoReasoning,
    generateThreadMetadata,
    translateTranscriptToEnglish,
    improvePrompt,
    reviewPlanParallelism,
    planFetchExploration,
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    generateReviewGuide,
  } satisfies ProviderTextGeneration;
}
