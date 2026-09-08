import type { ServerProviderModel } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { createModelCapabilities } from "@t3tools/shared/model";

import { resolveClaudeDiscoveredModels } from "./ClaudeDiscoveredModels.ts";
import type { ClaudeGatewayCatalog, ClaudeGatewayModelProfile } from "./ClaudeGatewayCatalog.ts";

const emptyCapabilities = createModelCapabilities({ optionDescriptors: [] });
const gatewayCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low", isDefault: true },
        { id: "high", label: "High" },
      ],
    },
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});
const forcedFastGatewayCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "xhigh", label: "Extra High", isDefault: true },
      ],
    },
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
      currentValue: true,
    },
  ],
});

const gatewayProfile: ClaudeGatewayModelProfile = {
  canonicalModelId: "gpt-5.6-sol",
  baseModelId: "claude-codex-gpt-5.6-sol",
  fastModelId: "claude-codex-gpt-5.6-sol-fast",
  aliases: ["claude-codex-gpt-5.6-sol", "claude-fable-5-dd-los-6.5-tpg", "gateway-sonnet"],
  defaultEffort: "low",
  capabilities: gatewayCapabilities,
};

const gatewayCatalog: ClaudeGatewayCatalog = {
  profiles: [
    gatewayProfile,
    {
      ...gatewayProfile,
      aliases: ["claude-codex-gpt-5.6-sol-xhigh-fast"],
      defaultEffort: "xhigh",
      capabilities: forcedFastGatewayCapabilities,
    },
  ],
};

const builtInModels: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: emptyCapabilities,
  },
];

describe("Claude-discovered models", () => {
  it("uses the gateway model catalog and preserves its display names", () => {
    const models = resolveClaudeDiscoveredModels(builtInModels, [
      { value: "claude-codex-gpt-5.6-sol", displayName: "GPT 5.6 Sol" },
      { value: "claude-codex-gpt-5.4-mini", displayName: "GPT 5.4 Mini" },
    ]);

    expect(models).toEqual([
      {
        slug: "claude-codex-gpt-5.6-sol",
        name: "GPT 5.6 Sol",
        isCustom: false,
        capabilities: emptyCapabilities,
      },
      {
        slug: "claude-codex-gpt-5.4-mini",
        name: "GPT 5.4 Mini",
        isCustom: false,
        capabilities: emptyCapabilities,
      },
    ]);
  });

  it("keeps built-in capabilities when Claude reports a known model", () => {
    const models = resolveClaudeDiscoveredModels(builtInModels, [
      { value: "claude-sonnet-4-6", displayName: "Sonnet from Claude Code" },
    ]);

    expect(models).toEqual(builtInModels);
  });

  it("keeps native Claude alias normalization when no gateway profile resolves it", () => {
    const models = resolveClaudeDiscoveredModels(builtInModels, [
      { value: "sonnet-4.6", displayName: "Sonnet from Claude Code" },
    ]);

    expect(models).toEqual(builtInModels);
  });

  it("uses exact gateway capabilities for a stable gateway alias", () => {
    const models = resolveClaudeDiscoveredModels(
      builtInModels,
      [
        {
          value: "claude-codex-gpt-5.6-sol",
          resolvedModel: "gpt-5.6-sol",
          displayName: "GPT 5.6 Sol",
          description: "Gateway-backed GPT model",
          supportsEffort: true,
          supportedEffortLevels: ["low", "high"],
          supportsAdaptiveThinking: true,
          supportsFastMode: false,
          supportsAutoMode: false,
        },
      ],
      gatewayCatalog,
    );

    expect(models).toEqual([
      {
        slug: "claude-codex-gpt-5.6-sol",
        name: "GPT 5.6 Sol",
        isCustom: false,
        capabilities: gatewayCapabilities,
      },
    ]);
  });

  it("maps an obfuscated gateway model by its unambiguous display name", () => {
    const models = resolveClaudeDiscoveredModels(
      builtInModels,
      [
        {
          value: "claude-fable-5-dd-unresolved",
          displayName: "GPT 5.6 Sol",
          description: "From gateway",
        },
      ],
      gatewayCatalog,
    );

    expect(models).toEqual([
      {
        slug: "claude-fable-5-dd-unresolved",
        name: "GPT 5.6 Sol",
        isCustom: false,
        capabilities: gatewayCapabilities,
      },
    ]);
  });

  it("uses resolvedModel to keep a gateway-backed native alias from being normalized", () => {
    const models = resolveClaudeDiscoveredModels(
      builtInModels,
      [
        {
          value: "sonnet",
          resolvedModel: "gateway-sonnet",
          displayName: "GPT through Sonnet",
        },
      ],
      gatewayCatalog,
    );

    expect(models).toEqual([
      {
        slug: "sonnet",
        name: "GPT through Sonnet",
        isCustom: false,
        capabilities: gatewayCapabilities,
      },
    ]);
  });

  it("preserves stable and obfuscated gateway selections as independent discovered rows", () => {
    const models = resolveClaudeDiscoveredModels(
      builtInModels,
      [
        { value: "claude-codex-gpt-5.6-sol", displayName: "GPT 5.6 Sol" },
        {
          value: "claude-fable-5-dd-los-6.5-tpg",
          displayName: "GPT 5.6 Sol (legacy selection)",
        },
      ],
      gatewayCatalog,
    );

    expect(models.map((model) => model.slug)).toEqual([
      "claude-codex-gpt-5.6-sol",
      "claude-fable-5-dd-los-6.5-tpg",
    ]);
    expect(models.every((model) => model.capabilities === gatewayCapabilities)).toBe(true);
  });

  it("keeps default opaque while exposing controls for a forced-fast gateway alias", () => {
    const models = resolveClaudeDiscoveredModels(
      builtInModels,
      [
        { value: "default", displayName: "Default" },
        {
          value: "claude-codex-gpt-5.6-sol-xhigh-fast",
          displayName: "Legacy GPT Fast",
        },
      ],
      gatewayCatalog,
    );

    expect(models).toEqual([
      {
        slug: "default",
        name: "Default",
        isCustom: false,
        capabilities: emptyCapabilities,
      },
      {
        slug: "claude-codex-gpt-5.6-sol-xhigh-fast",
        name: "Legacy GPT Fast",
        isCustom: false,
        capabilities: forcedFastGatewayCapabilities,
      },
    ]);
  });

  it("falls back to built-in models when discovery returns no usable entries", () => {
    const models = resolveClaudeDiscoveredModels(builtInModels, [
      { value: " ", displayName: "Invalid" },
    ]);

    expect(models).toEqual(builtInModels);
  });
});
