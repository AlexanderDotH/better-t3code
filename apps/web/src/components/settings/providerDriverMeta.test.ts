import { ProviderDriverKind } from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderSettingsFields } from "./ProviderSettingsForm";
import { DRIVER_OPTION_BY_VALUE, DRIVER_OPTIONS } from "./providerDriverMeta";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { OpenRouterIcon } from "../Icons";

const NATIVE_PROVIDER_DRIVERS = [
  {
    kind: "codex",
    label: "Codex",
    fields: ["binaryPath", "homePath", "shadowHomePath", "launchArgs"],
  },
  {
    kind: "claudeAgent",
    label: "Claude",
    fields: ["binaryPath", "homePath", "launchArgs"],
  },
  {
    kind: "cursor",
    label: "Cursor",
    badgeLabel: "Early Access",
    fields: ["binaryPath", "apiEndpoint"],
  },
  {
    kind: "grok",
    label: "Grok",
    badgeLabel: "Early Access",
    fields: ["binaryPath"],
  },
  {
    kind: "opencode",
    label: "OpenCode",
    fields: ["binaryPath", "serverUrl", "serverPassword"],
  },
  {
    kind: "gemini",
    label: "Gemini",
    badgeLabel: "Early Access",
    fields: [],
  },
  {
    kind: "chatgpt",
    label: "ChatGPT Subscription",
    badgeLabel: "Early Access",
    fields: ["binaryPath"],
  },
  {
    kind: "openrouter",
    label: "OpenRouter",
    badgeLabel: "Early Access",
    fields: [
      "protocol",
      "defaultModel",
      "customModels",
      "contextCompression",
      "routingMode",
      "allowFallbacks",
      "dataCollection",
      "requireZdr",
      "preferredMinThroughput",
      "preferredMaxLatency",
      "maxPromptPriceUsdPerMillion",
      "maxCompletionPriceUsdPerMillion",
      "maxRequestPriceUsd",
    ],
  },
] as const;

describe("providerDriverMeta", () => {
  it("exposes all built-in provider definitions and Early Access labels", () => {
    expect(
      DRIVER_OPTIONS.map(({ value, label, badgeLabel }) => ({
        value,
        label,
        ...(badgeLabel ? { badgeLabel } : {}),
      })),
    ).toEqual(
      NATIVE_PROVIDER_DRIVERS.map(({ kind, label, ...driver }) => ({
        value: ProviderDriverKind.make(kind),
        label,
        ...("badgeLabel" in driver && driver.badgeLabel ? { badgeLabel: driver.badgeLabel } : {}),
      })),
    );
  });

  it("uses OpenRouter branding in settings and model surfaces", () => {
    const openRouter = ProviderDriverKind.make("openrouter");
    expect(DRIVER_OPTION_BY_VALUE[openRouter]?.icon).toBe(OpenRouterIcon);
    expect(PROVIDER_ICON_BY_PROVIDER[openRouter]).toBe(OpenRouterIcon);
  });

  it("renders OpenRouter's current geometric OR mark", () => {
    const markup = renderToStaticMarkup(
      createElement(OpenRouterIcon, { "aria-label": "OpenRouter" }),
    );

    expect(markup).toContain('viewBox="0 0 401.4 293.7"');
    expect(markup).toContain("M303.9475,17.19926");
    expect(markup).toContain("fill-[#7624F4]");
    expect(markup).toContain("dark:fill-[#C8FF00]");
    expect(markup).not.toContain("#FF5C35");
    expect(markup).not.toContain("<rect");
  });

  it("derives settings fields for every native provider driver", () => {
    for (const driver of NATIVE_PROVIDER_DRIVERS) {
      const definition = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make(driver.kind)];

      expect(definition).toMatchObject({
        value: ProviderDriverKind.make(driver.kind),
        label: driver.label,
      });
      expect(deriveProviderSettingsFields(definition!).map((field) => field.key)).toEqual(
        driver.fields,
      );
    }
  });
});
