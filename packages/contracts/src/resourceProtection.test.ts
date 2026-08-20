import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  RESOURCE_MONITOR_PROTOCOL_VERSION,
  ResourceMonitorSnapshotEvent,
  ResourceProtectionSnapshot,
} from "./resourceTelemetry.ts";

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
});
