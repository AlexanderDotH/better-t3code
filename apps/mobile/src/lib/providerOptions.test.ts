import { describe, expect, it } from "vite-plus/test";

import type { ModelCapabilities } from "@t3tools/contracts";

import {
  applyProviderOptionMenuEvent,
  buildProviderOptionMenuActions,
  providerOptionsConfigurationLabel,
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
    const actions = buildProviderOptionMenuActions(descriptors);

    expect(actions).toMatchObject([
      {
        title: "Reasoning",
        subtitle: "Low",
        subactions: [
          { title: "Low (default)", state: "on" },
          { title: "Medium", state: undefined },
          { title: "High", state: undefined },
          { title: "Extra High", state: undefined },
          { title: "Max", state: undefined },
        ],
      },
      {
        title: "Fast Mode",
        subtitle: "Off",
        subactions: [
          { title: "Off", state: "on" },
          { title: "On", state: undefined },
        ],
      },
    ]);
    expect(providerOptionsConfigurationLabel(descriptors)).toBe("Low");

    const fastEvent = actions[1]?.subactions?.[1]?.id;
    expect(fastEvent).toBeDefined();
    expect(applyProviderOptionMenuEvent(descriptors, fastEvent!)).toEqual([
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

    expect(buildProviderOptionMenuActions(gpt54Descriptors)).toMatchObject([
      { title: "Reasoning", subtitle: "Medium" },
      { title: "Fast Mode", subtitle: "On" },
    ]);
    expect(buildProviderOptionMenuActions(miniDescriptors)).toMatchObject([
      { title: "Reasoning", subtitle: "Medium" },
    ]);
    expect(nonReasoningDescriptors).toEqual([]);
  });

  it("renders the option descriptors advertised by the selected model", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: CODEX_CAPABILITIES,
      selections: undefined,
    });

    expect(buildProviderOptionMenuActions(descriptors)).toMatchObject([
      {
        title: "Reasoning",
        subtitle: "Medium",
        subactions: [
          { title: "Medium (default)", state: "on" },
          { title: "High", state: undefined },
        ],
      },
      {
        title: "Service Tier",
        subtitle: "Standard",
        subactions: [
          { title: "Standard (default)", state: "on" },
          { title: "Fast", state: undefined },
        ],
      },
    ]);
    expect(providerOptionsConfigurationLabel(descriptors)).toBe("Medium · Standard");
  });

  it("updates generic select options without knowing provider-specific ids", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: CODEX_CAPABILITIES,
      selections: undefined,
    });
    const actions = buildProviderOptionMenuActions(descriptors);
    const fastEvent = actions[1]?.subactions?.[1]?.id;

    expect(fastEvent).toBeDefined();
    expect(applyProviderOptionMenuEvent(descriptors, fastEvent!)).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "priority" },
    ]);
  });

  it("treats an unspecified boolean capability as off", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: {
        optionDescriptors: [{ id: "fastMode", label: "Fast Mode", type: "boolean" }],
      },
      selections: undefined,
    });

    expect(buildProviderOptionMenuActions(descriptors)).toMatchObject([
      {
        title: "Fast Mode",
        subtitle: "Off",
        subactions: [
          { title: "Off", state: "on" },
          { title: "On", state: undefined },
        ],
      },
    ]);
    expect(providerOptionsConfigurationLabel(descriptors)).toBe("Configuration");
  });
});
