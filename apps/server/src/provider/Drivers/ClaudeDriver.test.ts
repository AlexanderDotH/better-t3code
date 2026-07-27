import { describe, expect, it } from "vitest";

import { createModelCapabilities } from "@t3tools/shared/model";

import type { ClaudeGatewayCatalog } from "./ClaudeGatewayCatalog.ts";
import { enrichClaudeGatewayCatalogAliases } from "./ClaudeDriver.ts";

const gatewayCatalog: ClaudeGatewayCatalog = {
  profiles: [
    {
      canonicalModelId: "gpt-5.6-sol",
      baseModelId: "claude-codex-gpt-5.6-sol",
      fastModelId: "claude-codex-gpt-5.6-sol-fast",
      aliases: ["gpt-5.6-sol", "claude-codex-gpt-5.6-sol", "claude-codex-gpt-5.6-sol-fast"],
      defaultEffort: "low",
      capabilities: createModelCapabilities({ optionDescriptors: [] }),
    },
    {
      canonicalModelId: "gpt-5.6-sol",
      baseModelId: "claude-codex-gpt-5.6-sol",
      fastModelId: "claude-codex-gpt-5.6-sol-fast",
      aliases: ["claude-codex-gpt-5.6-sol-xhigh-fast"],
      defaultEffort: "xhigh",
      capabilities: createModelCapabilities({ optionDescriptors: [] }),
    },
  ],
};

describe("enrichClaudeGatewayCatalogAliases", () => {
  it("maps a discovered obfuscated value through its resolved gateway model", () => {
    const enriched = enrichClaudeGatewayCatalogAliases(gatewayCatalog, [
      {
        value: "claude-fable-5-dd-los-6.5-tpg",
        displayName: "GPT-5.6 Sol",
        resolvedModel: "claude-codex-gpt-5.6-sol",
      },
    ]);

    expect(enriched.profiles[0]?.aliases).toContain("claude-fable-5-dd-los-6.5-tpg");
    expect(gatewayCatalog.profiles[0]?.aliases).not.toContain("claude-fable-5-dd-los-6.5-tpg");
  });

  it("maps an obfuscated forced-fast selection to its exact gateway profile", () => {
    const enriched = enrichClaudeGatewayCatalogAliases(gatewayCatalog, [
      {
        value: "default",
        displayName: "Default",
        resolvedModel: "claude-codex-gpt-5.6-sol",
      },
      {
        value: "claude-fable-5-dd-forced-fast",
        displayName: "Legacy Fast",
        resolvedModel: "claude-codex-gpt-5.6-sol-xhigh-fast",
      },
    ]);

    expect(enriched.profiles[0]?.aliases).not.toContain("claude-fable-5-dd-forced-fast");
    expect(enriched.profiles[1]?.aliases).toContain("claude-fable-5-dd-forced-fast");
    expect(gatewayCatalog.profiles[1]?.aliases).not.toContain("claude-fable-5-dd-forced-fast");
  });

  it("maps an obfuscated selection without resolvedModel by display name", () => {
    const enriched = enrichClaudeGatewayCatalogAliases(gatewayCatalog, [
      {
        value: "claude-fable-5-dd-unresolved",
        displayName: "GPT 5.6 Sol",
      },
    ]);

    expect(enriched.profiles[0]?.aliases).toContain("claude-fable-5-dd-unresolved");
    expect(enriched.profiles[1]?.aliases).not.toContain("claude-fable-5-dd-unresolved");
    expect(gatewayCatalog.profiles[0]?.aliases).not.toContain("claude-fable-5-dd-unresolved");
  });
});
