import { describe, expect, it } from "vite-plus/test";

import {
  createMobileProjectThreadPreviewRecord,
  initializeMobileProjectThreadPreviewPreference,
  mobileProjectThreadPreviewPreferencePatch,
  nextMobileProjectThreadPreviewUpdatedAt,
  resolveMobileProjectThreadPreviewCount,
} from "./project-thread-preview-preference";

const remoteRecord = {
  count: 8,
  updatedAt: 1_787_178_400_100,
  updateId: "desktop:preview-8",
} as const;

describe("mobile project thread preview preference", () => {
  it("shows three chats before a synchronized record is available", () => {
    expect(resolveMobileProjectThreadPreviewCount(undefined)).toBe(3);
  });

  it("marks the default transition without creating a timestamped record", () => {
    expect(
      initializeMobileProjectThreadPreviewPreference({
        localRecord: undefined,
        migrationVersion: undefined,
        remoteRecordExists: false,
      }),
    ).toEqual({
      projectThreadPreviewMigrationVersion: 1,
    });
  });

  it("does not overwrite an existing server record with a freshly seeded default", () => {
    expect(
      initializeMobileProjectThreadPreviewPreference({
        localRecord: undefined,
        migrationVersion: undefined,
        remoteRecordExists: true,
      }),
    ).toBeNull();
  });

  it("does not repeat initialization after the migration marker is stored", () => {
    expect(
      initializeMobileProjectThreadPreviewPreference({
        localRecord: undefined,
        migrationVersion: 1,
        remoteRecordExists: false,
      }),
    ).toBeNull();
  });

  it("preserves an explicit later choice of six", () => {
    const record = createMobileProjectThreadPreviewRecord(
      6,
      1_787_178_400_200,
      "mobile:explicit-6",
    );

    expect(resolveMobileProjectThreadPreviewCount(record)).toBe(6);
    expect(mobileProjectThreadPreviewPreferencePatch(record)).toEqual({
      projectThreadPreviewSyncRecord: record,
      projectThreadPreviewMigrationVersion: 1,
    });
  });

  it("marks an adopted server record as initialized", () => {
    expect(mobileProjectThreadPreviewPreferencePatch(remoteRecord)).toEqual({
      projectThreadPreviewSyncRecord: remoteRecord,
      projectThreadPreviewMigrationVersion: 1,
    });
  });

  it.each([0, 16, 2.5])("rejects an invalid locally selected count: %s", (count) => {
    expect(() =>
      createMobileProjectThreadPreviewRecord(count, 1_787_178_400_000, "mobile:invalid"),
    ).toThrow();
  });

  it("makes rapid local changes newer than both the winner and the prior local write", () => {
    expect(
      nextMobileProjectThreadPreviewUpdatedAt({
        now: 2_000,
        winnerUpdatedAt: 2_500,
        previousLocalUpdatedAt: 2_700,
      }),
    ).toBe(2_701);
  });
});
