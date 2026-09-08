import * as Schema from "effect/Schema";

import type {
  NativeProviderRoundEvent,
  NativeProviderToolCall,
} from "../nativeHarness/NativeProviderTypes.ts";
import type { OpenAiHistoryItem, OpenAiRoundEvent } from "./OpenAiProtocol.ts";

const decodeToolArguments = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

export type OpenAiAdapterToolCall = NativeProviderToolCall<{ readonly callId: string }>;

export function normalizeOpenAiAdapterRoundEvent(
  event: OpenAiRoundEvent,
): NativeProviderRoundEvent<OpenAiHistoryItem, OpenAiAdapterToolCall> {
  if (event.type !== "completed") return event;
  const toolCalls: Array<OpenAiAdapterToolCall> = [];
  for (const toolCall of event.toolCalls) {
    let args: Readonly<Record<string, unknown>>;
    try {
      args = decodeToolArguments(toolCall.arguments);
    } catch {
      return {
        type: "failed",
        message: `OpenAI returned malformed arguments for tool '${toolCall.name}'.`,
      };
    }
    toolCalls.push({
      ...(toolCall.sourceId === undefined ? {} : { sourceId: toolCall.sourceId }),
      name: toolCall.name,
      args,
      metadata: { callId: toolCall.callId },
    });
  }
  return {
    type: "completed",
    historyItems: event.historyItems,
    toolCalls,
    ...(event.assistantText === undefined ? {} : { assistantText: event.assistantText }),
    ...(event.reasoningText === undefined ? {} : { reasoningText: event.reasoningText }),
    stopReason: event.stopReason,
    ...(event.usage === undefined
      ? {}
      : {
          usage: {
            usedTokens: event.usage.totalTokens,
            inputTokens: event.usage.inputTokens,
            cachedInputTokens: event.usage.cachedInputTokens ?? 0,
            outputTokens: event.usage.outputTokens,
            reasoningOutputTokens: event.usage.reasoningTokens ?? 0,
            raw: event.usage,
          },
        }),
  };
}
