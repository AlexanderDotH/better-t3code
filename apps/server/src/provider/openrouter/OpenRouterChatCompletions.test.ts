import { describe, expect, it } from "@effect/vitest";
import type { OpenRouterSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import {
  buildOpenRouterChatCompletionRequest,
  decodeOpenRouterChatCompletionSse,
} from "./OpenRouterChatCompletions.ts";
import type { OpenRouterRoundRequest } from "./OpenRouterProtocol.ts";

const SETTINGS = {
  enabled: true,
  protocol: "chat-completions",
  defaultModel: "anthropic/claude-sonnet-4",
  customModels: [],
  contextCompression: false,
  routingMode: "openrouter-default",
  providerOrder: [],
  routingSort: "price",
  allowFallbacks: "inherit",
  dataCollection: "inherit",
  requireZdr: false,
} as const satisfies OpenRouterSettings;

const request = (overrides: Partial<OpenRouterRoundRequest> = {}): OpenRouterRoundRequest => ({
  model: SETTINGS.defaultModel,
  instructions: "Use tools when useful.",
  history: [{ type: "user", content: "Inspect the workspace." }],
  tools: [
    {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  ],
  toolParameters: { toolChoice: true, parallelToolCalls: true },
  settings: SETTINGS,
  ...overrides,
});

const bytes = (text: string, cuts: ReadonlyArray<number>) => {
  const encoded = new TextEncoder().encode(text);
  const chunks: Array<Uint8Array> = [];
  let start = 0;
  for (const end of cuts) {
    chunks.push(encoded.slice(start, end));
    start = end;
  }
  chunks.push(encoded.slice(start));
  return Stream.fromIterable(chunks);
};

describe("OpenRouter Chat Completions", () => {
  it.effect(
    "builds an exact-model stateless tool request and replays reasoning details unchanged",
    () =>
      buildOpenRouterChatCompletionRequest(
        request({
          history: [
            { type: "user", content: "Calculate." },
            {
              type: "assistant",
              content: "",
              toolCalls: [{ id: "call-1", name: "calculator", arguments: '{"x":1}' }],
              opaque: {
                protocol: "chat-completions",
                reasoningDetails: [
                  { type: "reasoning.encrypted", data: "opaque-token", id: "reasoning-1" },
                ],
              },
            },
            { type: "tool", callId: "call-1", content: "2" },
          ],
        }),
      ).pipe(
        Effect.map((body) => {
          expect(body.model).toBe("anthropic/claude-sonnet-4");
          expect(body).not.toHaveProperty("models");
          expect(body).toMatchObject({
            stream: true,
            stream_options: { include_usage: true },
            parallel_tool_calls: true,
            store: false,
            provider: { require_parameters: true },
            plugins: [{ id: "context-compression", enabled: false }],
          });
          expect(body.messages[2]).toMatchObject({
            role: "assistant",
            reasoning_details: [
              { type: "reasoning.encrypted", data: "opaque-token", id: "reasoning-1" },
            ],
          });
        }),
      ),
  );

  it.effect("does not replay Responses opaque reasoning after a protocol switch", () =>
    buildOpenRouterChatCompletionRequest(
      request({
        history: [
          {
            type: "assistant",
            content: "Visible answer",
            opaque: {
              protocol: "responses",
              outputItems: [
                {
                  type: "reasoning",
                  id: "reasoning-1",
                  encrypted_content: "responses-only-secret",
                },
              ],
            },
          },
        ],
      }),
    ).pipe(
      Effect.map((body) => {
        expect(JSON.stringify(body)).not.toContain("responses-only-secret");
        expect(body.messages).toContainEqual({ role: "assistant", content: "Visible answer" });
      }),
    ),
  );

  it.effect("omits unsupported optional tool parameters so routing remains available", () =>
    buildOpenRouterChatCompletionRequest(
      request({
        model: "moonshotai/kimi-k3",
        toolParameters: { toolChoice: true, parallelToolCalls: false },
      }),
    ).pipe(
      Effect.map((body) => {
        expect(body.model).toBe("moonshotai/kimi-k3");
        expect(body.tool_choice).toBe("auto");
        expect(body).not.toHaveProperty("parallel_tool_calls");
        expect(body.provider).toEqual({ require_parameters: true });
      }),
    ),
  );

  it.effect("omits tool choice when the selected endpoint does not advertise it", () =>
    buildOpenRouterChatCompletionRequest(
      request({ toolParameters: { toolChoice: false, parallelToolCalls: false } }),
    ).pipe(
      Effect.map((body) => {
        expect(body).not.toHaveProperty("tool_choice");
        expect(body).not.toHaveProperty("parallel_tool_calls");
      }),
    ),
  );

  it.effect("decodes fragmented text, reasoning, parallel tool calls, usage, and cost", () => {
    const sse =
      [
        'data: {"id":"gen-1","model":"anthropic/claude-sonnet-4","object":"chat.completion.chunk","created":1,"choices":[{"index":0,"delta":{"reasoning":"why","reasoning_details":[{"type":"reasoning.encrypted","data":"opaque","id":"r1"}],"content":"hel","tool_calls":[{"index":0,"id":"call-a","type":"function","function":{"name":"read_","arguments":"{\\\"pa"}},{"index":1,"id":"call-b","type":"function","function":{"name":"list_files","arguments":"{}"}}]}}]}',
        'data: {"id":"gen-1","model":"anthropic/claude-sonnet-4","object":"chat.completion.chunk","created":1,"choices":[{"index":0,"delta":{"content":"lo","tool_calls":[{"index":0,"function":{"name":"file","arguments":"th\\\":\\\"a\\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15,"cost":0.001}}',
        "data: [DONE]",
      ].join("\n\n") + "\n\n";

    return decodeOpenRouterChatCompletionSse(bytes(sse, [7, 31, 149, 377])).pipe(
      Stream.runCollect,
      Effect.map((chunk) => {
        const events = Array.from(chunk);
        expect(events).toContainEqual({ type: "contentDelta", kind: "reasoning", delta: "why" });
        expect(events).toContainEqual({ type: "contentDelta", kind: "assistant", delta: "hel" });
        expect(events).toContainEqual({ type: "contentDelta", kind: "assistant", delta: "lo" });
        expect(events.at(-1)).toEqual({
          type: "completed",
          assistantText: "hello",
          reasoningText: "why",
          toolCalls: [
            { sourceId: "call-a", name: "read_file", arguments: '{"path":"a"}' },
            { sourceId: "call-b", name: "list_files", arguments: "{}" },
          ],
          historyItems: [
            {
              type: "assistant",
              content: "hello",
              reasoning: "why",
              toolCalls: [
                { id: "call-a", name: "read_file", arguments: '{"path":"a"}' },
                { id: "call-b", name: "list_files", arguments: "{}" },
              ],
              opaque: {
                protocol: "chat-completions",
                reasoningDetails: [{ type: "reasoning.encrypted", data: "opaque", id: "r1" }],
              },
            },
          ],
          model: "anthropic/claude-sonnet-4",
          stopReason: "tool_calls",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          totalCostUsd: 0.001,
        });
      }),
    );
  });

  it.effect("fails on malformed JSON instead of silently ending the turn", () =>
    decodeOpenRouterChatCompletionSse(
      Stream.fromIterable([new TextEncoder().encode("data: {not-json}\n\n")]),
    ).pipe(
      Stream.runDrain,
      Effect.flip,
      Effect.map((error) => expect(error._tag).toBe("OpenRouterProtocolError")),
    ),
  );

  it.effect("maps SSE decoder failures to a redacted protocol error", () =>
    decodeOpenRouterChatCompletionSse(
      Stream.fromIterable([new TextEncoder().encode("retry: 1000\n\n")]),
    ).pipe(
      Stream.runDrain,
      Effect.flip,
      Effect.map((error) => {
        expect(error._tag).toBe("OpenRouterProtocolError");
        expect(error.message).toBe("OpenRouter SSE stream framing is invalid");
      }),
    ),
  );
});
