import { describe, expect, it } from "@effect/vitest";
import type { OpenRouterSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { OpenRouterRoundRequest } from "./OpenRouterProtocol.ts";
import {
  buildOpenRouterResponsesRequest,
  decodeOpenRouterResponsesSse,
} from "./OpenRouterResponses.ts";

const SETTINGS = {
  enabled: true,
  protocol: "responses",
  defaultModel: "openai/gpt-5.5",
  customModels: [],
  contextCompression: true,
  routingMode: "sort",
  providerOrder: [],
  routingSort: "throughput",
  allowFallbacks: "inherit",
  dataCollection: "inherit",
  requireZdr: false,
} as const satisfies OpenRouterSettings;

const request = (overrides: Partial<OpenRouterRoundRequest> = {}): OpenRouterRoundRequest => ({
  model: SETTINGS.defaultModel,
  instructions: "Use the available tools.",
  history: [{ type: "user", content: "Inspect status." }],
  tools: [
    {
      name: "status",
      description: "Read status",
      parameters: { type: "object", properties: {} },
    },
  ],
  toolParameters: { toolChoice: true, parallelToolCalls: true },
  settings: SETTINGS,
  ...overrides,
});

const responseEnvelope = (input: {
  readonly status: "completed" | "failed";
  readonly output?: ReadonlyArray<Record<string, unknown>>;
  readonly error?: { readonly code: "server_error"; readonly message: string } | null;
  readonly usage?: Record<string, unknown>;
}) => ({
  completed_at: input.status === "completed" ? 2 : null,
  created_at: 1,
  error: input.error ?? null,
  frequency_penalty: null,
  id: "response-1",
  incomplete_details: null,
  instructions: "Use the available tools.",
  metadata: null,
  model: "openai/gpt-5.5",
  object: "response",
  output: input.output ?? [],
  parallel_tool_calls: true,
  presence_penalty: null,
  status: input.status,
  store: false,
  temperature: null,
  tool_choice: "auto",
  tools: [],
  top_p: null,
  ...(input.usage === undefined ? {} : { usage: input.usage }),
});

describe("OpenRouter Responses beta", () => {
  it.effect("builds a stateless exact-model request without a previous response id", () =>
    buildOpenRouterResponsesRequest(
      request({
        history: [
          { type: "user", content: "First" },
          {
            type: "assistant",
            content: "Previous",
            opaque: {
              protocol: "responses",
              outputItems: [
                {
                  type: "reasoning",
                  id: "reasoning-1",
                  encrypted_content: "opaque-reasoning",
                  summary: [],
                },
                {
                  type: "message",
                  id: "message-1",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: "Previous", annotations: [] }],
                },
              ],
            },
          },
        ],
      }),
    ).pipe(
      Effect.map((body) => {
        expect(body).toMatchObject({
          model: "openai/gpt-5.5",
          store: false,
          stream: true,
          parallel_tool_calls: true,
          include: ["reasoning.encrypted_content"],
          provider: { require_parameters: true, sort: "throughput" },
          plugins: [{ id: "context-compression", enabled: true }],
        });
        expect(body).not.toHaveProperty("models");
        expect(body).not.toHaveProperty("previous_response_id");
        expect(body.input).toContainEqual(
          expect.objectContaining({
            type: "reasoning",
            encrypted_content: "opaque-reasoning",
          }),
        );
      }),
    ),
  );

  it.effect("does not replay Chat Completions opaque reasoning after a protocol switch", () =>
    buildOpenRouterResponsesRequest(
      request({
        history: [
          {
            type: "assistant",
            content: "Visible answer",
            opaque: {
              protocol: "chat-completions",
              reasoningDetails: [{ type: "reasoning.encrypted", data: "chat-only-secret" }],
            },
          },
        ],
      }),
    ).pipe(
      Effect.map((body) => {
        expect(JSON.stringify(body)).not.toContain("chat-only-secret");
        expect(body.input).toContainEqual({
          type: "message",
          role: "assistant",
          content: "Visible answer",
        });
      }),
    ),
  );

  it.effect("omits unsupported optional tool parameters from beta Responses requests", () =>
    buildOpenRouterResponsesRequest(
      request({
        model: "moonshotai/kimi-k3",
        toolParameters: { toolChoice: true, parallelToolCalls: false },
      }),
    ).pipe(
      Effect.map((body) => {
        expect(body.model).toBe("moonshotai/kimi-k3");
        expect(body.tool_choice).toBe("auto");
        expect(body).not.toHaveProperty("parallel_tool_calls");
        expect(body.provider).toEqual({ require_parameters: true, sort: "throughput" });
      }),
    ),
  );

  it.effect("streams text, reasoning, tool calls, opaque output items, usage, and cost", () => {
    const frames = [
      {
        type: "response.reasoning_summary_text.delta",
        delta: "plan",
        item_id: "reasoning-1",
        output_index: 0,
        summary_index: 0,
        sequence_number: 1,
      },
      {
        type: "response.output_text.delta",
        delta: "done",
        item_id: "message-1",
        output_index: 1,
        content_index: 0,
        logprobs: [],
        sequence_number: 2,
      },
      {
        type: "response.output_item.done",
        output_index: 2,
        sequence_number: 3,
        item: {
          type: "function_call",
          id: "function-1",
          call_id: "call-1",
          name: "status",
          arguments: "{}",
          status: "completed",
        },
      },
      {
        type: "response.completed",
        sequence_number: 4,
        response: responseEnvelope({
          status: "completed",
          output: [
            {
              type: "reasoning",
              id: "reasoning-1",
              encrypted_content: "opaque-response-reasoning",
              summary: [{ type: "summary_text", text: "plan" }],
              status: "completed",
            },
            {
              type: "message",
              id: "message-1",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "done", annotations: [] }],
            },
            {
              type: "function_call",
              id: "function-1",
              call_id: "call-1",
              name: "status",
              arguments: "{}",
              status: "completed",
            },
          ],
          usage: {
            input_tokens: 8,
            output_tokens: 4,
            total_tokens: 12,
            input_tokens_details: { cached_tokens: 2 },
            output_tokens_details: { reasoning_tokens: 1 },
            cost: 0.002,
          },
        }),
      },
    ];
    const sse = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
    const encoded = new TextEncoder().encode(sse);
    const chunks = [encoded.slice(0, 17), encoded.slice(17, 211), encoded.slice(211)];

    return decodeOpenRouterResponsesSse(Stream.fromIterable(chunks)).pipe(
      Stream.runCollect,
      Effect.map((chunk) => {
        const events = Array.from(chunk);
        expect(events.slice(0, 2)).toEqual([
          { type: "contentDelta", kind: "reasoning", delta: "plan" },
          { type: "contentDelta", kind: "assistant", delta: "done" },
        ]);
        expect(events.at(-1)).toEqual({
          type: "completed",
          assistantText: "done",
          reasoningText: "plan",
          toolCalls: [
            {
              sourceId: "call-1",
              name: "status",
              arguments: "{}",
              metadata: { itemId: "function-1" },
            },
          ],
          historyItems: [
            {
              type: "assistant",
              content: "done",
              reasoning: "plan",
              toolCalls: [{ id: "call-1", name: "status", arguments: "{}" }],
              opaque: {
                protocol: "responses",
                outputItems: frames[3]!.response.output,
              },
            },
          ],
          model: "openai/gpt-5.5",
          stopReason: "completed",
          usage: {
            inputTokens: 8,
            outputTokens: 4,
            totalTokens: 12,
            cachedInputTokens: 2,
            reasoningTokens: 1,
          },
          totalCostUsd: 0.002,
        });
      }),
    );
  });

  it.effect("turns incomplete and failed terminal events into typed protocol errors", () => {
    const frame = {
      type: "response.failed",
      sequence_number: 1,
      response: {
        ...responseEnvelope({
          status: "failed",
          error: { code: "server_error", message: "upstream failed" },
        }),
      },
    };

    return decodeOpenRouterResponsesSse(
      Stream.fromIterable([new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)]),
    ).pipe(
      Stream.runDrain,
      Effect.flip,
      Effect.map((error) => {
        expect(error._tag).toBe("OpenRouterProtocolError");
        expect(error.message).toContain("failed");
        expect(error.message).not.toContain("upstream failed");
      }),
    );
  });

  it.effect("redacts malformed or unsupported SSE frames behind a typed protocol error", () =>
    decodeOpenRouterResponsesSse(
      Stream.fromIterable([
        new TextEncoder().encode(
          'data: {"type":"response.output_text.delta","delta":{"secret":"body-value"}}\n\n',
        ),
      ]),
    ).pipe(
      Stream.runDrain,
      Effect.flip,
      Effect.map((error) => {
        expect(error._tag).toBe("OpenRouterProtocolError");
        expect(error.message).toBe("OpenRouter Responses SSE frame is malformed or unsupported");
        expect(JSON.stringify(error)).not.toContain("body-value");
      }),
    ),
  );
});
