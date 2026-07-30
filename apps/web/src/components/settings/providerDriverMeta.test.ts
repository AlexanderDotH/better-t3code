import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderSettingsFields } from "./ProviderSettingsForm";
import { DRIVER_OPTION_BY_VALUE, DRIVER_OPTIONS } from "./providerDriverMeta";
import { HyperagentIcon, LocalOpenAiIcon, NvidiaIcon, OpenRouterIcon } from "../Icons";

const INTEGRATION_PLAN_DRIVERS = [
  {
    kind: "gemini",
    label: "Gemini",
    fields: ["apiKey"],
  },
  {
    kind: "openrouter",
    label: "OpenRouter",
    fields: ["apiKey", "baseUrl", "preferredMaxCatalogContextTokens", "contextCompression"],
  },
  {
    kind: "nvidiaNim",
    label: "NVIDIA NIM",
    fields: ["apiKey", "baseUrl"],
  },
  {
    kind: "localOpenAi",
    label: "Local OpenAI",
    fields: [
      "v1BaseUrl",
      "apiKey",
      "opencodeServerBase",
      "opencodeServerUser",
      "opencodeServerPassword",
    ],
  },
  {
    kind: "opencodeZen",
    label: "OpenCode Zen",
    fields: ["apiKey", "baseUrl"],
  },
  {
    kind: "opencodeGo",
    label: "OpenCode Go",
    fields: ["apiKey", "baseUrl"],
  },
  {
    kind: "kiroAmazonQ",
    label: "Kiro / Amazon Q",
    fields: ["apiKey", "profileArn", "refreshToken", "refreshAuthRegion", "apiHost"],
  },
  {
    kind: "hyperagent",
    label: "Hyperagent",
    fields: ["sessionCookie", "baseUrl", "model", "fastMode"],
  },
  {
    kind: "cursorSdk",
    label: "Cursor SDK",
    fields: ["apiKey", "apiEndpoint"],
  },
] as const;

describe("providerDriverMeta", () => {
  it("exposes settings metadata for integration plan provider drivers", () => {
    for (const driver of INTEGRATION_PLAN_DRIVERS) {
      const definition = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make(driver.kind)];

      expect(definition).toMatchObject({
        value: ProviderDriverKind.make(driver.kind),
        label: driver.label,
        badgeLabel: "Early Access",
      });
      expect(deriveProviderSettingsFields(definition!).map((field) => field.key)).toEqual(
        driver.fields,
      );
    }
  });

  it("lists Gemini as an active driver option", () => {
    const geminiOptions = DRIVER_OPTIONS.filter(
      (option) => option.value === ProviderDriverKind.make("gemini"),
    );

    expect(geminiOptions).toHaveLength(1);
    expect(geminiOptions[0]).toMatchObject({
      label: "Gemini",
      badgeLabel: "Early Access",
    });
  });

  it("uses provider-specific icons for external provider integrations", () => {
    expect(DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("openrouter")]?.icon).toBe(
      OpenRouterIcon,
    );
    expect(DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("nvidiaNim")]?.icon).toBe(NvidiaIcon);
    expect(DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("localOpenAi")]?.icon).toBe(
      LocalOpenAiIcon,
    );
    expect(DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make("hyperagent")]?.icon).toBe(
      HyperagentIcon,
    );
  });
});
