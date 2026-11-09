import { describe, expect, it } from "vite-plus/test";

import { getProviderClient } from "./providerClients.ts";

describe("provider client icons", () => {
  it.each(["gemini", "openrouter", "lmstudio", "openaiCompatible", "chatgpt", "openai"])(
    "gives %s its own icon instead of the client fallback",
    (driver) => {
      expect(getProviderClient(driver)?.icon?.paths.length).toBeGreaterThan(0);
    },
  );

  it("shares one glyph across self-hosted endpoints", () => {
    expect(getProviderClient("lmstudio")?.icon).toBe(getProviderClient("openaiCompatible")?.icon);
  });
});
