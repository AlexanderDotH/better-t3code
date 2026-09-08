import type { ProjectThreadPreviewSyncRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  planProjectThreadPreviewSync,
  settleProjectThreadPreviewSyncWrites,
} from "./projectThreadPreviewSync.ts";

function record(updateId: string, updatedAt: number, count = 3): ProjectThreadPreviewSyncRecord {
  return { count, updatedAt, updateId };
}

describe("project thread preview synchronization", () => {
  it("chooses the record with the latest timestamp", () => {
    const localRecord = record("local", 1_000, 3);
    const serverRecord = record("server", 2_000, 7);

    const plan = planProjectThreadPreviewSync({
      localRecord,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 2,
          connected: true,
          record: serverRecord,
        },
      ],
    });

    expect(plan.winner).toEqual(serverRecord);
    expect(plan.nextLocalRecord).toEqual(serverRecord);
    expect(plan.writes).toEqual([]);
  });

  it("uses updateId as a deterministic tie-break", () => {
    const localRecord = record("update-a", 1_000, 3);
    const serverRecord = record("update-b", 1_000, 8);

    const plan = planProjectThreadPreviewSync({
      localRecord,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 2,
          connected: true,
          record: serverRecord,
        },
      ],
    });

    expect(plan.winner).toEqual(serverRecord);
    expect(plan.writes).toEqual([]);
  });

  it("uses an existing connected server record before a local default exists", () => {
    const serverRecord = record("server-existing", 5_000, 9);

    const plan = planProjectThreadPreviewSync({
      localRecord: null,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 2,
          connected: true,
          record: serverRecord,
        },
      ],
    });

    expect(plan.winner).toEqual(serverRecord);
    expect(plan.nextLocalRecord).toEqual(serverRecord);
    expect(plan.writes).toEqual([]);
  });

  it("fans out only to stale connected compatible servers", () => {
    const winner = record("latest", 5_000, 12);

    const plan = planProjectThreadPreviewSync({
      localRecord: winner,
      environments: [
        {
          environmentId: "stale",
          environmentSettingsVersion: 2,
          connected: true,
          record: record("older", 4_000),
        },
        {
          environmentId: "missing",
          environmentSettingsVersion: 2,
          connected: true,
          record: null,
        },
        {
          environmentId: "current",
          environmentSettingsVersion: 2,
          connected: true,
          record: winner,
        },
      ],
    });

    expect(plan.writes).toEqual([
      { environmentId: "stale", record: winner },
      { environmentId: "missing", record: winner },
    ]);
    expect(plan.pendingWrites).toEqual(plan.writes);
  });

  it("skips and reports servers older than settings version 2", () => {
    const winner = record("latest", 5_000);

    const plan = planProjectThreadPreviewSync({
      localRecord: winner,
      environments: [
        {
          environmentId: "legacy-v1",
          environmentSettingsVersion: 1,
          connected: true,
          record: record("older", 4_000),
        },
        {
          environmentId: "legacy-unknown",
          environmentSettingsVersion: undefined,
          connected: true,
          record: null,
        },
      ],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.pendingWrites).toEqual([]);
    expect(plan.unsupportedEnvironmentIds).toEqual(["legacy-v1", "legacy-unknown"]);
  });

  it("retains an offline target and retries it after reconnect", () => {
    const winner = record("latest", 5_000, 6);
    const offlinePlan = planProjectThreadPreviewSync({
      localRecord: winner,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 2,
          connected: false,
          record: record("older", 4_000),
        },
      ],
    });

    expect(offlinePlan.writes).toEqual([]);
    expect(offlinePlan.pendingWrites).toEqual([{ environmentId: "remote", record: winner }]);
    expect(offlinePlan.deferredEnvironmentIds).toEqual(["remote"]);

    const reconnectPlan = planProjectThreadPreviewSync({
      localRecord: winner,
      pendingWrites: offlinePlan.pendingWrites,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 2,
          connected: true,
          record: record("older", 4_000),
        },
      ],
    });
    const settlement = settleProjectThreadPreviewSyncWrites(reconnectPlan, [
      { environmentId: "remote", status: "success" },
    ]);

    expect(reconnectPlan.writes).toEqual([{ environmentId: "remote", record: winner }]);
    expect(settlement.pendingWrites).toEqual([]);
    expect(settlement.successfulEnvironmentIds).toEqual(["remote"]);
    expect(settlement.isFullySynchronized).toBe(true);
  });

  it("does not overwrite a newer cached offline record", () => {
    const localRecord = record("local", 5_000, 3);

    const plan = planProjectThreadPreviewSync({
      localRecord,
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 2,
          connected: false,
          record: record("offline-newer", 6_000, 10),
        },
      ],
    });

    expect(plan.winner).toEqual(localRecord);
    expect(plan.writes).toEqual([]);
    expect(plan.pendingWrites).toEqual([]);
  });

  it("converges to a no-op without creating an update loop", () => {
    const winner = record("same-update", 5_000, 4);

    const plan = planProjectThreadPreviewSync({
      localRecord: winner,
      pendingWrites: [{ environmentId: "remote", record: winner }],
      environments: [
        {
          environmentId: "remote",
          environmentSettingsVersion: 2,
          connected: true,
          record: winner,
        },
      ],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.pendingWrites).toEqual([]);
    expect(plan.deferredEnvironmentIds).toEqual([]);
  });

  it("reports partial failures and retains only failed writes", () => {
    const winner = record("latest", 5_000, 15);
    const plan = planProjectThreadPreviewSync({
      localRecord: winner,
      environments: [
        {
          environmentId: "updated",
          environmentSettingsVersion: 2,
          connected: true,
          record: null,
        },
        {
          environmentId: "failed",
          environmentSettingsVersion: 2,
          connected: true,
          record: record("older", 4_000),
        },
      ],
    });

    const settlement = settleProjectThreadPreviewSyncWrites(plan, [
      { environmentId: "updated", status: "success" },
      { environmentId: "failed", status: "failure" },
    ]);

    expect(settlement.successfulEnvironmentIds).toEqual(["updated"]);
    expect(settlement.failedEnvironmentIds).toEqual(["failed"]);
    expect(settlement.pendingWrites).toEqual([{ environmentId: "failed", record: winner }]);
    expect(settlement.hasPartialFailure).toBe(true);
    expect(settlement.isFullySynchronized).toBe(false);

    const disconnectedPlan = planProjectThreadPreviewSync({
      localRecord: winner,
      pendingWrites: settlement.pendingWrites,
      environments: [
        {
          environmentId: "failed",
          environmentSettingsVersion: 2,
          connected: false,
          record: winner,
        },
      ],
    });
    const retryPlan = planProjectThreadPreviewSync({
      localRecord: winner,
      pendingWrites: disconnectedPlan.pendingWrites,
      environments: [
        {
          environmentId: "failed",
          environmentSettingsVersion: 2,
          connected: true,
          record: record("older", 4_000),
        },
      ],
    });

    expect(disconnectedPlan.pendingWrites).toEqual([{ environmentId: "failed", record: winner }]);
    expect(disconnectedPlan.deferredEnvironmentIds).toEqual(["failed"]);
    expect(retryPlan.writes).toEqual([{ environmentId: "failed", record: winner }]);
  });

  it("keeps unreported writes pending without misreporting them as failures", () => {
    const winner = record("latest", 5_000);
    const plan = planProjectThreadPreviewSync({
      localRecord: winner,
      environments: [
        {
          environmentId: "no-result",
          environmentSettingsVersion: 2,
          connected: true,
          record: null,
        },
      ],
    });

    const settlement = settleProjectThreadPreviewSyncWrites(plan, []);

    expect(settlement.failedEnvironmentIds).toEqual([]);
    expect(settlement.unreportedEnvironmentIds).toEqual(["no-result"]);
    expect(settlement.pendingWrites).toEqual(plan.pendingWrites);
  });
});
