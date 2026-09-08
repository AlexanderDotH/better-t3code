import {
  RESOURCE_PROTECTION_MAX_AFFECTED_THREAD_IDS,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ResourceMonitorHostMemory,
  type ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";

import {
  MAX_IN_PROCESS_TURNS_PER_PROVIDER_INSTANCE,
  type InProcessUsage,
  type InProcessWorkAdmissionRequest,
  type ProviderInProcessUsage,
} from "./InProcessWorkAdmission.ts";
import {
  coreReserveBytes,
  reservationBytesForGrowthSamples,
  reservedMemoryBytes,
  type ResourceGovernorStateProjection,
} from "./ResourceGovernorAdmissionState.ts";
import type { ResourceProtectionPolicy } from "./ResourceProtectionPolicy.ts";

const MEASUREMENT_SAMPLE_COUNT = 5;
const MAX_GROWTH_OBSERVATIONS = 64;
const CRITICAL_SAMPLE_COUNT = 2;

export const RESOURCE_GOVERNOR_MAX_WAITING_ADMISSIONS = RESOURCE_PROTECTION_MAX_AFFECTED_THREAD_IDS;

export interface SubagentAdmissionRequest {
  readonly threadId: ThreadId;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly configurationKey: string;
  readonly retention?: {
    readonly kind: "root-turn" | "subagent";
    readonly lifecycleId: string;
  };
}

export interface SubagentLifecycleRequest extends SubagentAdmissionRequest {
  readonly agentId: string;
}

export interface RootTurnLifecycleRequest {
  readonly threadId: ThreadId;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly lifecycleId: string;
}

export interface ResourceGovernorRegisteredProcess {
  readonly threadId: ThreadId;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly exact: boolean;
  readonly currentRssBytes: number;
}

export interface WaitingAdmission extends SubagentAdmissionRequest {
  readonly id: number;
  readonly deferred: Deferred.Deferred<boolean>;
}

export interface ActiveMeasurement extends SubagentAdmissionRequest {
  readonly id: number;
  readonly reservedBytes: number;
  readonly baselineRssBytes: number;
  readonly samples: number;
  readonly initiallyUnknown: boolean;
  readonly measured: boolean;
  readonly agentId: string | undefined;
}

export interface InProcessWorkGrant {
  readonly id: number;
  readonly workId: string;
  readonly reservedBytes: number;
}

export interface WaitingInProcessWork extends InProcessWorkAdmissionRequest {
  readonly id: number;
  readonly reservedBytes: number;
  readonly deferred: Deferred.Deferred<InProcessWorkGrant | undefined>;
}

export interface ActiveInProcessWork extends InProcessWorkAdmissionRequest {
  readonly id: number;
  readonly reservedBytes: number;
}

export interface ResourceGovernorAdmissionQueueState {
  readonly policy: ResourceProtectionPolicy;
  readonly sample: { readonly memory: ResourceMonitorHostMemory } | undefined;
  readonly waiting: ReadonlyArray<WaitingAdmission>;
  readonly active: ReadonlyMap<number, ActiveMeasurement>;
  readonly waitingInProcess: ReadonlyArray<WaitingInProcessWork>;
  readonly activeInProcess: ReadonlyMap<number, ActiveInProcessWork>;
  readonly growthByConfiguration: ReadonlyMap<string, ReadonlyArray<number>>;
  readonly unknownConfigurationsInFlight: ReadonlySet<string>;
  readonly registrations: ReadonlyMap<string, ResourceGovernorRegisteredProcess>;
  readonly suspendedProcessTree: ResourceGovernorStateProjection["suspendedProcessTree"];
  readonly criticalSamples: number;
  readonly healthySamples: number;
}

export function resourceGovernorAdmissionQueueHasCapacity(
  state: Pick<ResourceGovernorAdmissionQueueState, "waiting" | "waitingInProcess">,
): boolean {
  return (
    state.waiting.length + state.waitingInProcess.length < RESOURCE_GOVERNOR_MAX_WAITING_ADMISSIONS
  );
}

export function requestMatchesRegistration(
  request: SubagentAdmissionRequest,
  registration: ResourceGovernorRegisteredProcess,
): boolean {
  return (
    request.threadId === registration.threadId &&
    request.provider === registration.provider &&
    request.providerInstanceId === registration.providerInstanceId
  );
}

export function requestsHaveSameOwner(
  left: Pick<SubagentAdmissionRequest, "threadId" | "provider" | "providerInstanceId">,
  right: Pick<SubagentAdmissionRequest, "threadId" | "provider" | "providerInstanceId">,
): boolean {
  return (
    left.threadId === right.threadId &&
    left.provider === right.provider &&
    left.providerInstanceId === right.providerInstanceId
  );
}

export function requestHasRetention(
  request: SubagentAdmissionRequest,
  retention: NonNullable<SubagentAdmissionRequest["retention"]>,
): boolean {
  return (
    request.retention?.kind === retention.kind &&
    request.retention.lifecycleId === retention.lifecycleId
  );
}

export function requestTreeRss(
  request: SubagentAdmissionRequest,
  registrations: ReadonlyMap<string, ResourceGovernorRegisteredProcess>,
): number {
  let total = 0;
  for (const registration of registrations.values()) {
    if (registration.exact && requestMatchesRegistration(request, registration)) {
      total += registration.currentRssBytes;
    }
  }
  return total;
}

function sameProviderInstance(
  left: Pick<InProcessWorkAdmissionRequest, "provider" | "providerInstanceId">,
  right: Pick<InProcessWorkAdmissionRequest, "provider" | "providerInstanceId">,
): boolean {
  return left.provider === right.provider && left.providerInstanceId === right.providerInstanceId;
}

function activeInProcessCount(
  active: ReadonlyMap<number, ActiveInProcessWork>,
  request: InProcessWorkAdmissionRequest,
): number {
  let count = 0;
  for (const work of active.values()) {
    if (sameProviderInstance(work, request)) count += 1;
  }
  return count;
}

export function drainAdmissions<S extends ResourceGovernorAdmissionQueueState>(
  state: S,
): {
  readonly state: S;
  readonly grantedProcesses: ReadonlyArray<WaitingAdmission>;
  readonly grantedInProcess: ReadonlyArray<WaitingInProcessWork>;
} {
  if (!state.policy.adaptiveAdmission) {
    return {
      state: {
        ...state,
        waiting: [],
        active: new Map(),
        waitingInProcess: [],
        activeInProcess: new Map(),
        unknownConfigurationsInFlight: new Set(),
      },
      grantedProcesses: state.waiting,
      grantedInProcess: state.waitingInProcess.map((candidate) => ({
        ...candidate,
        reservedBytes: 0,
      })),
    };
  }
  if (
    state.sample === undefined ||
    state.suspendedProcessTree !== undefined ||
    state.criticalSamples >= CRITICAL_SAMPLE_COUNT
  ) {
    return { state, grantedProcesses: [], grantedInProcess: [] };
  }

  const waiting = [...state.waiting];
  const waitingInProcess = [...state.waitingInProcess];
  const active = new Map(state.active);
  const activeInProcess = new Map(state.activeInProcess);
  const unknownConfigurationsInFlight = new Set(state.unknownConfigurationsInFlight);
  const grantedProcesses: Array<WaitingAdmission> = [];
  const grantedInProcess: Array<WaitingInProcessWork> = [];
  const reserve = coreReserveBytes(state.sample.memory.totalBytes);
  let reserved = reservedMemoryBytes(state);

  while (waiting.length + waitingInProcess.length > 0) {
    const processCandidate = waiting[0];
    const inProcessCandidate = waitingInProcess[0];
    const processIsNext =
      processCandidate !== undefined &&
      (inProcessCandidate === undefined || processCandidate.id < inProcessCandidate.id);

    if (processIsNext && processCandidate !== undefined) {
      const observations = state.growthByConfiguration.get(processCandidate.configurationKey) ?? [];
      const initiallyUnknown = observations.length === 0;
      if (initiallyUnknown && unknownConfigurationsInFlight.size > 0) break;

      const required = reservationBytesForGrowthSamples(observations);
      if (state.sample.memory.availableBytes - reserve - reserved < required) break;

      waiting.shift();
      grantedProcesses.push(processCandidate);
      reserved += required;
      active.set(processCandidate.id, {
        ...processCandidate,
        reservedBytes: required,
        baselineRssBytes: requestTreeRss(processCandidate, state.registrations),
        samples: 0,
        initiallyUnknown,
        measured: false,
        agentId: undefined,
      });
      if (initiallyUnknown) unknownConfigurationsInFlight.add(processCandidate.configurationKey);
      continue;
    }

    if (inProcessCandidate === undefined) break;
    if (
      activeInProcessCount(activeInProcess, inProcessCandidate) >=
      MAX_IN_PROCESS_TURNS_PER_PROVIDER_INSTANCE
    ) {
      break;
    }
    if (
      state.sample.memory.availableBytes - reserve - reserved <
      inProcessCandidate.reservedBytes
    ) {
      break;
    }

    waitingInProcess.shift();
    grantedInProcess.push(inProcessCandidate);
    reserved += inProcessCandidate.reservedBytes;
    activeInProcess.set(inProcessCandidate.id, inProcessCandidate);
  }

  return {
    state: {
      ...state,
      waiting,
      active,
      waitingInProcess,
      activeInProcess,
      unknownConfigurationsInFlight,
    },
    grantedProcesses,
    grantedInProcess,
  };
}

export function completeMeasurements<S extends ResourceGovernorAdmissionQueueState>(state: S): S {
  const active = new Map(state.active);
  const growthByConfiguration = new Map(state.growthByConfiguration);
  const unknownConfigurationsInFlight = new Set(state.unknownConfigurationsInFlight);

  for (const [id, measurement] of active) {
    if (measurement.measured) continue;
    const hasExactProcessTree = [...state.registrations.values()].some(
      (registration) => registration.exact && requestMatchesRegistration(measurement, registration),
    );
    if (!hasExactProcessTree) continue;

    const samples = measurement.samples + 1;
    if (samples < MEASUREMENT_SAMPLE_COUNT) {
      active.set(id, { ...measurement, samples });
      continue;
    }

    const observedGrowth = Math.max(
      0,
      requestTreeRss(measurement, state.registrations) - measurement.baselineRssBytes,
    );
    const observations = [
      ...(growthByConfiguration.get(measurement.configurationKey) ?? []),
      observedGrowth,
    ].slice(-MAX_GROWTH_OBSERVATIONS);
    growthByConfiguration.set(measurement.configurationKey, observations);
    if (measurement.initiallyUnknown) {
      unknownConfigurationsInFlight.delete(measurement.configurationKey);
    }
    const retainedForLifecycle =
      measurement.retention?.kind === "root-turn" ||
      (measurement.retention?.kind === "subagent" && measurement.agentId !== undefined);
    if (retainedForLifecycle) {
      active.set(id, { ...measurement, samples, measured: true });
      continue;
    }
    active.delete(id);
  }

  return { ...state, active, growthByConfiguration, unknownConfigurationsInFlight };
}

export function removeAdmission<S extends ResourceGovernorAdmissionQueueState>(
  state: S,
  id: number,
): S {
  const waiting = state.waiting.filter((candidate) => candidate.id !== id);
  const measurement = state.active.get(id);
  if (measurement === undefined) {
    return waiting.length === state.waiting.length ? state : { ...state, waiting };
  }

  const active = new Map(state.active);
  active.delete(id);
  const unknownConfigurationsInFlight = new Set(state.unknownConfigurationsInFlight);
  if (measurement.initiallyUnknown) {
    unknownConfigurationsInFlight.delete(measurement.configurationKey);
  }
  return { ...state, waiting, active, unknownConfigurationsInFlight };
}

export function removeInProcessAdmission<S extends ResourceGovernorAdmissionQueueState>(
  state: S,
  id: number,
): S {
  const waitingInProcess = state.waitingInProcess.filter((candidate) => candidate.id !== id);
  if (!state.activeInProcess.has(id)) {
    return waitingInProcess.length === state.waitingInProcess.length
      ? state
      : { ...state, waitingInProcess };
  }

  const activeInProcess = new Map(state.activeInProcess);
  activeInProcess.delete(id);
  return { ...state, waitingInProcess, activeInProcess };
}

export function inProcessUsageSnapshot(state: ResourceGovernorAdmissionQueueState): InProcessUsage {
  const usageByProvider = new Map<string, ProviderInProcessUsage>();
  const entryFor = (work: InProcessWorkAdmissionRequest) => {
    const key = `${work.provider}\u0000${work.providerInstanceId}`;
    const current = usageByProvider.get(key);
    if (current !== undefined) return { key, current };
    return {
      key,
      current: {
        provider: work.provider,
        providerInstanceId: work.providerInstanceId,
        activeCount: 0,
        waitingCount: 0,
        reservedBytes: 0,
      },
    };
  };

  let reservedBytes = 0;
  for (const work of state.activeInProcess.values()) {
    const { key, current } = entryFor(work);
    reservedBytes += work.reservedBytes;
    usageByProvider.set(key, {
      ...current,
      activeCount: current.activeCount + 1,
      reservedBytes: current.reservedBytes + work.reservedBytes,
    });
  }
  for (const work of state.waitingInProcess) {
    const { key, current } = entryFor(work);
    usageByProvider.set(key, { ...current, waitingCount: current.waitingCount + 1 });
  }

  return {
    activeCount: state.activeInProcess.size,
    waitingCount: state.waitingInProcess.length,
    reservedBytes,
    providers: [...usageByProvider.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, usage]) => usage),
  };
}

export function removeMatchingAdmissions<S extends ResourceGovernorAdmissionQueueState>(
  state: S,
  predicate: (admission: SubagentAdmissionRequest) => boolean,
): {
  readonly state: S;
  readonly cancelledWaiters: ReadonlyArray<WaitingAdmission>;
} {
  const cancelledWaiters = state.waiting.filter(predicate);
  const removedIds = [
    ...cancelledWaiters.map((entry) => entry.id),
    ...[...state.active.values()].filter(predicate).map((entry) => entry.id),
  ];
  let next = state;
  for (const id of removedIds) next = removeAdmission(next, id);
  return { state: next, cancelledWaiters };
}
