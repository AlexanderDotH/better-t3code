import type {
  BranchNamingOptions,
  ChatAttachment,
  ModelSelection,
  ProviderInteractionMode,
  DecisionGenerationInput,
  DecisionGenerationResult,
  DecisionGenerationError,
  PullRequestReviewGuide,
  TextGenerationError,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type { TextGenerationPolicy } from "./textGenerationPolicy.ts";
import type { ThreadTitleForkSource } from "./textGenerationPrompts.ts";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
  modelSelection: ModelSelection;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;
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
  threadContext?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
  modelSelection: ModelSelection;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  naming?: BranchNamingOptions | undefined;
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  modelSelection: ModelSelection;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  linkedContext?: string | undefined;
  cwd: string;
  message: string;
  previousTitle?: string | undefined;
  forkSource?: ThreadTitleForkSource | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  instructions?: string | undefined;
  modelSelection: ModelSelection;
}

export interface ThreadTitleGenerationResult {
  title: string;
  needsRefinement?: boolean | undefined;
}

export interface ReviewGuideStackLayer {
  readonly number: number;
  readonly title: string | null;
  readonly headSha: string | null;
  readonly state: "open" | "closed" | "merged";
}

export interface ReviewGuideGenerationInput {
  cwd: string;
  number: number;
  title: string;
  description: string;
  baseBranch: string;
  baseCommit: string;
  settledReview: string;
  instructions?: string | undefined;
  stack?: ReadonlyArray<ReviewGuideStackLayer> | undefined;
  modelSelection: ModelSelection;
}

export type ReviewGuideGenerationResult = Omit<
  PullRequestReviewGuide,
  "headSha" | "generatedAt" | "modelSelection"
>;

export interface ProviderTextGeneration {
  readonly summarizeContext?: (
    input: ContextSummaryInput,
  ) => Effect.Effect<ContextSummaryResult, TextGenerationError>;
  readonly decideAutoReasoning?: (
    input: AutoReasoningGenerationInput,
  ) => Effect.Effect<AutoReasoningGenerationResult, TextGenerationError>;
  readonly generateThreadMetadata?: (
    input: ThreadMetadataGenerationInput,
  ) => Effect.Effect<ThreadMetadataGenerationResult, TextGenerationError>;
  readonly translateTranscriptToEnglish?: (
    input: TranscriptTranslationInput,
  ) => Effect.Effect<TranscriptTranslationResult, TextGenerationError>;
  readonly improvePrompt?: (
    input: PromptImprovementInput,
  ) => Effect.Effect<PromptImprovementResult, TextGenerationError>;
  readonly reviewPlanParallelism?: (
    input: PlanParallelismReviewGenerationInput,
  ) => Effect.Effect<PlanParallelismReviewGenerationResult, TextGenerationError>;
  readonly planFetchExploration?: (
    input: FetchExplorationGenerationInput,
  ) => Effect.Effect<FetchExplorationGenerationResult, TextGenerationError>;
  readonly decisionGeneration?: {
    readonly decide: (
      input: DecisionGenerationInput & { readonly cwd: string },
    ) => Effect.Effect<DecisionGenerationResult, DecisionGenerationError>;
  };
  readonly generateCommitMessage: (
    input: CommitMessageGenerationInput,
  ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

  readonly generatePrContent: (
    input: PrContentGenerationInput,
  ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

  readonly generateBranchName: (
    input: BranchNameGenerationInput,
  ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

  readonly generateThreadTitle: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

  readonly generateReviewGuide: (
    input: ReviewGuideGenerationInput,
  ) => Effect.Effect<ReviewGuideGenerationResult, TextGenerationError>;
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
export interface AutoReasoningGenerationInput {
  readonly cwd: string;
  readonly userPrompt: string;
  readonly interactionMode: ProviderInteractionMode;
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

export type FetchExplorationGenerationResult = FetchExplorationPlan;
export interface AutoReasoningMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}
export interface ContextSummaryInput {
  readonly cwd: string;
  readonly modelSelection: ModelSelection;
  readonly previousSummary: string;
  readonly transcript: string;
}
export interface ContextSummaryResult {
  readonly summary: string;
}
