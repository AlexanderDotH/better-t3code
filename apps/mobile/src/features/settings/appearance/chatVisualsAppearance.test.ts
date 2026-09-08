import { describe, expect, it } from "vite-plus/test";

import { CHAT_VISUAL_MODE_OPTIONS, chatVisualModeSyncMessages } from "./chatVisualsAppearance";

describe("chat visuals appearance", () => {
  it("offers Current first and Classic as the compact legacy layout", () => {
    expect(CHAT_VISUAL_MODE_OPTIONS).toEqual([
      {
        mode: "current",
        label: "Current",
        description: "Shows the activity-focused transcript with larger work summaries.",
      },
      {
        mode: "classic",
        label: "Classic",
        description: "Restores the compact legacy transcript layout.",
      },
    ]);
  });

  it("describes syncing, failures, offline targets, and unsupported servers", () => {
    expect(
      chatVisualModeSyncMessages({
        isSyncing: true,
        failedEnvironmentLabels: ["Failed server"],
        deferredEnvironmentLabels: ["Offline server"],
        unsupportedEnvironmentLabels: ["Old server"],
      }),
    ).toEqual([
      "Syncing with connected environments…",
      "Could not sync with Failed server. T3 Code will retry after it reconnects.",
      "Waiting for Offline server to reconnect.",
      "Update Old server to sync this setting.",
    ]);
  });
});
