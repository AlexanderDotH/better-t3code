// @effect-diagnostics nodeBuiltinImport:off - Exact PID fencing requires a final /proc identity check immediately before a POSIX signal.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import type { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProviderProcessIdentity } from "./ProviderProcessTreeController.ts";

export interface ResourceGovernorProcessSample {
  readonly pid: number;
  readonly ppid: number;
  readonly startTimeMs: number;
  readonly residentBytes: number;
}

export interface ProviderProcessTreeSample {
  readonly exact: boolean;
  readonly residentBytes: number;
  readonly startTimeMs: number | undefined;
  readonly processIdentities: ReadonlyArray<ProviderProcessIdentity>;
}

export interface ProviderProcessRegistration {
  readonly threadId: ThreadId;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly pid: number;
  readonly startTimeMs?: number;
}

export interface RegisteredProviderProcess extends Omit<
  ProviderProcessRegistration,
  "startTimeMs"
> {
  readonly startTimeMs: number | undefined;
  readonly key: string;
  readonly exact: boolean;
  readonly currentRssBytes: number;
  readonly growthBytesPerSecond: number;
  readonly sampledAtMs: number | undefined;
  readonly processIdentities: ReadonlyArray<ProviderProcessIdentity>;
}

export function providerProcessRegistrationKey(
  input: Pick<ProviderProcessRegistration, "pid" | "startTimeMs">,
): string {
  const normalizedStartTimeMs =
    input.startTimeMs === undefined ? "pending" : Math.floor(input.startTimeMs / 1_000) * 1_000;
  return `${input.pid}:${normalizedStartTimeMs}`;
}

export function createRegisteredProviderProcess(
  registration: ProviderProcessRegistration,
  resolvedStartTimeMs: number | undefined,
): RegisteredProviderProcess {
  const key = providerProcessRegistrationKey({
    pid: registration.pid,
    ...(resolvedStartTimeMs === undefined ? {} : { startTimeMs: resolvedStartTimeMs }),
  });
  return {
    ...registration,
    startTimeMs: resolvedStartTimeMs,
    key,
    exact: false,
    currentRssBytes: 0,
    growthBytesPerSecond: 0,
    sampledAtMs: undefined,
    processIdentities: [],
  };
}

export function refreshRegisteredProviderProcesses(
  current: ReadonlyMap<string, RegisteredProviderProcess>,
  sample: {
    readonly sampledAtMs: number;
    readonly processes: ReadonlyArray<ResourceGovernorProcessSample>;
  },
): ReadonlyMap<string, RegisteredProviderProcess> {
  const refreshed = new Map<string, RegisteredProviderProcess>();
  for (const [key, registration] of current) {
    const tree = collectProviderProcessTree(registration, sample.processes);
    const nextKey =
      tree.startTimeMs === undefined
        ? key
        : providerProcessRegistrationKey({
            pid: registration.pid,
            startTimeMs: tree.startTimeMs,
          });
    const elapsedMs =
      registration.sampledAtMs === undefined
        ? 0
        : Math.max(0, sample.sampledAtMs - registration.sampledAtMs);
    const growthBytesPerSecond =
      tree.exact && registration.exact && elapsedMs > 0
        ? Math.max(0, tree.residentBytes - registration.currentRssBytes) / (elapsedMs / 1_000)
        : 0;
    refreshed.set(nextKey, {
      ...registration,
      startTimeMs: tree.startTimeMs,
      key: nextKey,
      exact: tree.exact,
      currentRssBytes: tree.residentBytes,
      growthBytesPerSecond,
      sampledAtMs: sample.sampledAtMs,
      processIdentities: tree.processIdentities,
    });
  }
  return refreshed;
}

function sameProcessStartTime(left: number, right: number): boolean {
  return Math.floor(left / 1_000) === Math.floor(right / 1_000);
}

export function collectProviderProcessTree(
  registration: { readonly pid: number; readonly startTimeMs: number | undefined },
  processes: ReadonlyArray<ResourceGovernorProcessSample>,
): ProviderProcessTreeSample {
  const processByPid = new Map(processes.map((process) => [process.pid, process]));
  const root = processByPid.get(registration.pid);
  if (
    root === undefined ||
    (registration.startTimeMs !== undefined &&
      !sameProcessStartTime(root.startTimeMs, registration.startTimeMs))
  ) {
    return {
      exact: false,
      residentBytes: 0,
      startTimeMs: registration.startTimeMs,
      processIdentities: [],
    };
  }

  const childrenByParent = new Map<number, Array<ResourceGovernorProcessSample>>();
  for (const process of processes) {
    const children = childrenByParent.get(process.ppid) ?? [];
    children.push(process);
    childrenByParent.set(process.ppid, children);
  }

  let residentBytes = 0;
  const processIdentities: Array<ProviderProcessIdentity> = [];
  const pending = [root];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const process = pending.shift();
    if (process === undefined) continue;
    const identity = `${process.pid}:${process.startTimeMs}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    residentBytes += process.residentBytes;
    processIdentities.push({ pid: process.pid, startTimeMs: process.startTimeMs });
    for (const child of childrenByParent.get(process.pid) ?? []) {
      if (child.startTimeMs >= process.startTimeMs) pending.push(child);
    }
  }
  return { exact: true, residentBytes, startTimeMs: root.startTimeMs, processIdentities };
}

function linuxProcessStartTimeMs(pid: number): number | undefined {
  try {
    const stat = NodeFS.readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return undefined;
    const fieldsAfterCommand = stat
      .slice(commandEnd + 2)
      .trim()
      .split(/\s+/u);
    const startTimeTicks = Number(fieldsAfterCommand[19]);
    const bootTimeSeconds = Number(
      /^btime\s+(\d+)$/mu.exec(NodeFS.readFileSync("/proc/stat", "utf8"))?.[1],
    );
    if (!Number.isFinite(startTimeTicks) || !Number.isFinite(bootTimeSeconds)) return undefined;

    // Linux exposes /proc process times in USER_HZ. All architectures supported
    // by the shipped Linux desktop use the kernel ABI value of 100 ticks/s.
    return Math.floor((bootTimeSeconds + startTimeTicks / 100) * 1_000);
  } catch {
    return undefined;
  }
}

export function providerProcessStartTimeMs(
  pid: number,
  hostPlatform: NodeJS.Platform,
): number | undefined {
  if (hostPlatform === "linux") {
    const linuxStartTime = linuxProcessStartTimeMs(pid);
    if (linuxStartTime !== undefined) return linuxStartTime;
  }
  if (hostPlatform === "win32") return undefined;
  try {
    const startedAt = NodeChildProcess.execFileSync(
      "/bin/ps",
      ["-p", String(pid), "-o", "lstart="],
      {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
      },
    ).trim();
    const parsed = Date.parse(startedAt);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export class ProviderProcessSignalError extends Schema.TaggedErrorClass<ProviderProcessSignalError>()(
  "ProviderProcessSignalError",
  {
    pid: Schema.Number,
    signal: Schema.Literals(["SIGSTOP", "SIGCONT"]),
    cause: Schema.Defect(),
  },
) {}

export function makeExactProcessSignaler(options?: {
  readonly hostPlatform?: NodeJS.Platform;
  readonly readStartTimeMs?: (pid: number) => number | undefined;
  readonly sendSignal?: (pid: number, signal: "SIGSTOP" | "SIGCONT") => void;
}): (
  identity: ProviderProcessIdentity,
  signal: "SIGSTOP" | "SIGCONT",
) => Effect.Effect<void, ProviderProcessSignalError> {
  const readStartTimeMs =
    options?.readStartTimeMs ??
    ((pid: number) =>
      options?.hostPlatform === undefined
        ? undefined
        : providerProcessStartTimeMs(pid, options.hostPlatform));
  const sendSignal = options?.sendSignal ?? ((pid, signal) => process.kill(pid, signal));
  return (identity, signal) =>
    Effect.try({
      try: () => {
        const actualStartTimeMs = readStartTimeMs(identity.pid);
        const identityMatches =
          actualStartTimeMs !== undefined &&
          sameProcessStartTime(actualStartTimeMs, identity.startTimeMs);
        if (!identityMatches) {
          // A missing or reused PID cannot still represent the process we
          // paused. Continuing it is therefore a successful no-op; stopping a
          // different process must fail closed.
          if (signal === "SIGCONT") return;
          throw new Error(`Process identity ${identity.pid}:${identity.startTimeMs} changed`);
        }
        sendSignal(identity.pid, signal);
      },
      catch: (cause) => new ProviderProcessSignalError({ pid: identity.pid, signal, cause }),
    });
}
