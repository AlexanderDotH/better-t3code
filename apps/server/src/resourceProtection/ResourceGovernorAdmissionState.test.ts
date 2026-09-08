import { RESOURCE_PROTECTION_MAX_AFFECTED_THREAD_IDS, ThreadId } from "@t3tools/contracts";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import type { ResourceGovernorAdmissionQueueState } from "./ResourceGovernorAdmissionQueue.ts";
import {
  GIBIBYTE,
  monitoringRequired,
  protectionSnapshot,
  resourcePressureProjection,
  type ResourceGovernorStateProjection,
} from "./ResourceGovernorAdmissionState.ts";

const baseState = (): ResourceGovernorStateProjection => ({
  policy: { adaptiveAdmission: false, processSuspension: false },
  sample: undefined,
  waiting: [],
  active: new Map(),
  waitingInProcess: [],
  activeInProcess: new Map(),
  registrations: { size: 1 },
  suspendedProcessTree: undefined,
  healthySamples: 0,
});

describe("resource governor state projection", () => {
  it("keeps admission queue state compatible with resource snapshots", () => {
    expectTypeOf<ResourceGovernorAdmissionQueueState>().toMatchTypeOf<ResourceGovernorStateProjection>();
  });

  it("does not sample registered processes when both optional policies are disabled", () => {
    expect(monitoringRequired(baseState())).toBe(false);
  });

  it("samples registrations for independent process suspension and retains resume monitoring", () => {
    expect(
      monitoringRequired({
        ...baseState(),
        policy: { adaptiveAdmission: false, processSuspension: true },
      }),
    ).toBe(true);
    expect(
      monitoringRequired({
        ...baseState(),
        suspendedProcessTree: {
          threadId: ThreadId.make("thread-needs-resume"),
          suspendConfirmed: true,
        },
      }),
    ).toBe(true);
  });

  it("projects only exact provider growth and identifies the fastest suspension candidate", () => {
    const fast = { exact: true, growthBytesPerSecond: 2 * GIBIBYTE, name: "fast" };
    const slow = { exact: true, growthBytesPerSecond: 0.5 * GIBIBYTE, name: "slow" };
    const inexact = { exact: false, growthBytesPerSecond: 20 * GIBIBYTE, name: "inexact" };

    const projection = resourcePressureProjection(
      { totalBytes: 16 * GIBIBYTE, availableBytes: 10 * GIBIBYTE },
      [slow, inexact, fast],
    );

    expect(projection.fastest).toBe(fast);
    expect(projection.projectedGrowthBytes).toBe(2.5 * GIBIBYTE);
    expect(projection.projectedAvailableBytes).toBe(-2.5 * GIBIBYTE);
    expect(projection.critical).toBe(true);
    expect(projection.inProcessEmergency).toBe(true);
  });

  it("projects affected threads in suspension, process FIFO, then in-process FIFO order", () => {
    const snapshot = protectionSnapshot({
      ...baseState(),
      sample: {
        memory: {
          totalBytes: 16 * GIBIBYTE,
          availableBytes: 3 * GIBIBYTE,
          swapTotalBytes: 8 * GIBIBYTE,
          swapFreeBytes: 8 * GIBIBYTE,
        },
      },
      suspendedProcessTree: {
        threadId: ThreadId.make("suspended"),
        suspendConfirmed: true,
      },
      waiting: [
        { threadId: ThreadId.make("process-1") },
        { threadId: ThreadId.make("suspended") },
        { threadId: ThreadId.make("process-2") },
      ],
      waitingInProcess: [
        { threadId: ThreadId.make("process-1") },
        { threadId: ThreadId.make("in-process-1") },
      ],
    });

    expect(snapshot.state).toBe("throttled");
    expect(snapshot.waitingStarts).toBe(5);
    expect(snapshot.affectedThreadIds).toEqual([
      "suspended",
      "process-1",
      "process-2",
      "in-process-1",
    ]);
    expect(snapshot.affectedThreadIdsTruncated).toBe(false);
  });

  it("caps affected threads at 256 unique ids and reports an exact overflow", () => {
    const processWaiters = Array.from(
      { length: RESOURCE_PROTECTION_MAX_AFFECTED_THREAD_IDS - 1 },
      (_, index) => ({ threadId: ThreadId.make(`process-${index}`) }),
    );
    const snapshot = protectionSnapshot({
      ...baseState(),
      sample: {
        memory: {
          totalBytes: 16 * GIBIBYTE,
          availableBytes: 3 * GIBIBYTE,
          swapTotalBytes: 8 * GIBIBYTE,
          swapFreeBytes: 8 * GIBIBYTE,
        },
      },
      suspendedProcessTree: {
        threadId: ThreadId.make("suspended"),
        suspendConfirmed: true,
      },
      waiting: processWaiters,
      waitingInProcess: [
        { threadId: ThreadId.make("process-0") },
        { threadId: ThreadId.make("overflow") },
      ],
    });

    expect(snapshot.affectedThreadIds).toHaveLength(RESOURCE_PROTECTION_MAX_AFFECTED_THREAD_IDS);
    expect(snapshot.affectedThreadIds[0]).toBe("suspended");
    expect(snapshot.affectedThreadIds.at(-1)).toBe(
      `process-${RESOURCE_PROTECTION_MAX_AFFECTED_THREAD_IDS - 2}`,
    );
    expect(snapshot.affectedThreadIds).not.toContain("overflow");
    expect(snapshot.affectedThreadIdsTruncated).toBe(true);
  });
});
