import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ChatAttachment, ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import { makeUsageHardBudgetCheck } from "../provider/usageHardBudget.ts";
import type { TextGenerationPolicy } from "./TextGenerationPolicy.ts";
import type { AutoReasoningMessage } from "./AutoReasoning.ts";

export type TextGenerationProvider =
  | "codex"
  | "claudeAgent"
  | "cursor"
  | "grok"
  | "opencode"
  | "gemini";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  /** When true, the model also returns a semantic branch name for the change. */
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;
  /** Only present when `includeBranch` was set on the input. */
  branch?: string | undefined;
}

export interface PrContentGenerationInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  changeRequestTemplate?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  cwd: string;
  message: string;
  /** Metadata-only context. Naming providers must not load or attach the binary payload. */
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadMetadataGenerationInput {
  cwd: string;
  message: string;
  /** Metadata-only context. Naming providers must not load or attach the binary payload. */
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface ThreadMetadataGenerationResult {
  title: string;
  branch: string;
}

export interface ThreadTitleGenerationInput {
  cwd: string;
  message: string;
  /** Present when replacing an existing title from the current thread history. */
  previousTitle?: string | undefined;
  /** Metadata-only context. Naming providers must not load or attach the binary payload. */
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface ThreadTitleGenerationResult {
  title: string;
}

export interface TranscriptTranslationInput {
  cwd: string;
  text: string;
  modelSelection: ModelSelection;
}

export interface TranscriptTranslationResult {
  text: string;
}

export interface PromptImprovementInput {
  cwd: string;
  text: string;
  modelSelection: ModelSelection;
  voiceCleanup?: {
    readonly instructions: string;
    readonly context: string;
  };
}

export interface PromptImprovementResult {
  text: string;
}

export interface PlanParallelismReviewGenerationInput {
  cwd: string;
  planMarkdown: string;
  userRequest?: string | undefined;
  maxSubagents: number;
  modelSelection: ModelSelection;
}

export interface PlanParallelismReviewGenerationResult {
  recommendedSubagents: number;
}

export interface FetchExplorationWorkerPlan {
  readonly scope: string;
  readonly questions: ReadonlyArray<string>;
}

export interface FetchExplorationPlan {
  readonly decision: "skip" | "run";
  readonly workers: ReadonlyArray<FetchExplorationWorkerPlan>;
}

export interface FetchExplorationGenerationInput {
  readonly cwd: string;
  readonly userRequest: string;
  readonly repositoryOrientation: string;
  readonly maxRecommendedWorkers: number;
  readonly modelSelection: ModelSelection;
}

export type FetchExplorationGenerationResult = FetchExplorationPlan;

export interface AutoReasoningGenerationInput {
  readonly cwd: string;
  readonly userPrompt: string;
  readonly interactionMode: "default" | "plan";
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly allowedEfforts: ReadonlyArray<string>;
  readonly conversation: ReadonlyArray<AutoReasoningMessage>;
  readonly modelSelection: ModelSelection;
}

export interface AutoReasoningGenerationResult {
  readonly effort: string;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
}

/**
 * TextGeneration - Service tag for commit and change request text generation.
 */
export class TextGeneration extends Context.Service<
  TextGeneration,
  {
    readonly decideAutoReasoning: (
      input: AutoReasoningGenerationInput,
    ) => Effect.Effect<AutoReasoningGenerationResult, TextGenerationError>;

    /**
     * Generate a commit message from staged change context.
     */
    readonly generateCommitMessage: (
      input: CommitMessageGenerationInput,
    ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

    /**
     * Generate change request title/body from branch and diff context.
     */
    readonly generatePrContent: (
      input: PrContentGenerationInput,
    ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

    /**
     * Generate a concise branch name from a user message.
     */
    readonly generateBranchName: (
      input: BranchNameGenerationInput,
    ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

    /** Generate the first-turn title and branch in one structured model call. */
    readonly generateThreadMetadata: (
      input: ThreadMetadataGenerationInput,
    ) => Effect.Effect<ThreadMetadataGenerationResult, TextGenerationError>;

    /** Generate a concise thread title from a first message or thread history. */
    readonly generateThreadTitle: (
      input: ThreadTitleGenerationInput,
    ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

    readonly translateTranscriptToEnglish: (
      input: TranscriptTranslationInput,
    ) => Effect.Effect<TranscriptTranslationResult, TextGenerationError>;

    readonly improvePrompt: (
      input: PromptImprovementInput,
    ) => Effect.Effect<PromptImprovementResult, TextGenerationError>;

    readonly reviewPlanParallelism: (
      input: PlanParallelismReviewGenerationInput,
    ) => Effect.Effect<PlanParallelismReviewGenerationResult, TextGenerationError>;

    readonly planFetchExploration: (
      input: FetchExplorationGenerationInput,
    ) => Effect.Effect<FetchExplorationGenerationResult, TextGenerationError>;
  }
>()("t3/textGeneration/TextGeneration") {}

type TextGenerationOp =
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

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

export const makeTextGenerationFromRegistry = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  checkBudget: (instanceId: ProviderInstanceId) => Effect.Effect<string | null>,
): TextGeneration["Service"] => {
  const resolve = (operation: TextGenerationOp, instanceId: ProviderInstanceId) =>
    checkBudget(instanceId).pipe(
      Effect.flatMap((reason) =>
        reason
          ? Effect.fail(new TextGenerationError({ operation, detail: reason }))
          : resolveInstance(registry, operation, instanceId),
      ),
    );
  return TextGeneration.of({
    decideAutoReasoning: (input) =>
      resolve("decideAutoReasoning", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.decideAutoReasoning(input)),
      ),
    generateCommitMessage: (input) =>
      resolve("generateCommitMessage", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateCommitMessage(input)),
      ),
    generatePrContent: (input) =>
      resolve("generatePrContent", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generatePrContent(input)),
      ),
    generateBranchName: (input) =>
      resolve("generateBranchName", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateBranchName(input)),
      ),
    generateThreadMetadata: (input) =>
      resolve("generateThreadMetadata", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateThreadMetadata(input)),
      ),
    generateThreadTitle: (input) =>
      resolve("generateThreadTitle", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateThreadTitle(input)),
      ),
    translateTranscriptToEnglish: (input) =>
      resolve("translateTranscriptToEnglish", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.translateTranscriptToEnglish(input)),
      ),
    improvePrompt: (input) =>
      resolve("improvePrompt", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.improvePrompt(input)),
      ),
    reviewPlanParallelism: (input) =>
      resolve("reviewPlanParallelism", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.reviewPlanParallelism(input)),
      ),
    planFetchExploration: (input) =>
      resolve("planFetchExploration", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.planFetchExploration(input)),
      ),
  });
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const checkBudget = yield* makeUsageHardBudgetCheck;
  return makeTextGenerationFromRegistry(registry, checkBudget);
});

export const layer = Layer.effect(TextGeneration, make);
