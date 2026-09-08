import { describe, expect, it } from "vite-plus/test";

import {
  setDesktopInterfaceLanguage,
  translateDesktopInterfaceMessage,
} from "./DesktopInterfaceLanguage.ts";

describe("DesktopInterfaceLanguage", () => {
  it("localizes native startup and WSL fallback dialogs with interpolation", () => {
    setDesktopInterfaceLanguage("fr");

    expect(translateDesktopInterfaceMessage("desktop.startup.failedTitle")).toBe(
      "Échec du démarrage de T3 Code",
    );
    expect(
      translateDesktopInterfaceMessage("desktop.wsl.fallbackPersistentMessage", {
        reason: "Node.js est introuvable.",
      }),
    ).toContain("Node.js est introuvable.");

    setDesktopInterfaceLanguage("en");
  });

  it("localizes native file filters and update availability reasons", () => {
    setDesktopInterfaceLanguage("de");

    expect(translateDesktopInterfaceMessage("desktop.picker.images")).toBe("Bilder");
    expect(translateDesktopInterfaceMessage("desktop.update.disabled.noFeed")).toContain(
      "Update-Quelle",
    );

    setDesktopInterfaceLanguage("en");
  });
});
