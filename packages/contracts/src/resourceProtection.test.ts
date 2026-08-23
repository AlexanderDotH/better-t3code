import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  RESOURCE_MONITOR_PROTOCOL_VERSION,
  ResourceMonitorCommand,
  ResourceMonitorEvent,
  ResourceMonitorHelloEvent,
  ResourceMonitorSnapshotEvent,
  ResourceProtectionSnapshot,
} from "./resourceTelemetry.ts";

const decodeResourceMonitorCommand = Schema.decodeUnknownSync(ResourceMonitorCommand);
const decodeResourceMonitorEvent = Schema.decodeUnknownSync(ResourceMonitorEvent);
const decodeResourceMonitorHelloEvent = Schema.decodeUnknownSync(ResourceMonitorHelloEvent);
const decodeResourceMonitorSnapshotEvent = Schema.decodeUnknownSync(ResourceMonitorSnapshotEvent);
const decodeResourceProtectionSnapshot = Schema.decodeUnknownSync(ResourceProtectionSnapshot);

describe("resource protection contracts", () => {
  it("decodes host RAM and swap from resource monitor snapshots", () => {
    const decoded = decodeResourceMonitorSnapshotEvent({
      version: RESOURCE_MONITOR_PROTOCOL_VERSION,
      type: "snapshot",
      sequence: 1,
      sampledAtUnixMs: 1_000,
      collectionDurationMicros: 50,
      scannedProcessCount: 2,
      retainedProcessCount: 1,
      inaccessibleProcessCount: 0,
      memory: {
        totalBytes: 32 * 1024 ** 3,
        availableBytes: 12 * 1024 ** 3,
        swapTotalBytes: 16 * 1024 ** 3,
        swapFreeBytes: 4 * 1024 ** 3,
      },
      processes: [],
    });

    expect(decoded.memory.availableBytes).toBe(12 * 1024 ** 3);
    expect(decoded.memory.swapFreeBytes).toBe(4 * 1024 ** 3);
  });

  it("keeps the resource-protection snapshot ephemeral and explicit", () => {
    const decoded = decodeResourceProtectionSnapshot({
      state: "waiting",
      totalMemoryBytes: 32 * 1024 ** 3,
      availableMemoryBytes: 5 * 1024 ** 3,
      reservedMemoryBytes: 4 * 1024 ** 3,
      coreReserveBytes: 6 * 1024 ** 3,
      waitingStarts: 2,
      affectedThreadIds: ["thread-a", "thread-b"],
    });

    expect(decoded.state).toBe("waiting");
    expect(decoded.waitingStarts).toBe(2);
    expect(decoded.affectedThreadIds).toEqual(["thread-a", "thread-b"]);
  });

  it("advertises process suspend and resume support in the protocol 4 handshake", () => {
    expect(RESOURCE_MONITOR_PROTOCOL_VERSION).toBe(4);

    const decoded = decodeResourceMonitorHelloEvent({
      version: 4,
      type: "hello",
      sidecarVersion: "0.2.0",
      sidecarPid: 9_001,
      platform: "windows",
      arch: "x86_64",
      capabilities: {
        cumulativeCpuTime: true,
        currentCpuPercent: true,
        residentMemory: true,
        virtualMemory: true,
        ioBytes: true,
        processStartTime: true,
        processTree: true,
        processSuspendResume: true,
      },
    });

    expect(decoded.capabilities.processSuspendResume).toBe(true);
  });

  it.each(["suspendProcessTree", "resumeProcessTree"] as const)(
    "decodes %s commands with exact process identities",
    (type) => {
      const decoded = decodeResourceMonitorCommand({
        version: 4,
        type,
        requestId: "request-1",
        leaseId: "lease-1",
        processes: [{ pid: 42, startTimeMs: 1_725_000_000_000 }],
      });

      expect(decoded).toMatchObject({
        type,
        requestId: "request-1",
        leaseId: "lease-1",
        processes: [{ pid: 42, startTimeMs: 1_725_000_000_000 }],
      });
    },
  );

  it("rejects process-control commands without an exact process identity", () => {
    expect(() =>
      decodeResourceMonitorCommand({
        version: 4,
        type: "suspendProcessTree",
        requestId: "request-empty",
        leaseId: "lease-empty",
        processes: [],
      }),
    ).toThrow();
  });

  it("decodes correlated process-control failures without weakening existing events", () => {
    const decoded = decodeResourceMonitorEvent({
      version: 4,
      type: "processControlResult",
      requestId: "request-2",
      leaseId: "lease-2",
      operation: "resume",
      success: false,
      resumeRequired: true,
      error: "process identity changed",
    });

    expect(decoded).toEqual({
      version: 4,
      type: "processControlResult",
      requestId: "request-2",
      leaseId: "lease-2",
      operation: "resume",
      success: false,
      resumeRequired: true,
      error: "process identity changed",
    });
  });
});
