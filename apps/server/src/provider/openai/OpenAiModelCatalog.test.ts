import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decodeOpenAiModelCatalog, OpenAiModelCatalogError } from "./OpenAiModelCatalog.ts";

const model = (id: string) => ({
  id,
  object: "model",
  created: 1,
  owned_by: "openai",
  shutdown_date: null,
});

describe("OpenAI model catalog", () => {
  it.effect("intersects live availability with tested coding capabilities", () =>
    Effect.gen(function* () {
      const catalog = yield* decodeOpenAiModelCatalog({
        object: "list",
        data: [
          model("text-embedding-3-large"),
          model("gpt-5.6-luna"),
          model("gpt-5.6-sol"),
          model("gpt-5.6-terra"),
          model("gpt-5.6"),
          model("gpt-unknown-future"),
        ],
      });

      expect(catalog.map(({ id }) => id)).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
      expect(catalog[0]).toMatchObject({
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
      });
    }),
  );

  it.effect("uses the documented Sol alias only when the concrete model is absent", () =>
    Effect.gen(function* () {
      const catalog = yield* decodeOpenAiModelCatalog({
        object: "list",
        data: [model("gpt-5.6"), model("gpt-5.6-terra")],
      });

      expect(catalog.map(({ id }) => id)).toEqual(["gpt-5.6", "gpt-5.6-terra"]);
      expect(catalog[0]).toMatchObject({ name: "GPT-5.6 Sol", aliasFor: "gpt-5.6-sol" });
    }),
  );

  it.effect("fails closed when the live catalog shape drifts", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeOpenAiModelCatalog({ object: "list", data: [{ id: 42 }] }),
      );

      expect(error).toBeInstanceOf(OpenAiModelCatalogError);
      expect(error.message).toBe("OpenAI model catalog response is invalid");
    }),
  );
});
