import { describe, expect, it } from "@effect/vitest";
import { type OpenRouterSettings, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { OpenRouterCatalogModel } from "./OpenRouterModelCatalog.ts";
import type { OpenRouterRoundEvent } from "./OpenRouterProtocol.ts";
import {
  decodeOpenRouterPersistedHistory,
  encodeOpenRouterPersistedHistory,
  normalizeOpenRouterAdapterRoundEvent,
  resolveOpenRouterModel,
} from "./OpenRouterAdapter.ts";

const SETTINGS = {
  enabled: true,
  protocol: "chat-completions",
  defaultModel: "openai/gpt-5.5",
  customModels: [],
  contextCompression: false,
  routingMode: "openrouter-default",
  providerOrder: [],
  routingSort: "price",
  allowFallbacks: "inherit",
  dataCollection: "inherit",
  requireZdr: false,
} as const satisfies OpenRouterSettings;

const MODEL: OpenRouterCatalogModel = {
  id: "openai/gpt-5.5",
  name: "GPT 5.5",
  contextWindowTokens: 32_000,
  inputModalities: ["text"],
  outputModalities: ["text"],
  reasoningEfforts: ["low", "medium", "high"],
  defaultReasoningEffort: "medium",
  toolCapabilities: { tools: true, parallelToolCalls: true, toolChoice: true },
  isCustom: false,
  isVerified: true,
};

const INCOMPATIBLE_MODEL: OpenRouterCatalogModel = {
  ...MODEL,
  id: "openai/no-tools",
  name: "No tools",
  toolCapabilities: { tools: false, parallelToolCalls: false, toolChoice: false },
  incompatibilityReason: "This model does not support the tool calling required by T3 Code.",
};

describe("OpenRouter adapter boundary", () => {
  it("gates disabled, missing-default, stale-default, and unknown requested models", () => {
    expect(resolveOpenRouterModel({ ...SETTINGS, enabled: false }, [MODEL])).toEqual({
      ok: false,
      issue: "OpenRouter is disabled in this provider instance.",
    });
    expect(resolveOpenRouterModel({ ...SETTINGS, defaultModel: "" }, [MODEL])).toEqual({
      ok: false,
      issue: "Select an explicit OpenRouter default model before starting a turn.",
    });
    expect(resolveOpenRouterModel({ ...SETTINGS, defaultModel: "removed/model" }, [MODEL])).toEqual(
      {
        ok: false,
        issue: "Default model 'removed/model' is not in the authenticated OpenRouter catalog.",
      },
    );
    expect(resolveOpenRouterModel(SETTINGS, [MODEL], "unknown/model")).toEqual({
      ok: false,
      issue: "Model 'unknown/model' is not in the authenticated OpenRouter catalog.",
    });
    expect(
      resolveOpenRouterModel({ ...SETTINGS, defaultModel: INCOMPATIBLE_MODEL.id }, [
        MODEL,
        INCOMPATIBLE_MODEL,
      ]),
    ).toEqual({
      ok: false,
      issue: `Default model '${INCOMPATIBLE_MODEL.id}' is not compatible with T3 Code: ${INCOMPATIBLE_MODEL.incompatibilityReason}`,
    });
    expect(
      resolveOpenRouterModel(SETTINGS, [MODEL, INCOMPATIBLE_MODEL], INCOMPATIBLE_MODEL.id),
    ).toEqual({
      ok: false,
      issue: `Model '${INCOMPATIBLE_MODEL.id}' is not compatible with T3 Code: ${INCOMPATIBLE_MODEL.incompatibilityReason}`,
    });
    expect(resolveOpenRouterModel(SETTINGS, [MODEL])).toEqual({
      ok: true,
      model: "openai/gpt-5.5",
      catalogModel: MODEL,
    });
  });

  it("normalizes usage and parsed tool calls for the shared native harness", () => {
    const event: OpenRouterRoundEvent = {
      type: "completed",
      assistantText: "Inspecting.",
      reasoningText: "Need status.",
      model: "openai/gpt-5.5",
      stopReason: "tool_calls",
      historyItems: [
        {
          type: "assistant",
          content: "Inspecting.",
          toolCalls: [{ id: "call-1", name: "status", arguments: '{"scope":"repo"}' }],
          opaque: {
            protocol: "chat-completions",
            reasoningDetails: [{ type: "reasoning.encrypted", data: "opaque" }],
          },
        },
      ],
      toolCalls: [
        {
          sourceId: "call-1",
          name: "status",
          arguments: '{"scope":"repo"}',
        },
      ],
      usage: {
        inputTokens: 8,
        cachedInputTokens: 2,
        outputTokens: 5,
        reasoningTokens: 3,
        totalTokens: 13,
      },
      totalCostUsd: 0.004,
    };

    expect(normalizeOpenRouterAdapterRoundEvent(event)).toEqual({
      type: "completed",
      assistantText: "Inspecting.",
      reasoningText: "Need status.",
      historyItems: event.historyItems,
      toolCalls: [
        {
          sourceId: "call-1",
          name: "status",
          args: { scope: "repo" },
          metadata: { callId: "call-1" },
        },
      ],
      stopReason: "tool_calls",
      usage: {
        usedTokens: 13,
        inputTokens: 8,
        cachedInputTokens: 2,
        outputTokens: 5,
        reasoningOutputTokens: 3,
        raw: event.usage,
        totalCostUsd: 0.004,
      },
    });
  });

  it("fails closed and redacts malformed tool arguments", () => {
    const normalized = normalizeOpenRouterAdapterRoundEvent({
      type: "completed",
      model: "openai/gpt-5.5",
      historyItems: [],
      toolCalls: [
        {
          sourceId: "call-1",
          name: "status",
          arguments: '{"apiKey":"secret-value"',
        },
      ],
    });

    expect(normalized).toEqual({
      type: "failed",
      message: "OpenRouter returned malformed arguments for tool 'status'.",
    });
    expect(JSON.stringify(normalized)).not.toContain("secret-value");
  });

  it.effect("persists protocol-neutral history with protocol-tagged opaque reasoning", () =>
    Effect.gen(function* () {
      const persisted = {
        sessionId: "11111111-1111-4111-8111-111111111111",
        history: [
          { type: "user", content: "Hello" } as const,
          {
            type: "assistant",
            content: "Hi",
            opaque: {
              protocol: "chat-completions",
              reasoningDetails: [{ type: "reasoning.encrypted", data: "opaque-chat" }],
            },
          } as const,
          {
            type: "assistant",
            content: "Again",
            opaque: {
              protocol: "responses",
              outputItems: [
                { type: "reasoning", id: "reasoning-1", encrypted_content: "opaque-response" },
              ],
            },
          } as const,
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
      const encoded = encodeOpenRouterPersistedHistory(persisted);
      const decoded = yield* decodeOpenRouterPersistedHistory(encoded, persisted.sessionId);

      expect(decoded).toEqual({
        history: persisted.history,
        turns: persisted.turns,
        totalProcessedTokens: 42,
      });
      expect(encoded).toContain('"protocol":"chat-completions"');
      expect(encoded).toContain('"protocol":"responses"');
    }),
  );
});
