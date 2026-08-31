import { describe, expect, it } from "vite-plus/test";

import { pseudoLocalizeInterfaceMessage, translateInterfaceMessage } from "./interfaceLanguage.ts";
import { sidebarInterfaceCatalog } from "./interfaceLanguageCatalog.sidebar.ts";

function placeholders(template: string): readonly string[] {
  return [...template.matchAll(/{{([A-Za-z0-9_]+)}}/g)].map((match) => match[1] ?? "").toSorted();
}

function templates(value: string | Readonly<{ one: string; other: string }>): readonly string[] {
  return typeof value === "string" ? [value] : [value.one, value.other];
}

describe("sidebar interface catalog", () => {
  it("ships a non-empty en/de/fr message with matching placeholders for every key", () => {
    expect(sidebarInterfaceCatalog.keys.length).toBeGreaterThan(150);
    for (const key of sidebarInterfaceCatalog.keys) {
      const englishTemplates = templates(sidebarInterfaceCatalog.messages.en[key]);
      for (const language of ["de", "fr"] as const) {
        const localizedTemplates = templates(sidebarInterfaceCatalog.messages[language][key]);
        expect(localizedTemplates).toHaveLength(englishTemplates.length);
        for (const [index, localized] of localizedTemplates.entries()) {
          expect(localized.trim()).not.toBe("");
          expect(placeholders(localized)).toEqual(placeholders(englishTemplates[index] ?? ""));
        }
      }
    }
  });

  it("interpolates project, branch, count, and version values without translating content", () => {
    for (const language of ["en", "de", "fr"] as const) {
      expect(
        translateInterfaceMessage(language, "sidebar.project.settingsFor", {
          project: "Curivio",
        }),
      ).toContain("Curivio");
      expect(
        translateInterfaceMessage(language, "sidebar.thread.menu.newOnBranch", {
          branch: "feature/alpha",
        }),
      ).toContain("feature/alpha");
      expect(
        translateInterfaceMessage(language, "sidebar.olderProjects.count", { count: 2 }),
      ).toContain("2");
      expect(
        translateInterfaceMessage(language, "sidebar.update.changesIn", { version: "1.2.3" }),
      ).toContain("1.2.3");
    }
  });

  it("produces bounded pseudo-localized long labels while preserving interpolation", () => {
    const english = translateInterfaceMessage("en", "sidebar.project.removeWithThreadsConfirm", {
      project: "A very long project title",
      count: 12,
    });
    const pseudo = pseudoLocalizeInterfaceMessage("sidebar.project.removeWithThreadsConfirm", {
      project: "A very long project title",
      count: 12,
    });

    expect(pseudo).toContain("A very long project title");
    expect(pseudo).toContain("12");
    expect(pseudo.length).toBeGreaterThan(english.length);
    expect(pseudo.length).toBeLessThan(200);
  });
});
