import type * as Generated from "@effect/ai-openrouter/Generated";
import type { OpenRouterSettings } from "@t3tools/contracts";
import type * as Schema from "effect/Schema";

export type OpenRouterReasoningDetail = typeof Generated.ReasoningDetailUnion.Encoded;
export type OpenRouterResponseOutputItem = Readonly<Record<string, Schema.Json>>;

export interface OpenRouterToolCall {
  readonly sourceId: string;
  readonly name: string;
  readonly arguments: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OpenRouterToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly strict?: boolean;
}

export type OpenRouterHistoryOpaque =
  | {
      readonly protocol: "chat-completions";
      readonly reasoningDetails: ReadonlyArray<OpenRouterReasoningDetail>;
    }
  | {
      readonly protocol: "responses";
      readonly outputItems: ReadonlyArray<OpenRouterResponseOutputItem>;
    };

export type OpenRouterHistoryItem =
  | { readonly type: "user"; readonly content: string }
  | {
      readonly type: "assistant";
      readonly content: string;
      readonly reasoning?: string;
      readonly toolCalls?: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly arguments: string;
      }>;
      readonly opaque?: OpenRouterHistoryOpaque;
    }
  | {
      readonly type: "tool";
      readonly callId: string;
      readonly content: string;
      readonly name?: string;
    };

export type OpenRouterReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface OpenRouterJsonSchemaResponseFormat {
  readonly type: "json-schema";
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly description?: string;
  readonly strict?: boolean;
}

export interface OpenRouterRoundRequest {
  readonly model: string;
  readonly instructions: string;
  readonly history: ReadonlyArray<OpenRouterHistoryItem>;
  readonly tools: ReadonlyArray<OpenRouterToolDefinition>;
  readonly toolParameters?: {
    readonly toolChoice: boolean;
    readonly parallelToolCalls: boolean;
  };
  readonly settings: OpenRouterSettings;
  readonly reasoningEffort?: OpenRouterReasoningEffort;
  readonly responseFormat?: OpenRouterJsonSchemaResponseFormat;
  readonly signal?: AbortSignal;
}

export interface OpenRouterUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
}

export interface OpenRouterRoundResult {
  readonly assistantText?: string;
  readonly reasoningText?: string;
  readonly toolCalls: ReadonlyArray<OpenRouterToolCall>;
  readonly historyItems: ReadonlyArray<OpenRouterHistoryItem>;
  readonly model: string;
  readonly stopReason?: string;
  readonly usage?: OpenRouterUsage;
  readonly totalCostUsd?: number;
}

export type OpenRouterRoundEvent =
  | {
      readonly type: "contentDelta";
      readonly kind: "assistant" | "reasoning";
      readonly delta: string;
      readonly sourceId?: string;
    }
  | ({ readonly type: "completed" } & OpenRouterRoundResult)
  | { readonly type: "failed"; readonly message: string };

export interface OpenRouterTextCompletion {
  readonly text: string;
  readonly model: string;
  readonly usage?: OpenRouterUsage;
  readonly totalCostUsd?: number;
}
