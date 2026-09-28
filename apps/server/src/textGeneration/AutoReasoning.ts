import {
  CODEX_REASONING_EFFORT_OPTION_ID,
  type ChatAttachment,
  type DecisionGenerationError,
  type DecisionGenerationInput,
  type DecisionGenerationResult,
  type DecisionQuestion,
  type DecisionUsage,
  type ModelSelection,
  TextGenerationError,
} from "@t3tools/contracts";
import {
  getModelSelectionStringOptionValue,
  isAutoReasoningEnabled,
  readAutoReasoningResolution,
  selectManualReasoningEffort,
  stripAutoReasoning,
} from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { DecisionGenerationRequest } from "../decisionGeneration/DecisionGeneration.ts";

const AUTO_REASONING_CALL_MARKER = "<t3code_auto_reasoning_call>";
export const AUTO_REASONING_MAX_ESTIMATED_TOKENS = 8_000;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const AUTO_REASONING_MAX_CHARS = AUTO_REASONING_MAX_ESTIMATED_TOKENS * ESTIMATED_CHARS_PER_TOKEN;
const AUTO_REASONING_CONVERSATION_MAX_CHARS = 10_000;
const AUTO_REASONING_CURRENT_PROMPT_MAX_CHARS = 16_000;
const AUTO_REASONING_MESSAGE_MAX_CHARS = 2_000;
const AUTO_REASONING_SECTION_MAX_CHARS = 2_000;
const TRUNCATION_MARKER = "\n[truncated]";
const MIDDLE_TRUNCATION_MARKER = "\n[... middle truncated ...]\n";
export const AUTO_REASONING_DECISION_QUESTION_ID = "autoReasoning";
export const AUTO_REASONING_TIMEOUT = Duration.seconds(15);

const AUTO_REASONING_DECISION_INSTRUCTIONS = [
  "Choose the lowest adequate supported effort for the coding-agent turn in the decision state.",
  "Review privately before choosing:",
  "- Read the conversation chronologically to establish the current work state.",
  "- Split the current prompt into individual requests, bullets, and work items.",
  "- Compare each item with prior assistant outcomes. Treat only explicitly completed or verified work as done. Count only remaining or newly requested work.",
  "- Assess ambiguity, root-cause discovery, cross-layer or cross-client wiring, contracts, persistence, concurrency, security, and verification burden.",
  "- Prefer the lowest effort that can reliably satisfy the request.",
  "- Use higher effort for unresolved deep wiring, broad changes, difficult diagnosis, or high-risk work.",
  "- Do not raise effort merely because the conversation is long, the prompt is verbose, or completed work is repeated.",
  "- Do not answer or solve the user request.",
  "- Do not use tools, MCP, memory, skills, subagents, or project inspection.",
].join("\n");

const AUTO_REASONING_EFFORT_GUIDANCE: Readonly<Record<string, string>> = {
  none: "No deliberate reasoning is needed; the response can be produced directly.",
  minimal: "The remaining work is trivial, explicit, and carries negligible implementation risk.",
  low: "The work is narrow and well specified, with little diagnosis or cross-component coordination.",
  medium:
    "The work needs ordinary analysis or implementation across a small number of connected concerns.",
  high: "The work needs substantial diagnosis, multi-layer coordination, or careful verification.",
  xhigh:
    "The work is unusually complex, ambiguous, broad, or high risk and benefits from deep reasoning.",
  max: "The work demands the strongest available reasoning because several unusually difficult concerns interact.",
};

export interface AutoReasoningMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface AutoReasoningPromptInput {
  readonly userPrompt: string;
  readonly interactionMode: "default" | "plan";
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly allowedEfforts: ReadonlyArray<string>;
  readonly conversation: ReadonlyArray<AutoReasoningMessage>;
}

export interface AutoReasoningDecisionRequestInput extends AutoReasoningPromptInput {
  readonly decisionModelSelection: ModelSelection;
}

export interface AutoReasoningDiagnostic {
  readonly routerModel: {
    readonly instanceId: string;
    readonly model: string;
  } | null;
  readonly effort: string;
  readonly durationMs: number;
  readonly fallback: boolean;
  readonly usage?: DecisionUsage;
}

export interface AutoReasoningResolution {
  readonly effectiveSelection: ModelSelection;
  readonly diagnostic?: AutoReasoningDiagnostic;
}

export interface AutoReasoningActivityPayload {
  readonly autoReasoningEffort: string;
  readonly autoReasoningFallback: boolean;
  readonly autoReasoningRouterModel: AutoReasoningDiagnostic["routerModel"];
  readonly autoReasoningDurationMs: number;
  readonly autoReasoningUsage: DecisionUsage | null;
}

export type AutoReasoningDecide = (
  input: DecisionGenerationRequest,
) => Effect.Effect<DecisionGenerationResult, DecisionGenerationError>;

export const AutoReasoningOutputSchema = Schema.Struct({ effort: Schema.String });

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= TRUNCATION_MARKER.length) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= MIDDLE_TRUNCATION_MARKER.length) return value.slice(0, Math.max(0, maxChars));
  const contentChars = maxChars - MIDDLE_TRUNCATION_MARKER.length;
  const headChars = Math.ceil(contentChars / 2);
  return `${value.slice(0, headChars)}${MIDDLE_TRUNCATION_MARKER}${value.slice(-Math.floor(contentChars / 2))}`;
}

function buildAutoReasoningCriteria(allowedEfforts: ReadonlyArray<string>): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const [index, effort] of allowedEfforts.entries()) {
    const guidance =
      AUTO_REASONING_EFFORT_GUIDANCE[effort] ??
      "Use this effort only when it is the lowest supported option that can reliably complete the work.";
    criteria[effort] =
      `Rank ${index + 1} of ${allowedEfforts.length}, ordered from lowest to highest effort. ${guidance}`;
  }
  return criteria;
}

function buildAutoReasoningQuestion(allowedEfforts: ReadonlyArray<string>): DecisionQuestion {
  return {
    instructions: AUTO_REASONING_DECISION_INSTRUCTIONS,
    criteria: buildAutoReasoningCriteria(allowedEfforts),
  };
}

function formatAttachments(attachments: ReadonlyArray<ChatAttachment>): string {
  if (attachments.length === 0) return "(none)";
  return attachments
    .map((attachment) =>
      [attachment.type, attachment.name, attachment.mimeType, `${attachment.sizeBytes} bytes`].join(
        " | ",
      ),
    )
    .join("\n");
}

function formatConversation(messages: ReadonlyArray<AutoReasoningMessage>): string {
  if (messages.length === 0) return "(none)";
  const formatted = messages.map(
    (message, index) =>
      `${index + 1}. ${message.role}:\n${truncateMiddle(message.text, AUTO_REASONING_MESSAGE_MAX_CHARS)}`,
  );
  const complete = formatted.join("\n\n");
  if (complete.length <= AUTO_REASONING_CONVERSATION_MAX_CHARS) return complete;

  const origin = formatted.slice(0, 2);
  const recent: Array<string> = [];
  let usedChars = origin.reduce((total, message) => total + message.length + 2, 0);
  for (let index = formatted.length - 1; index >= origin.length; index -= 1) {
    const message = formatted[index]!;
    if (usedChars + message.length + 100 > AUTO_REASONING_CONVERSATION_MAX_CHARS) break;
    recent.unshift(message);
    usedChars += message.length + 2;
  }
  return [
    ...origin,
    `[${formatted.length - recent.length - origin.length} intermediate conversation messages omitted]`,
    ...recent,
  ].join("\n\n");
}

function formatAutoReasoningState(input: AutoReasoningPromptInput): string {
  return [
    `Interaction mode: ${input.interactionMode}`,
    "Attachment metadata:",
    truncate(formatAttachments(input.attachments), AUTO_REASONING_SECTION_MAX_CHARS),
    "Conversation before the current prompt:",
    formatConversation(input.conversation),
    "Current user prompt:",
    truncateMiddle(input.userPrompt, AUTO_REASONING_CURRENT_PROMPT_MAX_CHARS),
  ].join("\n");
}

function buildBoundedAutoReasoningDecision(input: AutoReasoningPromptInput): {
  readonly state: string;
  readonly questions: DecisionGenerationInput["questions"];
  readonly estimatedTokens: number;
} {
  const questions = {
    [AUTO_REASONING_DECISION_QUESTION_ID]: buildAutoReasoningQuestion(input.allowedEfforts),
  };
  const fixedRequestChars = JSON.stringify({ state: "", questions }).length;
  const state = truncateMiddle(
    formatAutoReasoningState(input),
    Math.max(0, AUTO_REASONING_MAX_CHARS - fixedRequestChars),
  );
  return {
    state,
    questions,
    estimatedTokens: Math.ceil(
      JSON.stringify({ state, questions }).length / ESTIMATED_CHARS_PER_TOKEN,
    ),
  };
}

export function buildAutoReasoningDecisionRequest(input: AutoReasoningDecisionRequestInput): {
  readonly request: DecisionGenerationInput;
  readonly estimatedTokens: number;
} {
  const decision = buildBoundedAutoReasoningDecision(input);
  return {
    request: {
      modelSelection: stripAutoReasoning(input.decisionModelSelection),
      state: decision.state,
      questions: decision.questions,
    },
    estimatedTokens: decision.estimatedTokens,
  };
}

export function buildAutoReasoningPrompt(input: AutoReasoningPromptInput): {
  readonly prompt: string;
  readonly outputSchema: typeof AutoReasoningOutputSchema;
  readonly estimatedTokens: number;
} {
  const decision = buildBoundedAutoReasoningDecision(input);
  const question = decision.questions[AUTO_REASONING_DECISION_QUESTION_ID]!;
  const prefix = [
    AUTO_REASONING_CALL_MARKER,
    question.instructions,
    "Return a JSON object with exactly one key: effort.",
    "Effort rules:",
    "- effort must exactly match one allowed effort.",
    `Allowed efforts, lowest to highest: ${truncate(
      input.allowedEfforts.join(", "),
      AUTO_REASONING_SECTION_MAX_CHARS,
    )}`,
    "Decision state:",
    decision.state,
  ].join("\n");
  const prompt = truncateMiddle(prefix, AUTO_REASONING_MAX_CHARS);
  return {
    prompt,
    outputSchema: AutoReasoningOutputSchema,
    estimatedTokens: Math.ceil(prompt.length / ESTIMATED_CHARS_PER_TOKEN),
  };
}

export function validateAutoReasoningDecision(
  allowedEfforts: ReadonlyArray<string>,
  decision: { readonly effort: string },
): Effect.Effect<{ readonly effort: string }, TextGenerationError> {
  if (allowedEfforts.includes(decision.effort)) return Effect.succeed(decision);
  return Effect.fail(
    new TextGenerationError({
      operation: "decideAutoReasoning",
      detail: "The Auto Reasoning result was not a supported live effort.",
    }),
  );
}

export function resolveAutoReasoningDecisionModelSelection(input: {
  readonly autoReasoningModelSelection: ModelSelection | null | undefined;
  readonly textGenerationModelSelection: ModelSelection;
}): ModelSelection {
  return stripAutoReasoning(
    input.autoReasoningModelSelection ?? input.textGenerationModelSelection,
  );
}

function readValidAutoReasoningEffort(
  allowedEfforts: ReadonlyArray<string>,
  result: DecisionGenerationResult | undefined,
): string | undefined {
  const effort = result?.answers[AUTO_REASONING_DECISION_QUESTION_ID]?.choice;
  return effort !== undefined && allowedEfforts.includes(effort) ? effort : undefined;
}

export function applyAutoReasoningDecisionResult(input: {
  readonly agentModelSelection: ModelSelection;
  readonly decisionModelSelection: ModelSelection;
  readonly allowedEfforts: ReadonlyArray<string>;
  readonly result?: DecisionGenerationResult;
  readonly durationMs: number;
}): AutoReasoningResolution {
  const effectiveFallback = stripAutoReasoning(input.agentModelSelection);
  const concreteFallback = getModelSelectionStringOptionValue(
    input.agentModelSelection,
    CODEX_REASONING_EFFORT_OPTION_ID,
  );
  if (concreteFallback === undefined) return { effectiveSelection: effectiveFallback };

  const chosenEffort = readValidAutoReasoningEffort(input.allowedEfforts, input.result);
  const acceptedResult = chosenEffort === undefined ? undefined : input.result;
  const effort = chosenEffort ?? concreteFallback;
  const decisionModelSelection = stripAutoReasoning(input.decisionModelSelection);
  return {
    effectiveSelection: selectManualReasoningEffort(effectiveFallback, effort),
    diagnostic: {
      routerModel: {
        instanceId: String(decisionModelSelection.instanceId),
        model: acceptedResult?.model ?? decisionModelSelection.model,
      },
      effort,
      durationMs: Math.max(0, input.durationMs),
      fallback: chosenEffort === undefined,
      ...(acceptedResult?.usage !== undefined ? { usage: acceptedResult.usage } : {}),
    },
  };
}

export function buildAutoReasoningActivityPayload(
  diagnostic: AutoReasoningDiagnostic,
): AutoReasoningActivityPayload {
  return {
    autoReasoningEffort: diagnostic.effort,
    autoReasoningFallback: diagnostic.fallback,
    autoReasoningRouterModel: diagnostic.routerModel,
    autoReasoningDurationMs: diagnostic.durationMs,
    autoReasoningUsage: diagnostic.usage ?? null,
  };
}

export function reuseAutoReasoningForRetry(input: {
  readonly agentModelSelection: ModelSelection;
  readonly activities: ReadonlyArray<{
    readonly kind: string;
    readonly payload: unknown;
    readonly turnId?: string | null;
  }>;
  readonly retryOfTurnId?: string;
}): AutoReasoningResolution | undefined {
  if (!isAutoReasoningEnabled(input.agentModelSelection)) return undefined;

  const previous =
    input.retryOfTurnId === undefined
      ? null
      : readAutoReasoningResolution(input.activities, input.retryOfTurnId);
  const effort =
    previous?.effectiveEffort ??
    getModelSelectionStringOptionValue(input.agentModelSelection, CODEX_REASONING_EFFORT_OPTION_ID);
  if (effort === undefined) {
    return { effectiveSelection: stripAutoReasoning(input.agentModelSelection) };
  }

  return {
    effectiveSelection: selectManualReasoningEffort(input.agentModelSelection, effort),
    diagnostic: {
      routerModel: null,
      effort,
      durationMs: 0,
      fallback: previous?.fallback ?? true,
    },
  };
}

export const resolveAutoReasoningDecision = Effect.fn("resolveAutoReasoningDecision")(function* (
  input: AutoReasoningDecisionRequestInput & {
    readonly cwd: string;
    readonly agentModelSelection: ModelSelection;
  },
  decide: AutoReasoningDecide,
) {
  if (!isAutoReasoningEnabled(input.agentModelSelection)) return undefined;

  const concreteFallback = getModelSelectionStringOptionValue(
    input.agentModelSelection,
    CODEX_REASONING_EFFORT_OPTION_ID,
  );
  if (concreteFallback === undefined) {
    return { effectiveSelection: stripAutoReasoning(input.agentModelSelection) };
  }

  const startedAt = yield* Clock.currentTimeMillis;
  const decisionExit =
    input.allowedEfforts.length === 0
      ? undefined
      : yield* Effect.exit(
          decide({
            cwd: input.cwd,
            ...buildAutoReasoningDecisionRequest(input).request,
          }).pipe(Effect.timeoutOption(AUTO_REASONING_TIMEOUT)),
        );
  if (
    decisionExit !== undefined &&
    Exit.isFailure(decisionExit) &&
    Cause.hasInterruptsOnly(decisionExit.cause)
  ) {
    return yield* Effect.interrupt;
  }

  const result =
    decisionExit !== undefined && Exit.isSuccess(decisionExit) && Option.isSome(decisionExit.value)
      ? decisionExit.value.value
      : undefined;
  return applyAutoReasoningDecisionResult({
    agentModelSelection: input.agentModelSelection,
    decisionModelSelection: input.decisionModelSelection,
    allowedEfforts: input.allowedEfforts,
    ...(result !== undefined ? { result } : {}),
    durationMs: (yield* Clock.currentTimeMillis) - startedAt,
  });
});
