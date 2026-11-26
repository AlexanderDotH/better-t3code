import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { buildOpenResponsesRequest, decodeOpenResponsesSse } from "./OpenResponses.ts";

const sse = (frames: ReadonlyArray<Record<string, unknown> | string>) =>
  Stream.fromIterable([
    new TextEncoder().encode(
      frames
        .map((frame) =>
          typeof frame === "string"
            ? `data: ${frame}\n\n`
            : `event: ${String(frame.type)}\ndata: ${JSON.stringify(frame)}\n\n`,
        )
        .join(""),
    ),
  ]);

const decode = (frames: ReadonlyArray<Record<string, unknown> | string>) =>
  decodeOpenResponsesSse(sse(frames), { label: "Open Responses" }).pipe(Stream.runCollect);

describe("Open Responses", () => {
  it("builds a stateless request that replays prior output items and relaxes tool strictness", () => {
    const body = buildOpenResponsesRequest({
      model: "gpt-oss-120b",
      instructions: "  ",
      history: [
        { type: "user", content: "Inspect." },
        {
          type: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "status", arguments: "{}" }],
        },
        { type: "tool", callId: "call-1", content: "clean" },
        {
          type: "assistant",
          content: "Clean.",
          outputItems: [{ type: "reasoning", id: "r1", summary: [], encrypted_content: "e" }],
        },
      ],
      tools: [{ name: "status", parameters: { type: "object" } }],
    });

    expect(body).not.toHaveProperty("instructions");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).toMatchObject({
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      tools: [{ type: "function", name: "status", parameters: { type: "object" }, strict: false }],
    });
    expect(body.input).toEqual([
      { type: "message", role: "user", content: "Inspect." },
      { type: "function_call", call_id: "call-1", name: "status", arguments: "{}" },
      { type: "function_call_output", call_id: "call-1", output: "clean" },
      { type: "reasoning", id: "r1", summary: [], encrypted_content: "e" },
    ]);
    expect(
      buildOpenResponsesRequest({ model: "m", instructions: "", history: [], tools: [] }),
    ).not.toHaveProperty("tools");
  });

  it.effect("follows the spec event names and ignores vendor events", () =>
    decode([
      { type: "response.created", sequence_number: 0, response: { status: "queued", usage: null } },
      { type: "acme:trace_event", sequence_number: 1 },
      { type: "response.reasoning.delta", sequence_number: 2, delta: "think" },
      { type: "response.output_text.delta", sequence_number: 3, delta: "Hi" },
      {
        type: "response.output_item.done",
        sequence_number: 4,
        item: { type: "function_call", call_id: "call-1", name: "status", arguments: "{}" },
      },
      {
        type: "response.completed",
        sequence_number: 5,
        response: { model: "gpt-oss-120b", status: "completed", output: [], usage: null },
      },
      "[DONE]",
    ]).pipe(
      Effect.map((events) => {
        expect(Array.from(events)).toEqual([
          { type: "contentDelta", kind: "reasoning", delta: "think" },
          { type: "contentDelta", kind: "assistant", delta: "Hi" },
          {
            type: "completed",
            model: "gpt-oss-120b",
            status: "completed",
            assistantText: "Hi",
            reasoningText: "think",
            toolCalls: [{ callId: "call-1", name: "status", arguments: "{}" }],
            outputItems: [
              { type: "function_call", call_id: "call-1", name: "status", arguments: "{}" },
            ],
          },
        ]);
      }),
    ),
  );

  it.effect("reports stream errors by code only and requires a terminal event", () =>
    Effect.gen(function* () {
      const failures = yield* Effect.forEach(
        [
          [{ type: "error", error: { code: "rate_limit_exceeded", message: "key sk-123 over" } }],
          [
            {
              type: "response.incomplete",
              response: { incomplete_details: { reason: "max_output_tokens" } },
            },
          ],
          [{ type: "response.output_text.delta", delta: "partial" }],
        ],
        (frames) => decode(frames).pipe(Effect.flip),
      );

      expect(failures.map((error) => error.message)).toEqual([
        "Open Responses stream reported an error (rate_limit_exceeded)",
        "Open Responses stream ended incomplete (max_output_tokens)",
        "Open Responses stream ended without a terminal event",
      ]);
      expect(JSON.stringify(failures)).not.toContain("sk-123");
    }),
  );
});
