import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  decodeOpenRouterModelCatalog,
  mergeOpenRouterCustomModels,
} from "./OpenRouterModelCatalog.ts";

const catalogModel = (input: {
  readonly id: string;
  readonly name: string;
  readonly inputModalities?: ReadonlyArray<"text" | "image">;
  readonly outputModalities: ReadonlyArray<"text" | "image">;
  readonly supportedParameters: ReadonlyArray<
    "tools" | "reasoning" | "temperature" | "parallel_tool_calls" | "tool_choice"
  >;
  readonly description?: string;
  readonly contextLength?: number;
  readonly reasoning?: {
    readonly mandatory: boolean;
    readonly supported_efforts?: ReadonlyArray<
      "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none"
    > | null;
    readonly default_effort?: "high" | "medium" | "low";
  };
}) => ({
  architecture: {
    input_modalities: input.inputModalities ?? ["text"],
    modality: null,
    output_modalities: input.outputModalities,
  },
  canonical_slug: input.id,
  context_length: input.contextLength ?? 32_000,
  created: 1,
  default_parameters: null,
  ...(input.description === undefined ? {} : { description: input.description }),
  id: input.id,
  links: { details: `https://openrouter.ai/${input.id}` },
  name: input.name,
  per_request_limits: null,
  pricing: { prompt: "0.000003", completion: "0.000015" },
  ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
  supported_parameters: input.supportedParameters,
  supported_voices: null,
  top_provider: { is_moderated: false },
});

const catalog = (data: ReadonlyArray<ReturnType<typeof catalogModel>>) => ({
  data,
  links: { next: null },
  total_count: data.length,
});

describe("OpenRouter model catalog", () => {
  it.effect("keeps the full authenticated catalog and classifies agent compatibility", () =>
    Effect.gen(function* () {
      const models = yield* decodeOpenRouterModelCatalog(
        catalog([
          catalogModel({
            id: "anthropic/claude-sonnet-4",
            name: "Claude Sonnet 4",
            description: "Agentic model",
            contextLength: 200_000,
            inputModalities: ["text", "image"],
            outputModalities: ["text"],
            supportedParameters: ["tools", "reasoning", "parallel_tool_calls", "tool_choice"],
            reasoning: {
              mandatory: false,
              supported_efforts: ["high", "medium", "low"],
              default_effort: "medium",
            },
          }),
          catalogModel({
            id: "image/only",
            name: "Image only",
            outputModalities: ["image"],
            supportedParameters: ["tools"],
          }),
          catalogModel({
            id: "chat/no-tools",
            name: "No tools",
            outputModalities: ["text"],
            supportedParameters: ["temperature"],
          }),
        ]),
      );

      expect(models).toEqual([
        {
          id: "anthropic/claude-sonnet-4",
          name: "Claude Sonnet 4",
          description: "Agentic model",
          contextWindowTokens: 200_000,
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          promptPriceUsdPerMillion: 3,
          completionPriceUsdPerMillion: 15,
          reasoningEfforts: ["high", "medium", "low"],
          defaultReasoningEffort: "medium",
          toolCapabilities: {
            tools: true,
            parallelToolCalls: true,
            toolChoice: true,
          },
          isCustom: false,
          isVerified: true,
        },
        expect.objectContaining({
          id: "image/only",
          outputModalities: ["image"],
          toolCapabilities: expect.objectContaining({ tools: true }),
          incompatibilityReason: "This model does not produce text responses required by T3 Code.",
        }),
        expect.objectContaining({
          id: "chat/no-tools",
          outputModalities: ["text"],
          toolCapabilities: expect.objectContaining({ tools: false }),
          incompatibilityReason:
            "This model does not support the tool calling required by T3 Code.",
        }),
      ]);
    }),
  );

  it.effect(
    "projects every gateway reasoning effort when the catalog reports unrestricted support",
    () =>
      Effect.gen(function* () {
        const models = yield* decodeOpenRouterModelCatalog(
          catalog([
            catalogModel({
              id: "openrouter/unrestricted-reasoning",
              name: "Unrestricted reasoning",
              outputModalities: ["text"],
              supportedParameters: ["tools", "reasoning"],
              reasoning: { mandatory: false, supported_efforts: null },
            }),
          ]),
        );

        expect(models[0]?.reasoningEfforts).toEqual([
          "max",
          "xhigh",
          "high",
          "medium",
          "low",
          "minimal",
          "none",
        ]);
      }),
  );

  it.effect("merges unique custom model and preset slugs as unverified entries", () =>
    Effect.gen(function* () {
      const live = yield* decodeOpenRouterModelCatalog(
        catalog([
          catalogModel({
            id: "openai/gpt-5.5",
            name: "GPT 5.5",
            outputModalities: ["text"],
            supportedParameters: ["tools"],
          }),
        ]),
      );

      expect(
        mergeOpenRouterCustomModels(live, [
          " @preset/t3-agent ",
          "OPENAI/GPT-5.5",
          "custom/private-model",
          "@preset/t3-agent",
          "",
        ]),
      ).toEqual([
        expect.objectContaining({ id: "openai/gpt-5.5", isVerified: true }),
        {
          id: "@preset/t3-agent",
          name: "@preset/t3-agent",
          inputModalities: ["text"],
          outputModalities: ["text"],
          reasoningEfforts: [],
          toolCapabilities: { tools: true, parallelToolCalls: false, toolChoice: false },
          isCustom: true,
          isVerified: false,
        },
        {
          id: "custom/private-model",
          name: "custom/private-model",
          inputModalities: ["text"],
          outputModalities: ["text"],
          reasoningEfforts: [],
          toolCapabilities: { tools: true, parallelToolCalls: false, toolChoice: false },
          isCustom: true,
          isVerified: false,
        },
      ]);
    }),
  );

  it.effect("fails closed when the catalog shape drifts", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodeOpenRouterModelCatalog({ models: [] }));
      expect(error._tag).toBe("OpenRouterModelCatalogError");
      expect(error.message).toContain("schema");
    }),
  );
});
