import { describe, expect, it } from "@effect/vitest";
import { type OpenRouterSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import type { OpenRouterResolvedCredential } from "./auth/OpenRouterCredentialStore.ts";
import {
  checkOpenRouterProviderStatus,
  openRouterModelsFromCatalog,
} from "./OpenRouterProvider.ts";

const SETTINGS = {
  enabled: true,
  protocol: "chat-completions",
  defaultModel: "openai/gpt-5.5",
  customModels: [],
  contextCompression: false,
  routingMode: "openrouter-default",
  providerOrder: [],
  routingSort: "price",
  allowFallbacks: "inherit",
  dataCollection: "inherit",
  requireZdr: false,
} as const satisfies OpenRouterSettings;

const MODELS = [
  {
    id: "openai/gpt-5.5",
    name: "GPT 5.5",
    contextWindowTokens: 1_000_000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    promptPriceUsdPerMillion: 2,
    completionPriceUsdPerMillion: 10,
    reasoningEfforts: ["low", "high"],
    defaultReasoningEffort: "high",
    toolCapabilities: { tools: true, parallelToolCalls: true, toolChoice: true },
    isCustom: false,
    isVerified: true,
  },
] as const;

const FULL_CATALOG = [
  ...MODELS,
  {
    id: "openai/no-tools",
    name: "No tools",
    contextWindowTokens: 128_000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    promptPriceUsdPerMillion: 0,
    completionPriceUsdPerMillion: 0,
    reasoningEfforts: [],
    toolCapabilities: { tools: false, parallelToolCalls: false, toolChoice: false },
    incompatibilityReason: "This model does not support the tool calling required by T3 Code.",
    isCustom: false,
    isVerified: true,
  },
] as const;

const storedCredential: OpenRouterResolvedCredential = {
  apiKey: Redacted.make("stored-secret"),
  source: "stored",
};

const environmentCredential: OpenRouterResolvedCredential = {
  apiKey: Redacted.make("environment-secret"),
  source: "environment",
};

function dependencies(input?: {
  readonly credential?: OpenRouterResolvedCredential;
  readonly models?: typeof MODELS | readonly [];
}) {
  return {
    resolveCredential: Effect.succeed(Option.fromNullishOr(input?.credential)),
    validateKey: () =>
      Effect.succeed({
        label: "sk-o…cret",
        isFreeTier: true,
        expiresAt: "2027-08-25T00:00:00.000Z",
      }),
    listModels: () => Effect.succeed(input?.models ?? MODELS),
  };
}

describe("OpenRouterProvider", () => {
  it("maps catalog capabilities and marks only the configured default model", () => {
    expect(openRouterModelsFromCatalog(FULL_CATALOG, "openai/gpt-5.5")).toEqual([
      expect.objectContaining({
        slug: "openai/gpt-5.5",
        name: "GPT 5.5",
        isDefault: true,
        isCustom: false,
        isVerified: true,
        capabilities: expect.objectContaining({
          contextWindow: { defaultTokens: 1_000_000, maxTokens: 1_000_000 },
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          pricing: { promptUsdPerMillion: 2, completionUsdPerMillion: 10 },
          toolSupport: { tools: true, parallelToolCalls: true, toolChoice: true },
          optionDescriptors: [
            expect.objectContaining({ id: "reasoningEffort", currentValue: "high" }),
          ],
        }),
      }),
      expect.objectContaining({
        slug: "openai/no-tools",
        isSelectable: false,
        unavailableReason: "This model does not support the tool calling required by T3 Code.",
        capabilities: expect.objectContaining({
          pricing: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
          toolSupport: { tools: false, parallelToolCalls: false, toolChoice: false },
        }),
      }),
    ]);
  });

  it.effect("keeps the full catalog visible but rejects an incompatible default", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkOpenRouterProviderStatus(
        { ...SETTINGS, defaultModel: "openai/no-tools" },
        {
          ...dependencies({ credential: storedCredential }),
          listModels: () => Effect.succeed(FULL_CATALOG),
        },
      );

      expect(snapshot).toMatchObject({
        status: "warning",
        models: [
          expect.objectContaining({ slug: "openai/gpt-5.5", isSelectable: true }),
          expect.objectContaining({ slug: "openai/no-tools", isSelectable: false }),
        ],
      });
      expect(snapshot.message).toContain("not compatible");
      expect(snapshot.nativeSubagents).toBeUndefined();
    }),
  );

  it.effect("warns without issuing network probes when no credential is configured", () =>
    Effect.gen(function* () {
      let validations = 0;
      let catalogRequests = 0;
      const snapshot = yield* checkOpenRouterProviderStatus(SETTINGS, {
        resolveCredential: Effect.succeed(Option.none()),
        validateKey: () =>
          Effect.sync(() => {
            validations++;
            return { label: "unused", isFreeTier: false };
          }),
        listModels: () =>
          Effect.sync(() => {
            catalogRequests++;
            return MODELS;
          }),
      });

      expect(snapshot).toMatchObject({
        status: "warning",
        auth: { status: "unauthenticated", type: "api-key" },
        models: [],
      });
      expect(snapshot.message).toContain("API key");
      expect(validations).toBe(0);
      expect(catalogRequests).toBe(0);
    }),
  );

  it.effect("explains when a valid credential cannot be used for inference", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkOpenRouterProviderStatus(SETTINGS, {
        ...dependencies({ credential: storedCredential }),
        validateKey: () =>
          Effect.fail({
            _tag: "OpenRouterKeyValidationError",
            code: "credential-not-inference",
            retryable: false,
            message:
              "OpenRouter Management API keys cannot be used with model completion endpoints.",
          }),
      });

      expect(snapshot).toMatchObject({
        status: "error",
        auth: { status: "error", type: "api-key" },
        models: [],
      });
      expect(snapshot.message).toContain("Management API keys");
      expect(snapshot.nativeSubagents).toBeUndefined();
      expect(snapshot.fetchWorkers).toBeUndefined();
    }),
  );

  it.effect("warns and blocks readiness until an explicit valid default model is selected", () =>
    Effect.gen(function* () {
      const missing = yield* checkOpenRouterProviderStatus(
        { ...SETTINGS, defaultModel: "" },
        dependencies({ credential: storedCredential }),
      );
      const invalid = yield* checkOpenRouterProviderStatus(
        { ...SETTINGS, defaultModel: "removed/model" },
        dependencies({ credential: storedCredential }),
      );

      expect(missing).toMatchObject({ status: "warning", models: expect.any(Array) });
      expect(missing.message).toContain("default model");
      expect(missing.nativeSubagents).toBeUndefined();
      expect(missing.fetchWorkers).toBeUndefined();
      expect(invalid).toMatchObject({ status: "warning", models: expect.any(Array) });
      expect(invalid.message).toContain("no longer available");
      expect(invalid.nativeSubagents).toBeUndefined();
      expect(invalid.fetchWorkers).toBeUndefined();
    }),
  );

  it.effect("advertises full native surfaces and environment-managed disconnect guidance", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkOpenRouterProviderStatus(
        SETTINGS,
        dependencies({ credential: environmentCredential }),
      );

      expect(snapshot).toMatchObject({
        status: "ready",
        badgeLabel: "Early Access",
        nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 40 },
        fetchWorkers: { maxRecommendedWorkers: 8, commandExecutionPolicy: "deny" },
        auth: {
          status: "authenticated",
          plan: { id: "free", label: "Free tier" },
          capabilities: { canDisconnect: false },
        },
      });
      expect(snapshot.message).toContain("OPENROUTER_API_KEY");
      expect(JSON.stringify(snapshot)).not.toContain("environment-secret");
    }),
  );
});
