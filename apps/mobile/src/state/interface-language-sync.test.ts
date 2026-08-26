import type { InterfaceLanguageSyncRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveMobileInterfaceLanguageSync } from "./interface-language-sync";

const record = (
  preference: InterfaceLanguageSyncRecord["preference"],
  updatedAt: number,
): InterfaceLanguageSyncRecord => ({
  preference,
  updatedAt,
  updateId: `mobile:${preference}:${updatedAt}`,
});

describe("mobile interface language sync", () => {
  it("adopts the newest connected environment and updates local preferences", () => {
    const remote = record("de", 20);
    const result = deriveMobileInterfaceLanguageSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: record("system", 10),
      environments: [
        {
          environmentId: "environment-a",
          label: "Desktop",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 4,
          record: remote,
        },
      ],
    });

    expect(result.preference).toBe("de");
    expect(result.preferencePatch).toEqual({ interfaceLanguageSyncRecord: remote });
  });

  it("reports older environments without writing to them", () => {
    const result = deriveMobileInterfaceLanguageSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: record("en", 10),
      environments: [
        {
          environmentId: "legacy",
          label: "Old server",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 3,
          record: null,
        },
      ],
    });

    expect(result.unsupportedEnvironmentLabels).toEqual(["Old server"]);
    expect(result.plan.writes).toEqual([]);
  });
});
