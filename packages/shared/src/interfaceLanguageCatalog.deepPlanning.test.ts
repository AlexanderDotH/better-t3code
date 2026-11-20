import { describe, expect, it } from "vite-plus/test";

import { translateInterfaceMessage } from "./interfaceLanguage.ts";
import { deepPlanningInterfaceCatalog } from "./interfaceLanguageCatalog.deepPlanning.ts";
import type { InterfaceMessageTemplate } from "./interfaceLanguageCatalog.types.ts";

function variants(template: InterfaceMessageTemplate): readonly string[] {
  return typeof template === "string" ? [template] : [template.one, template.other];
}

function placeholders(template: string): readonly string[] {
  return [...template.matchAll(/{{([A-Za-z0-9_]+)}}/g)]
    .map((match) => match[1] ?? "")
    .filter(Boolean)
    .toSorted();
}

describe("Deep Planning interface catalog", () => {
  it("ships English, German, and French copy with matching placeholders and plural forms", () => {
    for (const key of deepPlanningInterfaceCatalog.keys) {
      const english = variants(deepPlanningInterfaceCatalog.messages.en[key]);
      for (const language of ["en", "de", "fr"] as const) {
        const localized = variants(deepPlanningInterfaceCatalog.messages[language][key]);
        expect(localized.length, `${language}:${key}`).toBe(english.length);
        localized.forEach((template, index) => {
          expect(template.trim(), `${language}:${key}`).not.toBe("");
          expect(placeholders(template), `${language}:${key}`).toEqual(
            placeholders(english[index] ?? ""),
          );
        });
      }
    }
  });

  it("interpolates review rounds, accessible chat actions, and verified step counts", () => {
    expect(
      translateInterfaceMessage("de", "chat.deepPlan.status.completed", { completed: 5, total: 5 }),
    ).toBe("Fertig · 5/5 verifiziert");
    expect(
      translateInterfaceMessage("fr", "chat.deepPlan.removeSource", { title: "Recherche" }),
    ).toBe("Retirer Recherche");
    expect(
      translateInterfaceMessage("fr", "chat.deepPlan.status.reviewStep", {
        step: 3,
        round: 2,
        limit: 6,
      }),
    ).toBe("Vérification de l’étape 3 (passage 2/6)");
  });

  it("uses singular labels for one chat or lane", () => {
    expect(translateInterfaceMessage("en", "chat.deepPlan.projectSources", { count: 1 })).toBe(
      "1 project chat",
    );
    expect(translateInterfaceMessage("de", "chat.deepPlan.sourceCount", { count: 1 })).toBe(
      "1 Chat",
    );
    expect(translateInterfaceMessage("fr", "chat.deepPlan.laneCount", { count: 1 })).toBe(
      "1 piste",
    );
  });
});
