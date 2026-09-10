import { describe, expect, it } from "vite-plus/test";

import { providerIconKind } from "./provider-icon-kind";

describe("providerIconKind", () => {
  it("keeps OpenRouter distinct from the Codex fallback", () => {
    expect(providerIconKind("openrouter")).toBe("openrouter");
    expect(providerIconKind("unknown-provider")).toBe("codex");
  });

  it("uses the server symbol for both compatible endpoint types", () => {
    expect(providerIconKind("openaiCompatible")).toBe("server");
    expect(providerIconKind("lmstudio")).toBe("server");
  });
});
