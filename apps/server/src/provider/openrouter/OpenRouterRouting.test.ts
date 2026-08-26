import { describe, expect, it } from "@effect/vitest";
import type { OpenRouterSettings } from "@t3tools/contracts";

import { buildOpenRouterRequestPolicy } from "./OpenRouterRouting.ts";

const settings = (overrides: Partial<OpenRouterSettings> = {}): OpenRouterSettings => ({
  enabled: true,
  protocol: "chat-completions",
  defaultModel: "anthropic/claude-sonnet-4",
  customModels: [],
  contextCompression: false,
  routingMode: "openrouter-default",
  providerOrder: [],
  routingSort: "price",
  allowFallbacks: "inherit",
  dataCollection: "inherit",
  requireZdr: false,
  ...overrides,
});

describe("OpenRouter request policy", () => {
  it("keeps account routing and privacy defaults while requiring request parameters", () => {
    expect(buildOpenRouterRequestPolicy(settings())).toEqual({
      provider: { require_parameters: true },
      plugins: [{ id: "context-compression", enabled: false }],
    });
  });

  it("serializes ordered providers, privacy requirements, p50 thresholds, and price caps", () => {
    expect(
      buildOpenRouterRequestPolicy(
        settings({
          routingMode: "provider-order",
          providerOrder: [" Anthropic ", "Google", "anthropic", ""],
          allowFallbacks: "disabled",
          dataCollection: "deny",
          requireZdr: true,
          preferredMinThroughput: 42.5,
          preferredMaxLatency: 1.75,
          maxPromptPriceUsdPerMillion: 3,
          maxCompletionPriceUsdPerMillion: 15,
          maxRequestPriceUsd: 0.02,
          contextCompression: true,
        }),
      ),
    ).toEqual({
      provider: {
        require_parameters: true,
        order: ["Anthropic", "Google"],
        allow_fallbacks: false,
        data_collection: "deny",
        zdr: true,
        preferred_min_throughput: 42.5,
        preferred_max_latency: 1.75,
        max_price: { prompt: 3, completion: 15, request: 0.02 },
      },
      plugins: [{ id: "context-compression", enabled: true }],
    });
  });

  it("uses sort without also sending an order list", () => {
    const policy = buildOpenRouterRequestPolicy(
      settings({
        routingMode: "sort",
        routingSort: "latency",
        providerOrder: ["Anthropic"],
        allowFallbacks: "enabled",
        dataCollection: "allow",
      }),
    );

    expect(policy.provider).toMatchObject({
      require_parameters: true,
      sort: "latency",
      allow_fallbacks: true,
      data_collection: "allow",
    });
    expect(policy.provider).not.toHaveProperty("order");
  });
});
