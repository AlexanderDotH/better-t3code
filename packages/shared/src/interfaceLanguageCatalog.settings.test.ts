import { describe, expect, it } from "vite-plus/test";

import {
  settingsInterfaceCatalog,
  type SettingsInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.ts";
import { settingsApplicationInterfaceCatalog } from "./interfaceLanguageCatalog.settings.application.ts";
import { settingsConnectionsInterfaceCatalog } from "./interfaceLanguageCatalog.settings.connections.ts";
import { settingsDiagnosticsInterfaceCatalog } from "./interfaceLanguageCatalog.settings.diagnostics.ts";
import { settingsEnvironmentsInterfaceCatalog } from "./interfaceLanguageCatalog.settings.environments.ts";
import { settingsMcpInterfaceCatalog } from "./interfaceLanguageCatalog.settings.mcp.ts";
import { settingsProjectsInterfaceCatalog } from "./interfaceLanguageCatalog.settings.projects.ts";
import { settingsProvidersInterfaceCatalog } from "./interfaceLanguageCatalog.settings.providers.ts";
import { settingsThemeVoiceInterfaceCatalog } from "./interfaceLanguageCatalog.settings.themeVoice.ts";
import type { LocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";
import {
  getInterfaceMessageTemplate,
  INTERFACE_MESSAGE_KEYS,
  isInterfaceMessageKey,
  type InterfaceMessageKey,
} from "./interfaceLanguageCatalog.ts";

const representativeKeys = [
  "settings.common.search",
  "settings.providers.add.title",
  "settings.mcp.serverCount",
  "settings.providers.instanceNamed",
] as const satisfies readonly SettingsInterfaceMessageKey[];

const domainCatalogs = [
  settingsProvidersInterfaceCatalog,
  settingsProjectsInterfaceCatalog,
  settingsDiagnosticsInterfaceCatalog,
  settingsConnectionsInterfaceCatalog,
  settingsEnvironmentsInterfaceCatalog,
  settingsApplicationInterfaceCatalog,
  settingsMcpInterfaceCatalog,
  settingsThemeVoiceInterfaceCatalog,
] as const;

function expectCompleteCatalog<Key extends string>(catalog: LocalizedInterfaceCatalog<Key>) {
  expect(new Set(catalog.keys).size).toBe(catalog.keys.length);
  for (const language of ["en", "de", "fr"] as const) {
    for (const key of catalog.keys) {
      const message = catalog.messages[language][key];
      expect(message).toBeDefined();
      if (typeof message === "string") expect(message.trim()).not.toBe("");
    }
  }
}

describe("settings interface language catalog", () => {
  it("registers every settings key in the shared interface translator", () => {
    for (const catalog of [settingsInterfaceCatalog, ...domainCatalogs]) {
      expect(catalog.keys.every((key) => INTERFACE_MESSAGE_KEYS.includes(key))).toBe(true);
    }
    for (const key of representativeKeys) {
      const typedKey: InterfaceMessageKey = key;
      expect(getInterfaceMessageTemplate("fr", typedKey)).toBe(
        settingsInterfaceCatalog.messages.fr[key],
      );
    }
  });

  it("rejects unknown and prototype-derived message identifiers", () => {
    expect(isInterfaceMessageKey("settings.mcp.runtime.servers")).toBe(true);
    expect(isInterfaceMessageKey("settings.mcp.runtime.not-real")).toBe(false);
    expect(isInterfaceMessageKey("toString")).toBe(false);
  });

  it("owns complete English, German, and French settings messages", () => {
    expectCompleteCatalog(settingsInterfaceCatalog);
    expectCompleteCatalog(settingsProvidersInterfaceCatalog);
    expectCompleteCatalog(settingsProjectsInterfaceCatalog);
    expectCompleteCatalog(settingsDiagnosticsInterfaceCatalog);
    expectCompleteCatalog(settingsConnectionsInterfaceCatalog);
    expectCompleteCatalog(settingsEnvironmentsInterfaceCatalog);
    expectCompleteCatalog(settingsApplicationInterfaceCatalog);
    expectCompleteCatalog(settingsMcpInterfaceCatalog);
    expectCompleteCatalog(settingsThemeVoiceInterfaceCatalog);
    expect(representativeKeys.every((key) => settingsInterfaceCatalog.keys.includes(key))).toBe(
      true,
    );
  });

  it("keeps plural and interpolation placeholders in every locale", () => {
    for (const language of ["en", "de", "fr"] as const) {
      const count = settingsInterfaceCatalog.messages[language]["settings.mcp.serverCount"];
      expect(typeof count).toBe("object");
      if (typeof count === "object") {
        expect(count.one).toContain("{{count}}");
        expect(count.other).toContain("{{count}}");
      }
      expect(
        settingsInterfaceCatalog.messages[language]["settings.providers.instanceNamed"],
      ).toContain("{{name}}");
      const scopeCount =
        settingsEnvironmentsInterfaceCatalog.messages[language]["settings.connections.scopeCount"];
      expect(typeof scopeCount).toBe("object");
      if (typeof scopeCount === "object") {
        expect(scopeCount.one).toContain("{{count}}");
        expect(scopeCount.other).toContain("{{count}}");
      }
      expect(
        settingsEnvironmentsInterfaceCatalog.messages[language]["settings.connections.showScopes"],
      ).toContain("{{scopeCount}}");
      expect(
        settingsEnvironmentsInterfaceCatalog.messages[language][
          "settings.connections.toast.sshReady"
        ],
      ).toContain("{{environment}}");
    }
  });

  it("keeps provider, server, tool, error, and user payloads outside catalog ownership", () => {
    expect(
      settingsInterfaceCatalog.keys.some((key) =>
        /providerOutput|serverPayload|toolResult|errorDetail|userValue/u.test(key),
      ),
    ).toBe(false);
  });
});
