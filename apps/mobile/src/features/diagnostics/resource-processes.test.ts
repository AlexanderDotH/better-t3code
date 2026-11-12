import { describe, expect, it } from "vite-plus/test";

import { sortResourceProcesses } from "./resource-processes";

describe("resource process sorting", () => {
  it("ranks CPU and memory independently, uses stable identity ties and preserves the snapshot", () => {
    const processes = [
      { identity: { pid: 3, startTimeMs: 30 }, name: "worker", cpuPercent: 10, residentBytes: 90 },
      { identity: { pid: 2, startTimeMs: 20 }, name: "worker", cpuPercent: 20, residentBytes: 20 },
      { identity: { pid: 1, startTimeMs: 10 }, name: "worker", cpuPercent: 20, residentBytes: 50 },
    ];
    const ids = (entries: typeof processes) => entries.map((entry) => entry.identity.pid);
    expect(ids(sortResourceProcesses(processes, "cpu"))).toEqual([1, 2, 3]);
    expect(ids(sortResourceProcesses(processes, "memory"))).toEqual([3, 1, 2]);
    expect(ids(sortResourceProcesses(processes, "pid"))).toEqual([1, 2, 3]);
    expect(ids(processes)).toEqual([3, 2, 1]);
  });
});
