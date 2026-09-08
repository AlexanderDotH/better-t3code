import { DEFAULT_PROJECT_THREAD_PREVIEW_COUNT } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectThreadPreviewSyncRecord,
  projectThreadPreviewSyncStatusText,
  seedProjectThreadPreviewSyncRecord,
} from "./projectThreadPreviewSync";

describe("project thread preview sync bootstrap", () => {
  const userUpdateClock = {
    now: () => 1_787_178_400_000,
    updateId: () => "device-a:preview-count",
  };

  it("migrates the legacy saved six-chat value to the new default once", () => {
    expect(seedProjectThreadPreviewSyncRecord(6, undefined)).toEqual({
      count: DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
      updatedAt: 0,
      updateId: "legacy-client-settings-migration-v1:3",
    });
  });

  it("preserves a non-legacy saved value during the first synchronized seed", () => {
    expect(seedProjectThreadPreviewSyncRecord(9, undefined)).toEqual({
      count: 9,
      updatedAt: 0,
      updateId: "legacy-client-settings-migration-v1:9",
    });
  });

  it("preserves an explicit six after the one-time migration completed", () => {
    expect(seedProjectThreadPreviewSyncRecord(6, 1)).toEqual({
      count: 6,
      updatedAt: 0,
      updateId: "legacy-client-settings-migration-v1:6",
    });
  });

  it("keeps an explicit six-chat update after migration", () => {
    expect(createProjectThreadPreviewSyncRecord(6, userUpdateClock).count).toBe(6);
  });
});

describe("project thread preview sync status", () => {
  it("identifies older servers that need settings version 2", () => {
    expect(
      projectThreadPreviewSyncStatusText({
        failedEnvironmentLabels: [],
        unsupportedEnvironmentLabels: ["Old laptop"],
      }),
    ).toBe("Update Old laptop to sync this setting.");
  });

  it("reports partial failures and promises a reconnect retry", () => {
    expect(
      projectThreadPreviewSyncStatusText({
        failedEnvironmentLabels: ["Workstation", "Home server"],
        unsupportedEnvironmentLabels: [],
      }),
    ).toBe("Couldn’t sync to Workstation and Home server. We’ll retry automatically.");
  });
});
