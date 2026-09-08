import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import type * as Semaphore from "effect/Semaphore";

import {
  inProcessReservationBytes,
  type InProcessWorkAdmissionRequest,
  type InProcessWorkLease,
} from "./InProcessWorkAdmission.ts";
import {
  resourceGovernorAdmissionQueueHasCapacity,
  removeAdmission,
  removeInProcessAdmission,
  removeMatchingAdmissions,
  requestHasRetention,
  requestTreeRss,
  requestsHaveSameOwner,
  type InProcessWorkGrant,
  type ResourceGovernorAdmissionQueueState,
  type RootTurnLifecycleRequest,
  type SubagentAdmissionRequest,
  type SubagentLifecycleRequest,
} from "./ResourceGovernorAdmissionQueue.ts";
import { reservationBytesForGrowthSamples } from "./ResourceGovernorAdmissionState.ts";

interface AdmissionCoordinatorState extends ResourceGovernorAdmissionQueueState {
  readonly nextAdmissionId: number;
}

export function makeResourceGovernorAdmissionCoordinator<
  S extends AdmissionCoordinatorState,
>(input: {
  readonly stateRef: Ref.Ref<S>;
  readonly mutex: Semaphore.Semaphore;
  readonly commitAdmissions: (state: S) => Effect.Effect<void>;
}) {
  const cancelAdmission = (id: number) =>
    input.mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(input.stateRef);
        yield* input.commitAdmissions(removeAdmission(current, id));
      }),
    );

  const releaseInProcessLease = (id: number) =>
    input.mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(input.stateRef);
        yield* input.commitAdmissions(removeInProcessAdmission(current, id));
      }),
    );

  const acquireInProcessLease = (request: InProcessWorkAdmissionRequest) =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<InProcessWorkGrant | undefined>();
      const result = yield* input.mutex.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(input.stateRef);
          if (!resourceGovernorAdmissionQueueHasCapacity(current)) {
            return { _tag: "QueueFull" } as const;
          }
          const admissionId = current.nextAdmissionId;
          yield* input.commitAdmissions({
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
          return { _tag: "Waiting", id: admissionId } as const;
        }),
      );
      if (result._tag === "QueueFull") return undefined;
      const grant = yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() => releaseInProcessLease(result.id)),
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
      const result = yield* input.mutex.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(input.stateRef);
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
          if (!resourceGovernorAdmissionQueueHasCapacity(current)) {
            return { _tag: "QueueFull" } as const;
          }
          const id = current.nextAdmissionId;
          yield* input.commitAdmissions({
            ...current,
            nextAdmissionId: id + 1,
            waiting: [...current.waiting, { ...request, id, deferred }],
          });
          return { _tag: "Waiting", id } as const;
        }),
      );
      if (result._tag === "AlreadyAdmitted") return true;
      if (result._tag === "QueueFull") return false;
      return yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() => cancelAdmission(result.id)),
      );
    });

  const confirmSubagent = (request: SubagentLifecycleRequest) =>
    input.mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(input.stateRef);
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
          yield* input.commitAdmissions({ ...current, active });
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
        yield* input.commitAdmissions({
          ...current,
          nextAdmissionId: id + 1,
          active,
          unknownConfigurationsInFlight,
        });
      }),
    );

  const releaseSubagent = (request: Omit<SubagentLifecycleRequest, "configurationKey">) =>
    input.mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(input.stateRef);
        const ids = [...current.active.values()]
          .filter(
            (admission) =>
              requestsHaveSameOwner(admission, request) && admission.agentId === request.agentId,
          )
          .map((admission) => admission.id);
        let next = current;
        for (const id of ids) next = removeAdmission(next, id);
        yield* input.commitAdmissions(next);
      }),
    );

  const releaseRootTurn = (request: RootTurnLifecycleRequest) =>
    input.mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(input.stateRef);
        const removed = removeMatchingAdmissions(
          current,
          (admission) =>
            requestsHaveSameOwner(admission, request) &&
            requestHasRetention(admission, {
              kind: "root-turn",
              lifecycleId: request.lifecycleId,
            }),
        );
        yield* input.commitAdmissions(removed.state);
        yield* Effect.forEach(
          removed.cancelledWaiters,
          (waiter) => Deferred.succeed(waiter.deferred, false),
          { discard: true },
        );
      }),
    );

  return {
    acquireInProcessLease,
    awaitAdmission,
    confirmSubagent,
    releaseSubagent,
    releaseRootTurn,
  };
}
