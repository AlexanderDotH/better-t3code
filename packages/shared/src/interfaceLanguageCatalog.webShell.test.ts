import { describe, expect, it } from "vite-plus/test";

import { webShellInterfaceCatalog } from "./interfaceLanguageCatalog.webShell.ts";

describe("web shell interface catalog", () => {
  it("ships English, German, and French shell copy", () => {
    expect(webShellInterfaceCatalog.keys).toHaveLength(5);
    for (const language of ["en", "de", "fr"] as const) {
      for (const key of webShellInterfaceCatalog.keys) {
        const template = webShellInterfaceCatalog.messages[language][key];
        const values = typeof template === "string" ? [template] : [template.one, template.other];
        expect(values.every((value) => value.trim().length > 0)).toBe(true);
      }
    }
  });
});
