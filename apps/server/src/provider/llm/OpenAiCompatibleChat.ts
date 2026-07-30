export type OpenAiReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface OpenAiCompatibleBodyPolicy {
  readonly allowOpenRouterReasoning: boolean;
  readonly allowOpenRouterContextCompression: boolean;
}

export const STRICT_OPENAI_BODY_POLICY: OpenAiCompatibleBodyPolicy = {
  allowOpenRouterReasoning: false,
  allowOpenRouterContextCompression: false,
};

export const NVIDIA_NIM_BODY_POLICY: OpenAiCompatibleBodyPolicy = {
  allowOpenRouterReasoning: true,
  allowOpenRouterContextCompression: false,
};

export const OPENROUTER_BODY_POLICY: OpenAiCompatibleBodyPolicy = {
  allowOpenRouterReasoning: true,
  allowOpenRouterContextCompression: true,
};

export type OpenRouterReasoningApplyMode = "effort" | "max_tokens";

export type OpenRouterReasoningApplyResult =
  | {
      readonly attached: true;
      readonly mode: "effort";
      readonly effort: OpenAiReasoningEffort;
    }
  | {
      readonly attached: true;
      readonly mode: "max_tokens";
      readonly maxTokens: number;
      readonly completionMaxTokens: number;
    };

export type OpenRouterReasoningSnapshot =
  | {
      readonly provider: "openrouter";
      readonly reasoningAttached: false;
      readonly mode: "none";
    }
  | {
      readonly provider: "openrouter";
      readonly reasoningAttached: true;
      readonly mode: "effort";
      readonly effort: OpenAiReasoningEffort;
    }
  | {
      readonly provider: "openrouter";
      readonly reasoningAttached: true;
      readonly mode: "max_tokens";
      readonly maxTokens: number;
      readonly completionMaxTokens: number;
    };

export interface OpenRouterReasoningRequest {
  readonly storedModelId: string;
  readonly effort: OpenAiReasoningEffort;
  readonly enabled?: boolean | undefined;
}

export interface ApplyOpenAiCompletionBodyPoliciesInput {
  readonly body: Record<string, unknown>;
  readonly bodyPolicy: OpenAiCompatibleBodyPolicy;
  readonly contextCompressionEnabled: boolean;
  readonly reasoning?: OpenRouterReasoningRequest | undefined;
}

const ANTHROPIC_REASONING_BUDGET_BY_EFFORT = {
  minimal: 2048,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
} satisfies Record<OpenAiReasoningEffort, number>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isAnthropicOpenRouterModelId(storedModelId: string): boolean {
  return storedModelId.trim().toLowerCase().startsWith("anthropic/");
}

export function anthropicReasoningBudgetTokensForEffort(effort: OpenAiReasoningEffort): number {
  return clamp(ANTHROPIC_REASONING_BUDGET_BY_EFFORT[effort], 1024, 128_000);
}

export function applyOpenRouterUnifiedReasoning(
  body: Record<string, unknown>,
  storedModelId: string,
  effort: OpenAiReasoningEffort,
): OpenRouterReasoningApplyResult {
  if (!isAnthropicOpenRouterModelId(storedModelId)) {
    body.reasoning = { effort };
    return { attached: true, mode: "effort", effort };
  }

  const maxTokens = anthropicReasoningBudgetTokensForEffort(effort);
  const completionMaxTokens = clamp(maxTokens + 65_536, maxTokens + 1, 200_000);
  body.reasoning = { max_tokens: maxTokens };
  body.max_tokens = completionMaxTokens;
  return {
    attached: true,
    mode: "max_tokens",
    maxTokens,
    completionMaxTokens,
  };
}

export function openRouterReasoningApplyResultToSnapshot(
  applied: OpenRouterReasoningApplyResult,
): OpenRouterReasoningSnapshot {
  if (applied.mode === "effort") {
    return {
      provider: "openrouter",
      reasoningAttached: true,
      mode: "effort",
      effort: applied.effort,
    };
  }

  return {
    provider: "openrouter",
    reasoningAttached: true,
    mode: "max_tokens",
    maxTokens: applied.maxTokens,
    completionMaxTokens: applied.completionMaxTokens,
  };
}

export function emptyOpenRouterReasoningSnapshot(): OpenRouterReasoningSnapshot {
  return { provider: "openrouter", reasoningAttached: false, mode: "none" };
}

export function mergeOpenRouterContextCompressionPlugin(
  body: Record<string, unknown>,
  enabled: boolean,
): void {
  if (!enabled) return;

  const existingPlugins = Array.isArray(body.plugins) ? body.plugins : [];
  const hasContextCompression = existingPlugins.some(isContextCompressionPlugin);
  if (hasContextCompression) {
    body.plugins = existingPlugins;
    return;
  }

  body.plugins = [...existingPlugins, { id: "context-compression" }];
}

export function applyOpenAiCompletionBodyPolicies({
  body,
  bodyPolicy,
  contextCompressionEnabled,
  reasoning,
}: ApplyOpenAiCompletionBodyPoliciesInput): OpenRouterReasoningSnapshot {
  const reasoningSnapshot = applyOpenRouterReasoningBody(body, bodyPolicy, reasoning);
  mergeOpenRouterContextCompressionPlugin(
    body,
    bodyPolicy.allowOpenRouterContextCompression && contextCompressionEnabled,
  );
  return reasoningSnapshot;
}

function applyOpenRouterReasoningBody(
  body: Record<string, unknown>,
  bodyPolicy: OpenAiCompatibleBodyPolicy,
  reasoning: OpenRouterReasoningRequest | undefined,
): OpenRouterReasoningSnapshot {
  if (!bodyPolicy.allowOpenRouterReasoning || !reasoning || reasoning.enabled === false) {
    return emptyOpenRouterReasoningSnapshot();
  }

  const applied = applyOpenRouterUnifiedReasoning(body, reasoning.storedModelId, reasoning.effort);
  return openRouterReasoningApplyResultToSnapshot(applied);
}

function isContextCompressionPlugin(plugin: unknown): boolean {
  if (!plugin || typeof plugin !== "object") return false;
  return (plugin as { readonly id?: unknown }).id === "context-compression";
}

export type OpenAiUserContentPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image_url";
      readonly image_url: { readonly url: string; readonly detail?: "auto" | "low" | "high" };
    }
  | {
      readonly type: "file";
      readonly file: { readonly filename: string; readonly file_data: string };
    };

export type OpenAiMessageContent = string | ReadonlyArray<OpenAiUserContentPart>;

export type OpenAiMappedChatMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user" | "assistant"; readonly content: OpenAiMessageContent };

export type OpenAiChatCompletionsMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: OpenAiMessageContent }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly tool_calls?: ReadonlyArray<OpenAiToolCall>;
      readonly reasoning_content?: string | null;
    }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

export interface OpenAiToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface OpenAiCompatibleTextPart {
  readonly text: string;
}

export interface OpenAiCompatibleInlineDataPart {
  readonly inlineData: {
    readonly mimeType: string;
    readonly data: string;
    readonly filename?: string | undefined;
  };
}

export type OpenAiCompatibleMessagePart = OpenAiCompatibleTextPart | OpenAiCompatibleInlineDataPart;

export interface OpenAiCompatibleProviderMessage {
  readonly role: "user" | "model" | "assistant";
  readonly parts: ReadonlyArray<OpenAiCompatibleMessagePart>;
}

export function partsToOpenAiContent(
  parts: ReadonlyArray<OpenAiCompatibleMessagePart>,
): OpenAiMessageContent {
  const onlyPart = parts[0];
  if (parts.length === 1 && onlyPart && isTextPart(onlyPart)) {
    return onlyPart.text;
  }

  const contentParts: OpenAiUserContentPart[] = [];
  for (const part of parts) {
    if (isTextPart(part)) {
      if (part.text.length > 0) {
        contentParts.push({ type: "text", text: part.text });
      }
      continue;
    }

    contentParts.push(inlineDataToOpenAiContentPart(part.inlineData));
  }
  return contentParts;
}

export function toOpenAiMessages(
  systemPrompt: string,
  messages: ReadonlyArray<OpenAiCompatibleProviderMessage>,
): ReadonlyArray<OpenAiMappedChatMessage> {
  const out: OpenAiMappedChatMessage[] = [];
  if (systemPrompt.trim().length > 0) {
    out.push({ role: "system", content: systemPrompt });
  }

  for (const message of messages) {
    out.push({
      role: message.role === "user" ? "user" : "assistant",
      content: partsToOpenAiContent(message.parts),
    });
  }
  return out;
}

function isTextPart(part: OpenAiCompatibleMessagePart): part is OpenAiCompatibleTextPart {
  return "text" in part && typeof part.text === "string";
}

function inlineDataToOpenAiContentPart(
  inlineData: OpenAiCompatibleInlineDataPart["inlineData"],
): OpenAiUserContentPart {
  const mimeType = inlineData.mimeType.trim();
  const normalizedMimeType = normalizeMimeType(mimeType);
  const dataUrl = `data:${mimeType};base64,${inlineData.data}`;

  if (normalizedMimeType === "application/pdf") {
    return {
      type: "file",
      file: {
        filename: inlineData.filename?.trim() || "document.pdf",
        file_data: dataUrl,
      },
    };
  }

  return { type: "image_url", image_url: { url: dataUrl } };
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

export type OpenAiSseDataLine =
  | { readonly type: "ignored"; readonly line: string }
  | { readonly type: "done" }
  | { readonly type: "json"; readonly data: string; readonly value: unknown }
  | { readonly type: "malformed"; readonly data: string };

export function parseOpenAiSseDataLine(line: string): OpenAiSseDataLine {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return { type: "ignored", line };
  }

  const data = trimmed.slice(5).trim();
  if (data === "[DONE]") {
    return { type: "done" };
  }

  try {
    return { type: "json", data, value: JSON.parse(data) as unknown };
  } catch {
    return { type: "malformed", data };
  }
}

export function extractOpenAiTextContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(extractTextFromContentPart).join("");
  }
  return extractTextFromContentPart(content);
}

export function extractOpenRouterReasoningPayload(
  source: Readonly<Record<string, unknown>> | undefined,
): string {
  if (!source) return "";

  const reasoning = pickNonEmptyString(source.reasoning);
  if (reasoning) return reasoning;

  const reasoningContent = pickNonEmptyString(source.reasoning_content);
  if (reasoningContent) return reasoningContent;

  const reasoningDetails = extractReasoningDetails(source.reasoning_details);
  if (reasoningDetails) return reasoningDetails;

  return extractReasoningContentParts(source.content);
}

function extractReasoningDetails(reasoningDetails: unknown): string {
  if (!Array.isArray(reasoningDetails)) return "";

  return reasoningDetails
    .map((entry) => {
      if (typeof entry === "string") return entry;
      return extractTextProperty(entry);
    })
    .join("");
}

function extractReasoningContentParts(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Readonly<Record<string, unknown>>;
      if (record.type !== "reasoning") return "";
      return pickNonEmptyString(record.text);
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

function extractTextFromContentPart(part: unknown): string {
  if (part == null) return "";
  if (typeof part === "string") return part;
  return extractTextProperty(part);
}

function extractTextProperty(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return pickNonEmptyString((value as Readonly<Record<string, unknown>>).text);
}

function pickNonEmptyString(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}
