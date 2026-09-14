import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  decodeLmStudioModelCatalog,
  decodeOpenAiCompatibleModelCatalog,
  mergeOpenAiCompatibleCustomModels,
} from "./OpenAiCompatibleModelCatalog.ts";

describe("OpenAI-compatible model catalogs", () => {
  it.effect("accepts minimal catalogs and preserves arbitrary case-sensitive IDs", () =>
    Effect.gen(function* () {
      const models = yield* decodeOpenAiCompatibleModelCatalog({
        data: [{ id: "org/private/model.Q4_K_M.gguf" }, { id: "Model" }, { id: "model" }],
      });
      expect(models).toEqual([
        {
          id: "org/private/model.Q4_K_M.gguf",
          name: "org/private/model.Q4_K_M.gguf",
          toolCapabilities: {},
          isCustom: false,
          isVerified: true,
        },
        { id: "Model", name: "Model", toolCapabilities: {}, isCustom: false, isVerified: true },
        { id: "model", name: "model", toolCapabilities: {}, isCustom: false, isVerified: true },
      ]);
      expect(
        mergeOpenAiCompatibleCustomModels(models, ["Model", " custom ", "", "custom"]),
      ).toEqual([
        ...models,
        { id: "custom", name: "custom", toolCapabilities: {}, isCustom: true, isVerified: false },
      ]);
    }),
  );

  it.effect("separates explicit unsupported tools from absent capability metadata", () =>
    Effect.gen(function* () {
      const models = yield* decodeOpenAiCompatibleModelCatalog({
        data: [
          { id: "known-tools", context_length: 8192, supported_parameters: ["tools"] },
          { id: "no-tools", capabilities: { trained_for_tool_use: false } },
          { id: "unknown" },
          { id: "embedding", type: "embedding" },
          {
            id: "audio-only",
            architecture: { input_modalities: ["audio"], output_modalities: ["text"] },
          },
        ],
      });
      expect(models[0]).toMatchObject({
        contextWindowTokens: 8192,
        toolCapabilities: { tools: true, parallelToolCalls: false, toolChoice: false },
      });
      expect(models[1]).toMatchObject({
        toolCapabilities: { tools: false },
        incompatibilityReason: expect.stringContaining("tool calling"),
      });
      expect(models[2]).not.toHaveProperty("incompatibilityReason");
      expect(models[2]?.toolCapabilities).toEqual({});
      expect(models[3]).toMatchObject({
        outputModalities: ["embedding"],
        incompatibilityReason: expect.stringContaining("text responses"),
      });
      expect(models[4]).toMatchObject({
        inputModalities: ["audio"],
        incompatibilityReason: expect.stringContaining("text input"),
      });
    }),
  );

  it.effect("reads LM Studio v1 metadata without claiming downloaded models are loaded", () =>
    Effect.gen(function* () {
      const models = yield* decodeLmStudioModelCatalog({
        models: [
          {
            key: "local/model",
            type: "llm",
            display_name: "Local Model",
            loaded_instances: [],
            max_context_length: 32768,
            capabilities: { trained_for_tool_use: true },
          },
          { key: "local/embed", type: "embedding", loaded_instances: [{ id: "embed-instance" }] },
        ],
      });
      expect(models[0]).toMatchObject({
        id: "local/model",
        name: "Local Model",
        loaded: false,
        contextWindowTokens: 32768,
        toolCapabilities: { tools: true },
      });
      expect(models[1]).toMatchObject({ loaded: true, outputModalities: ["embedding"] });
    }),
  );

  it.effect("rejects malformed catalogs without including their contents in errors", () =>
    Effect.gen(function* () {
      for (const payload of [
        { data: [{ id: 3 }] },
        { data: [{ id: "  " }] },
        { data: "secret-key" },
        { models: [] },
      ]) {
        const error = yield* decodeOpenAiCompatibleModelCatalog(payload).pipe(Effect.flip);
        expect(error._tag).toBe("OpenAiCompatibleModelCatalogError");
        expect(error.message).not.toContain("secret-key");
      }
      const lmStudioError = yield* Effect.flip(
        decodeLmStudioModelCatalog({
          models: [{ key: "  ", type: "llm" }],
        }),
      );
      expect(lmStudioError._tag).toBe("OpenAiCompatibleModelCatalogError");
    }),
  );
});
