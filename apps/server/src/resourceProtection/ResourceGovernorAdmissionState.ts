import {
  RESOURCE_PROTECTION_MAX_AFFECTED_THREAD_IDS,
  type ResourceMonitorHostMemory,
  type ResourceProtectionSnapshot,
  type ThreadId,
} from "@t3tools/contracts";

import type { ResourceProtectionPolicy } from "./ResourceProtectionPolicy.ts";

export const GIBIBYTE = 1024 ** 3;

const MIN_CORE_RESERVE_BYTES = 2 * GIBIBYTE;
const MAX_CORE_RESERVE_BYTES = 6 * GIBIBYTE;
const MIN_IN_PROCESS_EMERGENCY_RESERVE_BYTES = 0.5 * GIBIBYTE;
const MAX_IN_PROCESS_EMERGENCY_RESERVE_BYTES = 2 * GIBIBYTE;
const IN_PROCESS_EMERGENCY_RESERVE_RATIO = 0.05;
const UNKNOWN_AGENT_RESERVATION_BYTES = 4 * GIBIBYTE;
const RESOURCE_PRESSURE_PROJECTION_WINDOW_SECONDS = 5;

interface Reservation {
  readonly reservedBytes: number;
}

interface ThreadOwner {
  readonly threadId: ThreadId;
}

interface Suspension extends ThreadOwner {
  readonly suspendConfirmed: boolean;
}

export interface ResourceGovernorStateProjection {
  readonly policy: ResourceProtectionPolicy;
  readonly sample: { readonly memory: ResourceMonitorHostMemory } | undefined;
  readonly waiting: ReadonlyArray<ThreadOwner>;
  readonly active: ReadonlyMap<number, Reservation>;
  readonly waitingInProcess: ReadonlyArray<ThreadOwner>;
  readonly activeInProcess: ReadonlyMap<number, Reservation>;
  readonly registrations: { readonly size: number };
  readonly suspendedProcessTree: Suspension | undefined;
  readonly healthySamples: number;
}

export function coreReserveBytes(totalBytes: number): number {
  return Math.min(
    MAX_CORE_RESERVE_BYTES,
    Math.max(MIN_CORE_RESERVE_BYTES, Math.ceil(totalBytes * 0.2)),
  );
}

export function inProcessEmergencyReserveBytes(totalBytes: number): number {
  return Math.min(
    MAX_IN_PROCESS_EMERGENCY_RESERVE_BYTES,
    Math.max(
      MIN_IN_PROCESS_EMERGENCY_RESERVE_BYTES,
      Math.ceil(totalBytes * IN_PROCESS_EMERGENCY_RESERVE_RATIO),
    ),
  );
}

export function resourcePressureProjection<
  T extends { readonly exact: boolean; readonly growthBytesPerSecond: number },
>(
  memory: Pick<ResourceMonitorHostMemory, "totalBytes" | "availableBytes">,
  registrations: Iterable<T>,
): {
  readonly fastest: T | undefined;
  readonly projectedGrowthBytes: number;
  readonly projectedAvailableBytes: number;
  readonly critical: boolean;
  readonly inProcessEmergency: boolean;
} {
  let fastest: T | undefined;
  let projectedGrowthBytes = 0;
  for (const registration of registrations) {
    if (!registration.exact) continue;
    projectedGrowthBytes += registration.growthBytesPerSecond;
    if (fastest === undefined || registration.growthBytesPerSecond > fastest.growthBytesPerSecond) {
      fastest = registration;
    }
  }
  const projectedAvailableBytes =
    memory.availableBytes - projectedGrowthBytes * RESOURCE_PRESSURE_PROJECTION_WINDOW_SECONDS;
  return {
    fastest,
    projectedGrowthBytes,
    projectedAvailableBytes,
    critical: projectedAvailableBytes < coreReserveBytes(memory.totalBytes),
    inProcessEmergency: projectedAvailableBytes < inProcessEmergencyReserveBytes(memory.totalBytes),
  };
}

export function reservationBytesForGrowthSamples(samples: ReadonlyArray<number>): number {
  if (samples.length === 0) return UNKNOWN_AGENT_RESERVATION_BYTES;
  const sorted = [...samples].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return Math.max(UNKNOWN_AGENT_RESERVATION_BYTES, Math.ceil((sorted[p95Index] ?? 0) * 1.25));
}

export function reservedMemoryBytes(state: ResourceGovernorStateProjection): number {
  let total = 0;
  for (const measurement of state.active.values()) total += measurement.reservedBytes;
  for (const work of state.activeInProcess.values()) total += work.reservedBytes;
  return total;
}

export function monitoringRequired(state: ResourceGovernorStateProjection): boolean {
  return (
    state.suspendedProcessTree !== undefined ||
    (state.policy.adaptiveAdmission &&
      (state.waiting.length > 0 ||
        state.active.size > 0 ||
        state.waitingInProcess.length > 0 ||
        state.activeInProcess.size > 0)) ||
    (state.policy.processSuspension && state.registrations.size > 0)
  );
}

function affectedThreadProjection(state: ResourceGovernorStateProjection): {
  readonly affectedThreadIds: ReadonlyArray<ThreadId>;
  readonly affectedThreadIdsTruncated: boolean;
} {
  const affectedThreadIds: ThreadId[] = [];
  const seen = new Set<ThreadId>();
  let affectedThreadIdsTruncated = false;
  const add = (threadId: ThreadId) => {
    if (seen.has(threadId)) return;
    seen.add(threadId);
    if (affectedThreadIds.length < RESOURCE_PROTECTION_MAX_AFFECTED_THREAD_IDS) {
      affectedThreadIds.push(threadId);
      return;
    }
    affectedThreadIdsTruncated = true;
  };

  if (state.suspendedProcessTree) add(state.suspendedProcessTree.threadId);
  for (const waiter of state.waiting) add(waiter.threadId);
  for (const waiter of state.waitingInProcess) add(waiter.threadId);
  return { affectedThreadIds, affectedThreadIdsTruncated };
}

export function protectionSnapshot(
  state: ResourceGovernorStateProjection,
): ResourceProtectionSnapshot {
  const memory = state.sample?.memory;
  const suspension = state.suspendedProcessTree;
  const recovering =
    suspension !== undefined && (!suspension.suspendConfirmed || state.healthySamples > 0);
  const affected = affectedThreadProjection(state);
  return {
    state: !memory
      ? "unavailable"
      : recovering
        ? "recovering"
        : suspension?.suspendConfirmed
          ? "throttled"
          : state.waiting.length + state.waitingInProcess.length > 0
            ? "waiting"
            : "normal",
    totalMemoryBytes: memory?.totalBytes ?? 0,
    availableMemoryBytes: memory?.availableBytes ?? 0,
    reservedMemoryBytes: reservedMemoryBytes(state),
    coreReserveBytes: memory ? coreReserveBytes(memory.totalBytes) : 0,
    waitingStarts: state.waiting.length + state.waitingInProcess.length,
    ...affected,
  };
}

export function criticalPressureVictim<T extends Reservation & { readonly id: number }>(
  active: ReadonlyMap<number, T>,
): T | undefined {
  return [...active.values()].sort(
    (left, right) => right.reservedBytes - left.reservedBytes || right.id - left.id,
  )[0];
}
