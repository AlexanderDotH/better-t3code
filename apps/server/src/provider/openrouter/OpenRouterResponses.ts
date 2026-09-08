import * as Generated from "@effect/ai-openrouter/Generated";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  type OpenRouterHistoryItem,
  type OpenRouterResponseOutputItem,
  type OpenRouterRoundEvent,
  type OpenRouterRoundRequest,
  type OpenRouterToolCall,
  type OpenRouterUsage,
} from "./OpenRouterProtocol.ts";
import { buildOpenRouterRequestPolicy } from "./OpenRouterRouting.ts";
import { decodeOpenRouterSseData, OpenRouterProtocolError } from "./OpenRouterSse.ts";

// The generated module publishes this union through the type-only `Schema.Schema<T>`
// view, which erases its encoded and service channels. Its generated AST is fully
// synchronous, so rebuild the codec view before composing it with the JSON codec.
const ResponseStreamEvents = Schema.make<Schema.Codec<Generated.StreamEvents>>(
  Generated.StreamEvents.ast,
);
const decodeResponseStreamEvent = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ResponseStreamEvents),
  { onExcessProperty: "ignore" },
);
const END_OF_STREAM = "\u0000t3-openrouter-responses-eof";

interface ResponsesStreamState {
  readonly assistantText: string;
  readonly reasoningText: string;
  readonly completed: boolean;
}

const responseInput = (request: OpenRouterRoundRequest): ReadonlyArray<unknown> => {
  const input: Array<unknown> = [];
  for (const item of request.history) {
    switch (item.type) {
      case "user":
        input.push({ type: "message", role: "user", content: item.content });
        break;
      case "tool":
        input.push({ type: "function_call_output", call_id: item.callId, output: item.content });
        break;
      case "assistant":
        if (item.opaque?.protocol === "responses") {
          input.push(...item.opaque.outputItems);
          break;
        }
        input.push({ type: "message", role: "assistant", content: item.content });
        for (const toolCall of item.toolCalls ?? []) {
          input.push({
            type: "function_call",
            call_id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          });
        }
        break;
    }
  }
  return input;
};

const responseTools = (request: OpenRouterRoundRequest): ReadonlyArray<unknown> =>
  request.tools.map((tool) => ({
    type: "function",
    name: tool.name,
    parameters: tool.parameters,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    ...(tool.strict === undefined ? {} : { strict: tool.strict }),
  }));

const responseTextConfig = (request: OpenRouterRoundRequest): unknown => {
  if (request.responseFormat === undefined) return undefined;
  return {
    format: {
      type: "json_schema",
      name: request.responseFormat.name,
      schema: request.responseFormat.schema,
      ...(request.responseFormat.description === undefined
        ? {}
        : { description: request.responseFormat.description }),
      strict: request.responseFormat.strict ?? true,
    },
  };
};

export const buildOpenRouterResponsesRequest = Effect.fn("buildOpenRouterResponsesRequest")((
  request: OpenRouterRoundRequest,
) => {
  const policy = buildOpenRouterRequestPolicy(request.settings);
  const text = responseTextConfig(request);
  const hasTools = request.tools.length > 0;
  return Effect.succeed({
    model: request.model,
    instructions: request.instructions,
    input: responseInput(request),
    tools: responseTools(request),
    ...(hasTools && request.toolParameters?.toolChoice ? { tool_choice: "auto" as const } : {}),
    ...(hasTools && request.toolParameters?.parallelToolCalls
      ? { parallel_tool_calls: true as const }
      : {}),
    store: false as const,
    stream: true,
    include: ["reasoning.encrypted_content"] as const,
    provider: policy.provider,
    plugins: policy.plugins,
    ...(request.reasoningEffort === undefined
      ? {}
      : { reasoning: { effort: request.reasoningEffort, summary: "auto" } }),
    ...(text === undefined ? {} : { text }),
  });
});

const normalizeResponsesUsage = (
  usage: NonNullable<Generated.OpenResponsesResult["usage"]>,
): OpenRouterUsage => ({
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  totalTokens: usage.total_tokens,
  ...(usage.input_tokens_details.cached_tokens === undefined
    ? {}
    : { cachedInputTokens: usage.input_tokens_details.cached_tokens }),
  ...(usage.output_tokens_details.reasoning_tokens === undefined
    ? {}
    : { reasoningTokens: usage.output_tokens_details.reasoning_tokens }),
});

const responseAssistantText = (output: Generated.OpenResponsesResult["output"]): string => {
  let text = "";
  for (const item of output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type === "output_text") text += part.text;
    }
  }
  return text;
};

const responseReasoningText = (output: Generated.OpenResponsesResult["output"]): string => {
  const summaries: Array<string> = [];
  for (const item of output) {
    if (item.type !== "reasoning") continue;
    for (const part of item.summary) summaries.push(part.text);
  }
  return summaries.join("\n");
};

const responseToolCalls = (
  output: Generated.OpenResponsesResult["output"],
): ReadonlyArray<OpenRouterToolCall> => {
  const calls: Array<OpenRouterToolCall> = [];
  for (const item of output) {
    if (item.type !== "function_call") continue;
    calls.push({
      sourceId: item.call_id,
      name: item.name,
      arguments: item.arguments,
      ...(item.id === undefined ? {} : { metadata: { itemId: item.id } }),
    });
  }
  return calls;
};

const completedResponsesEvent = (
  state: ResponsesStreamState,
  response: Generated.OpenResponsesResult,
): OpenRouterRoundEvent => {
  const assistantText = state.assistantText || responseAssistantText(response.output);
  const reasoningText = state.reasoningText || responseReasoningText(response.output);
  const toolCalls = responseToolCalls(response.output);
  const outputItems = response.output as unknown as ReadonlyArray<OpenRouterResponseOutputItem>;
  const historyItem: OpenRouterHistoryItem = {
    type: "assistant",
    content: assistantText,
    ...(reasoningText ? { reasoning: reasoningText } : {}),
    ...(toolCalls.length === 0
      ? {}
      : {
          toolCalls: toolCalls.map((toolCall) => ({
            id: toolCall.sourceId,
            name: toolCall.name,
            arguments: toolCall.arguments,
          })),
        }),
    ...(outputItems.length === 0 ? {} : { opaque: { protocol: "responses", outputItems } }),
  };
  return {
    type: "completed",
    ...(assistantText ? { assistantText } : {}),
    ...(reasoningText ? { reasoningText } : {}),
    toolCalls,
    historyItems: [historyItem],
    model: response.model,
    stopReason: response.status,
    ...(response.usage === undefined ? {} : { usage: normalizeResponsesUsage(response.usage) }),
    ...(response.usage?.cost == null ? {} : { totalCostUsd: response.usage.cost }),
  };
};

const consumeResponsesFrame = Effect.fn("consumeOpenRouterResponsesFrame")(function* (
  state: ResponsesStreamState,
  frame: string,
): Effect.fn.Return<
  readonly [ResponsesStreamState, ReadonlyArray<OpenRouterRoundEvent>],
  OpenRouterProtocolError
> {
  if (frame === END_OF_STREAM || frame === "[DONE]") {
    if (state.completed) return [state, []];
    return yield* new OpenRouterProtocolError({
      protocol: "responses",
      message: "OpenRouter Responses stream ended without a terminal event",
    });
  }
  const event = yield* decodeResponseStreamEvent(frame).pipe(
    Effect.mapError(
      () =>
        new OpenRouterProtocolError({
          protocol: "responses",
          message: "OpenRouter Responses SSE frame is malformed or unsupported",
        }),
    ),
  );
  switch (event.type) {
    case "response.output_text.delta": {
      const next = { ...state, assistantText: state.assistantText + event.delta };
      return [next, [{ type: "contentDelta", kind: "assistant", delta: event.delta }]];
    }
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta": {
      const next = { ...state, reasoningText: state.reasoningText + event.delta };
      return [next, [{ type: "contentDelta", kind: "reasoning", delta: event.delta }]];
    }
    case "response.completed": {
      const next = { ...state, completed: true };
      return [next, [completedResponsesEvent(next, event.response)]];
    }
    case "response.failed":
    case "response.incomplete":
      return yield* new OpenRouterProtocolError({
        protocol: "responses",
        message: `OpenRouter Responses stream ended with ${event.response.status}`,
      });
    case "error":
      return yield* new OpenRouterProtocolError({
        protocol: "responses",
        message: "OpenRouter Responses stream reported an upstream error",
      });
    default:
      return [state, []];
  }
});

export const decodeOpenRouterResponsesSse = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<OpenRouterRoundEvent, E | OpenRouterProtocolError, R> =>
  decodeOpenRouterSseData("responses", bytes).pipe(
    Stream.concat(Stream.succeed(END_OF_STREAM)),
    Stream.mapAccumEffect<
      ResponsesStreamState,
      string,
      OpenRouterRoundEvent,
      OpenRouterProtocolError,
      never
    >(() => ({ assistantText: "", reasoningText: "", completed: false }), consumeResponsesFrame),
  );
