import type { LegacyChatVisualMode, ChatVisualModeSyncRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION,
  planChatVisualModeSync,
  settleChatVisualModeSyncWrites,
} from "./chatVisualModeSync.ts";

function record(
  updateId: string,
  updatedAt: number,
  mode: LegacyChatVisualMode = "current",
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

describe("chat visual mode V2 compatibility", () => {
  const better = { mode: "better-t3", updatedAt: 5_000, updateId: "web:better" } as const;
  const mirror = { ...better, mode: "current" } as const;
  const modern = {
    environmentId: "modern",
    environmentSettingsVersion: 6,
    connected: true,
    record: mirror,
    recordV2: better,
  };
  const legacy = {
    environmentId: "legacy",
    environmentSettingsVersion: 3,
    connected: true,
    record: mirror,
  };

  it("prefers incoming V2 over a local V1 mirror at the exact same clock", () => {
    const plan = planChatVisualModeSync({ localRecord: mirror, environments: [modern] });
    expect(plan.winner).toEqual(better);
    expect(plan.writes).toEqual([]);
  });

  it("recovers Better T3 when the local V1 mirror was already migrated to V2", () => {
    const plan = planChatVisualModeSync({
      localRecord: mirror,
      localRecordV2: mirror,
      environments: [modern],
    });
    expect(plan.winner).toEqual(better);
    expect(plan.writes).toEqual([]);
  });

  it("upgrades V2-capable targets containing only an equal-clock V1 mirror", () => {
    const plan = planChatVisualModeSync({
      localRecord: mirror,
      localRecordV2: better,
      environments: [{ ...modern, recordV2: null }],
    });
    expect(plan.writes).toEqual([{ environmentId: "modern", record: better, recordVersion: 2 }]);
  });

  it("repairs a promoted mirror at the same clock without minting another update", () => {
    const plan = planChatVisualModeSync({
      localRecord: mirror,
      localRecordV2: better,
      environments: [{ ...modern, recordV2: mirror }],
    });
    expect(plan.writes).toEqual([{ environmentId: "modern", record: better, recordVersion: 2 }]);
  });

  it("keeps Better T3 locally and never writes it to an older server", () => {
    const plan = planChatVisualModeSync({
      localRecord: mirror,
      localRecordV2: better,
      environments: [legacy, modern],
    });
    expect(plan.winner).toEqual(better);
    expect(plan.writes).toEqual([]);
    expect(plan.pendingWrites).toEqual([]);
    expect(plan.unsupportedEnvironmentIds).toEqual(["legacy"]);
  });

  it("lets a newer explicit legacy edit win and sends each server its supported schema", () => {
    const newer = record("legacy:explicit", 6_000, "classic");
    const plan = planChatVisualModeSync({
      localRecord: mirror,
      localRecordV2: better,
      environments: [
        modern,
        { ...legacy, record: newer },
        { ...legacy, environmentId: "stale", record: mirror },
      ],
    });
    expect(plan.winner).toEqual(newer);
    expect(plan.writes).toEqual([
      { environmentId: "modern", record: newer, recordVersion: 2 },
      { environmentId: "stale", record: newer },
    ]);
    expect(plan.unsupportedEnvironmentIds).toEqual([]);
  });

  it("uses update IDs across protocols for conflicting same-time edits", () => {
    const newer = record("zz:legacy", better.updatedAt, "classic");
    const plan = planChatVisualModeSync({
      localRecord: null,
      localRecordV2: better,
      environments: [{ ...legacy, record: newer }],
    });
    expect(plan.winner).toEqual(newer);
  });

  it("defers Better T3 only for a compatible offline server and retries on reconnect", () => {
    const offline = { ...modern, connected: false, record: null, recordV2: null };
    const plan = planChatVisualModeSync({
      localRecord: mirror,
      localRecordV2: better,
      environments: [offline, legacy],
    });
    expect(plan.writes).toEqual([]);
    expect(plan.deferredEnvironmentIds).toEqual(["modern"]);
    expect(plan.pendingWrites).toEqual([
      { environmentId: "modern", record: better, recordVersion: 2 },
    ]);
    const retry = planChatVisualModeSync({
      localRecord: mirror,
      localRecordV2: better,
      environments: [{ ...offline, connected: true }],
      pendingWrites: plan.pendingWrites,
    });
    const failed = settleChatVisualModeSyncWrites(retry, [
      { environmentId: "modern", status: "failure" },
    ]);
    expect(failed.pendingWrites).toEqual(retry.writes);
    expect(
      settleChatVisualModeSyncWrites(retry, [{ environmentId: "modern", status: "success" }])
        .pendingWrites,
    ).toEqual([]);
  });

  it("does not replay stable compatibility mirrors between environments", () => {
    const plan = planChatVisualModeSync({
      localRecord: mirror,
      localRecordV2: better,
      environments: [modern, { ...modern, environmentId: "second" }, legacy],
    });
    expect(plan.writes).toEqual([]);
    expect(plan.pendingWrites).toEqual([]);
  });
});
