import { ThinkingLevel, type Model } from "@google/genai";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import type { GeminiClient } from "../GeminiClient.ts";
import {
  checkGeminiProviderStatus,
  createGeminiModelCapabilities,
  discoveredGeminiModels,
  GEMINI_DEFAULT_MODEL,
  GEMINI_REASONING_EFFORT_OPTION_ID,
  geminiModelsFromSettings,
  geminiModelSupportsTextOutput,
  resolveGeminiApiKey,
  resolveGeminiReasoningProfile,
  resolveGeminiThinkingConfig,
} from "./GeminiProvider.ts";

describe("GeminiProvider", () => {
  it("prefers GOOGLE_API_KEY exactly like the official SDK", () => {
    expect(
      resolveGeminiApiKey({
        GEMINI_API_KEY: "gemini-key",
        GOOGLE_API_KEY: "google-key",
      }),
    ).toEqual({ apiKey: "google-key", source: "GOOGLE_API_KEY" });
    expect(resolveGeminiApiKey({ GEMINI_API_KEY: "gemini-key" })).toEqual({
      apiKey: "gemini-key",
      source: "GEMINI_API_KEY",
    });
    expect(resolveGeminiApiKey({})).toBeUndefined();
  });

  it("publishes a stable default model and preserves custom models once", () => {
    const models = geminiModelsFromSettings([
      GEMINI_DEFAULT_MODEL,
      "gemini-custom",
      "gemini-custom",
    ]);

    expect(models[0]).toMatchObject({
      slug: GEMINI_DEFAULT_MODEL,
      isDefault: true,
      isCustom: false,
    });
    expect(models.filter((model) => model.slug === "gemini-custom")).toEqual([
      expect.objectContaining({ slug: "gemini-custom", isCustom: true }),
    ]);
  });

  describe("geminiModelSupportsTextOutput", () => {
    it("accepts models that generate text", () => {
      const textModels: Array<Model> = [
        {
          name: "models/gemini-3.6-flash",
          supportedActions: ["generateContent"],
          outputTokenLimit: 8192,
        },
        {
          name: "models/gemini-2.5-flash",
          supportedActions: ["generateContent"],
          outputTokenLimit: 8192,
        },
        {
          name: "models/gemini-2.5-pro",
          supportedActions: ["generateContent"],
          outputTokenLimit: 8192,
        },
        {
          name: "models/gemma-4-31b-it",
          supportedActions: ["generateContent"],
          outputTokenLimit: 4096,
        },
      ];

      for (const model of textModels) {
        expect(geminiModelSupportsTextOutput(model)).toBe(true);
      }
    });

    it("rejects image-generation models", () => {
      const imageModels: Array<Model> = [
        { name: "models/gemini-2.5-flash-image", supportedActions: ["generateContent"] },
        { name: "models/gemini-3.1-flash-image", supportedActions: ["generateContent"] },
        { name: "models/gemini-3-pro-image", supportedActions: ["generateContent"] },
        { name: "models/imagen-3.0-generate-002", supportedActions: ["generateImages"] },
        { name: "models/nano-banana-pro-preview", supportedActions: ["generateContent"] },
        {
          name: "models/custom-image-gen",
          supportedActions: ["generateContent"],
          displayName: "Text to Image Generator",
        },
      ];

      for (const model of imageModels) {
        expect(geminiModelSupportsTextOutput(model)).toBe(false);
      }
    });

    it("rejects audio and speech models", () => {
      const audioModels: Array<Model> = [
        { name: "models/gemini-2.5-flash-tts", supportedActions: ["generateContent"] },
        { name: "models/lyria-3-clip-preview", supportedActions: ["generateContent"] },
        {
          name: "models/custom-speaker",
          supportedActions: ["generateContent"],
          description: "High quality text-to-speech engine",
        },
      ];

      for (const model of audioModels) {
        expect(geminiModelSupportsTextOutput(model)).toBe(false);
      }
    });

    it("rejects video and embedding models", () => {
      const otherNonTextModels: Array<Model> = [
        { name: "models/veo-2.0-generate-001", supportedActions: ["generateVideos"] },
        { name: "models/text-embedding-004", supportedActions: ["embedContent"] },
        { name: "models/gemini-robotics-er-1.6-preview", supportedActions: ["generateContent"] },
      ];

      for (const model of otherNonTextModels) {
        expect(geminiModelSupportsTextOutput(model)).toBe(false);
      }
    });

    it("rejects models with outputTokenLimit <= 0", () => {
      const zeroTokenModel: Model = {
        name: "models/gemini-zero-token",
        supportedActions: ["generateContent"],
        outputTokenLimit: 0,
      };
      expect(geminiModelSupportsTextOutput(zeroTokenModel)).toBe(false);
    });

    it("rejects models without text output modality when modalities are declared", () => {
      const imageOnlyModality: Model = {
        name: "models/gemini-vision-out",
        supportedActions: ["generateContent"],
        outputTokenLimit: 2048,
        ...({ outputModalities: ["IMAGE"] } as Record<string, unknown>),
      };
      expect(geminiModelSupportsTextOutput(imageOnlyModality)).toBe(false);

      const textModality: Model = {
        name: "models/gemini-text-out",
        supportedActions: ["generateContent"],
        outputTokenLimit: 2048,
        ...({ outputModalities: ["TEXT"] } as Record<string, unknown>),
      };
      expect(geminiModelSupportsTextOutput(textModality)).toBe(true);
    });
  });

  describe("reasoning levels and capabilities", () => {
    it("configures reasoning levels for Gemini models", () => {
      const profile36 = resolveGeminiReasoningProfile("gemini-3.6-flash");
      expect(profile36).toEqual({
        defaultLevel: "medium",
        levels: ["minimal", "low", "medium", "high"],
      });

      const profile31Pro = resolveGeminiReasoningProfile("gemini-3.1-pro-preview");
      expect(profile31Pro).toEqual({
        defaultLevel: "high",
        levels: ["low", "medium", "high"],
      });

      const profile35Lite = resolveGeminiReasoningProfile("gemini-3.5-flash-lite");
      expect(profile35Lite).toEqual({
        defaultLevel: "minimal",
        levels: ["minimal", "low", "medium", "high"],
      });

      const capabilities = createGeminiModelCapabilities("gemini-3.6-flash");
      const descriptor = capabilities.optionDescriptors?.find(
        (desc) => desc.id === GEMINI_REASONING_EFFORT_OPTION_ID,
      );
      expect(descriptor).toBeDefined();
      expect(descriptor).toMatchObject({
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        currentValue: "medium",
      });
      if (descriptor?.type === "select") {
        expect(descriptor.options.map((opt) => opt.id)).toEqual([
          "minimal",
          "low",
          "medium",
          "high",
        ]);
        expect(descriptor.options.find((opt) => opt.isDefault)?.id).toBe("medium");
      }
    });

    it("does not expose reasoning options when model explicitly disables thinking", () => {
      const model: Model = {
        name: "models/gemini-2.0-flash",
        thinking: false,
      };
      const profile = resolveGeminiReasoningProfile("gemini-2.0-flash", model);
      expect(profile).toBeUndefined();

      const capabilities = createGeminiModelCapabilities("gemini-2.0-flash", model);
      expect(capabilities.optionDescriptors).toEqual([]);
    });

    it("resolves Gemini 3 thinkingConfig with ThinkingLevel and includeThoughts", () => {
      expect(resolveGeminiThinkingConfig("minimal", "gemini-3.6-flash")).toEqual({
        thinkingLevel: ThinkingLevel.MINIMAL,
        includeThoughts: true,
      });
      expect(resolveGeminiThinkingConfig("low", "gemini-3.6-flash")).toEqual({
        thinkingLevel: ThinkingLevel.LOW,
        includeThoughts: true,
      });
      expect(resolveGeminiThinkingConfig("medium", "gemini-3.6-flash")).toEqual({
        thinkingLevel: ThinkingLevel.MEDIUM,
        includeThoughts: true,
      });
      expect(resolveGeminiThinkingConfig("high", "gemini-3.6-flash")).toEqual({
        thinkingLevel: ThinkingLevel.HIGH,
        includeThoughts: true,
      });
      expect(resolveGeminiThinkingConfig("none", "gemini-3.6-flash")).toEqual({
        thinkingLevel: ThinkingLevel.MINIMAL,
        includeThoughts: true,
      });
      // Fallback to model default when undefined
      expect(resolveGeminiThinkingConfig(undefined, "gemini-3.6-flash")).toEqual({
        thinkingLevel: ThinkingLevel.MEDIUM,
        includeThoughts: true,
      });
      expect(resolveGeminiThinkingConfig(undefined, "gemini-3.1-pro-preview")).toEqual({
        thinkingLevel: ThinkingLevel.HIGH,
        includeThoughts: true,
      });
    });

    it("resolves Gemini 2.5 thinkingConfig with token budgets", () => {
      expect(resolveGeminiThinkingConfig("low", "gemini-2.5-flash")).toEqual({
        thinkingBudget: 2048,
        includeThoughts: true,
      });
      expect(resolveGeminiThinkingConfig("high", "gemini-2.5-pro")).toEqual({
        thinkingBudget: 24576,
        includeThoughts: true,
      });
      expect(resolveGeminiThinkingConfig("none", "gemini-2.5-flash")).toEqual({
        thinkingBudget: 0,
        includeThoughts: false,
      });
      expect(resolveGeminiThinkingConfig(undefined, "gemini-2.5-pro")).toEqual({
        thinkingBudget: 8192,
        includeThoughts: true,
      });
    });
  });

  describe("model discovery via checkGeminiProviderStatus", () => {
    it("filters out non-text models and equips text models with reasoning capabilities", async () => {
      const mockRawModels: Array<Model> = [
        {
          name: "models/gemini-3.6-flash",
          displayName: "Gemini 3.6 Flash",
          supportedActions: ["generateContent"],
          inputTokenLimit: 1_000_000,
          outputTokenLimit: 8192,
        },
        {
          name: "models/gemini-2.5-flash-image",
          displayName: "Gemini 2.5 Flash Image",
          supportedActions: ["generateContent"],
        },
        {
          name: "models/text-embedding-004",
          displayName: "Text Embedding 004",
          supportedActions: ["embedContent"],
        },
        {
          name: "models/imagen-3.0-generate-002",
          displayName: "Imagen 3",
          supportedActions: ["generateImages"],
        },
        {
          name: "models/gemini-3.1-pro-preview",
          displayName: "Gemini 3.1 Pro Preview",
          supportedActions: ["generateContent"],
          inputTokenLimit: 1_000_000,
          outputTokenLimit: 8192,
        },
      ];

      const discovered = discoveredGeminiModels(mockRawModels);
      expect(discovered.map((m) => m.slug)).toEqual(["gemini-3.6-flash", "gemini-3.1-pro-preview"]);

      const fakeClient = {
        models: {
          list: async () => ({ page: mockRawModels }),
          generateContent: async () => {
            throw new Error("not implemented");
          },
          generateContentStream: async () => {
            throw new Error("not implemented");
          },
        },
      } as unknown as GeminiClient;

      const provider = await Effect.runPromise(
        checkGeminiProviderStatus(
          { enabled: true, customModels: [] },
          { GOOGLE_API_KEY: "test-google-key" },
          () => fakeClient,
        ),
      );

      expect(provider.models.map((m) => m.slug)).toEqual([
        "gemini-3.6-flash",
        "gemini-3.1-pro-preview",
      ]);
      const flashModel = provider.models.find((m) => m.slug === "gemini-3.6-flash");
      expect(flashModel?.capabilities?.optionDescriptors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "reasoningEffort",
            currentValue: "medium",
          }),
        ]),
      );
    });
  });
});
