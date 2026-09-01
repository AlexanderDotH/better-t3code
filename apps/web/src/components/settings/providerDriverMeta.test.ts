import { ProviderDriverKind } from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderSettingsFields } from "./ProviderSettingsForm";
import { DRIVER_OPTION_BY_VALUE, DRIVER_OPTIONS } from "./providerDriverMeta";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { OpenAI, OpenRouterIcon } from "../Icons";

const NATIVE_PROVIDER_DRIVERS = [
  {
    kind: "codex",
    label: "Codex",
    fields: ["binaryPath", "homePath", "shadowHomePath", "launchArgs"],
  },
  {
    kind: "claudeAgent",
    label: "Claude",
    fields: ["binaryPath", "homePath", "autoCompactWindow", "launchArgs"],
  },
  {
    kind: "cursor",
    label: "Cursor",
    badgeMessageKey: "settings.providers.badge.earlyAccess",
    fields: ["binaryPath", "apiEndpoint"],
  },
  {
    kind: "grok",
    label: "Grok",
    badgeMessageKey: "settings.providers.badge.earlyAccess",
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
    badgeMessageKey: "settings.providers.badge.earlyAccess",
    fields: [],
  },
  {
    kind: "chatgpt",
    label: "ChatGPT Subscription",
    badgeMessageKey: "settings.providers.badge.earlyAccess",
    fields: ["binaryPath"],
  },
  {
    kind: "openrouter",
    label: "OpenRouter",
    badgeMessageKey: "settings.providers.badge.earlyAccess",
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
  {
    kind: "openai",
    label: "OpenAI Responses",
    badgeMessageKey: "settings.providers.badge.earlyAccess",
    fields: [],
  },
] as const;

describe("providerDriverMeta", () => {
  it("exposes all built-in provider definitions and Early Access labels", () => {
    expect(
      DRIVER_OPTIONS.map(({ value, label, badgeMessageKey }) => ({
        value,
        label,
        ...(badgeMessageKey ? { badgeMessageKey } : {}),
      })),
    ).toEqual(
      NATIVE_PROVIDER_DRIVERS.map(({ kind, label, ...driver }) => ({
        value: ProviderDriverKind.make(kind),
        label,
        ...("badgeMessageKey" in driver && driver.badgeMessageKey
          ? { badgeMessageKey: driver.badgeMessageKey }
          : {}),
      })),
    );
  });

  it("uses OpenRouter branding in settings and model surfaces", () => {
    const openRouter = ProviderDriverKind.make("openrouter");
    expect(DRIVER_OPTION_BY_VALUE[openRouter]?.icon).toBe(OpenRouterIcon);
    expect(PROVIDER_ICON_BY_PROVIDER[openRouter]).toBe(OpenRouterIcon);
  });

  it("uses OpenAI branding for the Responses provider", () => {
    const openAi = ProviderDriverKind.make("openai");
    expect(DRIVER_OPTION_BY_VALUE[openAi]?.icon).toBe(OpenAI);
    expect(PROVIDER_ICON_BY_PROVIDER[openAi]).toBe(OpenAI);
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
