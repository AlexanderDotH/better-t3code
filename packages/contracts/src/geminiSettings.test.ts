import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { GeminiSettings, ServerSettings, ServerSettingsPatch } from "./settings.ts";

const decodeGeminiSettings = Schema.decodeUnknownSync(GeminiSettings);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("GeminiSettings", () => {
  it("keeps the synthesized default provider disabled until it is configured", () => {
    expect(decodeGeminiSettings({})).toEqual({
      enabled: false,
      customModels: [],
    });
    expect(decodeServerSettings({}).providers.gemini).toEqual({
      enabled: false,
      customModels: [],
    });
  });

  it("accepts Gemini provider patches without changing the legacy provider contract", () => {
    expect(
      decodeServerSettingsPatch({
        providers: {
          gemini: {
            enabled: true,
            customModels: ["gemini-custom"],
          },
        },
      }).providers?.gemini,
    ).toEqual({ enabled: true, customModels: ["gemini-custom"] });
  });
});
