import type { ChatVisualMode, ChatVisualModeSyncRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION,
  planChatVisualModeSync,
  settleChatVisualModeSyncWrites,
} from "./chatVisualModeSync.ts";

function record(
  updateId: string,
  updatedAt: number,
  mode: ChatVisualMode = "current",
): ChatVisualModeSyncRecord {
  return { mode, updatedAt, updateId };
}

describe("chat visual mode synchronization", () => {
  it("chooses the latest timestamp and caches the server winner locally", () => {
    const localRecord = record("local", 1_000, "current");
    const serverRecord = record("server", 2_000, "classic");

    const plan = planChatVisualModeSync({
      localRecord,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION,
          connected: true,
          record: serverRecord,
        },
      ],
    });

    expect(plan.winner).toEqual(serverRecord);
    expect(plan.nextLocalRecord).toEqual(serverRecord);
    expect(plan.writes).toEqual([]);
  });

  it("uses updateId as the deterministic timestamp tie-break", () => {
    const localRecord = record("update-a", 1_000, "current");
    const serverRecord = record("update-b", 1_000, "classic");

    const plan = planChatVisualModeSync({
      localRecord,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION,
          connected: true,
          record: serverRecord,
        },
      ],
    });

    expect(plan.winner).toEqual(serverRecord);
    expect(plan.nextLocalRecord).toEqual(serverRecord);
    expect(plan.writes).toEqual([]);
  });

  it("fans the winner out only to stale connected version-3 environments", () => {
    const winner = record("latest", 5_000, "classic");

    const plan = planChatVisualModeSync({
      localRecord: winner,
      environments: [
        {
          environmentId: "stale",
          environmentSettingsVersion: 3,
          connected: true,
          record: record("older", 4_000),
        },
        {
          environmentId: "missing",
          environmentSettingsVersion: 3,
          connected: true,
          record: null,
        },
        {
          environmentId: "current",
          environmentSettingsVersion: 3,
          connected: true,
          record: winner,
        },
        {
          environmentId: "legacy-v2",
          environmentSettingsVersion: 2,
          connected: true,
          record: record("legacy", 3_000),
        },
        {
          environmentId: "legacy-v1",
          environmentSettingsVersion: 1,
          connected: true,
          record: null,
        },
      ],
    });

    expect(plan.writes).toEqual([
      { environmentId: "stale", record: winner },
      { environmentId: "missing", record: winner },
    ]);
    expect(plan.pendingWrites).toEqual(plan.writes);
    expect(plan.unsupportedEnvironmentIds).toEqual(["legacy-v2", "legacy-v1"]);
  });

  it("defers an offline stale target and retries it after reconnect", () => {
    const winner = record("latest", 5_000, "classic");
    const offlinePlan = planChatVisualModeSync({
      localRecord: winner,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 3,
          connected: false,
          record: record("older", 4_000),
        },
      ],
    });

    expect(offlinePlan.writes).toEqual([]);
    expect(offlinePlan.pendingWrites).toEqual([{ environmentId: "remote", record: winner }]);
    expect(offlinePlan.deferredEnvironmentIds).toEqual(["remote"]);

    const reconnectPlan = planChatVisualModeSync({
      localRecord: winner,
      pendingWrites: offlinePlan.pendingWrites,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 3,
          connected: true,
          record: record("older", 4_000),
        },
      ],
    });

    expect(reconnectPlan.writes).toEqual([{ environmentId: "remote", record: winner }]);
    expect(
      settleChatVisualModeSyncWrites(reconnectPlan, [
        { environmentId: "remote", status: "success" },
      ]),
    ).toMatchObject({
      pendingWrites: [],
      successfulEnvironmentIds: ["remote"],
      isFullySynchronized: true,
    });
  });

  it("retains failed and unreported writes after a partial settlement", () => {
    const winner = record("latest", 5_000, "classic");
    const plan = planChatVisualModeSync({
      localRecord: winner,
      environments: [
        {
          environmentId: "updated",
          environmentSettingsVersion: 3,
          connected: true,
          record: null,
        },
        {
          environmentId: "failed",
          environmentSettingsVersion: 3,
          connected: true,
          record: record("older", 4_000),
        },
        {
          environmentId: "unreported",
          environmentSettingsVersion: 3,
          connected: true,
          record: record("oldest", 3_000),
        },
      ],
    });

    const settlement = settleChatVisualModeSyncWrites(plan, [
      { environmentId: "updated", status: "success" },
      { environmentId: "failed", status: "failure" },
    ]);

    expect(settlement.successfulEnvironmentIds).toEqual(["updated"]);
    expect(settlement.failedEnvironmentIds).toEqual(["failed"]);
    expect(settlement.unreportedEnvironmentIds).toEqual(["unreported"]);
    expect(settlement.pendingWrites).toEqual([
      { environmentId: "failed", record: winner },
      { environmentId: "unreported", record: winner },
    ]);
    expect(settlement.hasPartialFailure).toBe(true);
    expect(settlement.isFullySynchronized).toBe(false);
  });

  it("converges to a no-op once every environment has the same record", () => {
    const winner = record("same-update", 5_000, "classic");

    const plan = planChatVisualModeSync({
      localRecord: winner,
      pendingWrites: [{ environmentId: "remote", record: winner }],
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 3,
          connected: true,
          record: winner,
        },
      ],
    });

    expect(plan.winner).toEqual(winner);
    expect(plan.writes).toEqual([]);
    expect(plan.pendingWrites).toEqual([]);
    expect(plan.deferredEnvironmentIds).toEqual([]);
  });
});
