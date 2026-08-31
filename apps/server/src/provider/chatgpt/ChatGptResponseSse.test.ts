import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { decodeChatGptResponseSse } from "./ChatGptResponseSse.ts";

const encoder = new TextEncoder();

describe("ChatGptResponseSse", () => {
  it.effect(
    "decodes split text, reasoning, encrypted items, calls, usage, and terminal state",
    () =>
      Effect.gen(function* () {
        const wire = [
          'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
          'data: {"type":"response.reasoning_summary_text.delta","delta":"Thinking"}\n\n',
          'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"r1","encrypted_content":"cipher","summary":[]}}\n\n',
          'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"f1","call_id":"call-1","name":"workspace_context","arguments":"{\\"q\\":\\"x\\"}"}}\n\n',
          'data: {"type":"response.completed","response":{"id":"resp-1","status":"completed","output":[],"usage":{"input_tokens":10,"output_tokens":4,"total_tokens":14,"input_tokens_details":{"cached_tokens":2},"output_tokens_details":{"reasoning_tokens":3}}}}\n\n',
          "data: [DONE]\n\n",
        ].join("");
        const split = Math.floor(wire.length / 2);
        const events = yield* decodeChatGptResponseSse(
          Stream.make(encoder.encode(wire.slice(0, split)), encoder.encode(wire.slice(split))),
        ).pipe(Stream.runCollect);

        expect(Array.from(events)).toEqual([
          { type: "outputTextDelta", delta: "Hello" },
          { type: "reasoningDelta", delta: "Thinking" },
          {
            type: "outputItemDone",
            item: { type: "reasoning", id: "r1", encryptedContent: "cipher", summary: [] },
          },
          {
            type: "outputItemDone",
            item: {
              type: "functionCall",
              id: "f1",
              callId: "call-1",
              name: "workspace_context",
              arguments: '{"q":"x"}',
            },
          },
          {
            type: "responseCompleted",
            responseId: "resp-1",
            status: "completed",
            outputItems: [],
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
              cachedInputTokens: 2,
              reasoningTokens: 3,
            },
          },
          { type: "streamDone" },
        ]);
      }),
  );

  it.effect("fails visibly on an unknown event type", () =>
    Effect.gen(function* () {
      const error = yield* decodeChatGptResponseSse(
        Stream.make(encoder.encode('data: {"type":"response.future_protocol"}\n\n')),
      ).pipe(Stream.runDrain, Effect.flip);
      expect(error._tag).toBe("ChatGptProtocolDriftError");
      expect(error.message).toContain("response.future_protocol");
    }),
  );

  it.effect("fails on a truncated final frame", () =>
    Effect.gen(function* () {
      const error = yield* decodeChatGptResponseSse(
        Stream.make(encoder.encode('data: {"type":"response.output_text.delta","delta":"x"}')),
      ).pipe(Stream.runDrain, Effect.flip);
      expect(error._tag).toBe("ChatGptProtocolDriftError");
      expect(error.message).toContain("truncated");
    }),
  );
});
