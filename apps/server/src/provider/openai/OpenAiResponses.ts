import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type {
  OpenAiHistoryItem,
  OpenAiJsonObject,
  OpenAiRoundEvent,
  OpenAiRoundRequest,
  OpenAiToolCall,
  OpenAiUsage,
} from "./OpenAiProtocol.ts";

const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const JsonObject = Schema.Record(Schema.String, Schema.Json);
const Usage = Schema.Struct({
  input_tokens: NonNegativeInteger,
  output_tokens: NonNegativeInteger,
  total_tokens: NonNegativeInteger,
  input_tokens_details: Schema.optionalKey(
    Schema.Struct({
      cached_tokens: Schema.optionalKey(NonNegativeInteger),
      cache_write_tokens: Schema.optionalKey(NonNegativeInteger),
    }),
  ),
  output_tokens_details: Schema.optionalKey(
    Schema.Struct({ reasoning_tokens: Schema.optionalKey(NonNegativeInteger) }),
  ),
});
const ResponseStatus = Schema.Literals([
  "queued",
  "in_progress",
  "completed",
  "failed",
  "incomplete",
  "cancelled",
]);
const ResponseShape = Schema.Struct({
  id: Schema.String,
  model: Schema.String,
  status: ResponseStatus,
  output: Schema.Array(JsonObject),
  usage: Schema.optionalKey(Schema.Union([Usage, Schema.Null])),
  error: Schema.optionalKey(Schema.Unknown),
  incomplete_details: Schema.optionalKey(Schema.Unknown),
});
const DeltaEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("response.output_text.delta"),
    item_id: Schema.optionalKey(Schema.String),
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("response.reasoning_summary_text.delta"),
    item_id: Schema.optionalKey(Schema.String),
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("response.reasoning_text.delta"),
    item_id: Schema.optionalKey(Schema.String),
    delta: Schema.String,
  }),
]);
const TerminalEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("response.completed"), response: ResponseShape }),
  Schema.Struct({ type: Schema.Literal("response.failed"), response: ResponseShape }),
  Schema.Struct({ type: Schema.Literal("response.incomplete"), response: ResponseShape }),
  Schema.Struct({ type: Schema.Literal("error") }),
]);
const IgnoredEventType = Schema.Literals([
  "response.created",
  "response.queued",
  "response.in_progress",
  "response.output_item.added",
  "response.output_item.done",
  "response.content_part.added",
  "response.content_part.done",
  "response.output_text.done",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary_text.done",
  "response.reasoning_text.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.refusal.delta",
  "response.refusal.done",
]);
const IgnoredEvent = Schema.Struct({ type: IgnoredEventType });
const RawEvent = Schema.Union([DeltaEvent, TerminalEvent, IgnoredEvent]);
const EventEnvelope = Schema.Struct({ type: Schema.String });
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeEnvelope = Schema.decodeUnknownEffect(EventEnvelope);
const decodeEvent = Schema.decodeUnknownEffect(RawEvent);

const MessageItem = Schema.Struct({
  type: Schema.Literal("message"),
  content: Schema.Array(JsonObject),
});
const ReasoningItem = Schema.Struct({
  type: Schema.Literal("reasoning"),
  summary: Schema.optionalKey(Schema.Array(JsonObject)),
});
const FunctionCallItem = Schema.Struct({
  type: Schema.Literal("function_call"),
  id: Schema.optionalKey(Schema.String),
  call_id: Schema.String,
  name: Schema.String,
  arguments: Schema.String,
});
const OutputTextPart = Schema.Struct({ type: Schema.Literal("output_text"), text: Schema.String });
const RefusalPart = Schema.Struct({ type: Schema.Literal("refusal"), refusal: Schema.String });
const ReasoningSummaryPart = Schema.Struct({
  type: Schema.Literal("summary_text"),
  text: Schema.String,
});
const isMessageItem = Schema.is(MessageItem);
const isReasoningItem = Schema.is(ReasoningItem);
const isFunctionCallItem = Schema.is(FunctionCallItem);
const isOutputTextPart = Schema.is(OutputTextPart);
const isRefusalPart = Schema.is(RefusalPart);
const isReasoningSummaryPart = Schema.is(ReasoningSummaryPart);

export class OpenAiProtocolError extends Schema.TaggedErrorClass<OpenAiProtocolError>()(
  "OpenAiProtocolError",
  { message: Schema.String },
) {}

export function buildOpenAiResponsesRequest(request: OpenAiRoundRequest) {
  const hasTools = request.tools.length > 0;
  return {
    model: request.model,
    instructions: request.instructions,
    input: request.history,
    tools: request.tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      parameters: tool.parameters,
      strict: false as const,
    })),
    store: false as const,
    stream: true as const,
    include: ["reasoning.encrypted_content"] as const,
    ...(hasTools ? { tool_choice: "auto" as const, parallel_tool_calls: true as const } : {}),
    reasoning: {
      context: "all_turns" as const,
      summary: "auto" as const,
      ...(request.reasoningEffort === undefined ? {} : { effort: request.reasoningEffort }),
    },
    ...(request.responseFormat === undefined
      ? {}
      : {
          text: {
            format: {
              type: "json_schema" as const,
              name: request.responseFormat.name,
              schema: request.responseFormat.schema,
              ...(request.responseFormat.description === undefined
                ? {}
                : { description: request.responseFormat.description }),
              strict: true as const,
            },
          },
        }),
  };
}

function outputText(items: ReadonlyArray<OpenAiJsonObject>): string {
  return items
    .filter(isMessageItem)
    .flatMap(({ content }) =>
      content.flatMap((part) => {
        if (isOutputTextPart(part)) return [part.text];
        if (isRefusalPart(part)) return [part.refusal];
        return [];
      }),
    )
    .join("");
}

function reasoningText(items: ReadonlyArray<OpenAiJsonObject>): string {
  return items
    .filter(isReasoningItem)
    .flatMap(({ summary }) =>
      (summary ?? []).filter(isReasoningSummaryPart).map(({ text }) => text),
    )
    .join("\n");
}

function toolCalls(items: ReadonlyArray<OpenAiJsonObject>): ReadonlyArray<OpenAiToolCall> {
  return items.filter(isFunctionCallItem).map((item) => ({
    ...(item.id === undefined ? {} : { sourceId: item.id }),
    callId: item.call_id,
    name: item.name,
    arguments: item.arguments,
  }));
}

function normalizeUsage(usage: typeof Usage.Type): OpenAiUsage {
  return {
    inputTokens: usage.input_tokens,
    ...(usage.input_tokens_details?.cached_tokens === undefined
      ? {}
      : { cachedInputTokens: usage.input_tokens_details.cached_tokens }),
    ...(usage.input_tokens_details?.cache_write_tokens === undefined
      ? {}
      : { cacheWriteInputTokens: usage.input_tokens_details.cache_write_tokens }),
    outputTokens: usage.output_tokens,
    ...(usage.output_tokens_details?.reasoning_tokens === undefined
      ? {}
      : { reasoningTokens: usage.output_tokens_details.reasoning_tokens }),
    totalTokens: usage.total_tokens,
  };
}

const normalizeCompleted = Effect.fn("normalizeOpenAiCompletedResponse")(function* (
  response: typeof ResponseShape.Type,
) {
  for (const item of response.output) {
    if (isMessageItem(item) || isReasoningItem(item) || isFunctionCallItem(item)) continue;
    return yield* new OpenAiProtocolError({
      message: "OpenAI response contained an unsupported output item",
    });
  }
  const assistantText = outputText(response.output);
  const reasoning = reasoningText(response.output);
  return {
    type: "completed" as const,
    ...(assistantText ? { assistantText } : {}),
    ...(reasoning ? { reasoningText: reasoning } : {}),
    model: response.model,
    stopReason: response.status,
    historyItems: response.output as ReadonlyArray<OpenAiHistoryItem>,
    toolCalls: toolCalls(response.output),
    ...(response.usage == null ? {} : { usage: normalizeUsage(response.usage) }),
  } satisfies OpenAiRoundEvent;
});

interface SseState {
  readonly dataLines: ReadonlyArray<string>;
  readonly completed: boolean;
}

const END_OF_STREAM = "\u0000t3-openai-responses-eof";

const decodeFrame = Effect.fn("decodeOpenAiResponsesFrame")(function* (data: string) {
  if (data === "[DONE]") return { type: "done" as const };
  const json = yield* decodeJson(data).pipe(
    Effect.mapError(() => new OpenAiProtocolError({ message: "OpenAI SSE frame is invalid JSON" })),
  );
  const envelope = yield* decodeEnvelope(json, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(() => new OpenAiProtocolError({ message: "OpenAI SSE frame has no type" })),
  );
  return yield* decodeEvent(json, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(
      () =>
        new OpenAiProtocolError({
          message: `OpenAI SSE event '${envelope.type}' is unsupported or malformed`,
        }),
    ),
  );
});

const consumeFrame = Effect.fn("consumeOpenAiResponsesFrame")(function* (
  state: SseState,
  data: string,
): Effect.fn.Return<readonly [SseState, ReadonlyArray<OpenAiRoundEvent>], OpenAiProtocolError> {
  const event = yield* decodeFrame(data);
  if (event.type === "done") {
    if (!state.completed) {
      return yield* new OpenAiProtocolError({
        message: "OpenAI response stream ended before a terminal event",
      });
    }
    return [state, []];
  }
  if (event.type === "response.output_text.delta") {
    return [
      state,
      [
        {
          type: "contentDelta",
          kind: "assistant",
          ...(event.item_id === undefined ? {} : { sourceId: event.item_id }),
          delta: event.delta,
        },
      ],
    ];
  }
  if (
    event.type === "response.reasoning_summary_text.delta" ||
    event.type === "response.reasoning_text.delta"
  ) {
    return [
      state,
      [
        {
          type: "contentDelta",
          kind: "reasoning",
          ...(event.item_id === undefined ? {} : { sourceId: event.item_id }),
          delta: event.delta,
        },
      ],
    ];
  }
  if (event.type === "response.completed") {
    if (state.completed) {
      return yield* new OpenAiProtocolError({
        message: "OpenAI response stream emitted more than one terminal event",
      });
    }
    if (event.response.status !== "completed") {
      return yield* new OpenAiProtocolError({
        message: `OpenAI response ended with ${event.response.status}`,
      });
    }
    return [{ ...state, completed: true }, [yield* normalizeCompleted(event.response)]];
  }
  if (event.type === "response.failed" || event.type === "response.incomplete") {
    return yield* new OpenAiProtocolError({
      message: `OpenAI response ended with ${event.response.status}`,
    });
  }
  if (event.type === "error") {
    return yield* new OpenAiProtocolError({ message: "OpenAI response stream reported an error" });
  }
  return [state, []];
});

const consumeLine = Effect.fn("consumeOpenAiResponsesLine")(function* (
  state: SseState,
  line: string,
): Effect.fn.Return<readonly [SseState, ReadonlyArray<OpenAiRoundEvent>], OpenAiProtocolError> {
  if (line === END_OF_STREAM) {
    if (state.dataLines.length > 0) {
      return yield* new OpenAiProtocolError({
        message: "OpenAI response stream ended with a truncated frame",
      });
    }
    if (!state.completed) {
      return yield* new OpenAiProtocolError({
        message: "OpenAI response stream ended without a terminal event",
      });
    }
    return [state, []];
  }
  if (line === "") {
    if (state.dataLines.length === 0) return [state, []];
    return yield* consumeFrame({ ...state, dataLines: [] }, state.dataLines.join("\n"));
  }
  if (line.startsWith(":")) return [state, []];
  if (line.startsWith("event:")) return [state, []];
  if (line.startsWith("data:")) {
    return [{ ...state, dataLines: [...state.dataLines, line.slice(5).replace(/^ /u, "")] }, []];
  }
  return yield* new OpenAiProtocolError({
    message: "OpenAI response stream contains an unsupported SSE field",
  });
});

export const decodeOpenAiResponsesSse = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<OpenAiRoundEvent, E | OpenAiProtocolError, R> =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.concat(Stream.succeed(END_OF_STREAM)),
    Stream.mapAccumEffect<SseState, string, OpenAiRoundEvent, OpenAiProtocolError, never>(
      () => ({ dataLines: [], completed: false }),
      consumeLine,
    ),
  );
