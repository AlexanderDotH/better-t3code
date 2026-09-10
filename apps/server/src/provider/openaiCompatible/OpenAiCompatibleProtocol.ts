import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Sse from "effect/unstable/encoding/Sse";

export type OpenAiCompatibleHistoryItem =
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
    }
  | {
      readonly type: "tool";
      readonly callId: string;
      readonly content: string;
      readonly name?: string;
    };

export interface OpenAiCompatibleToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface OpenAiCompatibleRoundRequest {
  readonly model: string;
  readonly instructions: string;
  readonly history: ReadonlyArray<OpenAiCompatibleHistoryItem>;
  readonly tools: ReadonlyArray<OpenAiCompatibleToolDefinition>;
  readonly signal?: AbortSignal;
}

export interface OpenAiCompatibleToolCall {
  readonly sourceId: string;
  readonly name: string;
  readonly arguments: string;
}

export interface OpenAiCompatibleUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
}

export type OpenAiCompatibleRoundEvent =
  | {
      readonly type: "contentDelta";
      readonly kind: "assistant" | "reasoning";
      readonly delta: string;
    }
  | {
      readonly type: "completed";
      readonly assistantText?: string;
      readonly reasoningText?: string;
      readonly toolCalls: ReadonlyArray<OpenAiCompatibleToolCall>;
      readonly historyItems: ReadonlyArray<OpenAiCompatibleHistoryItem>;
      readonly model: string;
      readonly stopReason?: string;
      readonly usage?: OpenAiCompatibleUsage;
    };

export class OpenAiCompatibleProtocolError extends Schema.TaggedError<OpenAiCompatibleProtocolError>()(
  "OpenAiCompatibleProtocolError",
  { message: Schema.String },
) {}

export function buildOpenAiCompatibleChatCompletionRequest(request: OpenAiCompatibleRoundRequest) {
  const messages: Array<unknown> = [];
  if (request.instructions.trim()) messages.push({ role: "system", content: request.instructions });
  for (const item of request.history) {
    switch (item.type) {
      case "user":
        messages.push({ role: "user", content: item.content });
        break;
      case "tool":
        messages.push({ role: "tool", tool_call_id: item.callId, content: item.content });
        break;
      case "assistant":
        messages.push({
          role: "assistant",
          content: item.content || null,
          ...(item.toolCalls?.length
            ? {
                tool_calls: item.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        });
        break;
    }
  }
  return {
    model: request.model,
    messages,
    stream: true,
    ...(request.tools.length === 0
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              ...(tool.description === undefined ? {} : { description: tool.description }),
              parameters: tool.parameters,
            },
          })),
        }),
  };
}

const nullableString = Schema.optionalKey(Schema.NullOr(Schema.String));
const tokenCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const toolCallDelta = Schema.Struct({
  index: tokenCount,
  id: nullableString,
  type: Schema.optionalKey(Schema.Literal("function")),
  function: Schema.optionalKey(Schema.Struct({ name: nullableString, arguments: nullableString })),
});
const usageSchema = Schema.Struct({
  prompt_tokens: tokenCount,
  completion_tokens: tokenCount,
  total_tokens: tokenCount,
  prompt_tokens_details: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ cached_tokens: Schema.optionalKey(tokenCount) })),
  ),
  completion_tokens_details: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({ reasoning_tokens: Schema.optionalKey(Schema.NullOr(tokenCount)) }),
    ),
  ),
});
const decodeChunk = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      model: Schema.optionalKey(Schema.String),
      choices: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            index: tokenCount,
            finish_reason: nullableString,
            delta: Schema.optionalKey(
              Schema.Struct({
                content: nullableString,
                reasoning: nullableString,
                reasoning_content: nullableString,
                tool_calls: Schema.optionalKey(Schema.NullOr(Schema.Array(toolCallDelta))),
              }),
            ),
          }),
        ),
      ),
      usage: Schema.optionalKey(Schema.NullOr(usageSchema)),
      error: Schema.optionalKey(Schema.Unknown),
    }),
  ),
);
const decodeArguments = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)),
);
const END_OF_STREAM = "\u0000t3-compatible-eof";

interface ChatState {
  assistantText: string;
  reasoningText: string;
  model: string;
  stopReason?: string;
  usage?: OpenAiCompatibleUsage;
  readonly toolCalls: Map<number, OpenAiCompatibleToolCall>;
  completed: boolean;
}

const completeRound = Effect.fn("OpenAiCompatibleProtocol.completeRound")(function* (
  state: ChatState,
): Effect.fn.Return<OpenAiCompatibleRoundEvent, OpenAiCompatibleProtocolError> {
  if (state.stopReason === undefined) {
    return yield* new OpenAiCompatibleProtocolError({
      message: "The endpoint stream ended without a finish reason.",
    });
  }
  const toolCalls = Array.from(state.toolCalls.entries())
    .sort(([left], [right]) => left - right)
    .map(([, call]) => call);
  if (state.stopReason === "function_call") {
    return yield* new OpenAiCompatibleProtocolError({
      message:
        "The endpoint returned unsupported legacy function calls. Function tools are required.",
    });
  }
  if (state.stopReason === "tool_calls" && toolCalls.length === 0) {
    return yield* new OpenAiCompatibleProtocolError({
      message: "The endpoint ended a function-calling round without a function call.",
    });
  }
  if (toolCalls.length > 0 && !["stop", "tool_calls"].includes(state.stopReason)) {
    return yield* new OpenAiCompatibleProtocolError({
      message: "The endpoint stopped before completing its function calls.",
    });
  }
  for (const call of toolCalls) {
    if (!call.sourceId.trim() || !call.name.trim()) {
      return yield* new OpenAiCompatibleProtocolError({
        message: "The endpoint returned an incomplete function call.",
      });
    }
    yield* decodeArguments(call.arguments).pipe(
      Effect.mapError(
        () =>
          new OpenAiCompatibleProtocolError({
            message: "The endpoint returned malformed function arguments.",
          }),
      ),
    );
  }
  if (new Set(toolCalls.map((call) => call.sourceId)).size !== toolCalls.length) {
    return yield* new OpenAiCompatibleProtocolError({
      message: "The endpoint returned duplicate function call identifiers.",
    });
  }
  state.completed = true;
  return {
    type: "completed",
    ...(state.assistantText ? { assistantText: state.assistantText } : {}),
    ...(state.reasoningText ? { reasoningText: state.reasoningText } : {}),
    model: state.model,
    stopReason: state.stopReason,
    ...(state.usage === undefined ? {} : { usage: state.usage }),
    toolCalls,
    historyItems: [
      {
        type: "assistant",
        content: state.assistantText,
        ...(state.reasoningText ? { reasoning: state.reasoningText } : {}),
        ...(toolCalls.length === 0
          ? {}
          : {
              toolCalls: toolCalls.map((call) => ({
                id: call.sourceId,
                name: call.name,
                arguments: call.arguments,
              })),
            }),
      },
    ],
  };
});

const consumeFrame = Effect.fn("OpenAiCompatibleProtocol.consumeFrame")(function* (
  state: ChatState,
  frame: string,
): Effect.fn.Return<
  readonly [ChatState, ReadonlyArray<OpenAiCompatibleRoundEvent>],
  OpenAiCompatibleProtocolError
> {
  if (state.completed) return [state, []];
  if (frame === END_OF_STREAM) {
    return yield* new OpenAiCompatibleProtocolError({
      message: "The endpoint stream ended before its terminal event.",
    });
  }
  if (frame.trim() === "[DONE]") return [state, [yield* completeRound(state)]];
  const chunk = yield* decodeChunk(frame).pipe(
    Effect.mapError(
      () => new OpenAiCompatibleProtocolError({ message: "The endpoint SSE frame is malformed." }),
    ),
  );
  if (chunk.error !== undefined || chunk.choices === undefined) {
    return yield* new OpenAiCompatibleProtocolError({
      message: "The endpoint stream reported an upstream error or invalid response.",
    });
  }
  const choice = chunk.choices.find((candidate) => candidate.index === 0);
  if (chunk.choices.length > 0 && choice === undefined) {
    return yield* new OpenAiCompatibleProtocolError({
      message: "The endpoint stream omitted the requested completion choice.",
    });
  }
  const assistantDelta = choice?.delta?.content ?? "";
  const reasoningDelta = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? "";
  state.assistantText += assistantDelta;
  state.reasoningText += reasoningDelta;
  if (chunk.model) state.model = chunk.model;
  if (choice?.finish_reason != null) state.stopReason = choice.finish_reason;
  for (const delta of choice?.delta?.tool_calls ?? []) {
    const existing = state.toolCalls.get(delta.index);
    state.toolCalls.set(delta.index, {
      sourceId: `${existing?.sourceId ?? ""}${delta.id ?? ""}`,
      name: `${existing?.name ?? ""}${delta.function?.name ?? ""}`,
      arguments: `${existing?.arguments ?? ""}${delta.function?.arguments ?? ""}`,
    });
  }
  if (chunk.usage != null) {
    const usage = chunk.usage;
    const cachedInputTokens = usage.prompt_tokens_details?.cached_tokens;
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
    state.usage = {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
      ...(reasoningTokens == null ? {} : { reasoningTokens }),
    };
  }
  const events: Array<OpenAiCompatibleRoundEvent> = [];
  if (reasoningDelta)
    events.push({ type: "contentDelta", kind: "reasoning", delta: reasoningDelta });
  if (assistantDelta)
    events.push({ type: "contentDelta", kind: "assistant", delta: assistantDelta });
  return [state, events];
});

export const decodeOpenAiCompatibleChatCompletionSse = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
  model = "unknown",
): Stream.Stream<OpenAiCompatibleRoundEvent, E | OpenAiCompatibleProtocolError, R> =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.catchTag(["Retry", "SseError"], () =>
      Stream.fail(
        new OpenAiCompatibleProtocolError({ message: "The endpoint SSE framing is invalid." }),
      ),
    ),
    Stream.map((event) => event.data),
    Stream.concat(Stream.succeed(END_OF_STREAM)),
    Stream.mapAccumEffect(
      (): ChatState => ({
        assistantText: "",
        reasoningText: "",
        model,
        toolCalls: new Map(),
        completed: false,
      }),
      consumeFrame,
    ),
    Stream.takeUntil((event) => event.type === "completed"),
  );
