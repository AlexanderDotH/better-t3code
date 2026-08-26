// @effect-diagnostics nodeBuiltinImport:off - Exact PID fencing requires a final /proc identity check immediately before a POSIX signal.
import * as NodeFS from "node:fs";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";

import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ResourceMonitorHostMemory,
  ResourceProtectionSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as NativeTelemetryClient from "../resourceTelemetry/NativeTelemetryClient.ts";
import { subscribeBeforeSnapshotWithoutMutex } from "../utils/subscribeBeforeSnapshot.ts";
import { constrainHostMemoryToCurrentCgroup } from "./ContainerMemoryBudget.ts";
import {
  MAX_IN_PROCESS_TURNS_PER_PROVIDER_INSTANCE,
  inProcessReservationBytes,
  type InProcessCriticalPressureNotice,
  type InProcessUsage,
  type InProcessWorkAdmissionRequest,
  type InProcessWorkLease,
  type ProviderInProcessUsage,
} from "./InProcessWorkAdmission.ts";
import {
  makeDelegatingProviderProcessTreeController,
  makePosixProviderProcessTreeController,
  type ProviderProcessIdentity,
  type ProviderProcessTreeController,
  type ProviderProcessTreeLease,
} from "./ProviderProcessTreeController.ts";

export const GIBIBYTE = 1024 ** 3;

const MIN_CORE_RESERVE_BYTES = 2 * GIBIBYTE;
const MAX_CORE_RESERVE_BYTES = 6 * GIBIBYTE;
const UNKNOWN_AGENT_RESERVATION_BYTES = 4 * GIBIBYTE;
const MEASUREMENT_SAMPLE_COUNT = 5;
const PROJECTION_WINDOW_SECONDS = 5;
const CRITICAL_SAMPLE_COUNT = 2;
const HEALTHY_SAMPLE_COUNT = 5;
const MAX_GROWTH_OBSERVATIONS = 64;

export interface ResourceGovernorProcessSample {
  readonly pid: number;
  readonly ppid: number;
  readonly startTimeMs: number;
  readonly residentBytes: number;
}

export interface ResourceGovernorSample {
  readonly sampledAtMs: number;
  readonly memory: ResourceMonitorHostMemory;
  readonly processes: ReadonlyArray<ResourceGovernorProcessSample>;
}

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

export interface ProviderProcessRegistration {
  readonly threadId: ThreadId;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly pid: number;
  readonly startTimeMs?: number;
}

interface RegisteredProviderProcess extends Omit<ProviderProcessRegistration, "startTimeMs"> {
  readonly startTimeMs: number | undefined;
  readonly key: string;
  readonly exact: boolean;
  readonly currentRssBytes: number;
  readonly growthBytesPerSecond: number;
  readonly sampledAtMs: number | undefined;
  readonly processIdentities: ReadonlyArray<ProviderProcessIdentity>;
}

interface WaitingAdmission extends SubagentAdmissionRequest {
  readonly id: number;
  readonly deferred: Deferred.Deferred<boolean>;
}

interface ActiveMeasurement extends SubagentAdmissionRequest {
  readonly id: number;
  readonly reservedBytes: number;
  readonly baselineRssBytes: number;
  readonly samples: number;
  readonly initiallyUnknown: boolean;
  readonly measured: boolean;
  readonly agentId: string | undefined;
}

interface InProcessWorkGrant {
  readonly id: number;
  readonly workId: string;
  readonly reservedBytes: number;
}

interface WaitingInProcessWork extends InProcessWorkAdmissionRequest {
  readonly id: number;
  readonly reservedBytes: number;
  readonly deferred: Deferred.Deferred<InProcessWorkGrant | undefined>;
}

interface ActiveInProcessWork extends InProcessWorkAdmissionRequest {
  readonly id: number;
  readonly reservedBytes: number;
}

interface SuspendedProviderProcessTree extends ProviderProcessTreeLease {
  readonly registrationKey: string;
  readonly threadId: ThreadId;
  readonly suspendConfirmed: boolean;
  readonly resumeRequired: boolean;
}

interface GovernorState {
  readonly nextAdmissionId: number;
  readonly sample: ResourceGovernorSample | undefined;
  readonly waiting: ReadonlyArray<WaitingAdmission>;
  readonly active: ReadonlyMap<number, ActiveMeasurement>;
  readonly waitingInProcess: ReadonlyArray<WaitingInProcessWork>;
  readonly activeInProcess: ReadonlyMap<number, ActiveInProcessWork>;
  readonly growthByConfiguration: ReadonlyMap<string, ReadonlyArray<number>>;
  readonly unknownConfigurationsInFlight: ReadonlySet<string>;
  readonly registrations: ReadonlyMap<string, RegisteredProviderProcess>;
  readonly suspendedProcessTree: SuspendedProviderProcessTree | undefined;
  readonly criticalSamples: number;
  readonly healthySamples: number;
}

export interface SubagentResourceGovernorOptions {
  readonly processTreeController?: ProviderProcessTreeController;
  readonly createProcessTreeLeaseId?: () => string;
  readonly signalProcess?: (
    identity: { readonly pid: number; readonly startTimeMs: number },
    signal: "SIGSTOP" | "SIGCONT",
  ) => Effect.Effect<void, ProviderProcessSignalError>;
}

export class ProviderProcessSignalError extends Schema.TaggedErrorClass<ProviderProcessSignalError>()(
  "ProviderProcessSignalError",
  {
    pid: Schema.Number,
    signal: Schema.Literals(["SIGSTOP", "SIGCONT"]),
    cause: Schema.Defect(),
  },
) {}

const encodeResourceConfigurationKey = Schema.encodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown),
);

export function resourceConfigurationKey(input: unknown): string {
  return `sha256:${NodeCrypto.createHash("sha256").update(encodeResourceConfigurationKey(input)).digest("hex")}`;
}

export class SubagentResourceGovernor extends Context.Service<
  SubagentResourceGovernor,
  {
    readonly awaitAdmission: (request: SubagentAdmissionRequest) => Effect.Effect<boolean>;
    readonly acquireInProcessLease: (
      request: InProcessWorkAdmissionRequest,
    ) => Effect.Effect<InProcessWorkLease | undefined>;
    readonly confirmSubagent: (request: SubagentLifecycleRequest) => Effect.Effect<void>;
    readonly releaseSubagent: (
      request: Omit<SubagentLifecycleRequest, "configurationKey">,
    ) => Effect.Effect<void>;
    readonly releaseRootTurn: (request: RootTurnLifecycleRequest) => Effect.Effect<void>;
    readonly observe: (sample: ResourceGovernorSample) => Effect.Effect<void>;
    readonly telemetryUnavailable: Effect.Effect<void>;
    readonly registerProviderProcess: (
      registration: ProviderProcessRegistration,
    ) => Effect.Effect<void>;
    readonly unregisterProviderProcess: (
      identity: Pick<ProviderProcessRegistration, "pid" | "startTimeMs">,
    ) => Effect.Effect<void>;
    readonly cancelThread: (threadId: ThreadId) => Effect.Effect<void>;
    readonly shutdown: Effect.Effect<void>;
    readonly latest: Effect.Effect<ResourceProtectionSnapshot>;
    readonly inProcessUsage: Effect.Effect<InProcessUsage>;
    readonly changes: Stream.Stream<ResourceProtectionSnapshot>;
    readonly monitoringDemand: Stream.Stream<boolean>;
    readonly subscribe: Effect.Effect<
      {
        readonly latest: ResourceProtectionSnapshot;
        readonly changes: Stream.Stream<ResourceProtectionSnapshot>;
      },
      never,
      Scope.Scope
    >;
  }
>()("t3/resourceProtection/SubagentResourceGovernor") {}

export function coreReserveBytes(totalBytes: number): number {
  return Math.min(
    MAX_CORE_RESERVE_BYTES,
    Math.max(MIN_CORE_RESERVE_BYTES, Math.ceil(totalBytes * 0.2)),
  );
}

export function reservationBytesForGrowthSamples(samples: ReadonlyArray<number>): number {
  if (samples.length === 0) return UNKNOWN_AGENT_RESERVATION_BYTES;
  const sorted = [...samples].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return Math.max(UNKNOWN_AGENT_RESERVATION_BYTES, Math.ceil((sorted[p95Index] ?? 0) * 1.25));
}

function registrationKey(input: Pick<ProviderProcessRegistration, "pid" | "startTimeMs">) {
  const normalizedStartTimeMs =
    input.startTimeMs === undefined ? "pending" : Math.floor(input.startTimeMs / 1_000) * 1_000;
  return `${input.pid}:${normalizedStartTimeMs}`;
}

function sameProcessStartTime(left: number, right: number): boolean {
  return Math.floor(left / 1_000) === Math.floor(right / 1_000);
}

function requestMatchesRegistration(
  request: SubagentAdmissionRequest,
  registration: RegisteredProviderProcess,
): boolean {
  return (
    request.threadId === registration.threadId &&
    request.provider === registration.provider &&
    request.providerInstanceId === registration.providerInstanceId
  );
}

function requestsHaveSameOwner(
  left: Pick<SubagentAdmissionRequest, "threadId" | "provider" | "providerInstanceId">,
  right: Pick<SubagentAdmissionRequest, "threadId" | "provider" | "providerInstanceId">,
): boolean {
  return (
    left.threadId === right.threadId &&
    left.provider === right.provider &&
    left.providerInstanceId === right.providerInstanceId
  );
}

function requestHasRetention(
  request: SubagentAdmissionRequest,
  retention: NonNullable<SubagentAdmissionRequest["retention"]>,
): boolean {
  return (
    request.retention?.kind === retention.kind &&
    request.retention.lifecycleId === retention.lifecycleId
  );
}

function requestTreeRss(
  request: SubagentAdmissionRequest,
  registrations: ReadonlyMap<string, RegisteredProviderProcess>,
): number {
  let total = 0;
  for (const registration of registrations.values()) {
    if (registration.exact && requestMatchesRegistration(request, registration)) {
      total += registration.currentRssBytes;
    }
  }
  return total;
}

function providerTreeRss(
  registration: { readonly pid: number; readonly startTimeMs: number | undefined },
  processes: ReadonlyArray<ResourceGovernorProcessSample>,
): {
  readonly exact: boolean;
  readonly residentBytes: number;
  readonly startTimeMs: number | undefined;
  readonly processIdentities: ReadonlyArray<ProviderProcessIdentity>;
} {
  const processByPid = new Map(processes.map((process) => [process.pid, process]));
  const root = processByPid.get(registration.pid);
  if (
    !root ||
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
  const queue = [root];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const process = queue.shift();
    if (!process) continue;
    const identity = `${process.pid}:${process.startTimeMs}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    residentBytes += process.residentBytes;
    processIdentities.push({ pid: process.pid, startTimeMs: process.startTimeMs });
    for (const child of childrenByParent.get(process.pid) ?? []) {
      if (child.startTimeMs >= process.startTimeMs) queue.push(child);
    }
  }
  return { exact: true, residentBytes, startTimeMs: root.startTimeMs, processIdentities };
}

function reservedMemoryBytes(state: GovernorState): number {
  let total = 0;
  for (const measurement of state.active.values()) total += measurement.reservedBytes;
  for (const work of state.activeInProcess.values()) total += work.reservedBytes;
  return total;
}

function monitoringRequired(state: GovernorState): boolean {
  return (
    state.waiting.length > 0 ||
    state.active.size > 0 ||
    state.waitingInProcess.length > 0 ||
    state.activeInProcess.size > 0 ||
    state.registrations.size > 0 ||
    state.suspendedProcessTree !== undefined
  );
}

function affectedThreadIds(state: GovernorState): ReadonlyArray<ThreadId> {
  const affected = new Set<ThreadId>(state.waiting.map((waiter) => waiter.threadId));
  for (const waiter of state.waitingInProcess) affected.add(waiter.threadId);
  if (state.suspendedProcessTree) affected.add(state.suspendedProcessTree.threadId);
  return [...affected];
}

function protectionSnapshot(state: GovernorState): ResourceProtectionSnapshot {
  const memory = state.sample?.memory;
  const suspension = state.suspendedProcessTree;
  const recovering =
    suspension !== undefined && (!suspension.suspendConfirmed || state.healthySamples > 0);
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
    affectedThreadIds: affectedThreadIds(state),
  };
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

function drainAdmissions(state: GovernorState): {
  readonly state: GovernorState;
  readonly grantedProcesses: ReadonlyArray<WaitingAdmission>;
  readonly grantedInProcess: ReadonlyArray<WaitingInProcessWork>;
} {
  if (
    !state.sample ||
    state.suspendedProcessTree ||
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

    if (processIsNext && processCandidate) {
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
      if (initiallyUnknown) {
        unknownConfigurationsInFlight.add(processCandidate.configurationKey);
      }
      continue;
    }

    if (!inProcessCandidate) break;
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

function completeMeasurements(state: GovernorState): GovernorState {
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
    } else {
      active.delete(id);
    }
  }

  return { ...state, active, growthByConfiguration, unknownConfigurationsInFlight };
}

function removeAdmission(state: GovernorState, id: number): GovernorState {
  const waiting = state.waiting.filter((candidate) => candidate.id !== id);
  const measurement = state.active.get(id);
  if (!measurement) return waiting === state.waiting ? state : { ...state, waiting };

  const active = new Map(state.active);
  active.delete(id);
  const unknownConfigurationsInFlight = new Set(state.unknownConfigurationsInFlight);
  if (measurement.initiallyUnknown) {
    unknownConfigurationsInFlight.delete(measurement.configurationKey);
  }
  return { ...state, waiting, active, unknownConfigurationsInFlight };
}

function removeInProcessAdmission(state: GovernorState, id: number): GovernorState {
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

function inProcessUsageSnapshot(state: GovernorState): InProcessUsage {
  const usageByProvider = new Map<string, ProviderInProcessUsage>();
  const entryFor = (work: InProcessWorkAdmissionRequest) => {
    const key = `${work.provider}\u0000${work.providerInstanceId}`;
    const current = usageByProvider.get(key);
    if (current) return { key, current };
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

function criticalPressureVictim(
  active: ReadonlyMap<number, ActiveInProcessWork>,
): ActiveInProcessWork | undefined {
  return [...active.values()].sort(
    (left, right) => right.reservedBytes - left.reservedBytes || right.id - left.id,
  )[0];
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
          Math.floor(actualStartTimeMs / 1_000) === Math.floor(identity.startTimeMs / 1_000);
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

function removeMatchingAdmissions(
  state: GovernorState,
  predicate: (admission: SubagentAdmissionRequest) => boolean,
): {
  readonly state: GovernorState;
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

export const makeSubagentResourceGovernor = Effect.fnUntraced(function* (
  options: SubagentResourceGovernorOptions = {},
) {
  const hostPlatform = yield* HostProcessPlatform;
  const signalProcess = options.signalProcess ?? makeExactProcessSignaler({ hostPlatform });
  const processTreeController =
    options.processTreeController ?? makePosixProviderProcessTreeController(signalProcess);
  const createProcessTreeLeaseId = options.createProcessTreeLeaseId ?? NodeCrypto.randomUUID;
  const stateRef = yield* Ref.make<GovernorState>({
    nextAdmissionId: 1,
    sample: undefined,
    waiting: [],
    active: new Map(),
    waitingInProcess: [],
    activeInProcess: new Map(),
    growthByConfiguration: new Map(),
    unknownConfigurationsInFlight: new Set(),
    registrations: new Map(),
    suspendedProcessTree: undefined,
    criticalSamples: 0,
    healthySamples: 0,
  });
  const latestRef = yield* Ref.make<ResourceProtectionSnapshot>(
    protectionSnapshot(yield* Ref.get(stateRef)),
  );
  const changes = yield* PubSub.sliding<ResourceProtectionSnapshot>(1);
  const monitoringDemandChanges = yield* PubSub.sliding<boolean>(1);
  const mutex = yield* Semaphore.make(1);

  const publish = (state: GovernorState) => {
    const snapshot = protectionSnapshot(state);
    return Ref.set(latestRef, snapshot).pipe(
      Effect.andThen(PubSub.publish(changes, snapshot)),
      Effect.andThen(PubSub.publish(monitoringDemandChanges, monitoringRequired(state))),
    );
  };

  const resumeSuspendedProcessTree = Effect.fnUntraced(function* (state: GovernorState) {
    const suspended = state.suspendedProcessTree;
    if (!suspended) return { state, resumed: true } as const;

    const resumed = yield* processTreeController
      .resume(suspended)
      .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    if (!resumed) {
      return {
        state: {
          ...state,
          suspendedProcessTree: { ...suspended, resumeRequired: true },
          criticalSamples: 0,
          healthySamples: 0,
        },
        resumed: false,
      } as const;
    }

    return {
      state: {
        ...state,
        suspendedProcessTree: undefined,
        criticalSamples: 0,
        healthySamples: 0,
      },
      resumed: true,
    } as const;
  });

  const commitAdmissions = Effect.fnUntraced(function* (state: GovernorState) {
    const drained = drainAdmissions(state);
    yield* Ref.set(stateRef, drained.state);
    yield* publish(drained.state);
    yield* Effect.forEach(
      drained.grantedProcesses,
      (admission) => Deferred.succeed(admission.deferred, true),
      { discard: true },
    );
    yield* Effect.forEach(
      drained.grantedInProcess,
      (admission) =>
        Deferred.succeed(admission.deferred, {
          id: admission.id,
          workId: admission.workId,
          reservedBytes: admission.reservedBytes,
        }),
      { discard: true },
    );
  });

  const cancelAdmission = (id: number) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        yield* commitAdmissions(removeAdmission(current, id));
      }),
    );

  const releaseInProcessLease = (id: number) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        yield* commitAdmissions(removeInProcessAdmission(current, id));
      }),
    );

  const acquireInProcessLease = (request: InProcessWorkAdmissionRequest) =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<InProcessWorkGrant | undefined>();
      const id = yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(stateRef);
          const admissionId = current.nextAdmissionId;
          yield* commitAdmissions({
            ...current,
            nextAdmissionId: admissionId + 1,
            waitingInProcess: [
              ...current.waitingInProcess,
              {
                ...request,
                id: admissionId,
                reservedBytes: inProcessReservationBytes(request.reservation),
                deferred,
              },
            ],
          });
          return admissionId;
        }),
      );
      const grant = yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() => releaseInProcessLease(id)),
      );
      if (!grant) return undefined;
      return {
        workId: grant.workId,
        reservedBytes: grant.reservedBytes,
        release: releaseInProcessLease(grant.id),
      } satisfies InProcessWorkLease;
    });

  const awaitAdmission = (request: SubagentAdmissionRequest) =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<boolean>();
      const result = yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(stateRef);
          const retention = request.retention;
          if (
            retention &&
            [...current.active.values()].some(
              (admission) =>
                requestsHaveSameOwner(admission, request) &&
                requestHasRetention(admission, retention),
            )
          ) {
            return { _tag: "AlreadyAdmitted" } as const;
          }
          const id = current.nextAdmissionId;
          yield* commitAdmissions({
            ...current,
            nextAdmissionId: id + 1,
            waiting: [...current.waiting, { ...request, id, deferred }],
          });
          return { _tag: "Waiting", id } as const;
        }),
      );
      if (result._tag === "AlreadyAdmitted") return true;
      return yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() => cancelAdmission(result.id)),
      );
    });

  const confirmSubagent = (request: SubagentLifecycleRequest) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        if (
          [...current.active.values()].some(
            (admission) =>
              requestsHaveSameOwner(admission, request) && admission.agentId === request.agentId,
          )
        ) {
          return;
        }

        const active = new Map(current.active);
        const pending = [...active.values()]
          .filter(
            (admission) =>
              requestsHaveSameOwner(admission, request) &&
              admission.configurationKey === request.configurationKey &&
              admission.retention?.kind === "subagent" &&
              admission.agentId === undefined,
          )
          .sort((left, right) => left.id - right.id)[0];
        if (pending) {
          active.set(pending.id, { ...pending, agentId: request.agentId });
          yield* commitAdmissions({ ...current, active });
          return;
        }

        const observations = current.growthByConfiguration.get(request.configurationKey) ?? [];
        const initiallyUnknown = observations.length === 0;
        const id = current.nextAdmissionId;
        active.set(id, {
          ...request,
          retention: { kind: "subagent", lifecycleId: request.agentId },
          id,
          reservedBytes: reservationBytesForGrowthSamples(observations),
          baselineRssBytes: requestTreeRss(request, current.registrations),
          samples: 0,
          initiallyUnknown,
          measured: false,
          agentId: request.agentId,
        });
        const unknownConfigurationsInFlight = new Set(current.unknownConfigurationsInFlight);
        if (initiallyUnknown) unknownConfigurationsInFlight.add(request.configurationKey);
        yield* commitAdmissions({
          ...current,
          nextAdmissionId: id + 1,
          active,
          unknownConfigurationsInFlight,
        });
      }),
    );

  const releaseSubagent = (request: Omit<SubagentLifecycleRequest, "configurationKey">) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        const ids = [...current.active.values()]
          .filter(
            (admission) =>
              requestsHaveSameOwner(admission, request) && admission.agentId === request.agentId,
          )
          .map((admission) => admission.id);
        let next = current;
        for (const id of ids) next = removeAdmission(next, id);
        yield* commitAdmissions(next);
      }),
    );

  const releaseRootTurn = (request: RootTurnLifecycleRequest) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        const removed = removeMatchingAdmissions(
          current,
          (admission) =>
            requestsHaveSameOwner(admission, request) &&
            requestHasRetention(admission, {
              kind: "root-turn",
              lifecycleId: request.lifecycleId,
            }),
        );
        yield* commitAdmissions(removed.state);
        yield* Effect.forEach(
          removed.cancelledWaiters,
          (waiter) => Deferred.succeed(waiter.deferred, false),
          { discard: true },
        );
      }),
    );

  const observe = (sample: ResourceGovernorSample) =>
    Effect.gen(function* () {
      const cancellation = yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          let current = yield* Ref.get(stateRef);
          if (current.suspendedProcessTree?.resumeRequired) {
            const pendingResume = yield* resumeSuspendedProcessTree(current);
            if (!pendingResume.resumed) {
              yield* commitAdmissions({ ...pendingResume.state, sample: undefined });
              return undefined;
            }
            current = pendingResume.state;
          }
          const registrations = new Map<string, RegisteredProviderProcess>();
          for (const [key, registration] of current.registrations) {
            const tree = providerTreeRss(registration, sample.processes);
            const nextKey =
              tree.startTimeMs === undefined
                ? key
                : registrationKey({ pid: registration.pid, startTimeMs: tree.startTimeMs });
            const elapsedMs =
              registration.sampledAtMs === undefined
                ? 0
                : Math.max(0, sample.sampledAtMs - registration.sampledAtMs);
            const growthBytesPerSecond =
              tree.exact && registration.exact && elapsedMs > 0
                ? Math.max(0, tree.residentBytes - registration.currentRssBytes) /
                  (elapsedMs / 1_000)
                : 0;
            registrations.set(nextKey, {
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

          let next: GovernorState = completeMeasurements({ ...current, sample, registrations });
          const exactRegistrations = [...registrations.values()].filter(
            (registration) => registration.exact,
          );
          const fastest = exactRegistrations.sort(
            (left, right) => right.growthBytesPerSecond - left.growthBytesPerSecond,
          )[0];
          const projectedGrowthBytes = exactRegistrations.reduce(
            (total, registration) => total + registration.growthBytesPerSecond,
            0,
          );
          const projectedAvailableBytes =
            sample.memory.availableBytes - projectedGrowthBytes * PROJECTION_WINDOW_SECONDS;
          const critical = projectedAvailableBytes < coreReserveBytes(sample.memory.totalBytes);

          if (next.suspendedProcessTree) {
            const paused = registrations.get(next.suspendedProcessTree.registrationKey);
            if (!paused?.exact || paused.startTimeMs === undefined) {
              const resumed = yield* resumeSuspendedProcessTree({
                ...next,
                suspendedProcessTree: { ...next.suspendedProcessTree, resumeRequired: true },
              });
              next = resumed.state;
            } else if (critical) {
              next = { ...next, criticalSamples: 0, healthySamples: 0 };
            } else {
              const healthySamples = next.healthySamples + 1;
              if (healthySamples >= HEALTHY_SAMPLE_COUNT) {
                const resumed = yield* resumeSuspendedProcessTree({
                  ...next,
                  suspendedProcessTree: { ...next.suspendedProcessTree, resumeRequired: true },
                });
                next = resumed.state;
              } else {
                next = { ...next, healthySamples };
              }
            }
          } else if (critical) {
            const criticalSamples = next.criticalSamples + 1;
            next = { ...next, criticalSamples, healthySamples: 0 };
            const victim =
              criticalSamples >= CRITICAL_SAMPLE_COUNT
                ? criticalPressureVictim(next.activeInProcess)
                : undefined;
            let pressureCancellation:
              | {
                  readonly work: ActiveInProcessWork;
                  readonly notice: InProcessCriticalPressureNotice;
                }
              | undefined;
            if (victim) {
              next = removeInProcessAdmission(next, victim.id);
              pressureCancellation = {
                work: victim,
                notice: {
                  reason: "critical-memory-pressure",
                  workId: victim.workId,
                  reservedBytes: victim.reservedBytes,
                  sampledAtMs: sample.sampledAtMs,
                  availableMemoryBytes: sample.memory.availableBytes,
                  coreReserveBytes: coreReserveBytes(sample.memory.totalBytes),
                },
              };
            } else if (
              criticalSamples >= CRITICAL_SAMPLE_COUNT &&
              fastest &&
              fastest.startTimeMs !== undefined &&
              fastest.growthBytesPerSecond > 0 &&
              fastest.processIdentities[0] !== undefined
            ) {
              const [rootIdentity, ...descendantIdentities] = fastest.processIdentities;
              const lease: ProviderProcessTreeLease = {
                leaseId: createProcessTreeLeaseId(),
                processIdentities: [rootIdentity, ...descendantIdentities],
              };
              const suspension = yield* processTreeController.suspend(lease).pipe(Effect.result);
              if (Result.isSuccess(suspension)) {
                next = {
                  ...next,
                  suspendedProcessTree: {
                    ...lease,
                    registrationKey: fastest.key,
                    threadId: fastest.threadId,
                    suspendConfirmed: true,
                    resumeRequired: false,
                  },
                  criticalSamples: 0,
                  healthySamples: 0,
                };
              } else if (suspension.failure.resumeRequired) {
                const compensated = yield* processTreeController
                  .resume(lease)
                  .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
                if (!compensated) {
                  next = {
                    ...next,
                    suspendedProcessTree: {
                      ...lease,
                      registrationKey: fastest.key,
                      threadId: fastest.threadId,
                      suspendConfirmed: false,
                      resumeRequired: true,
                    },
                    criticalSamples: 0,
                    healthySamples: 0,
                  };
                }
              }
            }
            yield* commitAdmissions(next);
            return pressureCancellation;
          } else {
            next = { ...next, criticalSamples: 0, healthySamples: 0 };
          }

          yield* commitAdmissions(next);
          return undefined;
        }),
      );
      if (!cancellation) return;
      yield* Effect.suspend(() => cancellation.work.onCriticalPressure(cancellation.notice)).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("in-process work cancellation callback failed", {
            workId: cancellation.work.workId,
            cause,
          }),
        ),
      );
    });

  const telemetryUnavailable = mutex.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      const pendingResume = current.suspendedProcessTree
        ? yield* resumeSuspendedProcessTree({
            ...current,
            suspendedProcessTree: { ...current.suspendedProcessTree, resumeRequired: true },
          })
        : { state: current, resumed: true as const };
      const next = {
        ...pendingResume.state,
        sample: undefined,
        criticalSamples: 0,
        healthySamples: 0,
      };
      yield* Ref.set(stateRef, next);
      yield* publish(next);
    }),
  );

  const registerProviderProcess = (registration: ProviderProcessRegistration) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        const resolvedStartTimeMs =
          registration.startTimeMs ?? providerProcessStartTimeMs(registration.pid, hostPlatform);
        const key = registrationKey({
          pid: registration.pid,
          ...(resolvedStartTimeMs === undefined ? {} : { startTimeMs: resolvedStartTimeMs }),
        });
        const registrations = new Map(current.registrations);
        registrations.set(key, {
          ...registration,
          startTimeMs: resolvedStartTimeMs,
          key,
          exact: false,
          currentRssBytes: 0,
          growthBytesPerSecond: 0,
          sampledAtMs: undefined,
          processIdentities: [],
        });
        yield* commitAdmissions({ ...current, registrations });
      }),
    );

  const unregisterProviderProcess = (
    identity: Pick<ProviderProcessRegistration, "pid" | "startTimeMs">,
  ) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        const key =
          identity.startTimeMs === undefined
            ? [...current.registrations].find(([, value]) => value.pid === identity.pid)?.[0]
            : registrationKey(identity);
        if (!key) return;
        const registration = current.registrations.get(key);
        const suspendedProcessTree = current.suspendedProcessTree;
        const removingSuspendedTree = suspendedProcessTree?.registrationKey === key;
        const pendingResume =
          removingSuspendedTree && suspendedProcessTree
            ? yield* resumeSuspendedProcessTree({
                ...current,
                suspendedProcessTree: {
                  ...suspendedProcessTree,
                  resumeRequired: true,
                },
              })
            : { state: current, resumed: true as const };
        const registrations = new Map(pendingResume.state.registrations);
        registrations.delete(key);
        let next: GovernorState = {
          ...pendingResume.state,
          registrations,
          healthySamples: removingSuspendedTree ? 0 : current.healthySamples,
        };
        let cancelledWaiters: ReadonlyArray<WaitingAdmission> = [];
        if (
          registration &&
          ![...registrations.values()].some(
            (candidate) =>
              candidate.threadId === registration.threadId &&
              candidate.provider === registration.provider &&
              candidate.providerInstanceId === registration.providerInstanceId,
          )
        ) {
          const removed = removeMatchingAdmissions(
            next,
            (admission) =>
              admission.threadId === registration.threadId &&
              admission.provider === registration.provider &&
              admission.providerInstanceId === registration.providerInstanceId,
          );
          next = removed.state;
          cancelledWaiters = removed.cancelledWaiters;
        }
        yield* commitAdmissions(next);
        yield* Effect.forEach(
          cancelledWaiters,
          (waiter) => Deferred.succeed(waiter.deferred, false),
          { discard: true },
        );
      }),
    );

  const cancelThread = (threadId: ThreadId) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        const registrationEntries = [...current.registrations].filter(
          ([, registration]) => registration.threadId === threadId,
        );
        const suspendedProcessTree = current.suspendedProcessTree;
        const removingSuspendedTree = registrationEntries.some(
          ([key]) => key === suspendedProcessTree?.registrationKey,
        );
        const pendingResume =
          removingSuspendedTree && suspendedProcessTree
            ? yield* resumeSuspendedProcessTree({
                ...current,
                suspendedProcessTree: {
                  ...suspendedProcessTree,
                  resumeRequired: true,
                },
              })
            : { state: current, resumed: true as const };
        const registrations = new Map(pendingResume.state.registrations);
        for (const [key] of registrationEntries) registrations.delete(key);
        const removed = removeMatchingAdmissions(
          { ...pendingResume.state, registrations },
          (admission) => admission.threadId === threadId,
        );
        const cancelledInProcessWaiters = removed.state.waitingInProcess.filter(
          (work) => work.threadId === threadId,
        );
        const inProcessIds = [
          ...cancelledInProcessWaiters.map((work) => work.id),
          ...[...removed.state.activeInProcess.values()]
            .filter((work) => work.threadId === threadId)
            .map((work) => work.id),
        ];
        let next = removed.state;
        for (const id of inProcessIds) next = removeInProcessAdmission(next, id);
        yield* commitAdmissions({
          ...next,
          healthySamples: 0,
        });
        yield* Effect.forEach(
          removed.cancelledWaiters,
          (waiter) => Deferred.succeed(waiter.deferred, false),
          { discard: true },
        );
        yield* Effect.forEach(
          cancelledInProcessWaiters,
          (waiter) => Deferred.succeed(waiter.deferred, undefined),
          { discard: true },
        );
      }),
    );

  const shutdown = mutex.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      let resumedState = current;
      if (current.suspendedProcessTree) {
        const firstResume = yield* resumeSuspendedProcessTree({
          ...current,
          suspendedProcessTree: { ...current.suspendedProcessTree, resumeRequired: true },
        });
        resumedState = firstResume.state;
        if (!firstResume.resumed) {
          resumedState = (yield* resumeSuspendedProcessTree(firstResume.state)).state;
        }
      }
      const stopped: GovernorState = {
        ...resumedState,
        sample: undefined,
        waiting: [],
        active: new Map(),
        waitingInProcess: [],
        activeInProcess: new Map(),
        unknownConfigurationsInFlight: new Set(),
        registrations: new Map(),
        criticalSamples: 0,
        healthySamples: 0,
      };
      yield* Ref.set(stateRef, stopped);
      yield* publish(stopped);
      yield* Effect.forEach(current.waiting, (waiter) => Deferred.succeed(waiter.deferred, false), {
        discard: true,
      });
      yield* Effect.forEach(
        current.waitingInProcess,
        (waiter) => Deferred.succeed(waiter.deferred, undefined),
        { discard: true },
      );
      yield* PubSub.shutdown(changes);
      yield* PubSub.shutdown(monitoringDemandChanges);
    }),
  );

  return SubagentResourceGovernor.of({
    awaitAdmission,
    acquireInProcessLease,
    confirmSubagent,
    releaseSubagent,
    releaseRootTurn,
    observe,
    telemetryUnavailable,
    registerProviderProcess,
    unregisterProviderProcess,
    cancelThread,
    shutdown,
    latest: Ref.get(latestRef),
    inProcessUsage: Ref.get(stateRef).pipe(Effect.map(inProcessUsageSnapshot)),
    changes: Stream.fromPubSub(changes),
    monitoringDemand: Stream.concat(
      Stream.make(false),
      Stream.fromPubSub(monitoringDemandChanges),
    ).pipe(Stream.changes),
    subscribe: subscribeBeforeSnapshotWithoutMutex(changes, Ref.get(latestRef)),
  });
});

const makeScopedSubagentResourceGovernor = (options: SubagentResourceGovernorOptions = {}) =>
  Effect.acquireRelease(makeSubagentResourceGovernor(options), (governor) => governor.shutdown);

export const layer = Layer.effect(SubagentResourceGovernor, makeScopedSubagentResourceGovernor());

export const layerLive = Layer.effect(
  SubagentResourceGovernor,
  Effect.gen(function* () {
    const nativeTelemetry = yield* NativeTelemetryClient.NativeTelemetryClient;
    const hostPlatform = yield* HostProcessPlatform;
    const governor = yield* makeScopedSubagentResourceGovernor(
      hostPlatform === "win32"
        ? {
            processTreeController: makeDelegatingProviderProcessTreeController({
              suspendProcessTree: nativeTelemetry.suspendProcessTree,
              resumeProcessTree: nativeTelemetry.resumeProcessTree,
            }),
          }
        : {},
    );
    yield* Stream.unwrap(
      Effect.map(nativeTelemetry.subscribeHealth, ({ latest, changes }) =>
        Stream.concat(Stream.make(latest), changes),
      ),
    ).pipe(
      Stream.filter((health) => health.status !== "healthy"),
      Stream.runForEach(() => governor.telemetryUnavailable),
      Effect.forkScoped,
    );
    yield* governor.monitoringDemand.pipe(
      Stream.switchMap((active) =>
        active ? nativeTelemetry.resourceProtectionSnapshots : Stream.empty,
      ),
      Stream.runForEach(({ snapshot }) =>
        governor.observe({
          sampledAtMs: snapshot.sampledAtUnixMs,
          memory: constrainHostMemoryToCurrentCgroup(snapshot.memory),
          processes: snapshot.processes,
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logError("resource protection telemetry stream stopped", { cause }),
      ),
      Effect.forkScoped,
    );
    return governor;
  }),
);
