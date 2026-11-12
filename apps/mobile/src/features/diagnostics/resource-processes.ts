import type { ResourceTelemetryProcess } from "@t3tools/contracts";

export type ResourceProcessSort = "cpu" | "memory" | "pid";

export function sortResourceProcesses<
  T extends Pick<ResourceTelemetryProcess, "cpuPercent" | "residentBytes" | "identity" | "name">,
>(processes: readonly T[], sort: ResourceProcessSort): T[] {
  return [...processes].sort((a, b) => {
    const difference =
      sort === "cpu"
        ? b.cpuPercent - a.cpuPercent
        : sort === "memory"
          ? b.residentBytes - a.residentBytes
          : a.identity.pid - b.identity.pid;
    return (
      difference ||
      a.name.localeCompare(b.name) ||
      a.identity.pid - b.identity.pid ||
      a.identity.startTimeMs - b.identity.startTimeMs
    );
  });
}
