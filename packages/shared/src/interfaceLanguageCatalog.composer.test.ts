import { describe, expect, it } from "vite-plus/test";

import { pseudoLocalizeInterfaceMessage, translateInterfaceMessage } from "./interfaceLanguage.ts";
import { composerInterfaceCatalog } from "./interfaceLanguageCatalog.composer.ts";

function placeholders(template: string): readonly string[] {
  return [...template.matchAll(/{{([A-Za-z0-9_]+)}}/g)]
    .map((match) => match[1] ?? "")
    .filter(Boolean)
    .toSorted();
}

describe("composer interface catalog", () => {
  it("ships complete English, German, and French copy with matching placeholders", () => {
    expect(new Set(composerInterfaceCatalog.keys).size).toBe(composerInterfaceCatalog.keys.length);

    for (const key of composerInterfaceCatalog.keys) {
      const english = composerInterfaceCatalog.messages.en[key];
      expect(typeof english).toBe("string");
      if (typeof english !== "string") continue;

      for (const language of ["de", "fr"] as const) {
        const localized = composerInterfaceCatalog.messages[language][key];
        expect(typeof localized).toBe("string");
        if (typeof localized !== "string") continue;
        expect(localized.trim(), `${language}:${key}`).not.toBe("");
        expect(placeholders(localized), `${language}:${key}`).toEqual(placeholders(english));
      }
    }
  });

  it("translates composer-owned status and approval copy", () => {
    expect(translateInterfaceMessage("de", "chat.composer.sync.loadingMessages")).toBe(
      "Nachrichten werden geladen...",
    );
    expect(translateInterfaceMessage("fr", "chat.composer.sync.syncingMessages")).toBe(
      "Synchronisation des messages...",
    );
    expect(translateInterfaceMessage("de", "chat.composer.approval.label.command")).toBe(
      "Befehl genehmigen",
    );
    expect(translateInterfaceMessage("fr", "chat.composer.approval.detail.fileRead")).toBe(
      "Fichier à lire",
    );
    expect(translateInterfaceMessage("de", "chat.composer.userInput.hideQuestionOptions")).toBe(
      "Frage und Antwortoptionen ausblenden",
    );
    expect(translateInterfaceMessage("fr", "chat.composer.command.source.repo")).toBe("Dépôt");
    expect(
      translateInterfaceMessage("de", "chat.composer.command.sourceSkill", {
        source: "Repository",
      }),
    ).toBe("Repository-Skill");
    expect(translateInterfaceMessage("fr", "chat.composer.stash.time.hoursAgo", { count: 3 })).toBe(
      "il y a 3 h",
    );
  });

  it("keeps pseudo-localized labels bounded", () => {
    const pseudo = pseudoLocalizeInterfaceMessage("chat.composer.approval.label.mcpElicitation");
    expect(pseudo).toMatch(/^⟦.+⟧$/u);
    expect(pseudo.length).toBeLessThan(100);
  });
});
