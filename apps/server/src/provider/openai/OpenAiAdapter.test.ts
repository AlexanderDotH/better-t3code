import { describe, expect, it } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { OpenAiCatalogModel } from "./OpenAiModelCatalog.ts";
import type { OpenAiRoundEvent } from "./OpenAiProtocol.ts";
import {
  decodeOpenAiPersistedHistory,
  encodeOpenAiPersistedHistory,
  normalizeOpenAiAdapterRoundEvent,
  resolveOpenAiModel,
} from "./OpenAiAdapter.ts";

const MODEL: OpenAiCatalogModel = {
  id: "gpt-5.6-sol",
  name: "GPT-5.6 Sol",
  contextWindowTokens: 1_050_000,
  maxOutputTokens: 128_000,
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
  defaultReasoningEffort: "medium",
  toolCapabilities: { tools: true, parallelToolCalls: true, toolChoice: true },
  isVerified: true,
};

describe("OpenAI adapter boundary", () => {
  it("gates disabled, empty, and unknown model selections", () => {
    expect(resolveOpenAiModel({ enabled: false }, [MODEL])).toEqual({
      ok: false,
      issue: "OpenAI Responses is disabled in this provider instance.",
    });
    expect(resolveOpenAiModel({ enabled: true }, [])).toEqual({
      ok: false,
      issue: "The authenticated OpenAI account returned no tested coding models.",
    });
    expect(resolveOpenAiModel({ enabled: true }, [MODEL], "unknown-model")).toEqual({
      ok: false,
      issue: "Model 'unknown-model' is not in the authenticated tested OpenAI catalog.",
    });
    expect(resolveOpenAiModel({ enabled: true }, [MODEL])).toEqual({
      ok: true,
      model: MODEL.id,
      catalogModel: MODEL,
    });
  });

  it("normalizes usage and parsed parallel tool calls for the native harness", () => {
    const event: OpenAiRoundEvent = {
      type: "completed",
      assistantText: "Inspecting.",
      reasoningText: "Need both files.",
      model: MODEL.id,
      stopReason: "completed",
      historyItems: [
        { type: "reasoning", encrypted_content: "opaque", summary: [] },
        {
          type: "function_call",
          id: "function-1",
          call_id: "call-1",
          name: "workspace_context",
          arguments: '{"queries":[]}',
        },
        {
          type: "function_call",
          id: "function-2",
          call_id: "call-2",
          name: "knowledge_graph_query",
          arguments: '{"query":"provider"}',
        },
      ],
      toolCalls: [
        {
          sourceId: "function-1",
          callId: "call-1",
          name: "workspace_context",
          arguments: '{"queries":[]}',
        },
        {
          sourceId: "function-2",
          callId: "call-2",
          name: "knowledge_graph_query",
          arguments: '{"query":"provider"}',
        },
      ],
      usage: {
        inputTokens: 12,
        cachedInputTokens: 3,
        outputTokens: 7,
        reasoningTokens: 2,
        totalTokens: 19,
      },
    };

    expect(normalizeOpenAiAdapterRoundEvent(event)).toEqual({
      type: "completed",
      assistantText: "Inspecting.",
      reasoningText: "Need both files.",
      historyItems: event.historyItems,
      toolCalls: [
        {
          sourceId: "function-1",
          name: "workspace_context",
          args: { queries: [] },
          metadata: { callId: "call-1" },
        },
        {
          sourceId: "function-2",
          name: "knowledge_graph_query",
          args: { query: "provider" },
          metadata: { callId: "call-2" },
        },
      ],
      stopReason: "completed",
      usage: {
        usedTokens: 19,
        inputTokens: 12,
        cachedInputTokens: 3,
        outputTokens: 7,
        reasoningOutputTokens: 2,
        raw: event.usage,
      },
    });
  });

  it("fails closed and redacts malformed function arguments", () => {
    const normalized = normalizeOpenAiAdapterRoundEvent({
      type: "completed",
      model: MODEL.id,
      stopReason: "completed",
      historyItems: [],
      toolCalls: [
        {
          callId: "call-1",
          name: "workspace_context",
          arguments: '{"apiKey":"secret-value"',
        },
      ],
    });

    expect(normalized).toEqual({
      type: "failed",
      message: "OpenAI returned malformed arguments for tool 'workspace_context'.",
    });
    expect(JSON.stringify(normalized)).not.toContain("secret-value");
  });

  it.effect("persists all encrypted output items and turn boundaries", () =>
    Effect.gen(function* () {
      const persisted = {
        sessionId: "11111111-1111-4111-8111-111111111111",
        history: [
          { type: "message", role: "user", content: "Inspect" },
          {
            type: "reasoning",
            id: "reasoning-1",
            encrypted_content: "encrypted-reasoning",
            summary: [],
          },
          {
            type: "message",
            id: "message-1",
            role: "assistant",
            content: [{ type: "output_text", text: "Done", annotations: [] }],
          },
        ],
        turns: [
          {
            id: TurnId.make("22222222-2222-4222-8222-222222222222"),
            historyStart: 0,
            historyEnd: 3,
            items: [],
          },
        ],
        totalProcessedTokens: 42,
      };

      const encoded = encodeOpenAiPersistedHistory(persisted);
      const decoded = yield* decodeOpenAiPersistedHistory(encoded, persisted.sessionId);

      expect(decoded).toEqual({
        history: persisted.history,
        turns: persisted.turns,
        totalProcessedTokens: 42,
      });
      expect(encoded).toContain("encrypted-reasoning");
    }),
  );
});
