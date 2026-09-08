import { describe, expect, it } from "vite-plus/test";

import {
  GEMINI_DEFAULT_MODEL,
  geminiModelsFromSettings,
  resolveGeminiApiKey,
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
});
