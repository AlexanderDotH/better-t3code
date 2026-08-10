import { describe, expect, it } from "vite-plus/test";

import type { ModelCapabilities } from "@t3tools/contracts";

import {
  applyProviderOptionSelection,
  providerOptionValueLabels,
  resolveProviderOptionDescriptors,
} from "./providerOptions";

const CODEX_CAPABILITIES: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      currentValue: "medium",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
      ],
      currentValue: "default",
    },
  ],
};

const GPT_56_SOL_CAPABILITIES: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low", isDefault: true },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
        { id: "max", label: "Max" },
      ],
    },
    { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
  ],
};

const GPT_54_CAPABILITIES: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
    },
    { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
  ],
};

describe("mobile provider options", () => {
  it("renders and persists gateway GPT reasoning with Fast off by default", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: GPT_56_SOL_CAPABILITIES,
      selections: undefined,
    });

    expect(providerOptionValueLabels(descriptors)).toEqual(["Low"]);
    expect(applyProviderOptionSelection(descriptors, { id: "fastMode", value: true })).toEqual([
      { id: "effort", value: "low" },
      { id: "fastMode", value: true },
    ]);
  });

  it("uses a new GPT ladder default and drops options the model no longer advertises", () => {
    const gpt54Descriptors = resolveProviderOptionDescriptors({
      capabilities: GPT_54_CAPABILITIES,
      selections: [
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
      ],
    });
    const miniDescriptors = resolveProviderOptionDescriptors({
      capabilities: {
        optionDescriptors: GPT_54_CAPABILITIES.optionDescriptors?.filter(
          (descriptor) => descriptor.id !== "fastMode",
        ),
      },
      selections: [
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
      ],
    });
    const nonReasoningDescriptors = resolveProviderOptionDescriptors({
      capabilities: { optionDescriptors: [] },
      selections: [
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
      ],
    });

    expect(providerOptionValueLabels(gpt54Descriptors)).toEqual(["Medium", "Fast Mode"]);
    expect(providerOptionValueLabels(miniDescriptors)).toEqual(["Medium"]);
    expect(nonReasoningDescriptors).toEqual([]);
  });

  it("summarizes the option values currently in effect", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: CODEX_CAPABILITIES,
      selections: undefined,
    });

    expect(providerOptionValueLabels(descriptors)).toEqual(["Medium", "Standard"]);
  });

  it("updates generic select options without knowing provider-specific ids", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: CODEX_CAPABILITIES,
      selections: undefined,
    });

    expect(
      applyProviderOptionSelection(descriptors, { id: "serviceTier", value: "priority" }),
    ).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "priority" },
    ]);
    // Choices the model doesn't advertise are rejected, not stored.
    expect(
      applyProviderOptionSelection(descriptors, { id: "serviceTier", value: "turbo" }),
    ).toBeNull();
    expect(applyProviderOptionSelection(descriptors, { id: "unknown", value: "high" })).toBeNull();
  });

  it("treats an unspecified boolean capability as off", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: {
        optionDescriptors: [{ id: "fastMode", label: "Fast Mode", type: "boolean" }],
      },
      selections: undefined,
    });

    expect(providerOptionValueLabels(descriptors)).toEqual([]);
    expect(applyProviderOptionSelection(descriptors, { id: "fastMode", value: true })).toEqual([
      { id: "fastMode", value: true },
    ]);
  });
});
