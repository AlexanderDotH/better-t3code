import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type ModelCapabilities } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  KIRO_AMAZON_Q_PROVIDER,
  LOCAL_OPENAI_PROVIDER,
  NVIDIA_NIM_PROVIDER,
  OPENCODE_GO_PROVIDER,
  OPENCODE_ZEN_PROVIDER,
  OPENROUTER_PROVIDER,
  buildOpenAiCompatibleProviderSnapshot,
  buildOpenAiCompatibleServerProviderSnapshot,
  localOpenAiV1BasesForCatalogProbe,
  normalizeKiroChatModelCatalogResponse,
  normalizeKiroProfilesResponse,
  normalizeLocalOpenAiModelCatalogResponse,
  normalizeLocalOpenAiV1Base,
  normalizeNvidiaNimModelsResponse,
  normalizeOpenRouterModelsResponse,
  normalizeOpencodeGoModelsResponse,
  normalizeOpencodeZenModelsResponse,
  parseOpenAiCompatibleModelsListJson,
} from "./OpenAiCompatibleProvider.ts";

const CHECKED_AT = "2026-07-01T12:00:00.000Z";

function descriptorIds(model: { readonly capabilities: ModelCapabilities | null }) {
  return model.capabilities?.optionDescriptors?.map((descriptor) => descriptor.id) ?? [];
}

describe("OpenAI-compatible catalog normalizers", () => {
  it("normalizes OpenRouter rows with pricing, context, vision, and reasoning metadata", () => {
    const models = normalizeOpenRouterModelsResponse({
      data: [
        null,
        { name: "missing id" },
        {
          id: "anthropic/claude-3.5-sonnet",
          name: "Claude 3.5 Sonnet",
          top_provider: { context_length: "200000" },
          pricing: { prompt: "0.000003", completion: 0.000015 },
          supported_parameters: ["reasoning"],
          default_parameters: { reasoning: { effort: ["low", "high"] } },
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
        },
        {
          id: "image/only",
          name: "Image Only",
          architecture: {
            input_modalities: ["image"],
            output_modalities: ["image"],
          },
        },
        {
          id: "deepseek/deepseek-r1",
          name: "DeepSeek R1",
          supported_parameters: ["include_reasoning"],
        },
        {
          id: "z-ai/glm5",
          name: "GLM 5",
        },
      ],
    });

    expect(models.map((model) => model.id)).toEqual([
      "anthropic/claude-3.5-sonnet",
      "deepseek/deepseek-r1",
      "z-ai/glm5",
    ]);

    const claude = models[0]!;
    expect(claude.contextLength).toBe(200000);
    expect(claude.promptPerMillionUsd).toBe(3);
    expect(claude.completionPerMillionUsd).toBe(15);
    expect(claude.hasVisionInput).toBe(true);
    expect(claude.visionCapable).toBe(true);
    expect(claude.supportedParameters).toEqual(["reasoning"]);
    expect(descriptorIds(claude)).toEqual(["reasoningEffort"]);
    expect(claude.capabilities?.optionDescriptors?.[0]).toMatchObject({
      id: "reasoningEffort",
      currentValue: "low",
    });

    expect(models[1]!.isThinkingModel).toBe(true);
    expect(models[1]!.thinkingStrength).toBe("low");
    expect(models[2]!.thinkingStrength).toBe("medium");
    expect(descriptorIds(models[2]!)).toEqual(["reasoningEffort"]);
  });

  it("normalizes NVIDIA NIM rows without borrowing OpenRouter metadata", () => {
    const models = normalizeNvidiaNimModelsResponse({
      data: [
        {
          id: "meta/llama-3.1",
          object: "model",
          created: 1,
          owned_by: "nvidia",
          name: "Llama 3.1",
        },
        {
          id: "z-ai/glm5",
          name: "GLM 5",
          metadata: {
            supported_parameters: ["reasoning"],
            max_sequence_length: "131072",
            pricing: { input: "0.000001", output: "0.000002" },
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
        },
      ],
    });

    expect(models.map((model) => model.id)).toEqual(["z-ai/glm5", "meta/llama-3.1"]);
    expect(models[0]).toMatchObject({
      catalogContextTokens: 131072,
      promptPerMillionUsd: 1,
      completionPerMillionUsd: 2,
      hasVisionInput: true,
      visionCapable: true,
      freeTier: false,
    });
    expect(descriptorIds(models[0]!)).toEqual(["reasoningEffort"]);
    expect(models[1]).toMatchObject({
      id: "meta/llama-3.1",
      freeTier: true,
      hasVisionInput: false,
      visionCapable: false,
    });
  });

  it("parses local OpenAI-compatible model list variants and normalizes probe bases", () => {
    expect(normalizeLocalOpenAiV1Base(" http://127.0.0.1:1234/// ")).toBe(
      "http://127.0.0.1:1234/v1",
    );
    expect(localOpenAiV1BasesForCatalogProbe("http://127.0.0.1:11434/v1")).toEqual([
      "http://127.0.0.1:11434/v1",
      "http://127.0.0.1:1234/v1",
      "http://localhost:11434/v1",
      "http://localhost:1234/v1",
    ]);

    const rows = parseOpenAiCompatibleModelsListJson({
      models: [
        { model: "llama3.1" },
        { name: "display-only" },
        { id: "qwen3", title: "Qwen 3" },
        "bare-model",
        { id: "qwen3", title: "Duplicate" },
      ],
    });
    expect(rows).toEqual([
      { id: "bare-model" },
      { id: "display-only" },
      { id: "llama3.1" },
      { id: "qwen3", name: "Qwen 3" },
    ]);

    expect(
      normalizeLocalOpenAiModelCatalogResponse({ data: rows }).map((model) => model.id),
    ).toEqual(["bare-model", "display-only", "llama3.1", "qwen3"]);
  });

  it("filters OpenCode Zen and Go catalogs to chat-completions models", () => {
    expect(
      normalizeOpencodeZenModelsResponse({
        data: [
          { id: "big-pickle" },
          { id: "deepseek-v4-pro" },
          { id: "gpt-5.1" },
          { id: "claude-sonnet-5" },
          { id: "gemini-3-pro" },
        ],
      }).map((model) => [model.id, model.priceLabel]),
    ).toEqual([
      ["big-pickle", "Zen - $0 promo"],
      ["deepseek-v4-pro", "Zen - metered"],
    ]);

    expect(
      normalizeOpencodeGoModelsResponse({
        data: [{ id: "deepseek-v4-pro" }, { id: "qwen3.7-max" }, { id: "kimi-k2.6" }],
      }).map((model) => model.id),
    ).toEqual(["deepseek-v4-pro", "kimi-k2.6"]);
  });

  it("normalizes Kiro profiles and model catalog responses", () => {
    expect(
      normalizeKiroProfilesResponse({
        profiles: [{ arn: " arn:aws:q:profile/test " }, { arn: "ignored" }],
      }),
    ).toBe("arn:aws:q:profile/test");

    const models = normalizeKiroChatModelCatalogResponse({
      models: [
        { modelId: "amazon.nova-lite-v1:0", name: "Nova Lite" },
        { id: "amazon.nova-pro-v1:0" },
        { name: "missing id" },
      ],
    });

    expect(
      models.map((model) => ({
        id: model.id,
        name: model.name,
        source: model.source,
        priceLabel: model.priceLabel,
        subProvider: model.subProvider,
        capabilities: model.capabilities,
      })),
    ).toEqual([
      {
        id: "amazon.nova-lite-v1:0",
        name: "Nova Lite",
        source: "kiro-amazon-q",
        subProvider: "Kiro / Amazon Q",
        priceLabel: "Kiro - Amazon Q usage",
        capabilities: { optionDescriptors: [] },
      },
      {
        id: "amazon.nova-pro-v1:0",
        name: "amazon.nova-pro-v1:0",
        source: "kiro-amazon-q",
        subProvider: "Kiro / Amazon Q",
        priceLabel: "Kiro - Amazon Q usage",
        capabilities: { optionDescriptors: [] },
      },
    ]);
  });
});

describe("OpenAI-compatible provider snapshot builders", () => {
  it.effect("reports missing required credentials as a warning", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildOpenAiCompatibleProviderSnapshot({
        provider: OPENROUTER_PROVIDER,
        enabled: true,
        checkedAt: CHECKED_AT,
        apiKey: "",
        catalogModels: [],
      });

      expect(snapshot.displayName).toBe("OpenRouter");
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.message).toContain("API key");
    }),
  );

  it.effect("projects normalized catalog rows into server provider models", () =>
    Effect.gen(function* () {
      const [model] = normalizeNvidiaNimModelsResponse({
        data: [{ id: "z-ai/glm5", name: "GLM 5", supported_parameters: ["reasoning"] }],
      });

      const snapshot = yield* buildOpenAiCompatibleProviderSnapshot({
        provider: NVIDIA_NIM_PROVIDER,
        enabled: true,
        checkedAt: CHECKED_AT,
        apiKey: "nvapi-test",
        catalogModels: model ? [model] : [],
      });

      expect(snapshot.displayName).toBe("NVIDIA NIM");
      expect(snapshot.status).toBe("ready");
      expect(snapshot.auth).toMatchObject({ status: "authenticated", type: "bearer" });
      expect(snapshot.models).toEqual([
        {
          slug: "z-ai/glm5",
          name: "GLM 5",
          isCustom: false,
          subProvider: "NVIDIA NIM",
          capabilities: model!.capabilities,
        },
      ]);
    }),
  );

  it.effect("stamps instance identity for provider sources that want a full ServerProvider", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildOpenAiCompatibleServerProviderSnapshot({
        provider: LOCAL_OPENAI_PROVIDER,
        instanceId: ProviderInstanceId.make("localOpenAi"),
        enabled: true,
        checkedAt: CHECKED_AT,
        baseUrl: "http://127.0.0.1:1234/v1",
        catalogModels: parseOpenAiCompatibleModelsListJson({ data: [{ id: "local-model" }] }),
      });

      expect(snapshot.instanceId).toBe("localOpenAi");
      expect(snapshot.driver).toBe("localOpenAi");
      expect(snapshot.continuation).toEqual({ groupKey: "localOpenAi:instance:localOpenAi" });
      expect(snapshot.models.map((model) => model.slug)).toEqual(["local-model"]);
    }),
  );

  it("exports definitions for each requested provider", () => {
    expect([
      OPENROUTER_PROVIDER.displayName,
      NVIDIA_NIM_PROVIDER.displayName,
      LOCAL_OPENAI_PROVIDER.displayName,
      OPENCODE_ZEN_PROVIDER.displayName,
      OPENCODE_GO_PROVIDER.displayName,
      KIRO_AMAZON_Q_PROVIDER.displayName,
    ]).toEqual([
      "OpenRouter",
      "NVIDIA NIM",
      "Local OpenAI",
      "OpenCode Zen",
      "OpenCode Go",
      "Kiro / Amazon Q",
    ]);
  });
});
