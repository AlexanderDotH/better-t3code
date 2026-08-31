import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Usage = Schema.Struct({
  input_tokens: NonNegativeInteger,
  output_tokens: NonNegativeInteger,
  total_tokens: NonNegativeInteger,
  input_tokens_details: Schema.optionalKey(
    Schema.Struct({ cached_tokens: Schema.optionalKey(NonNegativeInteger) }),
  ),
  output_tokens_details: Schema.optionalKey(
    Schema.Struct({ reasoning_tokens: Schema.optionalKey(NonNegativeInteger) }),
  ),
});
const MessageItem = Schema.Struct({
  type: Schema.Literal("message"),
  id: Schema.optionalKey(Schema.String),
  role: Schema.optionalKey(Schema.String),
  content: Schema.Array(Schema.Unknown),
});
const ReasoningItem = Schema.Struct({
  type: Schema.Literal("reasoning"),
  id: Schema.optionalKey(Schema.String),
  encrypted_content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
  summary: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
const FunctionCallItem = Schema.Struct({
  type: Schema.Literal("function_call"),
  id: Schema.optionalKey(Schema.String),
  call_id: Schema.String,
  name: Schema.String,
  arguments: Schema.String,
});
const OutputItem = Schema.Union([MessageItem, ReasoningItem, FunctionCallItem]);
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
  status: ResponseStatus,
  output: Schema.Array(OutputItem),
  usage: Schema.optionalKey(Schema.Union([Usage, Schema.Null])),
  error: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        code: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
        message: Schema.String,
      }),
      Schema.Null,
    ]),
  ),
  incomplete_details: Schema.optionalKey(Schema.Unknown),
});
const DeltaEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("response.output_text.delta"), delta: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("response.reasoning_summary_text.delta"),
    delta: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("response.reasoning_text.delta"), delta: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("response.function_call_arguments.delta"),
    delta: Schema.String,
    item_id: Schema.optionalKey(Schema.String),
    output_index: Schema.optionalKey(NonNegativeInteger),
  }),
  Schema.Struct({ type: Schema.Literal("response.refusal.delta"), delta: Schema.String }),
]);
const ItemDoneEvent = Schema.Struct({
  type: Schema.Literal("response.output_item.done"),
  item: OutputItem,
});
const TerminalEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("response.completed"), response: ResponseShape }),
  Schema.Struct({ type: Schema.Literal("response.failed"), response: ResponseShape }),
  Schema.Struct({ type: Schema.Literal("response.incomplete"), response: ResponseShape }),
  Schema.Struct({
    type: Schema.Literal("error"),
    code: Schema.optionalKey(Schema.String),
    message: Schema.String,
  }),
]);
const IgnoredEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("response.created") }),
  Schema.Struct({ type: Schema.Literal("response.queued") }),
  Schema.Struct({ type: Schema.Literal("response.in_progress") }),
  Schema.Struct({ type: Schema.Literal("response.output_item.added") }),
  Schema.Struct({ type: Schema.Literal("response.content_part.added") }),
  Schema.Struct({ type: Schema.Literal("response.content_part.done") }),
  Schema.Struct({ type: Schema.Literal("response.output_text.done") }),
  Schema.Struct({ type: Schema.Literal("response.reasoning_summary_part.added") }),
  Schema.Struct({ type: Schema.Literal("response.reasoning_summary_part.done") }),
  Schema.Struct({ type: Schema.Literal("response.reasoning_summary_text.done") }),
  Schema.Struct({ type: Schema.Literal("response.reasoning_text.done") }),
  Schema.Struct({ type: Schema.Literal("response.function_call_arguments.done") }),
  Schema.Struct({ type: Schema.Literal("response.refusal.done") }),
]);
const RawEvent = Schema.Union([DeltaEvent, ItemDoneEvent, TerminalEvent, IgnoredEvent]);
const EventEnvelope = Schema.Struct({ type: Schema.String });
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeEnvelope = Schema.decodeUnknownEffect(EventEnvelope);
const decodeEvent = Schema.decodeUnknownEffect(RawEvent);

export interface ChatGptResponseUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
}

export type ChatGptResponseOutputItem =
  | {
      readonly type: "message";
      readonly id?: string;
      readonly role?: string;
      readonly content: ReadonlyArray<unknown>;
    }
  | {
      readonly type: "reasoning";
      readonly id?: string;
      readonly encryptedContent?: string;
      readonly summary: ReadonlyArray<unknown>;
    }
  | {
      readonly type: "functionCall";
      readonly id?: string;
      readonly callId: string;
      readonly name: string;
      readonly arguments: string;
    };

export type ChatGptResponseEvent =
  | { readonly type: "outputTextDelta"; readonly delta: string }
  | { readonly type: "reasoningDelta"; readonly delta: string }
  | {
      readonly type: "functionCallArgumentsDelta";
      readonly delta: string;
      readonly itemId?: string;
      readonly outputIndex?: number;
    }
  | { readonly type: "refusalDelta"; readonly delta: string }
  | { readonly type: "outputItemDone"; readonly item: ChatGptResponseOutputItem }
  | {
      readonly type: "responseCompleted";
      readonly responseId: string;
      readonly status: typeof ResponseStatus.Type;
      readonly outputItems: ReadonlyArray<ChatGptResponseOutputItem>;
      readonly usage?: ChatGptResponseUsage;
    }
  | {
      readonly type: "responseFailed";
      readonly responseId?: string;
      readonly status?: typeof ResponseStatus.Type;
      readonly code?: string;
      readonly message: string;
    }
  | { readonly type: "streamDone" };

export class ChatGptProtocolDriftError extends Schema.TaggedErrorClass<ChatGptProtocolDriftError>()(
  "ChatGptProtocolDriftError",
  { message: Schema.String },
) {}

const normalizeOutputItem = (item: typeof OutputItem.Type): ChatGptResponseOutputItem => {
  switch (item.type) {
    case "message":
      return {
        type: "message",
        ...(item.id === undefined ? {} : { id: item.id }),
        ...(item.role === undefined ? {} : { role: item.role }),
        content: item.content,
      };
    case "reasoning":
      return {
        type: "reasoning",
        ...(item.id === undefined ? {} : { id: item.id }),
        ...(item.encrypted_content == null ? {} : { encryptedContent: item.encrypted_content }),
        summary: item.summary ?? [],
      };
    case "function_call":
      return {
        type: "functionCall",
        ...(item.id === undefined ? {} : { id: item.id }),
        callId: item.call_id,
        name: item.name,
        arguments: item.arguments,
      };
  }
};

const normalizeUsage = (usage: typeof Usage.Type): ChatGptResponseUsage => ({
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  totalTokens: usage.total_tokens,
  ...(usage.input_tokens_details?.cached_tokens === undefined
    ? {}
    : { cachedInputTokens: usage.input_tokens_details.cached_tokens }),
  ...(usage.output_tokens_details?.reasoning_tokens === undefined
    ? {}
    : { reasoningTokens: usage.output_tokens_details.reasoning_tokens }),
});

const normalizeTerminal = (
  event: Extract<typeof RawEvent.Type, { readonly type: string }>,
): ReadonlyArray<ChatGptResponseEvent> => {
  if (event.type === "error") {
    return [
      {
        type: "responseFailed",
        ...(event.code === undefined ? {} : { code: event.code }),
        message: event.message,
      },
    ];
  }
  if (
    event.type !== "response.completed" &&
    event.type !== "response.failed" &&
    event.type !== "response.incomplete"
  ) {
    return [];
  }
  const response = event.response;
  if (event.type === "response.completed" && response.status === "completed") {
    return [
      {
        type: "responseCompleted",
        responseId: response.id,
        status: response.status,
        outputItems: response.output.map(normalizeOutputItem),
        ...(response.usage == null ? {} : { usage: normalizeUsage(response.usage) }),
      },
    ];
  }
  return [
    {
      type: "responseFailed",
      responseId: response.id,
      status: response.status,
      ...(response.error?.code == null ? {} : { code: response.error.code }),
      message: response.error?.message ?? `ChatGPT response ended with ${response.status}`,
    },
  ];
};

const normalizeRawEvent = (event: typeof RawEvent.Type): ReadonlyArray<ChatGptResponseEvent> => {
  switch (event.type) {
    case "response.output_text.delta":
      return [{ type: "outputTextDelta", delta: event.delta }];
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta":
      return [{ type: "reasoningDelta", delta: event.delta }];
    case "response.function_call_arguments.delta":
      return [
        {
          type: "functionCallArgumentsDelta",
          delta: event.delta,
          ...(event.item_id === undefined ? {} : { itemId: event.item_id }),
          ...(event.output_index === undefined ? {} : { outputIndex: event.output_index }),
        },
      ];
    case "response.refusal.delta":
      return [{ type: "refusalDelta", delta: event.delta }];
    case "response.output_item.done":
      return [{ type: "outputItemDone", item: normalizeOutputItem(event.item) }];
    default:
      return normalizeTerminal(event);
  }
};

const decodeFrame = Effect.fn("decodeChatGptSseFrame")(function* (
  data: string,
): Effect.fn.Return<ReadonlyArray<ChatGptResponseEvent>, ChatGptProtocolDriftError> {
  if (data === "[DONE]") return [{ type: "streamDone" }];
  const json = yield* decodeJson(data).pipe(
    Effect.mapError(
      () => new ChatGptProtocolDriftError({ message: "ChatGPT SSE frame contains invalid JSON" }),
    ),
  );
  const envelope = yield* decodeEnvelope(json, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(
      () => new ChatGptProtocolDriftError({ message: "ChatGPT SSE frame has no event type" }),
    ),
  );
  const event = yield* decodeEvent(json, { onExcessProperty: "ignore" }).pipe(
    Effect.mapError(
      () =>
        new ChatGptProtocolDriftError({
          message: `Unsupported or malformed ChatGPT SSE event: ${envelope.type}`,
        }),
    ),
  );
  return normalizeRawEvent(event);
});

interface SseState {
  readonly dataLines: ReadonlyArray<string>;
  readonly eventName?: string;
}

const END_OF_STREAM = "\u0000t3-chatgpt-sse-eof";

const consumeLine = Effect.fn("consumeChatGptSseLine")(function* (
  state: SseState,
  line: string,
): Effect.fn.Return<
  readonly [SseState, ReadonlyArray<ChatGptResponseEvent>],
  ChatGptProtocolDriftError
> {
  if (line === END_OF_STREAM) {
    if (state.dataLines.length === 0 && state.eventName === undefined) return [state, []];
    return yield* new ChatGptProtocolDriftError({
      message: "ChatGPT SSE stream ended with a truncated frame",
    });
  }
  if (line === "") {
    if (state.dataLines.length === 0) return [{ dataLines: [] }, []];
    const events = yield* decodeFrame(state.dataLines.join("\n"));
    return [{ dataLines: [] }, events];
  }
  if (line.startsWith(":")) return [state, []];
  if (line.startsWith("event:")) {
    return [{ ...state, eventName: line.slice(6).trim() }, []];
  }
  if (line.startsWith("data:")) {
    const data = line.slice(5).replace(/^ /u, "");
    return [{ ...state, dataLines: [...state.dataLines, data] }, []];
  }
  return yield* new ChatGptProtocolDriftError({
    message: "ChatGPT SSE stream contains an unsupported field",
  });
});

export const decodeChatGptResponseSse = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<ChatGptResponseEvent, E | ChatGptProtocolDriftError, R> =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.concat(Stream.succeed(END_OF_STREAM)),
    Stream.mapAccumEffect<SseState, string, ChatGptResponseEvent, ChatGptProtocolDriftError, never>(
      () => ({ dataLines: [] }),
      consumeLine,
    ),
  );
