import { EnvironmentId, type ResourceProtectionSnapshot, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildResourceProtectionBanner } from "./resourceProtectionBanner.ts";

const environmentId = EnvironmentId.make("environment-resource");
const threadId = ThreadId.make("thread-resource");

function snapshot(state: ResourceProtectionSnapshot["state"]): ResourceProtectionSnapshot {
  return {
    state,
    totalMemoryBytes: 32 * 1024 ** 3,
    availableMemoryBytes: 5 * 1024 ** 3,
    reservedMemoryBytes: 4 * 1024 ** 3,
    coreReserveBytes: 6 * 1024 ** 3,
    waitingStarts: state === "waiting" ? 1 : 0,
    affectedThreadIds: [threadId],
  };
}

describe("resourceProtectionBanner", () => {
  it("maps waiting and throttled server authority to the web banner", () => {
    expect(
      buildResourceProtectionBanner({ environmentId, threadId, snapshot: snapshot("waiting") }),
    ).toMatchObject({
      variant: "info",
      urgent: false,
      title: "Subagent wartet auf freien Speicher",
    });
    expect(
      buildResourceProtectionBanner({ environmentId, threadId, snapshot: snapshot("throttled") }),
    ).toMatchObject({
      variant: "warning",
      urgent: true,
      title: "Provider vorübergehend gedrosselt",
    });
  });

  it("does not show a banner for an unaffected thread", () => {
    expect(
      buildResourceProtectionBanner({
        environmentId,
        threadId: ThreadId.make("thread-other"),
        snapshot: snapshot("waiting"),
      }),
    ).toBeNull();
  });
});
