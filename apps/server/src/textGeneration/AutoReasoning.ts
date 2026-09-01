import { type ChatAttachment, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const AUTO_REASONING_CALL_MARKER = "<t3code_auto_reasoning_call>";
export const AUTO_REASONING_MAX_ESTIMATED_TOKENS = 8_000;
const AUTO_REASONING_MAX_CHARS = AUTO_REASONING_MAX_ESTIMATED_TOKENS * 4;
const AUTO_REASONING_CONVERSATION_MAX_CHARS = 10_000;
const AUTO_REASONING_CURRENT_PROMPT_MAX_CHARS = 16_000;
const AUTO_REASONING_MESSAGE_MAX_CHARS = 2_000;
const TRUNCATION_MARKER = "\n[truncated]";
const MIDDLE_TRUNCATION_MARKER = "\n[... middle truncated ...]\n";

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

export const AutoReasoningOutputSchema = Schema.Struct({ effort: Schema.String });

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= TRUNCATION_MARKER.length) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const contentChars = maxChars - MIDDLE_TRUNCATION_MARKER.length;
  const headChars = Math.ceil(contentChars / 2);
  return `${value.slice(0, headChars)}${MIDDLE_TRUNCATION_MARKER}${value.slice(-Math.floor(contentChars / 2))}`;
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

export function buildAutoReasoningPrompt(input: AutoReasoningPromptInput): {
  readonly prompt: string;
  readonly outputSchema: typeof AutoReasoningOutputSchema;
  readonly estimatedTokens: number;
} {
  const prefix = [
    AUTO_REASONING_CALL_MARKER,
    "Act as a fast preflight planner and choose the lowest adequate supported effort for the coding-agent turn below.",
    "Return a JSON object with exactly one key: effort.",
    "Review privately before choosing:",
    "- Read the conversation chronologically to establish the current work state.",
    "- Split the current prompt into individual requests, bullets, and work items.",
    "- Compare each item with prior assistant outcomes. Treat only explicitly completed or verified work as done. Count only remaining or newly requested work.",
    "- Assess ambiguity, root-cause discovery, cross-layer or cross-client wiring, contracts, persistence, concurrency, security, and verification burden.",
    "Effort rules:",
    "- effort must exactly match one allowed effort.",
    "- Prefer the lowest effort that can reliably satisfy the request.",
    "- Use higher effort for unresolved deep wiring, broad changes, difficult diagnosis, or high-risk work.",
    "- Do not raise effort merely because the conversation is long, the prompt is verbose, or completed work is repeated.",
    "- Do not answer or solve the user request.",
    "- Do not use tools, MCP, memory, skills, subagents, or project inspection.",
    `Allowed efforts, lowest to highest: ${truncate(input.allowedEfforts.join(", "), 2_000)}`,
    `Interaction mode: ${input.interactionMode}`,
    "Attachment metadata:",
    truncate(formatAttachments(input.attachments), 2_000),
    "Conversation before the current prompt:",
    formatConversation(input.conversation),
    "Current user prompt:",
    truncateMiddle(input.userPrompt, AUTO_REASONING_CURRENT_PROMPT_MAX_CHARS),
  ].join("\n");
  const prompt = truncateMiddle(prefix, AUTO_REASONING_MAX_CHARS);
  return {
    prompt,
    outputSchema: AutoReasoningOutputSchema,
    estimatedTokens: Math.ceil(prompt.length / 4),
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
