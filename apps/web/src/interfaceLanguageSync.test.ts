import { describe, expect, it } from "vite-plus/test";

import {
  collectSystemInterfaceLocales,
  createInterfaceLanguageSyncRecord,
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

    expect(record).toEqual({ preference: "de", updatedAt: 26, updateId: "web:de" });
  });

  it("localizes synchronization status", () => {
    expect(
      interfaceLanguageSyncStatusText("de", {
        failedEnvironmentLabels: ["Laptop"],
        deferredEnvironmentLabels: [],
        unsupportedEnvironmentLabels: [],
      }),
    ).toBe("Synchronisierung mit Laptop fehlgeschlagen. Ein neuer Versuch erfolgt automatisch.");
  });
});
