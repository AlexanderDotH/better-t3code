import { describe, expect, it } from "@effect/vitest";
import { type OpenRouterSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { makeOpenRouterDecisionGeneration } from "./OpenRouterDecisionGeneration.ts";
import type { OpenRouterCatalogModel } from "./OpenRouterModelCatalog.ts";
import type { OpenRouterRoundRequest } from "./OpenRouterProtocol.ts";
import type { OpenRouterDecisionsRequest } from "./OpenRouterDecisions.ts";
import type { OpenRouterTransport } from "./OpenRouterTransport.ts";

const SETTINGS = {
  enabled: true,
  protocol: "chat-completions",
  defaultModel: "openai/default-model",
  customModels: [],
  contextCompression: false,
  routingMode: "openrouter-default",
  providerOrder: [],
  routingSort: "price",
  allowFallbacks: "inherit",
  dataCollection: "inherit",
  requireZdr: false,
} as const satisfies OpenRouterSettings;

const NATIVE_MODEL: OpenRouterCatalogModel = {
  id: "research/future-system-one",
  name: "Future System One",
  inputModalities: ["text"],
  outputModalities: ["decisions"],
  reasoningEfforts: [],
  toolCapabilities: { tools: false, parallelToolCalls: false, toolChoice: false },
  selectionSupport: { agent: false, textGeneration: false, decision: "native" },
  incompatibilityReason: "Only available for decision features.",
  isCustom: false,
  isVerified: true,
};

const PROMPTED_MODEL: OpenRouterCatalogModel = {
  id: "typesafe/generative-router",
  name: "Generative Router",
  inputModalities: ["text"],
  outputModalities: ["text"],
  reasoningEfforts: ["low"],
  toolCapabilities: { tools: false, parallelToolCalls: false, toolChoice: false },
  selectionSupport: { agent: false, textGeneration: true, decision: "prompted" },
  incompatibilityReason: "This model does not support the tool calling required by T3 Code.",
  isCustom: false,
  isVerified: true,
};

const request = (model: string) => ({
  cwd: "/workspace",
  modelSelection: {
    instanceId: ProviderInstanceId.make("openrouter"),
    model,
    options: [{ id: "reasoningEffort", value: "low" }],
  },
  state: "Implement the selected feature.",
  questions: {
    context: {
      instructions: "Should the retrieved context be included?",
      criteria: {
        include: "The context contains useful project facts.",
        skip: "The context is irrelevant or redundant.",
      },
    },
  },
});

function makeTransport(
  catalog: ReadonlyArray<OpenRouterCatalogModel>,
  overrides: Partial<OpenRouterTransport>,
): OpenRouterTransport {
  return {
    listModels: () => Effect.succeed(catalog),
    decide: () => Effect.die("unexpected native decision"),
    streamRound: () => Stream.die("unexpected prompted decision"),
    ...overrides,
  };
}

describe("OpenRouter decision generation", () => {
  it.effect("dispatches metadata-classified native models to the Decisions API", () =>
    Effect.gen(function* () {
      const requests: Array<OpenRouterDecisionsRequest> = [];
      const transport = makeTransport([NATIVE_MODEL], {
        decide: (input) =>
          Effect.sync(() => {
            requests.push(input);
            return {
              model: "research/future-system-one-20260928",
              answers: {
                context: {
                  type: "choice" as const,
                  choice: "include",
                  probabilities: { include: 0.95, skip: 0.05 },
                  confidence: 0.9,
                },
              },
              usage: { input_tokens: 30, output_tokens: 4, cost: 0.00002 },
            };
          }),
      });
      const provider = makeOpenRouterDecisionGeneration(SETTINGS, transport);

      const result = yield* provider.decide(request(NATIVE_MODEL.id));

      expect(requests).toEqual([
        {
          model: NATIVE_MODEL.id,
          state: "Implement the selected feature.",
          questions: {
            context: {
              type: "choice",
              instructions: "Should the retrieved context be included?",
              criteria: {
                include: "The context contains useful project facts.",
                skip: "The context is irrelevant or redundant.",
              },
            },
          },
        },
      ]);
      expect(result).toEqual({
        model: "research/future-system-one-20260928",
        answers: {
          context: {
            choice: "include",
            probabilities: { include: 0.95, skip: 0.05 },
            confidence: 0.9,
          },
        },
        usage: { inputTokens: 30, outputTokens: 4, totalTokens: 34, costUsd: 0.00002 },
      });
    }),
  );

  it.effect("uses the selected generative model for strict prompted decisions", () =>
    Effect.gen(function* () {
      const rounds: Array<OpenRouterRoundRequest> = [];
      const transport = makeTransport([PROMPTED_MODEL], {
        streamRound: (round) => {
          rounds.push(round);
          return Stream.succeed({
            type: "completed" as const,
            assistantText: '{"answers":{"context":{"choice":"skip"}}}',
            model: PROMPTED_MODEL.id,
            historyItems: [
              {
                type: "assistant" as const,
                content: '{"answers":{"context":{"choice":"skip"}}}',
              },
            ],
            toolCalls: [],
            usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 },
          });
        },
      });
      const provider = makeOpenRouterDecisionGeneration(SETTINGS, transport);

      const result = yield* provider.decide(request(PROMPTED_MODEL.id));

      expect(result).toEqual({
        model: PROMPTED_MODEL.id,
        answers: { context: { choice: "skip" } },
        usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 },
      });
      expect(rounds).toHaveLength(1);
      expect(rounds[0]).toMatchObject({
        model: PROMPTED_MODEL.id,
        tools: [],
        reasoningEffort: "low",
        responseFormat: { type: "json-schema", name: "t3_decisions", strict: true },
      });
      expect(rounds[0]?.model).not.toBe(SETTINGS.defaultModel);
      expect(rounds[0]?.history[0]).toMatchObject({
        type: "user",
        content: expect.stringContaining("Implement the selected feature."),
      });
    }),
  );

  it.effect("rejects models whose catalog metadata does not support decisions", () =>
    Effect.gen(function* () {
      const unsupported = {
        ...PROMPTED_MODEL,
        id: "image/generator",
        outputModalities: ["image"],
        selectionSupport: { agent: false, textGeneration: false, decision: "none" as const },
      };
      const provider = makeOpenRouterDecisionGeneration(SETTINGS, makeTransport([unsupported], {}));

      const error = yield* Effect.flip(provider.decide(request(unsupported.id)));

      expect(error).toMatchObject({
        _tag: "DecisionGenerationError",
        reason: "unsupported-model",
      });
    }),
  );
});
