import * as NodeCrypto from "node:crypto";

import type {
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
import { ServerSettingsService } from "../serverSettings.ts";
import { subscribeBeforeSnapshotWithoutMutex } from "../utils/subscribeBeforeSnapshot.ts";
import {
  createRegisteredProviderProcess,
  makeExactProcessSignaler,
  providerProcessRegistrationKey,
  ProviderProcessSignalError,
  providerProcessStartTimeMs,
  refreshRegisteredProviderProcesses,
  type ProviderProcessRegistration,
  type RegisteredProviderProcess,
  type ResourceGovernorProcessSample,
} from "./ProviderProcessInventory.ts";
import {
  type InProcessCriticalPressureNotice,
  type InProcessUsage,
  type InProcessWorkAdmissionRequest,
  type InProcessWorkLease,
} from "./InProcessWorkAdmission.ts";
import {
  type ActiveInProcessWork,
  type ActiveMeasurement,
  completeMeasurements,
  drainAdmissions,
  inProcessUsageSnapshot,
  removeInProcessAdmission,
  removeMatchingAdmissions,
  type RootTurnLifecycleRequest,
  type SubagentAdmissionRequest,
  type SubagentLifecycleRequest,
  type WaitingAdmission,
  type WaitingInProcessWork,
} from "./ResourceGovernorAdmissionQueue.ts";
import {
  coreReserveBytes,
  criticalPressureVictim,
  monitoringRequired,
  protectionSnapshot,
  resourcePressureProjection,
} from "./ResourceGovernorAdmissionState.ts";
import { makeResourceGovernorAdmissionCoordinator } from "./ResourceGovernorAdmissionCoordinator.ts";
import {
  makeDelegatingProviderProcessTreeController,
  makePosixProviderProcessTreeController,
  type ProviderProcessTreeController,
  type ProviderProcessTreeLease,
} from "./ProviderProcessTreeController.ts";
import {
  DEFAULT_RESOURCE_PROTECTION_POLICY,
  resolveResourceProtectionPolicy,
  type ResourceProtectionPolicy,
} from "./ResourceProtectionPolicy.ts";
import { attachResourceProtectionRuntime } from "./ResourceProtectionRuntime.ts";

export {
  coreReserveBytes,
  GIBIBYTE,
  reservationBytesForGrowthSamples,
} from "./ResourceGovernorAdmissionState.ts";
export {
  createRegisteredProviderProcess,
  makeExactProcessSignaler,
  providerProcessRegistrationKey,
  ProviderProcessSignalError,
  providerProcessStartTimeMs,
  refreshRegisteredProviderProcesses,
  type ProviderProcessRegistration,
  type ResourceGovernorProcessSample,
} from "./ProviderProcessInventory.ts";
export type {
  RootTurnLifecycleRequest,
  SubagentAdmissionRequest,
  SubagentLifecycleRequest,
} from "./ResourceGovernorAdmissionQueue.ts";

const CRITICAL_SAMPLE_COUNT = 2;
const HEALTHY_SAMPLE_COUNT = 5;

export interface ResourceGovernorSample {
  readonly sampledAtMs: number;
  readonly memory: ResourceMonitorHostMemory;
  readonly processes: ReadonlyArray<ResourceGovernorProcessSample>;
}

interface SuspendedProviderProcessTree extends ProviderProcessTreeLease {
  readonly registrationKey: string;
  readonly threadId: ThreadId;
  readonly suspendConfirmed: boolean;
  readonly resumeRequired: boolean;
}

interface GovernorState {
  readonly policy: ResourceProtectionPolicy;
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
  readonly initialPolicy?: ResourceProtectionPolicy;
  readonly processTreeController?: ProviderProcessTreeController;
  readonly createProcessTreeLeaseId?: () => string;
  readonly signalProcess?: (
    identity: { readonly pid: number; readonly startTimeMs: number },
    signal: "SIGSTOP" | "SIGCONT",
  ) => Effect.Effect<void, ProviderProcessSignalError>;
}

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
    readonly setPolicy: (policy: ResourceProtectionPolicy) => Effect.Effect<void>;
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

export const makeSubagentResourceGovernor = Effect.fnUntraced(function* (
  options: SubagentResourceGovernorOptions = {},
) {
  const hostPlatform = yield* HostProcessPlatform;
  const signalProcess = options.signalProcess ?? makeExactProcessSignaler({ hostPlatform });
  const processTreeController =
    options.processTreeController ?? makePosixProviderProcessTreeController(signalProcess);
  const createProcessTreeLeaseId = options.createProcessTreeLeaseId ?? NodeCrypto.randomUUID;
  const stateRef = yield* Ref.make<GovernorState>({
    policy: options.initialPolicy ?? DEFAULT_RESOURCE_PROTECTION_POLICY,
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

  const {
    acquireInProcessLease,
    awaitAdmission,
    confirmSubagent,
    releaseSubagent,
    releaseRootTurn,
  } = makeResourceGovernorAdmissionCoordinator({ stateRef, mutex, commitAdmissions });

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
          const registrations = refreshRegisteredProviderProcesses(current.registrations, sample);

          let next: GovernorState = completeMeasurements({ ...current, sample, registrations });
          const { fastest, critical, inProcessEmergency } = resourcePressureProjection(
            sample.memory,
            registrations.values(),
          );

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
            let pressureCancellation:
              | {
                  readonly work: ActiveInProcessWork;
                  readonly notice: InProcessCriticalPressureNotice;
                }
              | undefined;
            if (
              next.policy.processSuspension &&
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
            } else {
              const victim =
                next.policy.adaptiveAdmission &&
                criticalSamples >= CRITICAL_SAMPLE_COUNT &&
                inProcessEmergency
                  ? criticalPressureVictim(next.activeInProcess)
                  : undefined;
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
        const registrations = new Map(current.registrations);
        const registered = createRegisteredProviderProcess(registration, resolvedStartTimeMs);
        registrations.set(registered.key, registered);
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
            : providerProcessRegistrationKey(identity);
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

  const setPolicy = (policy: ResourceProtectionPolicy) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        let next: GovernorState = { ...current, policy };
        if (!policy.processSuspension && current.suspendedProcessTree) {
          next = (yield* resumeSuspendedProcessTree({
            ...next,
            suspendedProcessTree: {
              ...current.suspendedProcessTree,
              resumeRequired: true,
            },
          })).state;
        }
        yield* commitAdmissions(next);
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
    setPolicy,
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
    const serverSettings = yield* ServerSettingsService;
    const settingsChanges = yield* serverSettings.subscribeChanges;
    const initialSettings = yield* serverSettings.getSettings;
    const governor = yield* makeScopedSubagentResourceGovernor(
      hostPlatform === "win32"
        ? {
            initialPolicy: resolveResourceProtectionPolicy(initialSettings),
            processTreeController: makeDelegatingProviderProcessTreeController({
              suspendProcessTree: nativeTelemetry.suspendProcessTree,
              resumeProcessTree: nativeTelemetry.resumeProcessTree,
            }),
          }
        : { initialPolicy: resolveResourceProtectionPolicy(initialSettings) },
    );
    yield* attachResourceProtectionRuntime({ governor, nativeTelemetry, settingsChanges });
    return governor;
  }),
);
