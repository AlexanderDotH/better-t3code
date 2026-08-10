/**
 * Shared prompt builders for text generation providers.
 *
 * Extracts the prompt construction logic that is identical across
 * Codex, Claude, and any future CLI-based text generation backends.
 *
 * @module textGenerationPrompts
 */
import * as Schema from "effect/Schema";
import type { ChatAttachment } from "@t3tools/contracts";

import { limitSection } from "./TextGenerationUtils.ts";
import type { TextGenerationPolicy } from "./TextGenerationPolicy.ts";

const EARLIER_CONTENT_TRUNCATION_MARKER = "[Earlier content truncated]\n\n";

function policyInstruction(instruction: string | undefined): ReadonlyArray<string> {
  const trimmed = instruction?.trim();
  return trimmed ? ["", "Additional instructions:", limitSection(trimmed, 4_000)] : [];
}

// ---------------------------------------------------------------------------
// Commit message
// ---------------------------------------------------------------------------

export interface CommitMessagePromptInput {
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
}

export function buildCommitMessagePrompt(input: CommitMessagePromptInput) {
  const wantsBranch = input.includeBranch === true;

  const prompt = [
    "You write concise git commit messages.",
    wantsBranch
      ? "Return a JSON object with keys: subject, body, branch."
      : "Return a JSON object with keys: subject, body.",
    "Rules:",
    "- subject must be imperative, <= 72 chars, and no trailing period",
    "- body can be empty string or short bullet points",
    ...(wantsBranch
      ? ["- branch must be a short semantic git branch fragment for this change"]
      : []),
    "- capture the primary user-visible or developer-visible change",
    ...policyInstruction(input.policy?.commitInstructions),
    "",
    `Branch: ${input.branch ?? "(detached)"}`,
    "",
    "Staged files:",
    limitSection(input.stagedSummary, 6_000),
    "",
    "Staged patch:",
    limitSection(input.stagedPatch, 40_000),
  ].join("\n");

  if (wantsBranch) {
    return {
      prompt,
      outputSchema: Schema.Struct({
        subject: Schema.String,
        body: Schema.String,
        branch: Schema.String,
      }),
    };
  }

  return {
    prompt,
    outputSchema: Schema.Struct({
      subject: Schema.String,
      body: Schema.String,
    }),
  };
}

// ---------------------------------------------------------------------------
// Change request content
// ---------------------------------------------------------------------------

export interface PrContentPromptInput {
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  changeRequestTemplate?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
}

export function buildPrContentPrompt(input: PrContentPromptInput) {
  const changeRequestTemplate = input.changeRequestTemplate?.trim();
  const bodyRules = changeRequestTemplate
    ? [
        "- body must be markdown and follow the repository change request template structure",
        "- fill in the template sections appropriately for this change",
        "- drop HTML comments from the template in the generated body",
        "- keep the template's markdown structure",
      ]
    : [
        "- body must be markdown and include headings '## Summary' and '## Testing'",
        "- under Summary, provide short bullet points",
        "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
      ];
  const prompt = [
    "You write source control change request content.",
    "Return a JSON object with keys: title, body.",
    "Rules:",
    "- title should be concise and specific",
    ...bodyRules,
    ...policyInstruction(input.policy?.changeRequestInstructions),
    ...(changeRequestTemplate
      ? ["", "Repository change request template:", limitSection(changeRequestTemplate, 8_000)]
      : []),
    "",
    `Base branch: ${input.baseBranch}`,
    `Head branch: ${input.headBranch}`,
    "",
    "Commits:",
    limitSection(input.commitSummary, 12_000),
    "",
    "Diff stat:",
    limitSection(input.diffSummary, 12_000),
    "",
    "Diff patch:",
    limitSection(input.diffPatch, 40_000),
  ].join("\n");

  const outputSchema = Schema.Struct({
    title: Schema.String,
    body: Schema.String,
  });

  return { prompt, outputSchema };
}

// ---------------------------------------------------------------------------
// Branch name
// ---------------------------------------------------------------------------

export interface BranchNamePromptInput {
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  policy?: TextGenerationPolicy | undefined;
}

interface PromptFromMessageInput {
  instruction: string;
  responseShape: string;
  rules: ReadonlyArray<string>;
  message: string;
  messageLabel?: string | undefined;
  preserveMessageEnd?: boolean | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  additionalInstructions?: string | undefined;
}

function preserveMessageEnd(message: string): string {
  const alreadyTruncated = message.startsWith(EARLIER_CONTENT_TRUNCATION_MARKER);
  const contents = alreadyTruncated
    ? message.slice(EARLIER_CONTENT_TRUNCATION_MARKER.length)
    : message;
  if (!alreadyTruncated && contents.length <= 8_000) {
    return contents;
  }
  return `${EARLIER_CONTENT_TRUNCATION_MARKER}${contents.slice(-8_000)}`;
}

function buildPromptFromMessage(input: PromptFromMessageInput): string {
  const attachmentLines = (input.attachments ?? []).map(
    (attachment) => `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
  );

  const promptSections = [
    input.instruction,
    input.responseShape,
    "Rules:",
    ...input.rules.map((rule) => `- ${rule}`),
    "",
    `${input.messageLabel ?? "User message"}:`,
    input.preserveMessageEnd
      ? preserveMessageEnd(input.message)
      : limitSection(input.message, 8_000),
    ...policyInstruction(input.additionalInstructions),
  ];
  if (attachmentLines.length > 0) {
    promptSections.push(
      "",
      "Attachment metadata:",
      limitSection(attachmentLines.join("\n"), 4_000),
    );
  }

  return promptSections.join("\n");
}

export function buildBranchNamePrompt(input: BranchNamePromptInput) {
  const prompt = buildPromptFromMessage({
    instruction: "You generate concise git branch names.",
    responseShape: "Return a JSON object with key: branch.",
    rules: [
      "Branch should describe the requested work from the user message.",
      "Keep it short and specific (2-6 words).",
      "Use plain words only, no issue prefixes and no punctuation-heavy text.",
      "If images are attached, use them as primary context for visual/UI issues.",
    ],
    message: input.message,
    attachments: input.attachments,
    additionalInstructions: input.policy?.branchInstructions,
  });
  const outputSchema = Schema.Struct({
    branch: Schema.String,
  });

  return { prompt, outputSchema };
}

// ---------------------------------------------------------------------------
// Thread title
// ---------------------------------------------------------------------------

export interface ThreadTitlePromptInput {
  message: string;
  previousTitle?: string | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  policy?: TextGenerationPolicy | undefined;
}

export function buildThreadTitlePrompt(input: ThreadTitlePromptInput) {
  const isRegeneration = input.previousTitle !== undefined;
  const prompt = buildPromptFromMessage({
    instruction: isRegeneration
      ? [
          "You write concise thread titles for coding conversations.",
          "The user requested a new title based on the contents of this thread.",
          `The previous title was ${JSON.stringify(input.previousTitle)}.`,
          "Come up with a new title that better represents the current state of the thread.",
        ].join("\n")
      : "You write concise thread titles for coding conversations.",
    responseShape: "Return a JSON object with key: title.",
    rules: [
      isRegeneration
        ? "Title should summarize the thread's current state, not just its initial request."
        : "Title should summarize the user's request, not restate it verbatim.",
      ...(isRegeneration
        ? [
            "Capture the thread's intent, not a PR number or other superficial detail.",
            "Return a different title from the previous title.",
          ]
        : []),
      "Keep it short and specific (3-8 words).",
      "Avoid quotes, filler, prefixes, and trailing punctuation.",
      "If images are attached, use them as primary context for visual/UI issues.",
    ],
    message: input.message,
    ...(isRegeneration
      ? {
          messageLabel: "Thread contents",
          preserveMessageEnd: true,
        }
      : {}),
    attachments: input.attachments,
    additionalInstructions: input.policy?.threadTitleInstructions,
  });
  const outputSchema = Schema.Struct({
    title: Schema.String,
  });

  return { prompt, outputSchema };
}

export const TranscriptTranslationOutputSchema = Schema.Struct({
  text: Schema.String,
});

export interface TranscriptTranslationPromptInput {
  text: string;
}

export function buildTranscriptTranslationPrompt(input: TranscriptTranslationPromptInput) {
  const prompt = [
    "You translate speech transcripts into faithful, concise English.",
    "Return a JSON object with key: text.",
    "Rules:",
    "- Preserve the complete meaning, intent, requirements, constraints, and tone.",
    "- Preserve code identifiers, commands, file paths, URLs, literals, and technical terms exactly.",
    "- Do not answer the transcript, add information, omit requirements, or expand its scope.",
    "- Keep the result concise without removing meaningful details.",
    "",
    "Transcript:",
    limitSection(input.text, 16_000),
  ].join("\n");

  return { prompt, outputSchema: TranscriptTranslationOutputSchema };
}

export const PromptImprovementOutputSchema = Schema.Struct({
  text: Schema.String,
});

export interface PromptImprovementPromptInput {
  text: string;
}

export function buildPromptImprovementPrompt(input: PromptImprovementPromptInput) {
  const prompt = [
    "You improve coding prompts for clarity and concision.",
    "Return a JSON object with key: text.",
    "Rules:",
    "- Keep the same language as the original prompt.",
    "- Preserve the original intent and every requirement, constraint, code identifier, command, file path, URL, literal, and technical term.",
    "- Do not add scope, requirements, assumptions, solutions, implementation details, or acceptance criteria.",
    "- Do not answer or carry out the prompt.",
    "- Improve only wording, grammar, organization, and clarity.",
    "",
    "Prompt:",
    limitSection(input.text, 16_000),
  ].join("\n");

  return { prompt, outputSchema: PromptImprovementOutputSchema };
}

// ---------------------------------------------------------------------------
// Fetch exploration planning
// ---------------------------------------------------------------------------

export const FETCH_EXPLORATION_REQUEST_MAX_CHARS = 16_000;
export const FETCH_EXPLORATION_ORIENTATION_MAX_CHARS = 24_000;
const FETCH_EXPLORATION_TRUNCATION_MARKER = "\n\n[truncated]";

export function truncateFetchExplorationContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const retainedChars = Math.max(0, maxChars - FETCH_EXPLORATION_TRUNCATION_MARKER.length);
  return `${value.slice(0, retainedChars)}${FETCH_EXPLORATION_TRUNCATION_MARKER}`;
}

export const FetchExplorationOutputSchema = Schema.Struct({
  decision: Schema.Literals(["skip", "run"]),
  workers: Schema.Array(
    Schema.Struct({
      scope: Schema.String,
      questions: Schema.Array(Schema.String),
    }),
  ),
});

export interface FetchExplorationPromptInput {
  readonly userRequest: string;
  readonly repositoryOrientation: string;
  readonly maxRecommendedWorkers: number;
}

export function buildFetchExplorationPrompt(input: FetchExplorationPromptInput) {
  const userRequest = truncateFetchExplorationContext(
    input.userRequest,
    FETCH_EXPLORATION_REQUEST_MAX_CHARS,
  );
  const repositoryOrientation = truncateFetchExplorationContext(
    input.repositoryOrientation,
    FETCH_EXPLORATION_ORIENTATION_MAX_CHARS,
  );
  const prompt = [
    "You decide whether transient repository exploration would help answer the user's request.",
    "Return a JSON object with exactly the keys: decision, workers.",
    "Each worker has exactly the keys: scope, questions.",
    "Rules:",
    "- Use decision=skip with zero workers when the request does not require repository discovery.",
    `- Use decision=run with between 1 and ${input.maxRecommendedWorkers} workers when discovery is useful.`,
    "- Every scope must be concrete, non-overlapping, and limited to repository-read-only discovery.",
    "- Every worker must have at least one concrete question.",
    "- Do not assign edits, implementation, mutating commands, external actions, or nested agents.",
    "- Use one worker for narrow work, 2-3 workers for bounded multi-area work, and 4-6 workers for broad cross-layer work.",
    "- Use a larger count only for genuinely repository-wide work with independent scopes.",
    "- Do not create duplicate, vague, observation-only, or coordination scopes.",
    "- Return only the JSON object. Do not use tools or inspect the repository yourself.",
    "",
    "Original user request:",
    userRequest,
    "",
    "Repository orientation:",
    repositoryOrientation,
  ].join("\n");

  return { prompt, outputSchema: FetchExplorationOutputSchema };
}

// ---------------------------------------------------------------------------
// Proposed-plan parallelism review
// ---------------------------------------------------------------------------

export const PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS = 64_000;
export const PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS = 16_000;

const REVIEW_CONTEXT_TRUNCATION_MARKER = "\n\n[truncated]";

export function truncatePlanParallelismReviewContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const retainedChars = Math.max(0, maxChars - REVIEW_CONTEXT_TRUNCATION_MARKER.length);
  return `${value.slice(0, retainedChars)}${REVIEW_CONTEXT_TRUNCATION_MARKER}`;
}

export const PlanParallelismReviewOutputSchema = Schema.Struct({
  recommendedSubagents: Schema.Int,
});

export interface PlanParallelismReviewPromptInput {
  readonly planMarkdown: string;
  readonly userRequest?: string | undefined;
  readonly maxSubagents: number;
}

export function buildPlanParallelismReviewPrompt(input: PlanParallelismReviewPromptInput) {
  const planMarkdown = truncatePlanParallelismReviewContext(
    input.planMarkdown,
    PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS,
  );
  const userRequest = input.userRequest
    ? truncatePlanParallelismReviewContext(
        input.userRequest,
        PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS,
      )
    : "(not available)";
  const prompt = [
    "You estimate the useful number of direct child subagents for implementing a coding plan.",
    "Return a JSON object with exactly one key: recommendedSubagents.",
    "Rules:",
    `- recommendedSubagents must be an integer between 2 and ${input.maxSubagents}.`,
    "- Prefer the highest useful parallelism supported by genuinely independent, non-overlapping workstreams.",
    "- Do not artificially stop at four when more independent workstreams exist.",
    "- Reduce the count for sequential dependencies, shared-file conflicts, or work that must be integrated before another part starts.",
    "- Ambiguity alone does not justify more subagents.",
    "- Count discovery separately only when it is a substantial, independently useful workstream.",
    "- Do not create dummy, duplicate, or observation-only roles.",
    "- Do not count the parent agent, which retains integration and final verification.",
    "- Do not execute the plan, use tools, inspect the filesystem, or modify files.",
    "- Return only the JSON object. Do not include rationale, names, tasks, or workstreams.",
    "",
    "Originating user request:",
    userRequest,
    "",
    "Proposed plan:",
    planMarkdown,
  ].join("\n");

  return { prompt, outputSchema: PlanParallelismReviewOutputSchema };
}
