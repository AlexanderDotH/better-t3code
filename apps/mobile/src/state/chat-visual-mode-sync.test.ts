import type { ChatVisualMode, ChatVisualModeSyncRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveMobileChatVisualModeSync } from "./chat-visual-mode-sync";

function record(
  mode: ChatVisualMode,
  updatedAt: number,
  updateId: string,
): ChatVisualModeSyncRecord {
  return { mode, updatedAt, updateId };
}

const serverRecord = record("classic", 2_000, "server:classic");

describe("mobile chat visual mode synchronization", () => {
  it("keeps the cached mode visible while connected server settings load", () => {
    const localRecord = record("classic", 3_000, "mobile:classic");
    const result = deriveMobileChatVisualModeSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord,
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
    expect(result.mode).toBe("classic");
    expect(result.preferencePatch).toBeNull();
  });

  it("adopts the newest connected v3 server record into local preferences", () => {
    const result = deriveMobileChatVisualModeSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: record("current", 1_000, "mobile:current"),
      environments: [
        {
          environmentId: "remote",
          label: "Remote",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 3,
          record: serverRecord,
        },
      ],
    });

    expect(result.mode).toBe("classic");
    expect(result.preferencePatch).toEqual({ chatVisualModeSyncRecord: serverRecord });
    expect(result.plan.writes).toEqual([]);
  });

  it("uses updateId to deterministically adopt a tied connected record", () => {
    const connectedRecord = record("classic", 2_000, "update-b");
    const result = deriveMobileChatVisualModeSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: record("current", 2_000, "update-a"),
      environments: [
        {
          environmentId: "remote",
          label: "Remote",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 3,
          record: connectedRecord,
        },
      ],
    });

    expect(result.mode).toBe("classic");
    expect(result.preferencePatch).toEqual({ chatVisualModeSyncRecord: connectedRecord });
  });

  it("renders Current without minting a record when no choice exists", () => {
    const result = deriveMobileChatVisualModeSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord: undefined,
      environments: [],
    });

    expect(result.mode).toBe("current");
    expect(result.preferencePatch).toBeNull();
    expect(result.plan.winner).toBeNull();
  });

  it("fans an explicit Current choice out to a stale connected v3 server", () => {
    const localRecord = record("current", 3_000, "mobile:current");
    const result = deriveMobileChatVisualModeSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord,
      environments: [
        {
          environmentId: "remote",
          label: "Remote",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 3,
          record: serverRecord,
        },
      ],
    });

    expect(result.mode).toBe("current");
    expect(result.plan.writes).toEqual([{ environmentId: "remote", record: localRecord }]);
  });

  it("defers offline v3 writes and reports v1/v2 servers as unsupported", () => {
    const localRecord = record("classic", 3_000, "mobile:classic");
    const result = deriveMobileChatVisualModeSync({
      preferencesReady: true,
      catalogReady: true,
      localRecord,
      environments: [
        {
          environmentId: "offline",
          label: "Offline server",
          connected: false,
          configLoaded: true,
          environmentSettingsVersion: 3,
          record: serverRecord,
        },
        {
          environmentId: "v1",
          label: "Version 1",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 1,
          record: null,
        },
        {
          environmentId: "v2",
          label: "Version 2",
          connected: true,
          configLoaded: true,
          environmentSettingsVersion: 2,
          record: null,
        },
      ],
    });

    expect(result.deferredEnvironmentLabels).toEqual(["Offline server"]);
    expect(result.unsupportedEnvironmentLabels).toEqual(["Version 1", "Version 2"]);
    expect(result.plan.writes).toEqual([]);
  });
});
