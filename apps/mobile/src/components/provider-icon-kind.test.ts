import { describe, expect, it } from "vite-plus/test";

import { providerIconKind } from "./provider-icon-kind";

describe("providerIconKind", () => {
  it("keeps OpenRouter distinct from the Codex fallback", () => {
    expect(providerIconKind("openrouter")).toBe("openrouter");
    expect(providerIconKind("unknown-provider")).toBe("codex");
  });
});
