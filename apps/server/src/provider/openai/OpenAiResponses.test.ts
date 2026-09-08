import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { OpenAiRoundRequest } from "./OpenAiProtocol.ts";
import {
  buildOpenAiResponsesRequest,
  decodeOpenAiResponsesSse,
  OpenAiProtocolError,
} from "./OpenAiResponses.ts";

const request = (overrides: Partial<OpenAiRoundRequest> = {}): OpenAiRoundRequest => ({
  model: "gpt-5.6-sol",
  instructions: "Use only T3-owned tools.",
  history: [{ type: "message", role: "user", content: "Inspect the repository." }],
  tools: [
    {
      name: "workspace_context",
      description: "Read bounded workspace context",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          queries: { type: "array", items: { type: "object" } },
          contextLines: { type: "integer" },
        },
        required: ["queries"],
      },
    },
  ],
  reasoningEffort: "high",
  ...overrides,
});

const completedResponse = {
  id: "response-1",
  model: "gpt-5.6-sol",
  status: "completed",
  error: null,
  incomplete_details: null,
  output: [
    {
      type: "reasoning",
      id: "reasoning-1",
      encrypted_content: "encrypted-reasoning",
      summary: [{ type: "summary_text", text: "Inspect first." }],
      status: "completed",
    },
    {
      type: "message",
      id: "message-1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Inspecting.", annotations: [] }],
    },
    {
      type: "function_call",
      id: "function-1",
      call_id: "call-1",
      name: "workspace_context",
      arguments: "{}",
      status: "completed",
    },
  ],
  usage: {
    input_tokens: 8,
    output_tokens: 5,
    total_tokens: 13,
    input_tokens_details: { cached_tokens: 2, cache_write_tokens: 4 },
    output_tokens_details: { reasoning_tokens: 3 },
  },
};

const encodeFrames = (frames: ReadonlyArray<unknown>): Uint8Array =>
  new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""));

describe("OpenAI Responses protocol", () => {
  it("builds a stateless all-turns request with T3-validated function tools", () => {
    const priorReasoning = {
      type: "reasoning",
      id: "reasoning-0",
      encrypted_content: "opaque-prior-reasoning",
      summary: [],
    } as const;
    const body = buildOpenAiResponsesRequest(
      request({
        history: [
          { type: "message", role: "user", content: "First turn" },
          priorReasoning,
          {
            type: "message",
            id: "message-0",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Previous answer", annotations: [] }],
          },
        ],
      }),
    );

    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      parallel_tool_calls: true,
      tool_choice: "auto",
      reasoning: { effort: "high", context: "all_turns", summary: "auto" },
    });
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body.tools).toEqual([
      {
        type: "function",
        name: "workspace_context",
        description: "Read bounded workspace context",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            queries: { type: "array", items: { type: "object" } },
            contextLines: { type: "integer" },
          },
          required: ["queries"],
        },
        strict: false,
      },
    ]);
    expect(body.input).toContainEqual(priorReasoning);
    expect(JSON.stringify(body.tools)).not.toMatch(/hosted|shell|mcp_server/iu);
  });

  it("uses strict Structured Outputs without exposing coding tools", () => {
    const body = buildOpenAiResponsesRequest(
      request({
        tools: [],
        responseFormat: {
          name: "status",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
        },
      }),
    );

    expect(body.tools).toEqual([]);
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.text).toEqual({
      format: {
        type: "json_schema",
        name: "status",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
        strict: true,
      },
    });
  });

  it.effect("streams text and reasoning, then preserves every terminal output item", () =>
    Effect.gen(function* () {
      const frames = encodeFrames([
        {
          type: "response.reasoning_summary_text.delta",
          delta: "Inspect first.",
          item_id: "reasoning-1",
          output_index: 0,
          summary_index: 0,
          sequence_number: 1,
        },
        {
          type: "response.output_text.delta",
          delta: "Inspecting.",
          item_id: "message-1",
          output_index: 1,
          content_index: 0,
          sequence_number: 2,
        },
        { type: "response.completed", sequence_number: 3, response: completedResponse },
      ]);

      const events = yield* decodeOpenAiResponsesSse(Stream.succeed(frames)).pipe(
        Stream.runCollect,
      );

      expect(Array.from(events)).toEqual([
        {
          type: "contentDelta",
          kind: "reasoning",
          sourceId: "reasoning-1",
          delta: "Inspect first.",
        },
        {
          type: "contentDelta",
          kind: "assistant",
          sourceId: "message-1",
          delta: "Inspecting.",
        },
        {
          type: "completed",
          assistantText: "Inspecting.",
          reasoningText: "Inspect first.",
          model: "gpt-5.6-sol",
          stopReason: "completed",
          historyItems: completedResponse.output,
          toolCalls: [
            {
              sourceId: "function-1",
              callId: "call-1",
              name: "workspace_context",
              arguments: "{}",
            },
          ],
          usage: {
            inputTokens: 8,
            cachedInputTokens: 2,
            cacheWriteInputTokens: 4,
            outputTokens: 5,
            reasoningTokens: 3,
            totalTokens: 13,
          },
        },
      ]);
      expect(JSON.stringify(Array.from(events))).toContain("encrypted-reasoning");
    }),
  );

  it.effect("fails closed for incomplete and malformed streams without echoing payloads", () =>
    Effect.gen(function* () {
      const incomplete = encodeFrames([
        {
          type: "response.incomplete",
          sequence_number: 1,
          response: { ...completedResponse, status: "incomplete", output: [] },
        },
      ]);
      const incompleteError = yield* Effect.flip(
        decodeOpenAiResponsesSse(Stream.succeed(incomplete)).pipe(Stream.runCollect),
      );
      expect(incompleteError).toBeInstanceOf(OpenAiProtocolError);
      expect(incompleteError.message).toContain("incomplete");

      const secret = "sk-secret-in-malformed-frame";
      const malformedError = yield* Effect.flip(
        decodeOpenAiResponsesSse(
          Stream.succeed(new TextEncoder().encode(`data: {"secret":"${secret}"}\n\n`)),
        ).pipe(Stream.runCollect),
      );
      expect(malformedError).toBeInstanceOf(OpenAiProtocolError);
      expect(JSON.stringify(malformedError)).not.toContain(secret);
    }),
  );

  it.effect("fails closed for failed and top-level error terminal events", () =>
    Effect.gen(function* () {
      const secret = "upstream-secret-detail";
      const failedError = yield* Effect.flip(
        decodeOpenAiResponsesSse(
          Stream.succeed(
            encodeFrames([
              {
                type: "response.failed",
                sequence_number: 1,
                response: {
                  ...completedResponse,
                  status: "failed",
                  output: [],
                  error: { message: secret },
                },
              },
            ]),
          ),
        ).pipe(Stream.runCollect),
      );
      expect(failedError).toBeInstanceOf(OpenAiProtocolError);
      expect(failedError.message).toBe("OpenAI response ended with failed");
      expect(JSON.stringify(failedError)).not.toContain(secret);

      const streamError = yield* Effect.flip(
        decodeOpenAiResponsesSse(
          Stream.succeed(
            encodeFrames([
              {
                type: "error",
                code: "server_error",
                message: secret,
                sequence_number: 1,
              },
            ]),
          ),
        ).pipe(Stream.runCollect),
      );
      expect(streamError).toBeInstanceOf(OpenAiProtocolError);
      expect(streamError.message).toBe("OpenAI response stream reported an error");
      expect(JSON.stringify(streamError)).not.toContain(secret);
    }),
  );
});
