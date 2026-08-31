import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createRegisteredProviderProcess,
  providerProcessRegistrationKey,
  refreshRegisteredProviderProcesses,
} from "./ProviderProcessInventory.ts";

const registration = {
  threadId: ThreadId.make("thread-inventory"),
  provider: ProviderDriverKind.make("codex"),
  providerInstanceId: ProviderInstanceId.make("codex-main"),
  pid: 41,
};

describe("provider process inventory state", () => {
  it("normalizes known process identities while keeping unresolved identities isolated", () => {
    expect(providerProcessRegistrationKey({ pid: 41 })).toBe("41:pending");
    expect(providerProcessRegistrationKey({ pid: 41, startTimeMs: 12_999 })).toBe("41:12000");
  });

  it("projects exact process trees and growth only across consecutive exact samples", () => {
    const pending = createRegisteredProviderProcess(registration, undefined);
    const first = refreshRegisteredProviderProcesses(new Map([[pending.key, pending]]), {
      sampledAtMs: 1_000,
      processes: [
        { pid: 41, ppid: 1, startTimeMs: 12_999, residentBytes: 100 },
        { pid: 42, ppid: 41, startTimeMs: 13_100, residentBytes: 50 },
      ],
    });
    const exact = [...first.values()][0];
    expect(exact).toMatchObject({
      key: "41:12000",
      exact: true,
      currentRssBytes: 150,
      growthBytesPerSecond: 0,
    });
    expect(exact?.processIdentities).toHaveLength(2);

    const second = refreshRegisteredProviderProcesses(first, {
      sampledAtMs: 2_000,
      processes: [
        { pid: 41, ppid: 1, startTimeMs: 12_999, residentBytes: 180 },
        { pid: 42, ppid: 41, startTimeMs: 13_100, residentBytes: 70 },
      ],
    });
    expect([...second.values()][0]).toMatchObject({
      currentRssBytes: 250,
      growthBytesPerSecond: 100,
    });

    const missing = refreshRegisteredProviderProcesses(second, {
      sampledAtMs: 3_000,
      processes: [],
    });
    expect([...missing.values()][0]).toMatchObject({
      exact: false,
      currentRssBytes: 0,
      growthBytesPerSecond: 0,
    });
  });
});
