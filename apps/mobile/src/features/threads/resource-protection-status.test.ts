import { type ResourceProtectionSnapshot, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveMobileResourceProtectionStatus } from "./resource-protection-status.ts";

const threadId = ThreadId.make("thread-mobile-resource");

function snapshot(state: ResourceProtectionSnapshot["state"]): ResourceProtectionSnapshot {
  return {
    state,
    totalMemoryBytes: 32 * 1024 ** 3,
    availableMemoryBytes: 5 * 1024 ** 3,
    reservedMemoryBytes: 4 * 1024 ** 3,
    coreReserveBytes: 6 * 1024 ** 3,
    waitingStarts: state === "waiting" ? 1 : 0,
    affectedThreadIds: [threadId],
    affectedThreadIdsTruncated: false,
  };
}

describe("mobile resource protection status", () => {
  it("shows English server-authoritative waiting and throttled status copy by default", () => {
    expect(resolveMobileResourceProtectionStatus(snapshot("waiting"), threadId)).toEqual({
      kind: "waiting",
      label: "Subagent waiting for memory",
    });
    expect(resolveMobileResourceProtectionStatus(snapshot("recovering"), threadId)).toEqual({
      kind: "throttled",
      label: "Provider temporarily throttled",
    });
  });

  it("shows German copy when the interface resolves German", () => {
    expect(resolveMobileResourceProtectionStatus(snapshot("recovering"), threadId, "de")).toEqual({
      kind: "throttled",
      label: "Provider vorübergehend gedrosselt",
    });
  });

  it("stays hidden for an unaffected thread", () => {
    expect(
      resolveMobileResourceProtectionStatus(
        snapshot("waiting"),
        ThreadId.make("thread-mobile-other"),
      ),
    ).toBeNull();
  });
});
