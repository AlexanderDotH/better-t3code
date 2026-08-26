import { describe, expect, it } from "vite-plus/test";

import { resolveInterfaceLocale, translateInterfaceMessage } from "./interfaceLanguage.ts";

describe("interface language", () => {
  it("honors an explicit language independently of the host locale", () => {
    expect(resolveInterfaceLocale("en", ["de-DE"])).toEqual({
      language: "en",
      locale: "en-US",
    });
    expect(resolveInterfaceLocale("de", ["en-GB"])).toEqual({
      language: "de",
      locale: "de-DE",
    });
  });

  it("negotiates supported system locales in preference order", () => {
    expect(resolveInterfaceLocale("system", ["fr-FR", "de-AT", "en-GB"])).toEqual({
      language: "de",
      locale: "de-AT",
    });
    expect(resolveInterfaceLocale("system", ["en_GB"])).toEqual({
      language: "en",
      locale: "en-GB",
    });
  });

  it("falls back to English for missing, invalid, or unsupported locales", () => {
    expect(resolveInterfaceLocale("system", [])).toEqual({
      language: "en",
      locale: "en-US",
    });
    expect(resolveInterfaceLocale("system", ["not a locale", "fr-FR"])).toEqual({
      language: "en",
      locale: "en-US",
    });
  });

  it("translates every resource-protection state in English and German", () => {
    expect(translateInterfaceMessage("en", "resourceProtection.throttled.label")).toBe(
      "Provider temporarily throttled",
    );
    expect(translateInterfaceMessage("de", "resourceProtection.throttled.label")).toBe(
      "Provider vorübergehend gedrosselt",
    );
    expect(translateInterfaceMessage("en", "resourceProtection.waiting.description")).toContain(
      "automatically",
    );
    expect(translateInterfaceMessage("de", "resourceProtection.waiting.description")).toContain(
      "automatisch",
    );
  });
});
