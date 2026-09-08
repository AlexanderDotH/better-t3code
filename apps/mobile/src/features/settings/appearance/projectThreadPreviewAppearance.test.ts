import { describe, expect, it } from "vite-plus/test";

import {
  projectThreadPreviewSyncMessages,
  stepProjectThreadPreviewCount,
} from "./projectThreadPreviewAppearance";

describe("project thread preview appearance controls", () => {
  it("steps within the supported 1 through 15 range", () => {
    expect(stepProjectThreadPreviewCount(1, -1)).toBe(1);
    expect(stepProjectThreadPreviewCount(3, 1)).toBe(4);
    expect(stepProjectThreadPreviewCount(15, 1)).toBe(15);
  });

  it("surfaces partial failures and their reconnect retry behavior", () => {
    expect(
      projectThreadPreviewSyncMessages({
        isSyncing: false,
        failedEnvironmentLabels: ["Office Mac"],
        deferredEnvironmentLabels: [],
        unsupportedEnvironmentLabels: [],
      }),
    ).toEqual(["Could not sync with Office Mac. T3 Code will retry after it reconnects."]);
  });

  it("identifies older servers that require an update", () => {
    expect(
      projectThreadPreviewSyncMessages({
        isSyncing: false,
        failedEnvironmentLabels: [],
        deferredEnvironmentLabels: [],
        unsupportedEnvironmentLabels: ["Old laptop"],
      }),
    ).toEqual(["Update Old laptop to sync this setting."]);
  });

  it("reports connected writes and offline targets without hiding either", () => {
    expect(
      projectThreadPreviewSyncMessages({
        isSyncing: true,
        failedEnvironmentLabels: [],
        deferredEnvironmentLabels: ["Home server", "Travel laptop"],
        unsupportedEnvironmentLabels: [],
      }),
    ).toEqual([
      "Syncing with connected environments…",
      "Waiting for Home server, Travel laptop to reconnect.",
    ]);
  });
});
