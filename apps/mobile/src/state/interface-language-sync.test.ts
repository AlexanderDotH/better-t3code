import type { InterfaceLocaleSyncRecordV1 } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveMobileInterfaceLanguageSync,
  mobileInterfaceLanguageSyncWrites,
  settleMobileInterfaceLanguageSyncWrites,
} from "./interface-language-sync";

const record = (
  preference: InterfaceLocaleSyncRecordV1["preference"],
  updatedAt: number,
): InterfaceLocaleSyncRecordV1 => ({
  version: 1,
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
      localLocaleRecord: record("system", 10),
      localLegacyRecord: null,
      environments: [
        {
          environmentId: "environment-a",
          label: "Desktop",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 5,
          localeRecord: remote,
          legacyRecord: null,
        },
      ],
    });

    expect(result.preference).toBe("de");
    expect(result.preferencePatch).toEqual({
      interfaceLocaleSyncRecordV1: remote,
      interfaceLanguageSyncRecord: {
        preference: "de",
        updatedAt: remote.updatedAt,
        updateId: remote.updateId,
      },
    });
  });

  it("reports older environments without writing to them", () => {
    const result = deriveMobileInterfaceLanguageSync({
      preferencesReady: true,
      catalogReady: true,
      localLocaleRecord: record("en", 10),
      localLegacyRecord: null,
      environments: [
        {
          environmentId: "legacy",
          label: "Old server",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 3,
          localeRecord: null,
          legacyRecord: null,
        },
      ],
    });

    expect(result.unsupportedEnvironmentLabels).toEqual(["Old server"]);
    expect(result.plan.localePlan.writes).toEqual([]);
    expect(result.plan.legacyPlan.writes).toEqual([]);
  });

  it("keeps French in V1 without writing it into the legacy compatibility record", () => {
    const french = record("fr", 20);
    const result = deriveMobileInterfaceLanguageSync({
      preferencesReady: true,
      catalogReady: true,
      localLocaleRecord: french,
      localLegacyRecord: {
        preference: "de",
        updatedAt: 10,
        updateId: "legacy:de",
      },
      environments: [],
    });

    expect(result.preference).toBe("fr");
    expect(result.preferencePatch).toBeNull();
  });

  it("adopts a newer German preference from a connected v4 environment", () => {
    const result = deriveMobileInterfaceLanguageSync({
      preferencesReady: true,
      catalogReady: true,
      localLocaleRecord: record("fr", 20),
      localLegacyRecord: null,
      environments: [
        {
          environmentId: "legacy-v4",
          label: "Older desktop",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 4,
          localeRecord: null,
          legacyRecord: {
            preference: "de",
            updatedAt: 30,
            updateId: "desktop:de:30",
          },
        },
      ],
    });

    expect(result.preference).toBe("de");
    expect(result.plan.winner).toEqual({
      version: 1,
      preference: "de",
      updatedAt: 30,
      updateId: "desktop:de:30",
    });
    expect(result.plan.legacyPlan.writes).toEqual([]);
    expect(result.unsupportedEnvironmentLabels).toEqual([]);
  });

  it("adds a missing legacy mirror for an existing English V1 preference", () => {
    const english = record("en", 20);
    const result = deriveMobileInterfaceLanguageSync({
      preferencesReady: true,
      catalogReady: true,
      localLocaleRecord: english,
      localLegacyRecord: null,
      environments: [],
    });

    expect(result.preferencePatch).toEqual({
      interfaceLocaleSyncRecordV1: english,
      interfaceLanguageSyncRecord: {
        preference: "en",
        updatedAt: 20,
        updateId: "mobile:en:20",
      },
    });
  });

  it("emits and settles schema-specific writes for v4 and v5 environments", () => {
    const english = record("en", 20);
    const result = deriveMobileInterfaceLanguageSync({
      preferencesReady: true,
      catalogReady: true,
      localLocaleRecord: english,
      localLegacyRecord: null,
      environments: [
        {
          environmentId: "legacy-v4",
          label: "Legacy",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 4,
          localeRecord: null,
          legacyRecord: null,
        },
        {
          environmentId: "locale-v5",
          label: "Current",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 5,
          localeRecord: null,
          legacyRecord: null,
        },
      ],
    });

    expect(mobileInterfaceLanguageSyncWrites(result.plan)).toEqual([
      { kind: "locale", environmentId: "locale-v5", record: english },
      {
        kind: "legacy",
        environmentId: "legacy-v4",
        record: { preference: "en", updatedAt: 20, updateId: "mobile:en:20" },
      },
    ]);
    expect(
      settleMobileInterfaceLanguageSyncWrites(result.plan, [
        { kind: "locale", environmentId: "locale-v5", status: "success" },
        { kind: "legacy", environmentId: "legacy-v4", status: "failure" },
      ]),
    ).toEqual({
      successfulEnvironmentIds: ["locale-v5"],
      failedEnvironmentIds: ["legacy-v4"],
    });
  });
});
