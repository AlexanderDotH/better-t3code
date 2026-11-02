import { assert, it } from "@effect/vitest";
import { createCodexContextWindowDescriptor } from "@t3tools/shared/model";

import { applyPreferredCodexDefaultModel, mapCodexModelCapabilities } from "./CodexProvider.ts";

const TEST_CONTEXT_WINDOW = {
  defaultTokens: 272_000,
  maxTokens: 872_000,
  effectivePercent: 95,
} as const;
const TEST_CONTEXT_WINDOW_DESCRIPTOR = createCodexContextWindowDescriptor(TEST_CONTEXT_WINDOW);

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities(
    {
      additionalSpeedTiers: [],
      defaultReasoningEffort: "super-high",
      description: "Test model",
      displayName: "GPT Test",
      hidden: false,
      id: "gpt-test",
      isDefault: true,
      model: "gpt-test",
      defaultServiceTier: "flex",
      serviceTiers: [
        {
          id: "priority",
          name: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          name: "Flex",
          description: "Lower-cost asynchronous routing.",
        },
      ],
      supportedReasoningEfforts: [
        {
          description: "Maximum reasoning",
          reasoningEffort: "super-high",
        },
      ],
    },
    TEST_CONTEXT_WINDOW,
  );

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
    TEST_CONTEXT_WINDOW_DESCRIPTOR,
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities(
    {
      additionalSpeedTiers: ["fast"],
      defaultReasoningEffort: "medium",
      defaultServiceTier: null,
      description: "Test model",
      displayName: "GPT Test",
      hidden: false,
      id: "gpt-test",
      isDefault: true,
      model: "gpt-test",
      serviceTiers: [
        {
          id: "priority",
          name: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          name: "Ultrafast",
          description: "The fastest available responses for latency-sensitive work.",
        },
      ],
      supportedReasoningEfforts: [],
    },
    TEST_CONTEXT_WINDOW,
  );

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          label: "Ultrafast",
          description: "Even faster, more expensive",
        },
      ],
      currentValue: "default",
    },
    TEST_CONTEXT_WINDOW_DESCRIPTOR,
  ]);
});

it("canonicalizes the legacy fast catalog tier to priority", () => {
  const capabilities = mapCodexModelCapabilities(
    {
      additionalSpeedTiers: ["fast"],
      defaultReasoningEffort: "medium",
      defaultServiceTier: "fast",
      description: "Legacy catalog model",
      displayName: "GPT Legacy",
      hidden: false,
      id: "gpt-legacy",
      isDefault: false,
      model: "gpt-legacy",
      serviceTiers: [],
      supportedReasoningEfforts: [],
    },
    TEST_CONTEXT_WINDOW,
  );

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        { id: "priority", label: "Fast", isDefault: true },
      ],
      currentValue: "priority",
    },
    TEST_CONTEXT_WINDOW_DESCRIPTOR,
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("ranks qualified Codex models while preserving their wire ids", () => {
  const models = applyPreferredCodexDefaultModel([
    {
      slug: "openai.gpt-5.6-luna",
      name: "Luna",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
    { slug: "openai.gpt-5.6-sol", name: "Sol", isCustom: false, capabilities: null },
  ]);
  assert.deepStrictEqual(
    models.filter((model) => model.isDefault).map((model) => model.slug),
    ["openai.gpt-5.6-sol"],
  );
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});
