import { describe, expect, it } from "vite-plus/test";

import { constrainHostMemoryToCgroup, readCgroupMemorySample } from "./ContainerMemoryBudget.ts";

function reader(files: Readonly<Record<string, string>>) {
  return (path: string): string | undefined => files[path];
}

describe("ContainerMemoryBudget", () => {
  it("reads cgroup v2 memory limits for the current process path", () => {
    expect(
      readCgroupMemorySample(
        reader({
          "/proc/self/cgroup": "0::/docker/test-scope\n",
          "/sys/fs/cgroup/docker/test-scope/memory.max": "2147483648\n",
          "/sys/fs/cgroup/docker/test-scope/memory.current": "536870912\n",
        }),
      ),
    ).toEqual({ limitBytes: 2_147_483_648, currentBytes: 536_870_912 });
  });

  it("falls back to cgroup v1 memory controller files", () => {
    expect(
      readCgroupMemorySample(
        reader({
          "/proc/self/cgroup": "5:memory:/docker/legacy\n",
          "/sys/fs/cgroup/memory/docker/legacy/memory.limit_in_bytes": "3221225472\n",
          "/sys/fs/cgroup/memory/docker/legacy/memory.usage_in_bytes": "1073741824\n",
        }),
      ),
    ).toEqual({ limitBytes: 3_221_225_472, currentBytes: 1_073_741_824 });
  });

  it("ignores an unlimited cgroup and constrains host memory to a real limit", () => {
    expect(
      readCgroupMemorySample(
        reader({
          "/proc/self/cgroup": "0::/\n",
          "/sys/fs/cgroup/memory.max": "max\n",
          "/sys/fs/cgroup/memory.current": "100\n",
        }),
      ),
    ).toBeNull();

    expect(
      constrainHostMemoryToCgroup(
        { totalBytes: 16_000, availableBytes: 8_000, swapTotalBytes: 0, swapFreeBytes: 0 },
        { limitBytes: 6_000, currentBytes: 2_500 },
      ),
    ).toEqual({
      totalBytes: 6_000,
      availableBytes: 3_500,
      swapTotalBytes: 0,
      swapFreeBytes: 0,
    });
  });

  it("accepts a zero current-usage sample", () => {
    expect(
      readCgroupMemorySample(
        reader({
          "/proc/self/cgroup": "0::/empty\n",
          "/sys/fs/cgroup/empty/memory.max": "1024\n",
          "/sys/fs/cgroup/empty/memory.current": "0\n",
        }),
      ),
    ).toEqual({ limitBytes: 1_024, currentBytes: 0 });
  });
});
