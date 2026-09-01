import { assert, it } from "@effect/vitest";
import { createCodexContextWindowDescriptor } from "@t3tools/shared/model";

import {
  applyPreferredCodexDefaultModel,
  isLegacyCodexModel,
  mapCodexModelCapabilities,
  parseCodexDebugModelCatalog,
} from "./CodexProvider.ts";

const TEST_CONTEXT_WINDOW = {
  defaultTokens: 272_000,
  maxTokens: 872_000,
  effectivePercent: 95,
} as const;

const TEST_CONTEXT_WINDOW_DESCRIPTOR = createCodexContextWindowDescriptor(TEST_CONTEXT_WINDOW);

it("extracts bounded context metadata from Codex's raw model catalog", () => {
  assert.deepStrictEqual(
    parseCodexDebugModelCatalog({
      models: [
        {
          slug: "gpt-5.6-sol",
          context_window: 272_000,
          max_context_window: 872_000,
          effective_context_window_percent: 95,
          model_messages: { instructions_template: "must not survive parsing" },
        },
        {
          slug: "broken",
          context_window: -1,
          max_context_window: 10,
        },
      ],
    }),
    new Map([
      ["gpt-5.6-sol", { defaultTokens: 272_000, maxTokens: 872_000, effectivePercent: 95 }],
    ]),
  );
});

it("keeps current Codex models out of legacy models", () => {
  assert.deepStrictEqual(
    [
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-daybreak-blue-latest",
      "gpt-daybreak-red-latest",
      "gpt-5.4",
    ].map((model) => [model, isLegacyCodexModel(model)]),
    [
      ["gpt-5.6-luna", false],
      ["gpt-5.6-terra", false],
      ["gpt-5.6-sol", false],
      ["gpt-daybreak-blue-latest", false],
      ["gpt-daybreak-red-latest", false],
      ["gpt-5.4", true],
    ],
  );
});

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

it("prefers sol over terra when both are available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol", isCustom: false, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.6-sol");
});

it("keeps Codex's own default when no preferred model is available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.5", name: "GPT-5.5", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});
