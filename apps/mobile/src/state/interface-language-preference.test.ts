import { describe, expect, it } from "vite-plus/test";

import {
  createMobileInterfaceLocaleRecordV1,
  nextMobileInterfaceLanguageUpdatedAt,
  resolveMobileInterfaceLocalePreference,
} from "./interface-language-preference";

describe("mobile interface language preference", () => {
  it("uses System before a synchronized choice exists", () => {
    expect(resolveMobileInterfaceLocalePreference(undefined)).toBe("system");
  });

  it("creates a valid explicit French V1 record", () => {
    expect(createMobileInterfaceLocaleRecordV1("fr", 42, "mobile:fr")).toEqual({
      version: 1,
      preference: "fr",
      updatedAt: 42,
      updateId: "mobile:fr",
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
