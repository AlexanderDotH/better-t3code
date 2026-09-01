import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { OpenRouterDriver } from "./OpenRouterDriver.ts";

const decodeOpenRouterDriverSettings = Schema.decodeUnknownSync(OpenRouterDriver.configSchema);

describe("OpenRouterDriver", () => {
  it("registers a disabled multi-instance provider with conservative defaults", () => {
    expect(OpenRouterDriver.driverKind).toBe("openrouter");
    expect(OpenRouterDriver.metadata).toEqual({
      displayName: "OpenRouter",
      supportsMultipleInstances: true,
    });
    expect(OpenRouterDriver.defaultConfig()).toEqual({
      enabled: false,
      protocol: "chat-completions",
      defaultModel: "",
      customModels: [],
      contextCompression: false,
      routingMode: "openrouter-default",
      providerOrder: [],
      routingSort: "price",
      allowFallbacks: "inherit",
      dataCollection: "inherit",
      requireZdr: false,
    });
  });

  it("rejects legacy custom origins before driver creation", () => {
    expect(() =>
      decodeOpenRouterDriverSettings({
        ...OpenRouterDriver.defaultConfig(),
        legacyBaseUrlIncompatible: true,
      }),
    ).toThrow(/non-OpenRouter base URL/u);
  });
});
