import { describe, expect, it } from "vite-plus/test";

import { settingsProjectsInterfaceCatalog } from "./interfaceLanguageCatalog.settings.projects.ts";

function placeholders(template: string): readonly string[] {
  return [...template.matchAll(/{{([A-Za-z0-9_]+)}}/g)].map((match) => match[1] ?? "").toSorted();
}

function templates(value: string | Readonly<{ one: string; other: string }>): readonly string[] {
  return typeof value === "string" ? [value] : [value.one, value.other];
}

describe("project settings interface catalog", () => {
  it("ships matching non-empty English, German, and French templates", () => {
    expect(settingsProjectsInterfaceCatalog.keys.length).toBeGreaterThan(80);
    for (const key of settingsProjectsInterfaceCatalog.keys) {
      const englishTemplates = templates(settingsProjectsInterfaceCatalog.messages.en[key]);
      for (const language of ["de", "fr"] as const) {
        const localizedTemplates = templates(
          settingsProjectsInterfaceCatalog.messages[language][key],
        );
        expect(localizedTemplates).toHaveLength(englishTemplates.length);
        for (const [index, localized] of localizedTemplates.entries()) {
          expect(localized.trim()).not.toBe("");
          expect(placeholders(localized)).toEqual(placeholders(englishTemplates[index] ?? ""));
        }
      }
    }
  });
});
