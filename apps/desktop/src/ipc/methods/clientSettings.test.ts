import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { didInterfaceLocaleSelectionChange } from "./clientSettings.ts";

const germanLegacy = {
  preference: "de" as const,
  updatedAt: 1,
  updateId: "desktop:de",
};

describe("didInterfaceLocaleSelectionChange", () => {
  it("reconfigures the desktop menu when a versioned French choice leaves the legacy mirror intact", () => {
    const previous = {
      ...DEFAULT_CLIENT_SETTINGS,
      interfaceLanguageLocalRecord: germanLegacy,
    };
    const next = {
      ...previous,
      interfaceLocaleLocalRecordV1: {
        version: 1 as const,
        preference: "fr" as const,
        updatedAt: 2,
        updateId: "desktop-v1:fr",
      },
    };

    expect(didInterfaceLocaleSelectionChange(previous, next)).toBe(true);
    expect(didInterfaceLocaleSelectionChange(next, next)).toBe(false);
  });
});
