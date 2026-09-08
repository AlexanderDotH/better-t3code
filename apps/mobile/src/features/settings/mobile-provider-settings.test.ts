import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mobileProviderCatalogModels,
  mobileProviderSettingsDefinition,
  parseMobileNumberDraft,
} from "./mobile-provider-settings";

function provider(models: ServerProvider["models"]): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("openrouter"),
    driver: ProviderDriverKind.make("openrouter"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-25T00:00:00.000Z",
    models,
    slashCommands: [],
    skills: [],
  };
}

describe("mobile provider settings", () => {
  it("maps only built-in OpenRouter to its annotated schema", () => {
    expect(mobileProviderSettingsDefinition(ProviderDriverKind.make("openrouter"))).not.toBeNull();
    expect(mobileProviderSettingsDefinition(ProviderDriverKind.make("custom"))).toBeNull();
  });

  it("keeps model-backed fields disabled until a catalog is present", () => {
    expect(mobileProviderCatalogModels(provider([]))).toBeUndefined();
    expect(
      mobileProviderCatalogModels(
        provider([
          {
            slug: "anthropic/claude-sonnet",
            name: "Claude Sonnet",
            isCustom: false,
            isDefault: true,
            capabilities: {},
          },
          {
            slug: "openai/no-tools",
            name: "No tools",
            isCustom: false,
            isSelectable: false,
            unavailableReason: "No tool support",
            capabilities: {},
          },
        ]),
      ),
    ).toEqual([
      { slug: "anthropic/claude-sonnet", name: "Claude Sonnet" },
      { slug: "openai/no-tools", name: "No tools", isSelectable: false },
    ]);
  });

  it("accepts blank optional numbers and rejects invalid or out-of-range drafts", () => {
    expect(parseMobileNumberDraft("", { min: 0 })).toEqual({ valid: true, value: undefined });
    expect(parseMobileNumberDraft("1.25", { min: 0, max: 2 })).toEqual({
      valid: true,
      value: 1.25,
    });
    expect(parseMobileNumberDraft("nope", { min: 0 })).toEqual({ valid: false });
    expect(parseMobileNumberDraft("-1", { min: 0 })).toEqual({ valid: false });
  });
});
