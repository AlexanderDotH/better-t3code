import type {
  HostPowerSnapshot,
  ResourceMonitorProcessControlResultEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import {
  NativeTelemetryExited,
  NativeTelemetryProcessControlFailed,
  NativeTelemetryRequestTimedOut,
  NativeTelemetryStreamClosed,
  type PendingProcessControlRequest,
  canCommandNativeTelemetrySidecar,
  completePendingProcessControlRequest,
  canRequestNativeTelemetryRetry,
  commitCollectionControlUpdate,
  failPendingProcessControlRequests,
  nativeTelemetrySupervisorFailureMessage,
  retainRecentNativeTelemetryFailures,
  resolveNativeSampleIntervalMs,
  synchronizeCollectionControlOnStart,
} from "./NativeTelemetryClient.ts";

const basePower: HostPowerSnapshot = {
  source: "electron-main",
  idle: "false",
  idleSeconds: 0,
  locked: "false",
  suspended: false,
  onBattery: "false",
  lowPowerMode: "false",
  thermalState: "nominal",
  stale: false,
  updatedAt: DateTime.makeUnsafe("2026-06-17T12:00:00.000Z"),
};

describe("resolveNativeSampleIntervalMs", () => {
  it("keeps a recovery cadence while suspended and backs off under host constraints", () => {
    expect(resolveNativeSampleIntervalMs({ ...basePower, suspended: true }, 1, 0)).toBe(15_000);
    expect(resolveNativeSampleIntervalMs({ ...basePower, locked: "true" }, 1, 0)).toBe(15_000);
    expect(resolveNativeSampleIntervalMs({ ...basePower, lowPowerMode: "true" }, 1, 0)).toBe(
      15_000,
    );
    expect(resolveNativeSampleIntervalMs({ ...basePower, thermalState: "critical" }, 1, 0)).toBe(
      15_000,
    );
    expect(resolveNativeSampleIntervalMs({ ...basePower, onBattery: "true" }, 1, 0)).toBe(5_000);
  });

  it("samples resource protection at 1Hz even while the host is constrained", () => {
    expect(resolveNativeSampleIntervalMs({ ...basePower, suspended: true }, 1, 1)).toBe(1_000);
    expect(resolveNativeSampleIntervalMs({ ...basePower, thermalState: "critical" }, 0, 1)).toBe(
      1_000,
    );
    expect(resolveNativeSampleIntervalMs({ ...basePower, onBattery: "true" }, 0, 1)).toBe(1_000);
  });

  it("keeps unknown background telemetry cheap but serves live diagnostics at 1Hz", () => {
    const unknown: HostPowerSnapshot = {
      ...basePower,
      source: "unknown",
      stale: true,
    };
    expect(resolveNativeSampleIntervalMs(unknown, 0, 0)).toBe(5_000);
    expect(resolveNativeSampleIntervalMs(unknown, 1, 0)).toBe(1_000);
    expect(
      resolveNativeSampleIntervalMs(
        { ...basePower, stale: true, locked: "true", suspended: true },
        0,
        0,
      ),
    ).toBe(5_000);
    expect(resolveNativeSampleIntervalMs(basePower, 0, 0)).toBe(1_000);
  });
});

describe("canRequestNativeTelemetryRetry", () => {
  it("only accepts retry while the supervisor is waiting without a live sidecar", () => {
    expect(canRequestNativeTelemetryRetry("degraded", false)).toBe(true);
    expect(canRequestNativeTelemetryRetry("unavailable", false)).toBe(true);
    expect(canRequestNativeTelemetryRetry("degraded", true)).toBe(false);
    expect(canRequestNativeTelemetryRetry("healthy", false)).toBe(false);
    expect(canRequestNativeTelemetryRetry("starting", false)).toBe(false);
  });
});

describe("canCommandNativeTelemetrySidecar", () => {
  it("keeps on-demand recovery commands available while a live sidecar is degraded", () => {
    expect(canCommandNativeTelemetrySidecar("healthy", true)).toBe(true);
    expect(canCommandNativeTelemetrySidecar("degraded", true)).toBe(true);
    expect(canCommandNativeTelemetrySidecar("unavailable", true)).toBe(false);
    expect(canCommandNativeTelemetrySidecar("degraded", false)).toBe(false);
  });
});

describe("NativeTelemetryRequestTimedOut", () => {
  it("models history and sample request deadlines without a fabricated cause", () => {
    const historyTimeout = new NativeTelemetryRequestTimedOut({
      operation: "readHistory",
      timeoutMs: 15_000,
    });
    const sampleTimeout = new NativeTelemetryRequestTimedOut({
      operation: "sampleNow",
      timeoutMs: 5_000,
    });

    expect(historyTimeout.message).toBe(
      "Resource monitor 'readHistory' request timed out after 15000ms.",
    );
    expect(sampleTimeout.message).toBe(
      "Resource monitor 'sampleNow' request timed out after 5000ms.",
    );
    expect("cause" in historyTimeout).toBe(false);
    expect("cause" in sampleTimeout).toBe(false);
  });
});

describe("process-control request correlation", () => {
  it.effect("completes only the request with the matching request and lease identity", () =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<void, NativeTelemetryProcessControlFailed>();
      const pending = yield* Ref.make(
        new Map<string, PendingProcessControlRequest>([
          [
            "request-2",
            {
              operation: "suspend",
              leaseId: "lease-1",
              deferred,
            },
          ],
        ]),
      );
      const lateResult: ResourceMonitorProcessControlResultEvent = {
        version: 4,
        type: "processControlResult",
        requestId: "request-1",
        leaseId: "lease-1",
        operation: "suspend",
        success: true,
        resumeRequired: false,
      };
      const currentResult: ResourceMonitorProcessControlResultEvent = {
        ...lateResult,
        requestId: "request-2",
      };

      yield* completePendingProcessControlRequest(pending, lateResult);
      expect((yield* Ref.get(pending)).size).toBe(1);

      yield* completePendingProcessControlRequest(pending, currentResult);
      yield* Deferred.await(deferred);
      expect((yield* Ref.get(pending)).size).toBe(0);
    }),
  );

  it.effect("fails a correlated request when the sidecar rejects the process identity", () =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<void, NativeTelemetryProcessControlFailed>();
      const pending = yield* Ref.make(
        new Map<string, PendingProcessControlRequest>([
          [
            "request-3",
            {
              operation: "resume",
              leaseId: "lease-2",
              deferred,
            },
          ],
        ]),
      );

      yield* completePendingProcessControlRequest(pending, {
        version: 4,
        type: "processControlResult",
        requestId: "request-3",
        leaseId: "lease-2",
        operation: "resume",
        success: false,
        resumeRequired: true,
        error: "process identity changed",
      });
      const failure = yield* Deferred.await(deferred).pipe(Effect.flip);

      expect(failure).toBeInstanceOf(NativeTelemetryProcessControlFailed);
      expect(failure.resumeRequired).toBe(true);
      expect(failure.message).toContain("process identity changed");
      expect((yield* Ref.get(pending)).size).toBe(0);
    }),
  );

  it.effect("fails and clears every pending request when the sidecar exits", () =>
    Effect.gen(function* () {
      const suspend = yield* Deferred.make<void, NativeTelemetryExited>();
      const resume = yield* Deferred.make<void, NativeTelemetryExited>();
      const pending = yield* Ref.make(
        new Map<string, PendingProcessControlRequest>([
          ["request-4", { operation: "suspend", leaseId: "lease-3", deferred: suspend }],
          ["request-5", { operation: "resume", leaseId: "lease-3", deferred: resume }],
        ]),
      );
      const exit = new NativeTelemetryExited({ exitCode: 1 });

      yield* failPendingProcessControlRequests(pending, exit);

      expect(yield* Deferred.await(suspend).pipe(Effect.flip)).toBe(exit);
      expect(yield* Deferred.await(resume).pipe(Effect.flip)).toBe(exit);
      expect((yield* Ref.get(pending)).size).toBe(0);
    }),
  );
});

describe("native telemetry supervisor failures", () => {
  it("distinguishes a closed event stream from a process exit", () => {
    expect(new NativeTelemetryStreamClosed().message).toBe(
      "Resource monitor event stream closed unexpectedly.",
    );
  });

  it("keeps defect details out of the caller-visible health message", () => {
    const secret = "credential=do-not-expose";
    const message = nativeTelemetrySupervisorFailureMessage(Cause.die(new Error(secret)));

    expect(message).toBe("Resource monitor supervisor stopped unexpectedly.");
    expect(message).not.toContain(secret);
  });
});

describe("retainRecentNativeTelemetryFailures", () => {
  it("expires old failures so an isolated crash restarts from the initial backoff", () => {
    expect(retainRecentNativeTelemetryFailures([0, 30_000], 90_001)).toEqual([]);
    expect(retainRecentNativeTelemetryFailures([30_000, 60_000], 90_000)).toEqual([30_000, 60_000]);
  });
});

describe("commitCollectionControlUpdate", () => {
  it.effect("retains desired demand and retries unapplied sidecar state", () =>
    Effect.gen(function* () {
      const initial = {
        hostPower: basePower,
        liveSubscriberCount: 0,
        resourceProtectionSubscriberCount: 0,
        sampleIntervalMs: 5_000,
      };
      const desired = yield* Ref.make(initial);
      const applied = yield* Ref.make(initial);
      const failure = new Error("sidecar write failed");
      const receivedStates: Array<readonly [number, number]> = [];

      const received = yield* commitCollectionControlUpdate(
        desired,
        applied,
        (current) => ({
          ...current,
          liveSubscriberCount: 1,
          sampleIntervalMs: 1_000,
        }),
        (previous, next) => {
          receivedStates.push([previous.sampleIntervalMs, next.sampleIntervalMs]);
          return Effect.fail(failure);
        },
      ).pipe(Effect.flip);

      expect(received).toBe(failure);
      expect(yield* Ref.get(desired)).toEqual({
        ...initial,
        liveSubscriberCount: 1,
        sampleIntervalMs: 1_000,
      });
      expect(yield* Ref.get(applied)).toEqual(initial);

      yield* commitCollectionControlUpdate(
        desired,
        applied,
        (current) => current,
        (previous, next) => {
          receivedStates.push([previous.sampleIntervalMs, next.sampleIntervalMs]);
          return Effect.void;
        },
      );
      expect(receivedStates).toEqual([
        [5_000, 1_000],
        [5_000, 1_000],
      ]);
      expect(yield* Ref.get(applied)).toEqual(yield* Ref.get(desired));
    }),
  );

  it.effect("serializes startup synchronization with runtime control updates", () =>
    Effect.gen(function* () {
      const initial = {
        hostPower: basePower,
        liveSubscriberCount: 0,
        resourceProtectionSubscriberCount: 0,
        sampleIntervalMs: 5_000,
      };
      const desired = yield* Ref.make(initial);
      const applied = yield* Ref.make(initial);
      const ready = yield* Ref.make(false);
      const mutex = yield* Semaphore.make(1);
      const startupApplying = yield* Deferred.make<void>();
      const releaseStartup = yield* Deferred.make<void>();
      const appliedIntervals: Array<number> = [];

      const startupFiber = yield* synchronizeCollectionControlOnStart(
        mutex,
        desired,
        applied,
        (control) =>
          Effect.sync(() => {
            appliedIntervals.push(control.sampleIntervalMs);
          }).pipe(
            Effect.andThen(Deferred.succeed(startupApplying, undefined)),
            Effect.andThen(Deferred.await(releaseStartup)),
            Effect.asVoid,
          ),
        Ref.set(ready, true),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(startupApplying);

      const updateFiber = yield* mutex
        .withPermits(1)(
          commitCollectionControlUpdate(
            desired,
            applied,
            (current) => ({
              ...current,
              liveSubscriberCount: 1,
              sampleIntervalMs: 1_000,
            }),
            (_previous, next) =>
              Effect.gen(function* () {
                expect(yield* Ref.get(ready)).toBe(true);
                appliedIntervals.push(next.sampleIntervalMs);
              }),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(yield* Ref.get(desired)).toEqual(initial);

      yield* Deferred.succeed(releaseStartup, undefined);
      yield* Fiber.join(startupFiber);
      yield* Fiber.join(updateFiber);

      expect(appliedIntervals).toEqual([5_000, 1_000]);
      expect(yield* Ref.get(applied)).toEqual(yield* Ref.get(desired));
    }),
  );
});
