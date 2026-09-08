import type { ProjectThreadPreviewSyncRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveMobileProjectThreadPreviewSync } from "./project-thread-preview-sync";

function record(
  count: number,
  updatedAt: number,
  updateId: string,
): ProjectThreadPreviewSyncRecord {
  return { count, updatedAt, updateId };
}

const serverRecord = record(8, 2_000, "server:preview-8");

describe("mobile project thread preview synchronization", () => {
  it("waits for connected server settings before initializing local state", () => {
    const result = deriveMobileProjectThreadPreviewSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: undefined,
      migrationVersion: undefined,
      environments: [
        {
          environmentId: "remote",
          label: "Remote",
          connected: true,
          configLoaded: false,
          environmentSettingsVersion: undefined,
          record: null,
        },
      ],
    });

    expect(result.isReady).toBe(false);
    expect(result.preferencePatch).toBeNull();
    expect(result.count).toBe(3);
  });

  it("keeps the offline cached count visible while a connected config loads", () => {
    const result = deriveMobileProjectThreadPreviewSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: record(6, 3_000, "mobile:preview-6"),
      migrationVersion: 1,
      environments: [
        {
          environmentId: "remote",
          label: "Remote",
          connected: true,
          configLoaded: false,
          environmentSettingsVersion: undefined,
          record: null,
        },
      ],
    });

    expect(result.isReady).toBe(false);
    expect(result.count).toBe(6);
  });

  it("adopts a connected compatible server record before writing a default", () => {
    const result = deriveMobileProjectThreadPreviewSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: undefined,
      migrationVersion: undefined,
      environments: [
        {
          environmentId: "remote",
          label: "Remote",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 2,
          record: serverRecord,
        },
      ],
    });

    expect(result.count).toBe(8);
    expect(result.preferencePatch).toEqual({
      projectThreadPreviewSyncRecord: serverRecord,
      projectThreadPreviewMigrationVersion: 1,
    });
    expect(result.plan.writes).toEqual([]);
  });

  it("renders default three offline without minting a record", () => {
    const result = deriveMobileProjectThreadPreviewSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: undefined,
      migrationVersion: undefined,
      environments: [
        {
          environmentId: "remote",
          label: "Remote",
          connected: false,
          configLoaded: true,
          environmentSettingsVersion: 2,
          record: serverRecord,
        },
      ],
    });

    expect(result.count).toBe(3);
    expect(result.preferencePatch).toEqual({ projectThreadPreviewMigrationVersion: 1 });
    expect(result.plan.winner).toBeNull();
    expect(result.plan.writes).toEqual([]);
  });

  it("fans an explicit mobile choice out to stale connected servers", () => {
    const localRecord = record(6, 3_000, "mobile:preview-6");
    const result = deriveMobileProjectThreadPreviewSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord,
      migrationVersion: 1,
      environments: [
        {
          environmentId: "remote",
          label: "Remote",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 2,
          record: serverRecord,
        },
      ],
    });

    expect(result.count).toBe(6);
    expect(result.preferencePatch).toBeNull();
    expect(result.plan.writes).toEqual([{ environmentId: "remote", record: localRecord }]);
  });

  it("identifies servers that require settings version 2", () => {
    const result = deriveMobileProjectThreadPreviewSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: record(3, 3_000, "mobile:preview-3"),
      migrationVersion: 1,
      environments: [
        {
          environmentId: "legacy",
          label: "Old server",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 1,
          record: null,
        },
      ],
    });

    expect(result.unsupportedEnvironmentLabels).toEqual(["Old server"]);
    expect(result.plan.writes).toEqual([]);
  });
});
