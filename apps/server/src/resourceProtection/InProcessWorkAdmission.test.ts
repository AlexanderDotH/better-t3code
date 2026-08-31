import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import {
  IN_PROCESS_BASE_RESERVATION_BYTES,
  MAX_IN_PROCESS_TURNS_PER_PROVIDER_INSTANCE,
  MEBIBYTE,
  inProcessReservationBytes,
} from "./InProcessWorkAdmission.ts";
import { RESOURCE_GOVERNOR_MAX_WAITING_ADMISSIONS } from "./ResourceGovernorAdmissionQueue.ts";
import {
  GIBIBYTE,
  makeSubagentResourceGovernor,
  type ResourceGovernorProcessSample,
  type ResourceGovernorSample,
} from "./SubagentResourceGovernor.ts";

const chatgpt = ProviderDriverKind.make("chatgpt");
const primaryInstance = ProviderInstanceId.make("chatgpt-primary");
const secondaryInstance = ProviderInstanceId.make("chatgpt-secondary");

function sample(input: {
  readonly availableGiB: number;
  readonly sampledAtMs: number;
  readonly totalGiB?: number;
  readonly processes?: ReadonlyArray<ResourceGovernorProcessSample>;
}): ResourceGovernorSample {
  return {
    sampledAtMs: input.sampledAtMs,
    memory: {
      totalBytes: (input.totalGiB ?? 16) * GIBIBYTE,
      availableBytes: input.availableGiB * GIBIBYTE,
      swapTotalBytes: 8 * GIBIBYTE,
      swapFreeBytes: 8 * GIBIBYTE,
    },
    processes: input.processes ?? [],
  };
}

function request(
  workId: string,
  options: {
    readonly providerInstanceId?: ProviderInstanceId;
    readonly serializedHistoryBytes?: number;
  } = {},
) {
  return {
    workId,
    threadId: ThreadId.make(`thread-${workId}`),
    provider: chatgpt,
    providerInstanceId: options.providerInstanceId ?? primaryInstance,
    reservation: {
      serializedHistoryBytes: options.serializedHistoryBytes ?? 0,
      attachmentBytes: 0,
      toolBufferBytes: 0,
    },
    onCriticalPressure: () => Effect.void,
  };
}

describe("in-process work admission", () => {
  it("reserves 64 MiB plus twice history and attachment/tool buffers", () => {
    expect(
      inProcessReservationBytes({
        serializedHistoryBytes: 10 * MEBIBYTE,
        attachmentBytes: 3 * MEBIBYTE,
        toolBufferBytes: 5 * MEBIBYTE,
      }),
    ).toBe(92 * MEBIBYTE);
  });

  it.effect("admits in FIFO order inside the existing core memory reserve", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      yield* governor.observe(sample({ availableGiB: 3.3, sampledAtMs: 0 }));

      const first = yield* governor.acquireInProcessLease(request("fifo-1"));
      expect(first?.reservedBytes).toBe(IN_PROCESS_BASE_RESERVATION_BYTES);

      const order: string[] = [];
      const second = yield* governor.acquireInProcessLease(request("fifo-2")).pipe(
        Effect.tap(() => Effect.sync(() => order.push("second"))),
        Effect.forkChild,
      );
      const third = yield* governor.acquireInProcessLease(request("fifo-3")).pipe(
        Effect.tap(() => Effect.sync(() => order.push("third"))),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      expect(second.pollUnsafe()).toBeUndefined();
      expect(third.pollUnsafe()).toBeUndefined();
      expect((yield* governor.latest).waitingStarts).toBe(2);

      yield* first?.release;
      const secondLease = yield* Fiber.join(second);
      expect(order).toEqual(["second"]);
      expect(third.pollUnsafe()).toBeUndefined();

      yield* secondLease?.release;
      const thirdLease = yield* Fiber.join(third);
      expect(order).toEqual(["second", "third"]);
      yield* thirdLease?.release;
      expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
    }),
  );

  it.effect(
    "shares one bounded wait queue across process and in-process admissions",
    () =>
      Effect.gen(function* () {
        expect(RESOURCE_GOVERNOR_MAX_WAITING_ADMISSIONS).toBe(256);
        const governor = yield* makeSubagentResourceGovernor();
        const perKind = RESOURCE_GOVERNOR_MAX_WAITING_ADMISSIONS / 2;
        const processWaiters = [];
        const inProcessWaiters = [];

        for (let index = 0; index < perKind; index += 1) {
          const processWaiter = yield* governor
            .awaitAdmission({
              threadId: ThreadId.make(`thread-shared-process-${index}`),
              provider: chatgpt,
              providerInstanceId: primaryInstance,
              configurationKey: "shared-capacity",
            })
            .pipe(Effect.forkChild);
          processWaiters.push(processWaiter);
          const inProcessWaiter = yield* governor
            .acquireInProcessLease(request(`shared-in-process-${index}`))
            .pipe(Effect.forkChild);
          inProcessWaiters.push(inProcessWaiter);
          yield* Effect.yieldNow;
        }

        expect((yield* governor.latest).waitingStarts).toBe(
          RESOURCE_GOVERNOR_MAX_WAITING_ADMISSIONS,
        );
        expect(
          yield* governor.awaitAdmission({
            threadId: ThreadId.make("thread-shared-process-overflow"),
            provider: chatgpt,
            providerInstanceId: primaryInstance,
            configurationKey: "shared-capacity",
          }),
        ).toBe(false);
        expect(
          yield* governor.acquireInProcessLease(request("shared-in-process-overflow")),
        ).toBeUndefined();

        yield* governor.shutdown;
        expect(yield* Effect.forEach(processWaiters, Fiber.join)).toEqual(
          Array.from({ length: perKind }, () => false),
        );
        expect(yield* Effect.forEach(inProcessWaiters, Fiber.join)).toEqual(
          Array.from({ length: perKind }, () => undefined),
        );
      }),
    30_000,
  );

  it.effect(
    "drains in-process waits and releases reservations when adaptive admission is disabled",
    () =>
      Effect.gen(function* () {
        const governor = yield* makeSubagentResourceGovernor();
        yield* governor.observe(sample({ availableGiB: 10, sampledAtMs: 0 }));
        const active = yield* governor.acquireInProcessLease(request("policy-active"));
        expect(active?.reservedBytes).toBe(IN_PROCESS_BASE_RESERVATION_BYTES);

        yield* governor.observe(sample({ availableGiB: 0.25, sampledAtMs: 1_000 }));
        const waiting = yield* governor
          .acquireInProcessLease(request("policy-waiting"))
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        expect(waiting.pollUnsafe()).toBeUndefined();

        yield* governor.setPolicy({ adaptiveAdmission: false, processSuspension: true });

        const drained = yield* Fiber.join(waiting);
        expect(drained).toMatchObject({ reservedBytes: 0 });
        expect((yield* governor.inProcessUsage).activeCount).toBe(0);
        expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
        expect(
          (yield* governor.acquireInProcessLease(request("policy-bypass")))?.reservedBytes,
        ).toBe(0);

        yield* active?.release;
        yield* drained?.release;
        yield* governor.setPolicy({ adaptiveAdmission: true, processSuspension: true });
        const gatedAgain = yield* governor
          .acquireInProcessLease(request("policy-gated-again"))
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        expect(gatedAgain.pollUnsafe()).toBeUndefined();
        yield* Fiber.interrupt(gatedAgain);
      }),
  );

  it.effect("cancels a thread's active lease and waiter with idempotent cleanup", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      const threadId = ThreadId.make("thread-cancelled-in-process");
      yield* governor.observe(sample({ availableGiB: 3.3, sampledAtMs: 0 }));

      const active = yield* governor.acquireInProcessLease({
        ...request("cancel-active"),
        threadId,
      });
      const waiting = yield* governor
        .acquireInProcessLease({ ...request("cancel-waiting"), threadId })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(waiting.pollUnsafe()).toBeUndefined();

      yield* governor.cancelThread(threadId);
      expect(yield* Fiber.join(waiting)).toBeUndefined();
      expect(yield* governor.inProcessUsage).toEqual({
        activeCount: 0,
        waitingCount: 0,
        reservedBytes: 0,
        providers: [],
      });
      yield* active?.release;
      yield* active?.release;
      expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
    }),
  );

  it.effect("cancels the largest and then newest in-process turn under critical pressure", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      yield* governor.observe(sample({ availableGiB: 10, sampledAtMs: 0 }));
      const cancellations: Array<{ readonly workId: string; readonly reason: string }> = [];
      const cancellation = (workId: string) => (notice: { readonly reason: string }) =>
        Effect.sync(() => cancellations.push({ workId, reason: notice.reason }));

      const small = yield* governor.acquireInProcessLease({
        ...request("small", { serializedHistoryBytes: MEBIBYTE }),
        onCriticalPressure: cancellation("small"),
      });
      const olderLarge = yield* governor.acquireInProcessLease({
        ...request("older-large", { serializedHistoryBytes: 4 * MEBIBYTE }),
        onCriticalPressure: cancellation("older-large"),
      });
      const newerLarge = yield* governor.acquireInProcessLease({
        ...request("newer-large", { serializedHistoryBytes: 4 * MEBIBYTE }),
        onCriticalPressure: cancellation("newer-large"),
      });

      yield* governor.observe(sample({ availableGiB: 0.5, sampledAtMs: 1_000 }));
      expect(cancellations).toEqual([]);
      yield* governor.observe(sample({ availableGiB: 0.5, sampledAtMs: 2_000 }));

      expect(cancellations).toEqual([
        { workId: "newer-large", reason: "critical-memory-pressure" },
      ]);
      const usage = yield* governor.inProcessUsage;
      expect(usage.activeCount).toBe(2);
      expect(usage.reservedBytes).toBe(
        (small?.reservedBytes ?? 0) + (olderLarge?.reservedBytes ?? 0),
      );

      yield* newerLarge?.release;
      yield* governor.observe(sample({ availableGiB: 10, sampledAtMs: 3_000 }));
      expect(cancellations).toHaveLength(1);
      yield* small?.release;
      yield* olderLarge?.release;
    }),
  );

  it.effect("keeps active in-process turns alive inside the start-admission reserve", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      yield* governor.observe(sample({ availableGiB: 10, sampledAtMs: 0 }));
      const cancellations: string[] = [];
      const lease = yield* governor.acquireInProcessLease({
        ...request("core-reserve-turn"),
        onCriticalPressure: (notice) => Effect.sync(() => cancellations.push(notice.workId)),
      });

      yield* governor.observe(sample({ availableGiB: 3, sampledAtMs: 1_000 }));
      yield* governor.observe(sample({ availableGiB: 3, sampledAtMs: 2_000 }));

      expect(cancellations).toEqual([]);
      expect((yield* governor.inProcessUsage).activeCount).toBe(1);
      yield* lease?.release;
    }),
  );

  it.effect("throttles a growing provider process before cancelling in-process work", () =>
    Effect.gen(function* () {
      const signals: Array<{ readonly pid: number; readonly signal: "SIGSTOP" | "SIGCONT" }> = [];
      const governor = yield* makeSubagentResourceGovernor({
        signalProcess: (identity, signal) =>
          Effect.sync(() => signals.push({ pid: identity.pid, signal })),
      });
      const rootPid = 701;
      const rootStartTimeMs = 70_000;
      const processes = (rssGiB: number): ReadonlyArray<ResourceGovernorProcessSample> => [
        {
          pid: rootPid,
          ppid: 1,
          startTimeMs: rootStartTimeMs,
          residentBytes: rssGiB * GIBIBYTE,
        },
      ];
      yield* governor.registerProviderProcess({
        threadId: ThreadId.make("thread-growing-provider"),
        provider: chatgpt,
        providerInstanceId: primaryInstance,
        pid: rootPid,
        startTimeMs: rootStartTimeMs,
      });
      yield* governor.observe(
        sample({ availableGiB: 10, sampledAtMs: 0, processes: processes(0.5) }),
      );
      const cancellations: string[] = [];
      const lease = yield* governor.acquireInProcessLease({
        ...request("in-process-bystander"),
        onCriticalPressure: (notice) => Effect.sync(() => cancellations.push(notice.workId)),
      });

      yield* governor.observe(
        sample({ availableGiB: 5.5, sampledAtMs: 1_000, processes: processes(1.5) }),
      );
      yield* governor.observe(
        sample({ availableGiB: 5.5, sampledAtMs: 2_000, processes: processes(2.5) }),
      );

      expect(cancellations).toEqual([]);
      expect(signals).toEqual([{ pid: rootPid, signal: "SIGSTOP" }]);
      expect((yield* governor.inProcessUsage).activeCount).toBe(1);
      yield* lease?.release;
      yield* governor.shutdown;
    }),
  );

  it.effect(
    "keeps forty managed sessions stable on a 16 GiB budget without provider processes",
    () =>
      Effect.gen(function* () {
        const governor = yield* makeSubagentResourceGovernor();
        yield* governor.observe(sample({ availableGiB: 8, sampledAtMs: 0 }));
        const rssBeforeBytes = process.memoryUsage.rss();

        const leases = yield* Effect.forEach(
          Array.from({ length: MAX_IN_PROCESS_TURNS_PER_PROVIDER_INSTANCE }, (_, index) => index),
          (index) => governor.acquireInProcessLease(request(`soak-${index + 1}`)),
        );
        expect(leases.every((lease) => lease !== undefined)).toBe(true);

        const otherProviderLease = yield* governor.acquireInProcessLease(
          request("secondary", { providerInstanceId: secondaryInstance }),
        );
        const fortyFirst = yield* governor
          .acquireInProcessLease(request("soak-41"))
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        expect(fortyFirst.pollUnsafe()).toBeUndefined();

        const atCapacity = yield* governor.inProcessUsage;
        expect(atCapacity.activeCount).toBe(41);
        expect(atCapacity.waitingCount).toBe(1);
        expect(atCapacity.reservedBytes).toBe(41 * IN_PROCESS_BASE_RESERVATION_BYTES);
        const globalSnapshot = yield* governor.latest;
        expect(globalSnapshot.totalMemoryBytes).toBe(16 * GIBIBYTE);
        expect(globalSnapshot.reservedMemoryBytes).toBe(41 * IN_PROCESS_BASE_RESERVATION_BYTES);
        expect(globalSnapshot.waitingStarts).toBe(1);
        expect(atCapacity.providers).toEqual([
          {
            provider: chatgpt,
            providerInstanceId: primaryInstance,
            activeCount: 40,
            waitingCount: 1,
            reservedBytes: 40 * IN_PROCESS_BASE_RESERVATION_BYTES,
          },
          {
            provider: chatgpt,
            providerInstanceId: secondaryInstance,
            activeCount: 1,
            waitingCount: 0,
            reservedBytes: IN_PROCESS_BASE_RESERVATION_BYTES,
          },
        ]);

        yield* leases[0]?.release;
        const replacement = yield* Fiber.join(fortyFirst);
        expect(replacement).toBeDefined();
        const afterReplacement = yield* governor.inProcessUsage;
        expect(afterReplacement.activeCount).toBe(41);
        expect(afterReplacement.waitingCount).toBe(0);
        expect(afterReplacement.reservedBytes).toBe(41 * IN_PROCESS_BASE_RESERVATION_BYTES);
        expect(Math.max(0, process.memoryUsage.rss() - rssBeforeBytes)).toBeLessThanOrEqual(
          2 * GIBIBYTE,
        );

        yield* leases[0]?.release;
        yield* Effect.forEach(leases, (lease) => lease?.release ?? Effect.void, { discard: true });
        yield* otherProviderLease?.release;
        yield* replacement?.release;
        const released = yield* governor.inProcessUsage;
        expect(released).toEqual({
          activeCount: 0,
          waitingCount: 0,
          reservedBytes: 0,
          providers: [],
        });
        expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
      }),
    30_000,
  );
});
