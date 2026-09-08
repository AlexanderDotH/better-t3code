// @effect-diagnostics nodeBuiltinImport:off - cgroup limits are a Linux process boundary.
import * as NodeFS from "node:fs";

import type { ResourceMonitorHostMemory } from "@t3tools/contracts";

export interface CgroupMemorySample {
  readonly limitBytes: number;
  readonly currentBytes: number;
}

export type CgroupFileReader = (path: string) => string | undefined;

function safeIntegerAtLeast(raw: string | undefined, minimum: number): number | null {
  if (!raw) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function cgroupFile(root: string, relativePath: string, name: string): string {
  const relative = relativePath.replace(/^\/+|\/+$/gu, "");
  return relative ? `${root}/${relative}/${name}` : `${root}/${name}`;
}

function readPair(
  read: CgroupFileReader,
  limitPath: string,
  currentPath: string,
): CgroupMemorySample | null {
  const limitBytes = safeIntegerAtLeast(read(limitPath), 1);
  const currentBytes = safeIntegerAtLeast(read(currentPath), 0);
  return limitBytes !== null && currentBytes !== null ? { limitBytes, currentBytes } : null;
}

export function readCgroupMemorySample(read: CgroupFileReader): CgroupMemorySample | null {
  const processCgroup = read("/proc/self/cgroup");
  if (!processCgroup) return null;

  for (const line of processCgroup.split(/\r?\n/gu)) {
    const [hierarchy, controllers, relativePath] = line.split(":", 3);
    if (hierarchy === "0" && controllers === "" && relativePath !== undefined) {
      const sample = readPair(
        read,
        cgroupFile("/sys/fs/cgroup", relativePath, "memory.max"),
        cgroupFile("/sys/fs/cgroup", relativePath, "memory.current"),
      );
      if (sample) return sample;
    }
  }

  for (const line of processCgroup.split(/\r?\n/gu)) {
    const [, controllers, relativePath] = line.split(":", 3);
    if (!controllers?.split(",").includes("memory") || relativePath === undefined) continue;
    const sample = readPair(
      read,
      cgroupFile("/sys/fs/cgroup/memory", relativePath, "memory.limit_in_bytes"),
      cgroupFile("/sys/fs/cgroup/memory", relativePath, "memory.usage_in_bytes"),
    );
    if (sample) return sample;
  }

  return null;
}

export function constrainHostMemoryToCgroup(
  host: ResourceMonitorHostMemory,
  cgroup: CgroupMemorySample | null,
): ResourceMonitorHostMemory {
  if (!cgroup || cgroup.limitBytes >= host.totalBytes) return host;
  return {
    ...host,
    totalBytes: cgroup.limitBytes,
    availableBytes: Math.min(
      host.availableBytes,
      Math.max(0, cgroup.limitBytes - cgroup.currentBytes),
    ),
  };
}

const readHostFile: CgroupFileReader = (path) => {
  try {
    return NodeFS.readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

export function constrainHostMemoryToCurrentCgroup(
  host: ResourceMonitorHostMemory,
): ResourceMonitorHostMemory {
  return constrainHostMemoryToCgroup(host, readCgroupMemorySample(readHostFile));
}
