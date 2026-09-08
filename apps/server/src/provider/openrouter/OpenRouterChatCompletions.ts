import * as Generated from "@effect/ai-openrouter/Generated";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  type OpenRouterHistoryItem,
  type OpenRouterReasoningDetail,
  type OpenRouterRoundEvent,
  type OpenRouterRoundRequest,
  type OpenRouterToolCall,
  type OpenRouterUsage,
} from "./OpenRouterProtocol.ts";
import { buildOpenRouterRequestPolicy } from "./OpenRouterRouting.ts";
import { decodeOpenRouterSseData, OpenRouterProtocolError } from "./OpenRouterSse.ts";

const decodeChatStreamChunk = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Generated.ChatStreamChunk),
);
const END_OF_STREAM = "\u0000t3-openrouter-chat-eof";

interface ToolCallAccumulator {
  readonly index: number;
  readonly sourceId?: string;
  readonly name: string;
  readonly arguments: string;
}

interface ChatStreamState {
  readonly assistantText: string;
  readonly reasoningText: string;
  readonly reasoningDetails: ReadonlyArray<OpenRouterReasoningDetail>;
  readonly toolCalls: ReadonlyMap<number, ToolCallAccumulator>;
  readonly model?: string;
  readonly stopReason?: string;
  readonly usage?: OpenRouterUsage;
  readonly totalCostUsd?: number;
  readonly completed: boolean;
}

const chatMessages = (request: OpenRouterRoundRequest): ReadonlyArray<unknown> => {
  const messages: Array<unknown> = [];
  if (request.instructions.trim()) {
    messages.push({ role: "system", content: request.instructions });
  }
  for (const item of request.history) {
    switch (item.type) {
      case "user":
        messages.push({ role: "user", content: item.content });
        break;
      case "tool":
        messages.push({ role: "tool", tool_call_id: item.callId, content: item.content });
        break;
      case "assistant": {
        const reasoningDetails =
          item.opaque?.protocol === "chat-completions" && item.opaque.reasoningDetails.length > 0
            ? item.opaque.reasoningDetails
            : undefined;
        messages.push({
          role: "assistant",
          content: item.content || null,
          ...(reasoningDetails !== undefined
            ? { reasoning_details: reasoningDetails }
            : item.reasoning === undefined
              ? {}
              : { reasoning: item.reasoning }),
          ...(item.toolCalls === undefined || item.toolCalls.length === 0
            ? {}
            : {
                tool_calls: item.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  type: "function",
                  function: { name: toolCall.name, arguments: toolCall.arguments },
                })),
              }),
        });
        break;
      }
    }
  }
  return messages;
};

const chatTools = (request: OpenRouterRoundRequest): ReadonlyArray<unknown> =>
  request.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      parameters: tool.parameters,
      ...(tool.strict === undefined ? {} : { strict: tool.strict }),
    },
  }));

const chatResponseFormat = (request: OpenRouterRoundRequest): unknown => {
  if (request.responseFormat === undefined) return undefined;
  return {
    type: "json_schema",
    json_schema: {
      name: request.responseFormat.name,
      schema: request.responseFormat.schema,
      ...(request.responseFormat.description === undefined
        ? {}
        : { description: request.responseFormat.description }),
      strict: request.responseFormat.strict ?? true,
    },
  };
};

export const buildOpenRouterChatCompletionRequest = Effect.fn(
  "buildOpenRouterChatCompletionRequest",
)((request: OpenRouterRoundRequest) => {
  const policy = buildOpenRouterRequestPolicy(request.settings);
  const responseFormat = chatResponseFormat(request);
  const hasTools = request.tools.length > 0;
  const body = {
    model: request.model,
    messages: chatMessages(request),
    tools: chatTools(request),
    ...(hasTools && request.toolParameters?.toolChoice ? { tool_choice: "auto" as const } : {}),
    ...(hasTools && request.toolParameters?.parallelToolCalls
      ? { parallel_tool_calls: true as const }
      : {}),
    store: false as const,
    stream: true,
    stream_options: { include_usage: true },
    provider: policy.provider,
    plugins: policy.plugins,
    ...(request.reasoningEffort === undefined
      ? {}
      : { reasoning: { effort: request.reasoningEffort } }),
    ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
  };
  return Effect.succeed(body);
});

const normalizeChatUsage = (usage: Generated.ChatUsage): OpenRouterUsage => ({
  inputTokens: usage.prompt_tokens,
  outputTokens: usage.completion_tokens,
  totalTokens: usage.total_tokens,
  ...(usage.prompt_tokens_details?.cached_tokens === undefined
    ? {}
    : { cachedInputTokens: usage.prompt_tokens_details.cached_tokens }),
  ...(usage.completion_tokens_details?.reasoning_tokens == null
    ? {}
    : { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }),
});

const updateToolCalls = (
  previous: ReadonlyMap<number, ToolCallAccumulator>,
  deltas: ReadonlyArray<Generated.ChatStreamToolCall>,
): ReadonlyMap<number, ToolCallAccumulator> => {
  if (deltas.length === 0) return previous;
  const next = new Map(previous);
  for (const delta of deltas) {
    const existing = next.get(delta.index);
    const sourceId = delta.id ?? existing?.sourceId;
    next.set(delta.index, {
      index: delta.index,
      ...(sourceId === undefined ? {} : { sourceId }),
      name: `${existing?.name ?? ""}${delta.function?.name ?? ""}`,
      arguments: `${existing?.arguments ?? ""}${delta.function?.arguments ?? ""}`,
    });
  }
  return next;
};

const completedToolCalls = (
  values: ReadonlyMap<number, ToolCallAccumulator>,
): ReadonlyArray<OpenRouterToolCall> =>
  Array.from(values.values())
    .sort((left, right) => left.index - right.index)
    .map((toolCall) => ({
      sourceId: toolCall.sourceId ?? `openrouter-tool-${toolCall.index}`,
      name: toolCall.name,
      arguments: toolCall.arguments,
    }));

const completedEvent = (state: ChatStreamState): OpenRouterRoundEvent => {
  const toolCalls = completedToolCalls(state.toolCalls);
  const historyItem: OpenRouterHistoryItem = {
    type: "assistant",
    content: state.assistantText,
    ...(state.reasoningText ? { reasoning: state.reasoningText } : {}),
    ...(toolCalls.length === 0
      ? {}
      : {
          toolCalls: toolCalls.map((toolCall) => ({
            id: toolCall.sourceId,
            name: toolCall.name,
            arguments: toolCall.arguments,
          })),
        }),
    ...(state.reasoningDetails.length === 0
      ? {}
      : {
          opaque: {
            protocol: "chat-completions",
            reasoningDetails: state.reasoningDetails,
          },
        }),
  };
  return {
    type: "completed",
    ...(state.assistantText ? { assistantText: state.assistantText } : {}),
    ...(state.reasoningText ? { reasoningText: state.reasoningText } : {}),
    toolCalls,
    historyItems: [historyItem],
    model: state.model ?? "unknown",
    ...(state.stopReason === undefined ? {} : { stopReason: state.stopReason }),
    ...(state.usage === undefined ? {} : { usage: state.usage }),
    ...(state.totalCostUsd === undefined ? {} : { totalCostUsd: state.totalCostUsd }),
  };
};

const consumeChatFrame = Effect.fn("consumeOpenRouterChatFrame")(function* (
  state: ChatStreamState,
  frame: string,
): Effect.fn.Return<
  readonly [ChatStreamState, ReadonlyArray<OpenRouterRoundEvent>],
  OpenRouterProtocolError
> {
  if (frame === END_OF_STREAM) {
    if (state.completed) return [state, []];
    return yield* new OpenRouterProtocolError({
      protocol: "chat-completions",
      message: "OpenRouter Chat Completions stream ended without a terminal event",
    });
  }
  if (frame === "[DONE]") {
    if (state.completed) return [state, []];
    const completed = { ...state, completed: true };
    return [completed, [completedEvent(completed)]];
  }
  const chunk = yield* decodeChatStreamChunk(frame, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(
      () =>
        new OpenRouterProtocolError({
          protocol: "chat-completions",
          message: "OpenRouter Chat Completions SSE frame is malformed",
        }),
    ),
  );
  if (chunk.error !== undefined) {
    return yield* new OpenRouterProtocolError({
      protocol: "chat-completions",
      message: "OpenRouter Chat Completions stream reported an upstream error",
    });
  }
  const choice = chunk.choices.find((candidate) => candidate.index === 0) ?? chunk.choices[0];
  const assistantDelta = choice?.delta.content ?? "";
  const reasoningDelta = choice?.delta.reasoning ?? "";
  const next: ChatStreamState = {
    assistantText: state.assistantText + assistantDelta,
    reasoningText: state.reasoningText + reasoningDelta,
    reasoningDetails: [...state.reasoningDetails, ...(choice?.delta.reasoning_details ?? [])],
    toolCalls: updateToolCalls(state.toolCalls, choice?.delta.tool_calls ?? []),
    model: chunk.model,
    ...(choice?.finish_reason == null
      ? state.stopReason === undefined
        ? {}
        : { stopReason: state.stopReason }
      : { stopReason: choice.finish_reason }),
    ...(chunk.usage === undefined
      ? state.usage === undefined
        ? {}
        : { usage: state.usage }
      : { usage: normalizeChatUsage(chunk.usage) }),
    ...(chunk.usage?.cost == null
      ? state.totalCostUsd === undefined
        ? {}
        : { totalCostUsd: state.totalCostUsd }
      : { totalCostUsd: chunk.usage.cost }),
    completed: false,
  };
  const events: Array<OpenRouterRoundEvent> = [];
  if (reasoningDelta)
    events.push({ type: "contentDelta", kind: "reasoning", delta: reasoningDelta });
  if (assistantDelta)
    events.push({ type: "contentDelta", kind: "assistant", delta: assistantDelta });
  return [next, events];
});

export const decodeOpenRouterChatCompletionSse = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<OpenRouterRoundEvent, E | OpenRouterProtocolError, R> =>
  decodeOpenRouterSseData("chat-completions", bytes).pipe(
    Stream.concat(Stream.succeed(END_OF_STREAM)),
    Stream.mapAccumEffect<
      ChatStreamState,
      string,
      OpenRouterRoundEvent,
      OpenRouterProtocolError,
      never
    >(
      () => ({
        assistantText: "",
        reasoningText: "",
        reasoningDetails: [],
        toolCalls: new Map(),
        completed: false,
      }),
      consumeChatFrame,
    ),
  );
