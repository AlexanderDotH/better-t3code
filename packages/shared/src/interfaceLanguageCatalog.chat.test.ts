import { describe, expect, it } from "vite-plus/test";

import {
  chatInterfaceCatalog,
  type ChatInterfaceMessageKey,
} from "./interfaceLanguageCatalog.chat.ts";
import {
  createInterfaceTranslator,
  resolveInterfaceLocale,
  translateInterfaceMessage,
} from "./interfaceLanguage.ts";

const representativeKeys = [
  "chat.agent.count",
  "chat.attachment.downloadFailed",
  "chat.composer.tasks.progress",
] as const satisfies readonly ChatInterfaceMessageKey[];

describe("chat interface language catalog", () => {
  it("owns complete English, German, and French messages", () => {
    expect(new Set(chatInterfaceCatalog.keys).size).toBe(chatInterfaceCatalog.keys.length);
    expect(representativeKeys.every((key) => chatInterfaceCatalog.keys.includes(key))).toBe(true);
    for (const language of ["en", "de", "fr"] as const) {
      for (const key of chatInterfaceCatalog.keys) {
        expect(chatInterfaceCatalog.messages[language][key]).toBeDefined();
      }
    }
  });

  it("keeps provider output and user-authored content outside the UI catalog", () => {
    expect(
      chatInterfaceCatalog.keys.some((key) =>
        /providerOutput|repositoryContent|terminalOutput|userPrompt/u.test(key),
      ),
    ).toBe(false);
  });

  it("interpolates user-visible context without translating dynamic content", () => {
    expect(
      translateInterfaceMessage("de", "chat.attachment.downloadFailed", {
        name: "agent-output.log",
      }),
    ).toBe("agent-output.log konnte nicht heruntergeladen werden");
  });

  it("selects singular and plural chat messages with the resolved locale", () => {
    const english = createInterfaceTranslator({ language: "en", locale: "en-US" });
    const french = createInterfaceTranslator({ language: "fr", locale: "fr-FR" });

    expect(english.message("chat.agent.count", { count: 1 })).toBe("1 agent");
    expect(english.message("chat.agent.count", { count: 2 })).toBe("2 agents");
    expect(french.message("chat.model.count", { count: 2 })).toBe("2 modèles");
  });

  it("falls back to English for an unsupported system locale", () => {
    const resolved = resolveInterfaceLocale("system", ["es-ES"]);
    const translator = createInterfaceTranslator(resolved);

    expect(resolved.language).toBe("en");
    expect(translator.message("chat.composer.attachFiles")).toBe("Attach files");
  });
});
