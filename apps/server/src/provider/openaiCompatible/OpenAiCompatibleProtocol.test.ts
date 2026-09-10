import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  buildOpenAiCompatibleChatCompletionRequest,
  decodeOpenAiCompatibleChatCompletionSse,
} from "./OpenAiCompatibleProtocol.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function sseBytes(frames: ReadonlyArray<string>) {
  const bytes = new TextEncoder().encode(frames.map((frame) => `data: ${frame}\r\n\r\n`).join(""));
  return Stream.fromIterable(Array.from(bytes, (byte) => Uint8Array.of(byte)));
}

describe("OpenAI-compatible Chat Completions", () => {
  it("sends the exact model and standard tool history without provider policy extras", () => {
    expect(
      buildOpenAiCompatibleChatCompletionRequest({
        model: "local/model-Q4.gguf",
        instructions: "Use tools.",
        history: [
          { type: "user", content: "Read it." },
          {
            type: "assistant",
            content: "",
            reasoning: "private reasoning",
            toolCalls: [{ id: "call-1", name: "read_file", arguments: "{}" }],
          },
          { type: "tool", callId: "call-1", name: "read_file", content: "contents" },
        ],
        tools: [{ name: "read_file", parameters: { type: "object" } }],
      }),
    ).toEqual({
      model: "local/model-Q4.gguf",
      messages: [
        { role: "system", content: "Use tools." },
        { role: "user", content: "Read it." },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "contents" },
      ],
      stream: true,
      tools: [
        { type: "function", function: { name: "read_file", parameters: { type: "object" } } },
      ],
    });
    expect(
      buildOpenAiCompatibleChatCompletionRequest({
        model: "manual",
        instructions: "",
        history: [],
        tools: [],
      }),
    ).not.toHaveProperty("tools");
  });

  it.effect("assembles indexed fragmented function calls, UTF-8 text, reasoning and usage", () =>
    Effect.gen(function* () {
      const events = yield* decodeOpenAiCompatibleChatCompletionSse(
        sseBytes([
          '{"choices":[{"index":0,"delta":{"reasoning_content":"think","content":"hé","tool_calls":[{"index":1,"id":"call-b","type":"function","function":{"name":"list_files","arguments":"{}"}},{"index":0,"id":"call-","function":{"name":"read_","arguments":"{\\\"pa"}}]}}]}',
          '{"choices":[{"index":0,"delta":{"content":"llo","tool_calls":[{"index":0,"id":"a","function":{"name":"file","arguments":"th\\\":\\\"a\\\"}"}},{"index":1,"function":{"name":null}}]},"finish_reason":"tool_calls"}]}',
          '{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15,"prompt_tokens_details":{"cached_tokens":3},"completion_tokens_details":{"reasoning_tokens":2}}}',
          "[DONE]",
        ]),
        "manual/model",
      ).pipe(Stream.runCollect);
      expect(events).toContainEqual({ type: "contentDelta", kind: "reasoning", delta: "think" });
      expect(events.at(-1)).toMatchObject({
        type: "completed",
        model: "manual/model",
        assistantText: "héllo",
        reasoningText: "think",
        stopReason: "tool_calls",
        toolCalls: [
          { sourceId: "call-a", name: "read_file", arguments: '{"path":"a"}' },
          { sourceId: "call-b", name: "list_files", arguments: "{}" },
        ],
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cachedInputTokens: 3,
          reasoningTokens: 2,
        },
      });
    }),
  );

  it.effect(
    "fails on malformed JSON, upstream errors, missing terminal events and missing finish reasons",
    () =>
      Effect.gen(function* () {
        for (const frames of [
          ["{secret malformed"],
          ['{"error":{"message":"secret server details"}}'],
          ['{"choices":[{"index":0,"delta":{"content":"partial"}}]}'],
          ['{"choices":[{"index":0,"delta":{"content":"partial"}}]}', "[DONE]"],
          ['{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}'],
        ]) {
          const error = yield* decodeOpenAiCompatibleChatCompletionSse(sseBytes(frames)).pipe(
            Stream.runCollect,
            Effect.flip,
          );
          expect(error._tag).toBe("OpenAiCompatibleProtocolError");
          expect(error.message).not.toContain("secret");
        }
      }),
  );

  it.effect("fails before completing tool calls with malformed arguments or missing identity", () =>
    Effect.gen(function* () {
      for (const call of [
        '{"index":0,"id":"call","function":{"name":"read","arguments":"{broken"}}',
        '{"index":0,"function":{"name":"read","arguments":"{}"}}',
        '{"index":0,"id":"call","function":{"arguments":"{}"}}',
      ]) {
        const error = yield* decodeOpenAiCompatibleChatCompletionSse(
          sseBytes([
            `{"choices":[{"index":0,"delta":{"tool_calls":[${call}]},"finish_reason":"tool_calls"}]}`,
            "[DONE]",
          ]),
        ).pipe(Stream.runCollect, Effect.flip);
        expect(error._tag).toBe("OpenAiCompatibleProtocolError");
      }
    }),
  );

  it.effect("maps SSE framing errors and ends immediately after the completed response", () =>
    Effect.gen(function* () {
      const error = yield* decodeOpenAiCompatibleChatCompletionSse(
        Stream.succeed(new TextEncoder().encode("retry: 1000\n\n")),
      ).pipe(Stream.runCollect, Effect.flip);
      expect(error).toMatchObject({
        _tag: "OpenAiCompatibleProtocolError",
        message: "The endpoint SSE framing is invalid.",
      });
      const events = yield* decodeOpenAiCompatibleChatCompletionSse(
        sseBytes([
          '{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
          "[DONE]",
        ]).pipe(Stream.concat(Stream.never)),
      ).pipe(Stream.runCollect);
      expect(events.at(-1)?.type).toBe("completed");
    }),
  );

  it.effect("rejects missing, legacy or truncated function calls before completing the round", () =>
    Effect.gen(function* () {
      for (const [finishReason, delta] of [
        ["tool_calls", {}],
        ["function_call", { function_call: { name: "read_file", arguments: "{}" } }],
        [
          "length",
          {
            tool_calls: [
              { index: 0, id: "call", function: { name: "read_file", arguments: "{}" } },
            ],
          },
        ],
        [
          "content_filter",
          {
            tool_calls: [
              { index: 0, id: "call", function: { name: "read_file", arguments: "{}" } },
            ],
          },
        ],
      ]) {
        const error = yield* decodeOpenAiCompatibleChatCompletionSse(
          sseBytes([
            encodeJson({ choices: [{ index: 0, delta, finish_reason: finishReason }] }),
            "[DONE]",
          ]),
        ).pipe(Stream.runCollect, Effect.flip);
        expect(error._tag).toBe("OpenAiCompatibleProtocolError");
      }
    }),
  );
});
