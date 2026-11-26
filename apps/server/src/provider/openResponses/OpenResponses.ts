import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Sse from "effect/encoding/Sse";

// Client for the Open Responses standard (https://www.openresponses.org/specification).
// It reads only the fields T3 Code needs, so vendor extensions and new enum values never
// break a turn; unknown events and items are ignored as the spec requires.

export type OpenResponsesItem = Readonly<Record<string, Schema.Json>>;

export type OpenResponsesHistoryItem =
  | { readonly type: "user"; readonly content: string }
  | {
      readonly type: "assistant";
      readonly content: string;
      readonly toolCalls?: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly arguments: string;
      }>;
      /** Output items from an earlier Open Responses round, replayed verbatim. */
      readonly outputItems?: ReadonlyArray<OpenResponsesItem>;
    }
  | { readonly type: "tool"; readonly callId: string; readonly content: string };

export interface OpenResponsesTool {
  readonly name: string;
  readonly description?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly strict?: boolean;
}

export interface OpenResponsesRequest {
  readonly model: string;
  readonly instructions: string;
  readonly history: ReadonlyArray<OpenResponsesHistoryItem>;
  readonly tools: ReadonlyArray<OpenResponsesTool>;
  readonly toolChoice?: boolean;
  readonly parallelToolCalls?: boolean;
  readonly reasoningEffort?: string;
  readonly responseFormat?: {
    readonly name: string;
    readonly schema: Readonly<Record<string, unknown>>;
    readonly description?: string;
    readonly strict?: boolean;
  };
}

export interface OpenResponsesUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly costUsd?: number;
}

export interface OpenResponsesToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
  readonly itemId?: string;
}

export type OpenResponsesEvent =
  | {
      readonly type: "contentDelta";
      readonly kind: "assistant" | "reasoning";
      readonly delta: string;
    }
  | {
      readonly type: "completed";
      readonly model?: string;
      readonly status: string;
      readonly assistantText: string;
      readonly reasoningText: string;
      readonly toolCalls: ReadonlyArray<OpenResponsesToolCall>;
      readonly outputItems: ReadonlyArray<OpenResponsesItem>;
      readonly usage?: OpenResponsesUsage;
    };

export class OpenResponsesProtocolError extends Schema.TaggedError<OpenResponsesProtocolError>()(
  "OpenResponsesProtocolError",
  { message: Schema.String },
) {}
export const isOpenResponsesProtocolError = Schema.is(OpenResponsesProtocolError);

function openResponsesInput(history: ReadonlyArray<OpenResponsesHistoryItem>) {
  const input: Array<unknown> = [];
  for (const item of history) {
    switch (item.type) {
      case "user":
        input.push({ type: "message", role: "user", content: item.content });
        break;
      case "tool":
        input.push({ type: "function_call_output", call_id: item.callId, output: item.content });
        break;
      case "assistant":
        if (item.outputItems !== undefined && item.outputItems.length > 0) {
          input.push(...item.outputItems);
          break;
        }
        if (item.content) input.push({ type: "message", role: "assistant", content: item.content });
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
}

/** A stateless streaming request: full history every round, reasoning kept as encrypted items. */
export function buildOpenResponsesRequest(request: OpenResponsesRequest) {
  const hasTools = request.tools.length > 0;
  const format = request.responseFormat;
  return {
    model: request.model,
    ...(request.instructions.trim() ? { instructions: request.instructions } : {}),
    input: openResponsesInput(request.history),
    ...(hasTools
      ? {
          tools: request.tools.map((tool) => ({
            type: "function" as const,
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            parameters: tool.parameters,
            // The spec defaults `strict` to true, which most T3 tool schemas do not satisfy.
            strict: tool.strict ?? false,
          })),
        }
      : {}),
    ...(hasTools && request.toolChoice ? { tool_choice: "auto" as const } : {}),
    ...(hasTools && request.parallelToolCalls ? { parallel_tool_calls: true as const } : {}),
    store: false as const,
    stream: true as const,
    include: ["reasoning.encrypted_content"] as const,
    ...(request.reasoningEffort === undefined
      ? {}
      : { reasoning: { effort: request.reasoningEffort, summary: "auto" as const } }),
    ...(format === undefined
      ? {}
      : {
          text: {
            format: {
              type: "json_schema" as const,
              name: format.name,
              schema: format.schema,
              ...(format.description === undefined ? {} : { description: format.description }),
              strict: format.strict ?? true,
            },
          },
        }),
  };
}

const JsonObject = Schema.Record(Schema.String, Schema.Json);
const Count = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const Envelope = Schema.Struct({ type: Schema.String });
const Delta = Schema.Struct({ delta: Schema.String });
const ItemDone = Schema.Struct({ item: Schema.NullOr(JsonObject) });
const Terminal = Schema.Struct({
  response: Schema.Struct({
    model: Schema.optionalKey(Schema.String),
    status: Schema.optionalKey(Schema.String),
    output: Schema.optionalKey(Schema.NullOr(Schema.Array(JsonObject))),
    usage: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(Schema.Unknown),
    incomplete_details: Schema.optionalKey(Schema.Unknown),
  }),
});
const Usage = Schema.Struct({
  input_tokens: Count,
  output_tokens: Count,
  total_tokens: Schema.optionalKey(Count),
  input_tokens_details: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ cached_tokens: Schema.optionalKey(Schema.NullOr(Count)) })),
  ),
  output_tokens_details: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ reasoning_tokens: Schema.optionalKey(Schema.NullOr(Count)) })),
  ),
  // OpenRouter extension: the request cost in USD.
  cost: Schema.optionalKey(Schema.NullOr(Count)),
});
const MessageItem = Schema.Struct({
  type: Schema.Literal("message"),
  content: Schema.Array(JsonObject),
});
const ReasoningItem = Schema.Struct({
  type: Schema.Literal("reasoning"),
  summary: Schema.optionalKey(Schema.NullOr(Schema.Array(JsonObject))),
  content: Schema.optionalKey(Schema.NullOr(Schema.Array(JsonObject))),
});
const FunctionCallItem = Schema.Struct({
  type: Schema.Literal("function_call"),
  id: Schema.optionalKey(Schema.String),
  call_id: Schema.String,
  name: Schema.String,
  arguments: Schema.String,
});
const TextPart = Schema.Struct({
  type: Schema.Literals(["output_text", "summary_text", "reasoning_text"]),
  text: Schema.String,
});
const RefusalPart = Schema.Struct({ type: Schema.Literal("refusal"), refusal: Schema.String });

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeEnvelope = Schema.decodeUnknownEffect(Envelope);
const decodeDelta = Schema.decodeUnknownEffect(Delta);
const decodeItemDone = Schema.decodeUnknownEffect(ItemDone);
const decodeTerminal = Schema.decodeUnknownEffect(Terminal);
const decodeUsage = Schema.decodeUnknownOption(Usage);
const isMessageItem = Schema.is(MessageItem);
const isReasoningItem = Schema.is(ReasoningItem);
const isFunctionCallItem = Schema.is(FunctionCallItem);
const isTextPart = Schema.is(TextPart);
const isRefusalPart = Schema.is(RefusalPart);

const partsText = (parts: ReadonlyArray<OpenResponsesItem> | null | undefined): string =>
  (parts ?? [])
    .map((part) => (isTextPart(part) ? part.text : isRefusalPart(part) ? part.refusal : ""))
    .join("");

const outputText = (items: ReadonlyArray<OpenResponsesItem>): string =>
  items
    .filter(isMessageItem)
    .map((item) => partsText(item.content))
    .join("");

const outputReasoning = (items: ReadonlyArray<OpenResponsesItem>): string =>
  items
    .filter(isReasoningItem)
    .map((item) => partsText(item.summary) || partsText(item.content))
    .filter(Boolean)
    .join("\n");

const outputToolCalls = (
  items: ReadonlyArray<OpenResponsesItem>,
): ReadonlyArray<OpenResponsesToolCall> =>
  items.filter(isFunctionCallItem).map((item) => ({
    callId: item.call_id,
    name: item.name,
    arguments: item.arguments,
    ...(item.id === undefined ? {} : { itemId: item.id }),
  }));

const normalizeUsage = (value: unknown): OpenResponsesUsage | undefined =>
  Option.getOrUndefined(
    Option.map(decodeUsage(value), (usage) => {
      const cached = usage.input_tokens_details?.cached_tokens;
      const reasoning = usage.output_tokens_details?.reasoning_tokens;
      return {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens ?? usage.input_tokens + usage.output_tokens,
        ...(cached == null ? {} : { cachedInputTokens: cached }),
        ...(reasoning == null ? {} : { reasoningTokens: reasoning }),
        ...(usage.cost == null ? {} : { costUsd: usage.cost }),
      };
    }),
  );

// Upstream error messages can echo prompt or account details; surface only identifier-shaped codes.
const errorCode = (value: unknown, key: "code" | "reason"): string => {
  const code = Predicate.hasProperty(value, key) ? value[key] : undefined;
  return Predicate.isString(code) && /^[\w.:-]{1,64}$/.test(code) ? ` (${code})` : "";
};

interface StreamState {
  readonly assistantText: string;
  readonly reasoningText: string;
  readonly doneItems: ReadonlyArray<OpenResponsesItem>;
  readonly completed: boolean;
}

const END_OF_STREAM = "\u0000t3-open-responses-eof";

// Untraced: this runs once per SSE frame, so a span per call would flood traces.
const consumeFrame = Effect.fnUntraced(function* (
  label: string,
  state: StreamState,
  frame: string,
): Effect.fn.Return<
  readonly [StreamState, ReadonlyArray<OpenResponsesEvent>],
  OpenResponsesProtocolError
> {
  const fail = (message: string) =>
    new OpenResponsesProtocolError({ message: `${label} ${message}` });
  if (state.completed) return [state, []];
  if (frame === END_OF_STREAM || frame.trim() === "[DONE]") {
    return yield* fail("stream ended without a terminal event");
  }
  const malformed = () => fail("SSE frame is malformed");
  const json = yield* decodeJson(frame).pipe(Effect.mapError(malformed));
  const { type } = yield* decodeEnvelope(json).pipe(Effect.mapError(malformed));
  switch (type) {
    case "response.output_text.delta": {
      const { delta } = yield* decodeDelta(json).pipe(Effect.mapError(malformed));
      const next = { ...state, assistantText: state.assistantText + delta };
      return [next, delta ? [{ type: "contentDelta", kind: "assistant", delta }] : []];
    }
    // `response.reasoning.delta` is the spec name; OpenAI-derived servers send `reasoning_text`.
    case "response.reasoning.delta":
    case "response.reasoning_text.delta":
    case "response.reasoning_summary_text.delta": {
      const { delta } = yield* decodeDelta(json).pipe(Effect.mapError(malformed));
      const next = { ...state, reasoningText: state.reasoningText + delta };
      return [next, delta ? [{ type: "contentDelta", kind: "reasoning", delta }] : []];
    }
    case "response.output_item.done": {
      const { item } = yield* decodeItemDone(json).pipe(Effect.mapError(malformed));
      return [item === null ? state : { ...state, doneItems: [...state.doneItems, item] }, []];
    }
    case "response.completed": {
      const { response } = yield* decodeTerminal(json).pipe(Effect.mapError(malformed));
      const outputItems =
        response.output != null && response.output.length > 0 ? response.output : state.doneItems;
      const usage = normalizeUsage(response.usage);
      return [
        { ...state, completed: true },
        [
          {
            type: "completed",
            ...(response.model === undefined ? {} : { model: response.model }),
            status: response.status ?? "completed",
            assistantText: state.assistantText || outputText(outputItems),
            reasoningText: state.reasoningText || outputReasoning(outputItems),
            toolCalls: outputToolCalls(outputItems),
            outputItems,
            ...(usage === undefined ? {} : { usage }),
          },
        ],
      ];
    }
    case "response.failed": {
      const { response } = yield* decodeTerminal(json).pipe(Effect.mapError(malformed));
      return yield* fail(`stream ended with failed${errorCode(response.error, "code")}`);
    }
    case "response.incomplete": {
      const { response } = yield* decodeTerminal(json).pipe(Effect.mapError(malformed));
      return yield* fail(
        `stream ended incomplete${errorCode(response.incomplete_details, "reason")}`,
      );
    }
    case "error": {
      const detail = Predicate.hasProperty(json, "error") ? json.error : json;
      return yield* fail(`stream reported an error${errorCode(detail, "code")}`);
    }
    default:
      return [state, []];
  }
});

export const decodeOpenResponsesSse = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
  options: { readonly label: string },
): Stream.Stream<OpenResponsesEvent, E | OpenResponsesProtocolError, R> =>
  bytes.pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.catchTag(["Retry", "SseError"], () =>
      Stream.fail(
        new OpenResponsesProtocolError({ message: `${options.label} SSE framing is invalid` }),
      ),
    ),
    Stream.map((event) => event.data),
    Stream.concat(Stream.succeed(END_OF_STREAM)),
    Stream.mapAccumEffect(
      (): StreamState => ({
        assistantText: "",
        reasoningText: "",
        doneItems: [],
        completed: false,
      }),
      (state, frame) => consumeFrame(options.label, state, frame),
    ),
    Stream.takeUntil((event) => event.type === "completed"),
  );
