import { assert, it } from "@effect/vitest";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import {
  getCodexServiceTierOptionValue,
  normalizeCodexModelSelectionServiceTier,
} from "./codexModelOptions.ts";

const serviceTierCapabilities = {
  optionDescriptors: [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select" as const,
      options: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
        { id: "flex", label: "Flex" },
      ],
      currentValue: "default",
    },
  ],
};

it("returns the selected Codex service tier id", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.5", [
    { id: "serviceTier", value: "flex" },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "flex");
});

it("keeps legacy persisted fast mode selections working", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "fastMode", value: true },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "priority");
});

it("maps the legacy service tier alias to the current priority tier", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "serviceTier", value: "fast" },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "priority");
});

it("keeps an explicit standard selection on the wire", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "serviceTier", value: "default" },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "default");
});

it("normalizes legacy fast mode against the selected model catalog", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "reasoningEffort", value: "high" },
    { id: "fastMode", value: true },
  ]);

  assert.deepStrictEqual(
    normalizeCodexModelSelectionServiceTier(selection, serviceTierCapabilities),
    createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
    ]),
  );
});

it("falls back to explicit standard for an unsupported selected tier", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "serviceTier", value: "turbo" },
  ]);

  assert.deepStrictEqual(
    normalizeCodexModelSelectionServiceTier(selection, serviceTierCapabilities),
    createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "serviceTier", value: "default" },
    ]),
  );
});

it("does not send a service tier for a model that declares no tier capability", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "reasoningEffort", value: "medium" },
    { id: "serviceTier", value: "priority" },
  ]);

  assert.deepStrictEqual(
    normalizeCodexModelSelectionServiceTier(selection, {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          options: [{ id: "medium", label: "Medium", isDefault: true }],
        },
      ],
    }),
    createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "reasoningEffort", value: "medium" },
    ]),
  );
});
