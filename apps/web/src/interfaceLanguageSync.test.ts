import { describe, expect, it } from "vite-plus/test";

import {
  collectSystemInterfaceLocales,
  createInterfaceLanguageSyncRecord,
  interfaceLanguagePreferenceMessageId,
  interfaceLanguageSyncStatusText,
} from "./interfaceLanguageSync.tsx";

describe("web interface language", () => {
  it("prefers the desktop host locale before Chromium's pinned locale", () => {
    expect(collectSystemInterfaceLocales("de_DE", ["en-US"])).toEqual(["de_DE", "en-US"]);
  });

  it("creates monotonic user-authored records", () => {
    const record = createInterfaceLanguageSyncRecord(
      "de",
      { now: () => 10, updateId: () => "web:de" },
      25,
    );

    expect(record).toEqual({
      version: 1,
      preference: "de",
      updatedAt: 26,
      updateId: "web:de",
    });
  });

  it("exposes all versioned locale choices, including French", () => {
    expect(interfaceLanguagePreferenceMessageId("system")).toBe(
      "settings.interfaceLanguage.system",
    );
    expect(interfaceLanguagePreferenceMessageId("en")).toBe("settings.interfaceLanguage.english");
    expect(interfaceLanguagePreferenceMessageId("de")).toBe("settings.interfaceLanguage.german");
    expect(interfaceLanguagePreferenceMessageId("fr")).toBe("settings.interfaceLanguage.french");
    expect(
      createInterfaceLanguageSyncRecord("fr", {
        now: () => 30,
        updateId: () => "web:fr",
      }),
    ).toMatchObject({ version: 1, preference: "fr", updateId: "web:fr" });
  });

  it("localizes synchronization status", () => {
    expect(
      interfaceLanguageSyncStatusText("de", {
        failedEnvironmentLabels: ["Laptop"],
        deferredEnvironmentLabels: [],
        unsupportedEnvironmentLabels: [],
      }),
    ).toBe("Synchronisierung mit Laptop fehlgeschlagen. Ein neuer Versuch erfolgt automatisch.");
    expect(
      interfaceLanguageSyncStatusText("fr", {
        failedEnvironmentLabels: ["Bureau", "Portable"],
        deferredEnvironmentLabels: [],
        unsupportedEnvironmentLabels: [],
      }),
    ).toContain("Bureau et Portable");
  });
});
