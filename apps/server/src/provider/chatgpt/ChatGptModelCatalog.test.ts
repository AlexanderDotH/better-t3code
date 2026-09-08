import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decodeChatGptModelCatalog } from "./ChatGptModelCatalog.ts";

describe("ChatGptModelCatalog", () => {
  it.effect("normalizes only account-advertised visible models and capabilities", () =>
    Effect.gen(function* () {
      const models = yield* decodeChatGptModelCatalog({
        models: [
          {
            slug: "gpt-5.6-sol",
            display_name: "GPT 5.6 Sol",
            description: "Frontier coding model",
            context_window: 1_000_000,
            default_reasoning_level: "high",
            supported_reasoning_levels: [
              { effort: "low", description: "Fast" },
              { effort: "high", description: "Deep" },
              { effort: "max", description: "Maximum" },
            ],
            service_tiers: [{ id: "priority", name: "Fast" }],
            visibility: "list",
          },
          {
            slug: "hidden-model",
            display_name: "Hidden",
            context_window: 128_000,
            default_reasoning_level: "medium",
            supported_reasoning_levels: ["medium"],
            visibility: "hidden",
          },
        ],
      });

      expect(models).toEqual([
        {
          id: "gpt-5.6-sol",
          displayName: "GPT 5.6 Sol",
          description: "Frontier coding model",
          contextWindowTokens: 1_000_000,
          defaultReasoningEffort: "high",
          reasoningEfforts: ["low", "high", "max"],
          serviceTiers: [{ id: "priority", label: "Fast" }],
        },
      ]);
    }),
  );

  it.effect(
    "fails when the live account catalog is missing instead of inventing fallback models",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(decodeChatGptModelCatalog({ data: [] }));
        expect(error._tag).toBe("ChatGptModelCatalogError");
        expect(error.message).toContain("no selectable models");
      }),
  );

  it.effect("fails visibly when an advertised model omits live capability metadata", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeChatGptModelCatalog({
          models: [{ slug: "drifted-model", display_name: "Drifted" }],
        }),
      );
      expect(error._tag).toBe("ChatGptModelCatalogError");
      expect(error.message).toContain("catalog schema");
    }),
  );
});
