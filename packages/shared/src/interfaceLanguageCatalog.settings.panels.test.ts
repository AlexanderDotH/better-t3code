import { describe, expect, it } from "vite-plus/test";

import { settingsPanelsInterfaceCatalog } from "./interfaceLanguageCatalog.settings.panels.ts";

describe("settings panels interface catalog", () => {
  it("ships non-empty English, German, and French messages for every key", () => {
    for (const key of settingsPanelsInterfaceCatalog.keys) {
      for (const language of ["en", "de", "fr"] as const) {
        const template = settingsPanelsInterfaceCatalog.messages[language][key];
        expect(typeof template === "string" ? template.trim() : template.other.trim()).not.toBe("");
      }
    }
  });
});
