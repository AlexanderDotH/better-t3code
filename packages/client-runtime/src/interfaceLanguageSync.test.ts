import type { InterfaceLanguageSyncRecord, InterfaceLocaleSyncRecordV1 } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createInterfaceLocaleCompatibilityMirror,
  planInterfaceLocaleCompatibilitySync,
  planInterfaceLocaleSync,
  planInterfaceLanguageSync,
  resolveInterfaceLocaleSyncRecord,
  settleInterfaceLocaleSyncWrites,
  toInterfaceLocaleRecordV1,
} from "./interfaceLanguageSync.ts";

const record = (
  preference: InterfaceLanguageSyncRecord["preference"],
  updatedAt: number,
  updateId: string,
): InterfaceLanguageSyncRecord => ({ preference, updatedAt, updateId });

describe("interface language sync", () => {
  it.each(["en", "de"] as const)(
    "migrates an existing %s record without changing its clock",
    (preference) => {
      expect(toInterfaceLocaleRecordV1(record(preference, 42, `desktop:${preference}`))).toEqual({
        version: 1,
        preference,
        updatedAt: 42,
        updateId: `desktop:${preference}`,
      });
    },
  );

  it("lets a newer legacy choice supersede French without writing French into the legacy schema", () => {
    const french = {
      version: 1 as const,
      preference: "fr" as const,
      updatedAt: 20,
      updateId: "mobile:fr",
    };
    const newerLegacy = record("de", 30, "desktop:de");

    expect(
      resolveInterfaceLocaleSyncRecord({ localeRecord: french, legacyRecord: newerLegacy }),
    ).toEqual({ version: 1, preference: "de", updatedAt: 30, updateId: "desktop:de" });
    expect(createInterfaceLocaleCompatibilityMirror(french, newerLegacy)).toEqual(newerLegacy);
  });

  it("breaks equal-timestamp conflicts by update ID", () => {
    const french = {
      version: 1 as const,
      preference: "fr" as const,
      updatedAt: 50,
      updateId: "web:z",
    };
    const german = record("de", 50, "desktop:a");

    expect(
      resolveInterfaceLocaleSyncRecord({ localeRecord: french, legacyRecord: german }),
    ).toEqual(french);
    expect(
      resolveInterfaceLocaleSyncRecord({
        localeRecord: { ...french, updateId: "desktop:a" },
        legacyRecord: { ...german, updateId: "web:z" },
      }),
    ).toEqual({ version: 1, ...german, updateId: "web:z" });
  });

  it("mirrors supported V1 choices for old clients", () => {
    const english = {
      version: 1 as const,
      preference: "en" as const,
      updatedAt: 50,
      updateId: "web:en",
    };

    expect(createInterfaceLocaleCompatibilityMirror(english, null)).toEqual({
      preference: "en",
      updatedAt: 50,
      updateId: "web:en",
    });
  });

  it("synchronizes French only to environments that understand locale record V1", () => {
    const french: InterfaceLocaleSyncRecordV1 = {
      version: 1,
      preference: "fr",
      updatedAt: 50,
      updateId: "mobile:fr",
    };
    const plan = planInterfaceLocaleSync({
      localRecord: french,
      environments: [
        {
          environmentId: "legacy-v4",
          environmentSettingsVersion: 4,
          connected: true,
          record: null,
        },
        {
          environmentId: "locale-v1",
          environmentSettingsVersion: 5,
          connected: true,
          record: null,
        },
      ],
    });

    expect(plan.writes).toEqual([{ environmentId: "locale-v1", record: french }]);
    expect(plan.unsupportedEnvironmentIds).toEqual(["legacy-v4"]);
    expect(
      settleInterfaceLocaleSyncWrites(plan, [{ environmentId: "locale-v1", status: "failure" }]),
    ).toMatchObject({
      failedEnvironmentIds: ["locale-v1"],
      pendingWrites: [{ environmentId: "locale-v1", record: french }],
      isFullySynchronized: false,
    });
  });

  it("elects a newer legacy record globally and fans it out through both schemas", () => {
    const french: InterfaceLocaleSyncRecordV1 = {
      version: 1,
      preference: "fr",
      updatedAt: 20,
      updateId: "web:fr",
    };
    const newerGerman = record("de", 30, "legacy:de");
    const plan = planInterfaceLocaleCompatibilitySync({
      localLocaleRecord: french,
      localLegacyRecord: null,
      environments: [
        {
          environmentId: "legacy-v4",
          environmentSettingsVersion: 4,
          connected: true,
          localeRecord: null,
          legacyRecord: newerGerman,
        },
        {
          environmentId: "locale-v1",
          environmentSettingsVersion: 5,
          connected: true,
          localeRecord: french,
          legacyRecord: null,
        },
      ],
    });

    expect(plan.winner).toEqual({ version: 1, ...newerGerman });
    expect(plan.nextLocalLegacyRecord).toEqual(newerGerman);
    expect(plan.localePlan.writes).toEqual([
      { environmentId: "locale-v1", record: { version: 1, ...newerGerman } },
    ]);
    expect(plan.legacyPlan.writes).toEqual([]);
    expect(plan.unsupportedEnvironmentIds).toEqual([]);
  });

  it("keeps a French winner away from v4 while still updating v5", () => {
    const french: InterfaceLocaleSyncRecordV1 = {
      version: 1,
      preference: "fr",
      updatedAt: 50,
      updateId: "web:fr",
    };
    const legacyGerman = record("de", 20, "legacy:de");
    const plan = planInterfaceLocaleCompatibilitySync({
      localLocaleRecord: french,
      localLegacyRecord: legacyGerman,
      environments: [
        {
          environmentId: "legacy-v4",
          environmentSettingsVersion: 4,
          connected: true,
          localeRecord: null,
          legacyRecord: legacyGerman,
        },
        {
          environmentId: "locale-v1",
          environmentSettingsVersion: 5,
          connected: true,
          localeRecord: null,
          legacyRecord: legacyGerman,
        },
      ],
    });

    expect(plan.winner).toEqual(french);
    expect(plan.nextLocalLegacyRecord).toEqual(legacyGerman);
    expect(plan.localePlan.writes).toEqual([{ environmentId: "locale-v1", record: french }]);
    expect(plan.legacyPlan.writes).toEqual([]);
    expect(plan.unsupportedEnvironmentIds).toEqual(["legacy-v4"]);
  });

  it.each(["en", "de"] as const)(
    "mirrors a %s V1 winner to a legacy-only environment",
    (preference) => {
      const localeRecord: InterfaceLocaleSyncRecordV1 = {
        version: 1,
        preference,
        updatedAt: 50,
        updateId: `desktop:${preference}`,
      };
      const plan = planInterfaceLocaleCompatibilitySync({
        localLocaleRecord: localeRecord,
        localLegacyRecord: null,
        environments: [
          {
            environmentId: "legacy-v4",
            environmentSettingsVersion: 4,
            connected: true,
            localeRecord: null,
            legacyRecord: null,
          },
        ],
      });

      const legacyRecord = {
        preference,
        updatedAt: 50,
        updateId: `desktop:${preference}`,
      };
      expect(plan.nextLocalLegacyRecord).toEqual(legacyRecord);
      expect(plan.legacyPlan.writes).toEqual([
        { environmentId: "legacy-v4", record: legacyRecord },
      ]);
      expect(plan.unsupportedEnvironmentIds).toEqual([]);
    },
  );

  it("repairs a missing V1 record on a v5 environment whose legacy mirror already matches", () => {
    const german: InterfaceLocaleSyncRecordV1 = {
      version: 1,
      preference: "de",
      updatedAt: 50,
      updateId: "desktop:de",
    };
    const plan = planInterfaceLocaleCompatibilitySync({
      localLocaleRecord: german,
      localLegacyRecord: {
        preference: "de",
        updatedAt: 50,
        updateId: "desktop:de",
      },
      environments: [
        {
          environmentId: "locale-v5",
          environmentSettingsVersion: 5,
          connected: true,
          localeRecord: null,
          legacyRecord: {
            preference: "de",
            updatedAt: 50,
            updateId: "desktop:de",
          },
        },
      ],
    });

    expect(plan.localePlan.writes).toEqual([{ environmentId: "locale-v5", record: german }]);
    expect(plan.legacyPlan.writes).toEqual([]);
  });

  it("retains a deferred French write and sends it after the v5 environment reconnects", () => {
    const french: InterfaceLocaleSyncRecordV1 = {
      version: 1,
      preference: "fr",
      updatedAt: 70,
      updateId: "web:fr",
    };
    const disconnectedPlan = planInterfaceLocaleCompatibilitySync({
      localLocaleRecord: french,
      localLegacyRecord: null,
      environments: [
        {
          environmentId: "locale-v5",
          environmentSettingsVersion: 5,
          connected: false,
          localeRecord: null,
          legacyRecord: null,
        },
      ],
    });

    expect(disconnectedPlan.localePlan.pendingWrites).toEqual([
      { environmentId: "locale-v5", record: french },
    ]);
    expect(disconnectedPlan.deferredEnvironmentIds).toEqual(["locale-v5"]);

    const reconnectedPlan = planInterfaceLocaleCompatibilitySync({
      localLocaleRecord: french,
      localLegacyRecord: null,
      environments: [
        {
          environmentId: "locale-v5",
          environmentSettingsVersion: 5,
          connected: true,
          localeRecord: null,
          legacyRecord: null,
        },
      ],
      pendingLocaleWrites: disconnectedPlan.localePlan.pendingWrites,
    });
    expect(reconnectedPlan.localePlan.writes).toEqual([
      { environmentId: "locale-v5", record: french },
    ]);
    expect(
      settleInterfaceLocaleSyncWrites(reconnectedPlan.localePlan, [
        { environmentId: "locale-v5", status: "success" },
      ]).pendingWrites,
    ).toEqual([]);
  });

  it("adopts the newest connected preference and propagates it", () => {
    const local = record("system", 10, "web:a");
    const remote = record("de", 20, "mobile:b");
    const plan = planInterfaceLanguageSync({
      localRecord: local,
      environments: [
        {
          environmentId: "environment-a",
          environmentSettingsVersion: 4,
          connected: true,
          record: remote,
        },
        {
          environmentId: "environment-b",
          environmentSettingsVersion: 4,
          connected: true,
          record: local,
        },
      ],
    });

    expect(plan.winner).toEqual(remote);
    expect(plan.nextLocalRecord).toEqual(remote);
    expect(plan.writes).toEqual([{ environmentId: "environment-b", record: remote }]);
  });

  it("does not write to environments that predate language sync", () => {
    const plan = planInterfaceLanguageSync({
      localRecord: record("en", 10, "web:a"),
      environments: [
        {
          environmentId: "legacy",
          environmentSettingsVersion: 3,
          connected: true,
          record: null,
        },
      ],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.unsupportedEnvironmentIds).toEqual(["legacy"]);
  });
});
