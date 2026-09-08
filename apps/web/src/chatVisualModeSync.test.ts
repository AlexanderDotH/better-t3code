import { DEFAULT_CHAT_VISUAL_MODE } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  chatVisualModeSyncStatusText,
  createChatVisualModeSyncRecord,
  resolveChatVisualMode,
} from "./chatVisualModeSync";

describe("chat visual mode sync cache", () => {
  const updateClock = {
    now: () => 1_787_178_400_000,
    updateId: () => "web:chat-visual-mode",
  };

  it("uses Current before a synchronized preference exists", () => {
    expect(resolveChatVisualMode(null)).toBe(DEFAULT_CHAT_VISUAL_MODE);
  });

  it("creates an explicit synchronized record when Current is selected", () => {
    expect(createChatVisualModeSyncRecord("current", updateClock)).toEqual({
      mode: "current",
      updatedAt: 1_787_178_400_000,
      updateId: "web:chat-visual-mode",
    });
  });

  it("creates an explicit synchronized record when Classic is selected", () => {
    expect(createChatVisualModeSyncRecord("classic", updateClock)).toEqual({
      mode: "classic",
      updatedAt: 1_787_178_400_000,
      updateId: "web:chat-visual-mode",
    });
  });

  it("makes a local selection newer than a cached winner from a faster clock", () => {
    expect(createChatVisualModeSyncRecord("current", updateClock, 1_787_178_500_000)).toEqual({
      mode: "current",
      updatedAt: 1_787_178_500_001,
      updateId: "web:chat-visual-mode",
    });
  });
});

describe("chat visual mode sync status", () => {
  it("distinguishes failed, deferred, and unsupported environments", () => {
    expect(
      chatVisualModeSyncStatusText({
        failedEnvironmentLabels: ["Workstation"],
        deferredEnvironmentLabels: ["Home server"],
        unsupportedEnvironmentLabels: ["Old laptop"],
      }),
    ).toBe(
      "Couldn’t sync to Workstation. We’ll retry automatically. " +
        "Update Old laptop to sync this setting. " +
        "Waiting for Home server to reconnect.",
    );
  });

  it("omits feedback after every compatible environment converges", () => {
    expect(
      chatVisualModeSyncStatusText({
        failedEnvironmentLabels: [],
        deferredEnvironmentLabels: [],
        unsupportedEnvironmentLabels: [],
      }),
    ).toBeNull();
  });
});
