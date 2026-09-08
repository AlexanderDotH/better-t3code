export interface DeepThinkingMessagePart {
  readonly text?: string | null | undefined;
}

export interface DeepThinkingMessage {
  readonly role: string;
  readonly parts?: ReadonlyArray<DeepThinkingMessagePart | string> | undefined;
}

export interface DeepThinkingAccumulatedData {
  readonly topics: ReadonlyArray<string>;
  readonly stepResults: ReadonlyArray<Record<string, unknown>>;
  readonly refinements: ReadonlyArray<Record<string, unknown>>;
}

export interface DeepThinkingRequestPolicyOptions {
  readonly stepCount: number;
  readonly refinementPasses: number;
  readonly parallelEnabled: boolean;
  readonly parallelBatchSize: number;
  readonly forceParallelForDurableProviders: boolean;
}

export const DEEP_THINKING_DECOMPOSE_SCHEMA_DESC = '{ "steps": ["topic 1", "topic 2", ...] }';
export const DEEP_THINKING_STEP_SCHEMA_DESC =
  '{ "thinking": "...", "considerations": ["..."], "openQuestions": ["..."] }';
export const DEEP_THINKING_REFINE_SCHEMA_DESC =
  '{ "sufficient": true|false, "gaps": ["..."], "adjustments": ["..."] }';

export function buildDeepThinkingRequestAppendix(
  options: DeepThinkingRequestPolicyOptions,
): string {
  const refinementLabel = options.refinementPasses === 1 ? "pass" : "passes";
  const parallelBatchSize = Math.min(options.stepCount, options.parallelBatchSize);
  const parallelGuidance = options.parallelEnabled
    ? `- Organize independent considerations in private batches of at most ${parallelBatchSize}.${
        options.forceParallelForDurableProviders
          ? " Use that bounded organization when the already-selected runtime supports it durably."
          : ""
      }`
    : "- Work through the considerations sequentially.";

  return `### Deep thinking
- Before acting or answering, privately examine at most ${options.stepCount} distinct considerations that materially affect the request.
- Perform at most ${options.refinementPasses} bounded self-review ${refinementLabel} before the final response.
${parallelGuidance}
- Do not reveal hidden chain-of-thought. Present only conclusions and concise rationale useful to the user.
- Do not start extra provider calls, tools, or agents solely to satisfy this mode.`;
}

function readPartText(part: DeepThinkingMessagePart | string): string {
  if (typeof part === "string") return part.trim();
  const value = Object.hasOwn(part, "text") ? part.text : undefined;
  return typeof value === "string" ? value.trim() : "";
}

export function extractTaskTextFromMessages(messages: ReadonlyArray<DeepThinkingMessage>): string {
  const userMessages = messages.filter((message) => message.role === "user");
  const lastUserMessage = userMessages[userMessages.length - 1];
  if (!lastUserMessage?.parts?.length) return "";

  return lastUserMessage.parts.map(readPartText).filter(Boolean).join("\n");
}

export function buildDecomposeSystemPrompt(stepCount: number): string {
  return (
    "Before answering, list exactly the distinct things you need to think through for this task.\n" +
    "Return one JSON object only - no markdown fences, no prose outside JSON.\n" +
    `Schema: ${DEEP_THINKING_DECOMPOSE_SCHEMA_DESC}\n` +
    `The "steps" array must contain exactly ${stepCount} non-empty strings - each one concrete topic to think about.`
  );
}

export function buildDecomposeUserPrompt(taskText: string): string {
  return (
    `Task:\n${taskText}\n\n` +
    "What are the distinct things you need to think through before answering well? " +
    "Return exactly the requested number of short topic strings."
  );
}

export function buildDecomposeRepairUserPrompt(
  taskText: string,
  stepCount: number,
  error: string,
  raw: string,
): string {
  return (
    `Task:\n${taskText}\n\nYour previous answer was invalid.\nError: ${error}\n\n` +
    `Return valid JSON with exactly ${stepCount} topic strings in "steps".\nPrevious (truncated):\n${raw.slice(0, 8000)}`
  );
}

export function buildStepWorkSystemPrompt(): string {
  return (
    "Work through one thinking topic for a task - explore it in depth before a final answer is written.\n" +
    "Return one JSON object only - no markdown fences, no prose outside JSON.\n" +
    `Schema: ${DEEP_THINKING_STEP_SCHEMA_DESC}\n` +
    '"thinking" must be a non-empty string.'
  );
}

export function buildStepWorkUserPrompt(
  taskText: string,
  topic: string,
  stepIndex: number,
  totalSteps: number,
  priorTopics: ReadonlyArray<string>,
): string {
  const priorBlock =
    priorTopics.length > 0
      ? `\nAlready covered:\n${priorTopics.map((priorTopic, index) => `${index + 1}. ${priorTopic}`).join("\n")}\n`
      : "";

  return (
    `Task:\n${taskText}\n\n` +
    `Think through step ${stepIndex + 1} of ${totalSteps}:\n${topic}\n` +
    `${priorBlock}\n` +
    "Focus only on this topic. Do not draft the final user-facing answer yet."
  );
}

export function buildStepWorkRepairUserPrompt(
  taskText: string,
  topic: string,
  error: string,
  raw: string,
): string {
  return (
    `Task:\n${taskText}\n\nTopic:\n${topic}\n\nPrevious answer invalid.\nError: ${error}\n\n` +
    `Return valid JSON.\nPrevious (truncated):\n${raw.slice(0, 8000)}`
  );
}

export function buildRefinementSystemPrompt(): string {
  return (
    "You judge whether accumulated thinking is sufficient to produce a high-quality final answer.\n" +
    "Return one JSON object only - no markdown fences.\n" +
    `Schema: ${DEEP_THINKING_REFINE_SCHEMA_DESC}`
  );
}

export function buildRefinementUserPrompt(
  taskText: string,
  data: DeepThinkingAccumulatedData,
): string {
  return (
    `Task:\n${taskText}\n\nAccumulated thinking:\n${JSON.stringify(data, null, 2)}\n\n` +
    "Is this thinking sufficient? List gaps and adjustments if not."
  );
}

export function buildAnswerSystemPrompt(originalSystem: string): string {
  return (
    `${originalSystem}\n\n` +
    "### Deep thinking\n" +
    "You receive accumulated thinking appended to the user message.\n" +
    "Produce the final answer that satisfies ALL rules in this system prompt (format, fences, tool use, etc.).\n" +
    "Do not mention the deep-thinking process unless the user asked for it."
  );
}

export function buildAnswerUserPrompt(
  taskText: string,
  data: DeepThinkingAccumulatedData,
  originalUser: string,
): string {
  return (
    `### Original request\n${originalUser || taskText}\n\n` +
    `### Accumulated thinking\n${JSON.stringify(data, null, 2)}\n\n` +
    "Based on the thinking above, produce the final answer to the original request."
  );
}

export function buildAccumulatedDeepThinkingData(
  topics: ReadonlyArray<string>,
  stepResults: ReadonlyArray<Record<string, unknown>>,
  refinements: ReadonlyArray<Record<string, unknown>>,
): DeepThinkingAccumulatedData {
  return { topics, stepResults, refinements };
}
