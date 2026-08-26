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
import {
  GIBIBYTE,
  makeSubagentResourceGovernor,
  type ResourceGovernorSample,
} from "./SubagentResourceGovernor.ts";

const chatgpt = ProviderDriverKind.make("chatgpt");
const primaryInstance = ProviderInstanceId.make("chatgpt-primary");
const secondaryInstance = ProviderInstanceId.make("chatgpt-secondary");

function sample(input: {
  readonly availableGiB: number;
  readonly sampledAtMs: number;
  readonly totalGiB?: number;
}): ResourceGovernorSample {
  return {
    sampledAtMs: input.sampledAtMs,
    memory: {
      totalBytes: (input.totalGiB ?? 16) * GIBIBYTE,
      availableBytes: input.availableGiB * GIBIBYTE,
      swapTotalBytes: 8 * GIBIBYTE,
      swapFreeBytes: 8 * GIBIBYTE,
    },
    processes: [],
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

      yield* governor.observe(sample({ availableGiB: 3, sampledAtMs: 1_000 }));
      expect(cancellations).toEqual([]);
      yield* governor.observe(sample({ availableGiB: 3, sampledAtMs: 2_000 }));

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
