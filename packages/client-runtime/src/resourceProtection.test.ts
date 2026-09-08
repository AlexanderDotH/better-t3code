import { ResourceProtectionSnapshot, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { resolveResourceProtectionPresentation } from "./resourceProtection.ts";

const decodeSnapshot = Schema.decodeUnknownSync(ResourceProtectionSnapshot);
const affectedThread = ThreadId.make("thread-affected");

function snapshot(state: "normal" | "waiting" | "throttled" | "recovering" | "unavailable") {
  return decodeSnapshot({
    state,
    totalMemoryBytes: 32 * 1024 ** 3,
    availableMemoryBytes: 5 * 1024 ** 3,
    reservedMemoryBytes: 4 * 1024 ** 3,
    coreReserveBytes: 6 * 1024 ** 3,
    waitingStarts: state === "waiting" ? 1 : 0,
    affectedThreadIds: [affectedThread],
  });
}

describe("resource protection presentation", () => {
  it("shows a waiting message only on the affected thread", () => {
    expect(resolveResourceProtectionPresentation(snapshot("waiting"), affectedThread)?.label).toBe(
      "Subagent waiting for memory",
    );
    expect(
      resolveResourceProtectionPresentation(snapshot("waiting"), ThreadId.make("thread-other")),
    ).toBeNull();
  });

  it("uses the English throttling message by default throughout recovery", () => {
    expect(
      resolveResourceProtectionPresentation(snapshot("throttled"), affectedThread)?.label,
    ).toBe("Provider temporarily throttled");
    expect(
      resolveResourceProtectionPresentation(snapshot("recovering"), affectedThread)?.label,
    ).toBe("Provider temporarily throttled");
  });

  it("uses German copy when the client resolves German", () => {
    expect(
      resolveResourceProtectionPresentation(snapshot("throttled"), affectedThread, "de"),
    ).toMatchObject({
      label: "Provider vorübergehend gedrosselt",
      description: "T3 setzt den Provider nach fünf gesunden Speichermessungen automatisch fort.",
    });
  });

  it("stays silent in normal state", () => {
    expect(resolveResourceProtectionPresentation(snapshot("normal"), affectedThread)).toBeNull();
  });

  it("keeps telemetry-loss waits and paused providers visible", () => {
    expect(
      resolveResourceProtectionPresentation(
        { ...snapshot("unavailable"), waitingStarts: 1 },
        affectedThread,
      )?.kind,
    ).toBe("waiting");
    expect(
      resolveResourceProtectionPresentation(snapshot("unavailable"), affectedThread)?.kind,
    ).toBe("throttled");
  });
});
