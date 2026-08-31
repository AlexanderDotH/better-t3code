import { describe, expect, it } from "vite-plus/test";

import { uiInterfaceCatalog, type UiInterfaceMessageKey } from "./interfaceLanguageCatalog.ui.ts";

const representativeKeys = [
  "ui.commandPalette.label",
  "ui.confirm.description",
  "ui.thread.startFailed",
  "ui.rightPanel.openSurface",
  "ui.notification.dismiss",
] as const satisfies readonly UiInterfaceMessageKey[];

describe("UI interface catalog", () => {
  it("owns each key once with English, German, and French copy", () => {
    expect(new Set(uiInterfaceCatalog.keys).size).toBe(uiInterfaceCatalog.keys.length);
    expect(representativeKeys.every((key) => uiInterfaceCatalog.keys.includes(key))).toBe(true);
    for (const language of ["en", "de", "fr"] as const) {
      for (const key of uiInterfaceCatalog.keys) {
        expect(uiInterfaceCatalog.messages[language][key]).toBeDefined();
      }
    }
  });
});
