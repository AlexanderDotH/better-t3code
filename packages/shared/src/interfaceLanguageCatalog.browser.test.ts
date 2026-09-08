import { describe, expect, it } from "vite-plus/test";

import {
  browserInterfaceCatalog,
  type BrowserInterfaceMessageKey,
} from "./interfaceLanguageCatalog.browser.ts";

const representativeKeys = [
  "browser.device.toolbar",
  "browser.files.openInPreviewFailed",
  "browser.preview.unreachableTitle",
  "browser.preview.removeHistory",
  "browser.preview.desktopOnly",
  "browser.chrome.addressPlaceholder",
  "browser.preview.openInPreview",
  "browser.preview.openInBrowser",
  "browser.search.resultCount",
] as const satisfies readonly BrowserInterfaceMessageKey[];

describe("browser interface language catalog", () => {
  it("owns complete English, German, and French browser messages", () => {
    expect(new Set(browserInterfaceCatalog.keys).size).toBe(browserInterfaceCatalog.keys.length);
    expect(representativeKeys.every((key) => browserInterfaceCatalog.keys.includes(key))).toBe(
      true,
    );
    for (const language of ["en", "de", "fr"] as const) {
      for (const key of browserInterfaceCatalog.keys) {
        const message = browserInterfaceCatalog.messages[language][key];
        expect(message).toBeDefined();
        if (typeof message === "string") expect(message.trim()).not.toBe("");
      }
    }
  });

  it("keeps dynamic content as interpolation placeholders in every locale", () => {
    for (const language of ["en", "de", "fr"] as const) {
      expect(browserInterfaceCatalog.messages[language]["browser.files.edit"]).toContain(
        "{{path}}",
      );
      expect(browserInterfaceCatalog.messages[language]["browser.search.projectLabel"]).toContain(
        "{{project}}",
      );
      expect(browserInterfaceCatalog.messages[language]["browser.preview.removeHistory"]).toContain(
        "{{label}}",
      );
      const resultCount = browserInterfaceCatalog.messages[language]["browser.search.resultCount"];
      expect(typeof resultCount).toBe("object");
      if (typeof resultCount === "object") {
        expect(resultCount.one).toContain("{{displayCount}}");
        expect(resultCount.other).toContain("{{displayCount}}");
      }
    }
  });

  it("does not catalog URLs, paths, filenames, page copy, or runtime error payloads", () => {
    expect(
      browserInterfaceCatalog.keys.some((key) =>
        /urlValue|pathValue|filenameValue|pageContent|runtimeErrorDetail/u.test(key),
      ),
    ).toBe(false);
  });
});
