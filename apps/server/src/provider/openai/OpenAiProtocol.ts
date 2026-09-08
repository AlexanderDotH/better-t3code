import type * as Schema from "effect/Schema";

export type OpenAiJsonObject = Readonly<Record<string, Schema.Json>>;
export type OpenAiHistoryItem = OpenAiJsonObject;

export type OpenAiReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OpenAiToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface OpenAiStructuredResponseFormat {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly description?: string;
}

export interface OpenAiRoundRequest {
  readonly model: string;
  readonly instructions: string;
  readonly history: ReadonlyArray<OpenAiHistoryItem>;
  readonly tools: ReadonlyArray<OpenAiToolDefinition>;
  readonly reasoningEffort?: OpenAiReasoningEffort;
  readonly responseFormat?: OpenAiStructuredResponseFormat;
  readonly signal?: AbortSignal;
}

export interface OpenAiToolCall {
  readonly sourceId?: string;
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
}

export interface OpenAiUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly outputTokens: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
}

export type OpenAiRoundEvent =
  | {
      readonly type: "contentDelta";
      readonly kind: "assistant" | "reasoning";
      readonly sourceId?: string;
      readonly delta: string;
    }
  | {
      readonly type: "completed";
      readonly assistantText?: string;
      readonly reasoningText?: string;
      readonly model: string;
      readonly stopReason: string;
      readonly historyItems: ReadonlyArray<OpenAiHistoryItem>;
      readonly toolCalls: ReadonlyArray<OpenAiToolCall>;
      readonly usage?: OpenAiUsage;
    };

export interface OpenAiTextCompletion {
  readonly text: string;
  readonly model: string;
  readonly usage?: OpenAiUsage;
}
