import { describe, expect, it } from "vite-plus/test";

import {
  createMobileInterfaceLanguageRecord,
  nextMobileInterfaceLanguageUpdatedAt,
  resolveMobileInterfaceLanguagePreference,
} from "./interface-language-preference";

describe("mobile interface language preference", () => {
  it("uses System before a synchronized choice exists", () => {
    expect(resolveMobileInterfaceLanguagePreference(undefined)).toBe("system");
  });

  it("creates a valid explicit German record", () => {
    expect(createMobileInterfaceLanguageRecord("de", 42, "mobile:de")).toEqual({
      preference: "de",
      updatedAt: 42,
      updateId: "mobile:de",
    });
  });

  it("keeps user updates newer than local and remote clocks", () => {
    expect(
      nextMobileInterfaceLanguageUpdatedAt({
        now: 10,
        winnerUpdatedAt: 20,
        previousLocalUpdatedAt: 30,
      }),
    ).toBe(31);
  });
});
