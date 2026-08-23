import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import {
  ProviderProcessTreeControlError,
  type ProviderProcessTreeLease,
} from "./ProviderProcessTreeController.ts";
import {
  GIBIBYTE,
  ProviderProcessSignalError,
  SubagentResourceGovernor,
  coreReserveBytes,
  makeExactProcessSignaler,
  makeSubagentResourceGovernor,
  reservationBytesForGrowthSamples,
  type ResourceGovernorSample,
} from "./SubagentResourceGovernor.ts";

const codex = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex-main");

function request(thread: string, configurationKey = "codex-main:mcp-a") {
  return {
    threadId: ThreadId.make(thread),
    provider: codex,
    providerInstanceId: instanceId,
    configurationKey,
  };
}

function sample(input: {
  readonly availableGiB: number;
  readonly sampledAtMs: number;
  readonly totalGiB?: number;
  readonly processes?: ResourceGovernorSample["processes"];
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

function growingProviderTree(rootPid: number, startTimeMs: number, rssGiB: number) {
  return [
    {
      pid: rootPid,
      ppid: 1,
      startTimeMs,
      residentBytes: rssGiB * GIBIBYTE,
    },
    {
      pid: rootPid + 1,
      ppid: rootPid,
      startTimeMs: startTimeMs + 100,
      residentBytes: rssGiB * GIBIBYTE,
    },
  ];
}

const driveToProviderTreeThrottle = Effect.fnUntraced(function* (
  governor: SubagentResourceGovernor["Service"],
  input: { readonly threadId: ThreadId; readonly rootPid: number; readonly startTimeMs: number },
) {
  yield* governor.registerProviderProcess({
    threadId: input.threadId,
    provider: codex,
    providerInstanceId: instanceId,
    pid: input.rootPid,
    startTimeMs: input.startTimeMs,
  });
  yield* governor.observe(
    sample({
      availableGiB: 7,
      sampledAtMs: 0,
      processes: growingProviderTree(input.rootPid, input.startTimeMs, 0.5),
    }),
  );
  yield* governor.observe(
    sample({
      availableGiB: 3.5,
      sampledAtMs: 1_000,
      processes: growingProviderTree(input.rootPid, input.startTimeMs, 1.5),
    }),
  );
  yield* governor.observe(
    sample({
      availableGiB: 3,
      sampledAtMs: 2_000,
      processes: growingProviderTree(input.rootPid, input.startTimeMs, 2.5),
    }),
  );
});

describe("SubagentResourceGovernor", () => {
  it("clamps the core reserve to 20 percent with 2-6 GiB bounds", () => {
    expect(coreReserveBytes(4 * GIBIBYTE)).toBe(2 * GIBIBYTE);
    expect(coreReserveBytes(16 * GIBIBYTE)).toBeCloseTo(3.2 * GIBIBYTE, 0);
    expect(coreReserveBytes(128 * GIBIBYTE)).toBe(6 * GIBIBYTE);
  });

  it("uses 4 GiB until observations make 1.25 times P95 larger", () => {
    expect(reservationBytesForGrowthSamples([])).toBe(4 * GIBIBYTE);
    expect(reservationBytesForGrowthSamples([1 * GIBIBYTE, 2 * GIBIBYTE])).toBe(4 * GIBIBYTE);
    expect(
      reservationBytesForGrowthSamples([1 * GIBIBYTE, 2 * GIBIBYTE, 5 * GIBIBYTE, 6 * GIBIBYTE]),
    ).toBeCloseTo(7.5 * GIBIBYTE, 0);
  });

  it.effect("admits waiting starts in FIFO order and initially measures a config singly", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      const processes = ["thread-1", "thread-2", "thread-3"].map((thread, index) => ({
        pid: 100 + index,
        ppid: 1,
        startTimeMs: 10_000 + index * 1_000,
        residentBytes: GIBIBYTE,
        threadId: ThreadId.make(thread),
      }));
      yield* Effect.forEach(
        processes,
        (process) =>
          governor.registerProviderProcess({
            threadId: process.threadId,
            provider: codex,
            providerInstanceId: instanceId,
            pid: process.pid,
            startTimeMs: process.startTimeMs,
          }),
        { discard: true },
      );
      const processSamples = processes.map(({ threadId: _threadId, ...process }) => process);
      yield* governor.observe(
        sample({ availableGiB: 8, sampledAtMs: 0, processes: processSamples }),
      );

      const order: string[] = [];
      const first = yield* governor.awaitAdmission(request("thread-1")).pipe(
        Effect.tap(() => Effect.sync(() => order.push("first"))),
        Effect.forkChild,
      );
      yield* Fiber.join(first);

      const second = yield* governor.awaitAdmission(request("thread-2")).pipe(
        Effect.tap(() => Effect.sync(() => order.push("second"))),
        Effect.forkChild,
      );
      const third = yield* governor.awaitAdmission(request("thread-3")).pipe(
        Effect.tap(() => Effect.sync(() => order.push("third"))),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      expect(second.pollUnsafe()).toBeUndefined();
      expect(third.pollUnsafe()).toBeUndefined();
      expect((yield* governor.latest).waitingStarts).toBe(2);

      for (let index = 1; index <= 5; index += 1) {
        yield* governor.observe(
          sample({ availableGiB: 8, sampledAtMs: index * 1_000, processes: processSamples }),
        );
      }
      yield* Fiber.join(second);
      expect(third.pollUnsafe()).toBeUndefined();

      for (let index = 6; index <= 10; index += 1) {
        yield* governor.observe(
          sample({ availableGiB: 8, sampledAtMs: index * 1_000, processes: processSamples }),
        );
      }
      yield* Fiber.join(third);

      expect(order).toEqual(["first", "second", "third"]);
      expect((yield* governor.latest).waitingStarts).toBe(0);
    }),
  );

  it.effect(
    "keeps unknown configurations single-file until an exact process tree is measured",
    () =>
      Effect.gen(function* () {
        const governor = yield* makeSubagentResourceGovernor();
        yield* governor.observe(sample({ availableGiB: 16, sampledAtMs: 0 }));

        expect(yield* governor.awaitAdmission(request("thread-a", "config-a"))).toBe(true);
        const second = yield* governor
          .awaitAdmission(request("thread-b", "config-b"))
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        expect(second.pollUnsafe()).toBeUndefined();

        for (let index = 1; index <= 5; index += 1) {
          yield* governor.observe(sample({ availableGiB: 16, sampledAtMs: index * 1_000 }));
        }
        expect(second.pollUnsafe()).toBeUndefined();

        yield* governor.registerProviderProcess({
          threadId: ThreadId.make("thread-a"),
          provider: codex,
          providerInstanceId: instanceId,
          pid: 201,
          startTimeMs: 20_000,
        });
        for (let index = 6; index <= 10; index += 1) {
          yield* governor.observe(
            sample({
              availableGiB: 16,
              sampledAtMs: index * 1_000,
              processes: [
                {
                  pid: 201,
                  ppid: 1,
                  startTimeMs: 20_000,
                  residentBytes: GIBIBYTE,
                },
              ],
            }),
          );
        }
        expect(yield* Fiber.join(second)).toBe(true);
      }),
  );

  it.effect("removes an interrupted waiter without disturbing the next start", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      yield* governor.observe(sample({ availableGiB: 3, sampledAtMs: 0 }));

      const cancelled = yield* governor.awaitAdmission(request("cancelled")).pipe(Effect.forkChild);
      const next = yield* governor.awaitAdmission(request("next")).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(cancelled);
      expect((yield* governor.latest).waitingStarts).toBe(1);

      yield* governor.observe(sample({ availableGiB: 8, sampledAtMs: 1_000 }));
      yield* Fiber.join(next);
      expect((yield* governor.latest).waitingStarts).toBe(0);
    }),
  );

  it.effect("invalidates stale memory after telemetry loss and resumes from a fresh sample", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      yield* governor.observe(sample({ availableGiB: 10, sampledAtMs: 0 }));
      yield* governor.telemetryUnavailable;

      const waiter = yield* governor
        .awaitAdmission(request("thread-telemetry-loss"))
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const unavailable = yield* governor.latest;
      expect(unavailable.state).toBe("unavailable");
      expect(unavailable.waitingStarts).toBe(1);
      expect(waiter.pollUnsafe()).toBeUndefined();

      yield* governor.observe(sample({ availableGiB: 10, sampledAtMs: 1_000 }));
      expect(yield* Fiber.join(waiter)).toBe(true);
    }),
  );

  it.effect("rechecks PID start time immediately before stopping a process", () =>
    Effect.gen(function* () {
      const signals: Array<{ readonly pid: number; readonly signal: "SIGSTOP" | "SIGCONT" }> = [];
      let actualStartTimeMs = 20_000;
      const signal = makeExactProcessSignaler({
        readStartTimeMs: () => actualStartTimeMs,
        sendSignal: (pid, sentSignal) => signals.push({ pid, signal: sentSignal }),
      });

      const fenced = yield* signal({ pid: 42, startTimeMs: 10_000 }, "SIGSTOP").pipe(Effect.exit);
      expect(Exit.isFailure(fenced)).toBe(true);
      expect(signals).toEqual([]);

      actualStartTimeMs = 10_999;
      yield* signal({ pid: 42, startTimeMs: 10_000 }, "SIGSTOP");
      expect(signals).toEqual([{ pid: 42, signal: "SIGSTOP" }]);

      actualStartTimeMs = 30_000;
      yield* signal({ pid: 42, startTimeMs: 10_000 }, "SIGCONT");
      expect(signals).toEqual([{ pid: 42, signal: "SIGSTOP" }]);
    }),
  );

  it.effect("matches subsecond spawn identities to the monitor's second precision", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      const threadId = ThreadId.make("thread-subsecond");
      yield* governor.registerProviderProcess({
        threadId,
        provider: codex,
        providerInstanceId: instanceId,
        pid: 77,
        startTimeMs: 10_999,
      });
      yield* governor.observe(
        sample({
          availableGiB: 10,
          sampledAtMs: 0,
          processes: [
            {
              pid: 77,
              ppid: 1,
              startTimeMs: 10_000,
              residentBytes: GIBIBYTE,
            },
          ],
        }),
      );

      expect(yield* governor.awaitAdmission(request(String(threadId)))).toBe(true);
      expect((yield* governor.latest).reservedMemoryBytes).toBe(4 * GIBIBYTE);
      yield* governor.unregisterProviderProcess({ pid: 77, startTimeMs: 10_999 });
      expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
    }),
  );

  it.effect(
    "pauses only an exact registered fastest-growing provider tree and resumes after five healthy samples",
    () =>
      Effect.gen(function* () {
        const signals: Array<{ readonly pid: number; readonly signal: "SIGSTOP" | "SIGCONT" }> = [];
        const governor = yield* makeSubagentResourceGovernor({
          signalProcess: (identity, signal) =>
            Effect.sync(() => {
              signals.push({ pid: identity.pid, signal });
            }),
        });

        yield* governor.registerProviderProcess({
          threadId: ThreadId.make("thread-fast"),
          provider: codex,
          providerInstanceId: instanceId,
          pid: 101,
          startTimeMs: 10_000,
        });
        yield* governor.registerProviderProcess({
          threadId: ThreadId.make("thread-slow"),
          provider: codex,
          providerInstanceId: instanceId,
          pid: 202,
          startTimeMs: 20_000,
        });

        const processes = (fastGiB: number, slowGiB: number) => [
          { pid: 101, ppid: 1, startTimeMs: 10_000, residentBytes: fastGiB * GIBIBYTE },
          { pid: 102, ppid: 101, startTimeMs: 10_100, residentBytes: fastGiB * GIBIBYTE },
          { pid: 202, ppid: 1, startTimeMs: 20_000, residentBytes: slowGiB * GIBIBYTE },
        ];

        yield* governor.observe(
          sample({ availableGiB: 7, sampledAtMs: 0, processes: processes(0.5, 0.5) }),
        );
        yield* governor.observe(
          sample({ availableGiB: 4, sampledAtMs: 1_000, processes: processes(1.5, 0.6) }),
        );
        expect(signals).toEqual([]);
        yield* governor.observe(
          sample({ availableGiB: 3.5, sampledAtMs: 2_000, processes: processes(2.5, 0.7) }),
        );

        expect(signals).toEqual([
          { pid: 101, signal: "SIGSTOP" },
          { pid: 102, signal: "SIGSTOP" },
        ]);
        expect((yield* governor.latest).state).toBe("throttled");

        for (let index = 3; index <= 7; index += 1) {
          yield* governor.observe(
            sample({ availableGiB: 8, sampledAtMs: index * 1_000, processes: processes(2.5, 0.7) }),
          );
        }

        expect(signals).toEqual([
          { pid: 101, signal: "SIGSTOP" },
          { pid: 102, signal: "SIGSTOP" },
          { pid: 102, signal: "SIGCONT" },
          { pid: 101, signal: "SIGCONT" },
        ]);
        expect((yield* governor.latest).state).toBe("normal");
      }),
  );

  it.effect("publishes throttled only after the full process-tree lease is confirmed", () =>
    Effect.gen(function* () {
      const suspensionConfirmed = yield* Deferred.make<void>();
      const suspended: Array<ProviderProcessTreeLease> = [];
      const governor = yield* makeSubagentResourceGovernor({
        createProcessTreeLeaseId: () => "lease-pending-suspend",
        processTreeController: {
          suspend: (lease) =>
            Effect.sync(() => suspended.push(lease)).pipe(
              Effect.andThen(Deferred.await(suspensionConfirmed)),
            ),
          resume: () => Effect.void,
        },
      });
      const threadId = ThreadId.make("thread-confirmed-suspend");
      const rootPid = 901;
      const startTimeMs = 90_000;
      yield* governor.registerProviderProcess({
        threadId,
        provider: codex,
        providerInstanceId: instanceId,
        pid: rootPid,
        startTimeMs,
      });
      yield* governor.observe(
        sample({
          availableGiB: 7,
          sampledAtMs: 0,
          processes: growingProviderTree(rootPid, startTimeMs, 0.5),
        }),
      );
      yield* governor.observe(
        sample({
          availableGiB: 3.5,
          sampledAtMs: 1_000,
          processes: growingProviderTree(rootPid, startTimeMs, 1.5),
        }),
      );

      const criticalObservation = yield* governor
        .observe(
          sample({
            availableGiB: 3,
            sampledAtMs: 2_000,
            processes: growingProviderTree(rootPid, startTimeMs, 2.5),
          }),
        )
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      expect((yield* governor.latest).state).toBe("normal");
      expect(suspended).toEqual([
        {
          leaseId: "lease-pending-suspend",
          processIdentities: [
            { pid: rootPid, startTimeMs },
            { pid: rootPid + 1, startTimeMs: startTimeMs + 100 },
          ],
        },
      ]);

      yield* Deferred.succeed(suspensionConfirmed, undefined);
      yield* Fiber.join(criticalObservation);
      expect((yield* governor.latest).state).toBe("throttled");
    }),
  );

  it.effect("keeps recovery visible until the same lease is confirmed resumed", () =>
    Effect.gen(function* () {
      const resumeConfirmed = yield* Deferred.make<void>();
      const resumed: Array<ProviderProcessTreeLease> = [];
      const governor = yield* makeSubagentResourceGovernor({
        createProcessTreeLeaseId: () => "lease-pending-resume",
        processTreeController: {
          suspend: () => Effect.void,
          resume: (lease) =>
            Effect.sync(() => resumed.push(lease)).pipe(
              Effect.andThen(Deferred.await(resumeConfirmed)),
            ),
        },
      });
      const rootPid = 906;
      const startTimeMs = 90_600;
      yield* driveToProviderTreeThrottle(governor, {
        threadId: ThreadId.make("thread-confirmed-resume"),
        rootPid,
        startTimeMs,
      });
      for (let index = 3; index <= 6; index += 1) {
        yield* governor.observe(
          sample({
            availableGiB: 8,
            sampledAtMs: index * 1_000,
            processes: growingProviderTree(rootPid, startTimeMs, 2.5),
          }),
        );
      }
      expect((yield* governor.latest).state).toBe("recovering");

      const recoveryObservation = yield* governor
        .observe(
          sample({
            availableGiB: 8,
            sampledAtMs: 7_000,
            processes: growingProviderTree(rootPid, startTimeMs, 2.5),
          }),
        )
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      expect((yield* governor.latest).state).toBe("recovering");
      expect(resumed[0]?.leaseId).toBe("lease-pending-resume");

      yield* Deferred.succeed(resumeConfirmed, undefined);
      yield* Fiber.join(recoveryObservation);
      expect((yield* governor.latest).state).toBe("normal");
    }),
  );

  it.effect("does not retain or resume a lease when process control rejects the suspend", () =>
    Effect.gen(function* () {
      const operations: Array<string> = [];
      const governor = yield* makeSubagentResourceGovernor({
        createProcessTreeLeaseId: () => "lease-reused-before-control",
        processTreeController: {
          suspend: (lease) => {
            operations.push(`suspend:${lease.leaseId}`);
            return Effect.fail(
              new ProviderProcessTreeControlError({
                operation: "suspend",
                leaseId: lease.leaseId,
                resumeRequired: false,
                cause: new Error("PID creation time changed"),
              }),
            );
          },
          resume: (lease) => Effect.sync(() => operations.push(`resume:${lease.leaseId}`)),
        },
      });
      const threadId = ThreadId.make("thread-reused-during-control");

      yield* driveToProviderTreeThrottle(governor, {
        threadId,
        rootPid: 911,
        startTimeMs: 91_000,
      });
      expect((yield* governor.latest).state).not.toBe("throttled");

      yield* governor.unregisterProviderProcess({ pid: 911, startTimeMs: 91_000 });
      yield* governor.shutdown;
      expect(operations).toEqual(["suspend:lease-reused-before-control"]);
    }),
  );

  it.effect("compensates and retains an unconfirmed partial suspend until resume succeeds", () =>
    Effect.gen(function* () {
      const operations: Array<string> = [];
      let resumeAttempts = 0;
      const governor = yield* makeSubagentResourceGovernor({
        createProcessTreeLeaseId: () => "lease-partial-suspend",
        processTreeController: {
          suspend: (lease) => {
            operations.push(`suspend:${lease.leaseId}`);
            return Effect.fail(
              new ProviderProcessTreeControlError({
                operation: "suspend",
                leaseId: lease.leaseId,
                resumeRequired: true,
                cause: new Error("rollback left one owned suspend increment"),
              }),
            );
          },
          resume: (lease) => {
            operations.push(`resume:${lease.leaseId}`);
            resumeAttempts += 1;
            return resumeAttempts === 1
              ? Effect.fail(
                  new ProviderProcessTreeControlError({
                    operation: "resume",
                    leaseId: lease.leaseId,
                    resumeRequired: true,
                    cause: new Error("first compensation failed"),
                  }),
                )
              : Effect.void;
          },
        },
      });
      const threadId = ThreadId.make("thread-partial-suspend");

      yield* driveToProviderTreeThrottle(governor, {
        threadId,
        rootPid: 916,
        startTimeMs: 91_600,
      });

      const pending = yield* governor.latest;
      expect(pending.state).toBe("recovering");
      expect(pending.state).not.toBe("throttled");
      expect(pending.affectedThreadIds).toContain(threadId);
      expect(operations).toEqual(["suspend:lease-partial-suspend", "resume:lease-partial-suspend"]);

      yield* governor.observe(sample({ availableGiB: 12, sampledAtMs: 3_000 }));

      expect(operations).toEqual([
        "suspend:lease-partial-suspend",
        "resume:lease-partial-suspend",
        "resume:lease-partial-suspend",
      ]);
      expect((yield* governor.latest).state).toBe("normal");
    }),
  );

  it.effect(
    "retries the same outstanding lease before admitting work after telemetry reconnect",
    () =>
      Effect.gen(function* () {
        const operations: Array<string> = [];
        let resumeAttempts = 0;
        const governor = yield* makeSubagentResourceGovernor({
          createProcessTreeLeaseId: () => "lease-telemetry-reconnect",
          processTreeController: {
            suspend: (lease) => Effect.sync(() => operations.push(`suspend:${lease.leaseId}`)),
            resume: (lease) => {
              operations.push(`resume:${lease.leaseId}`);
              resumeAttempts += 1;
              return resumeAttempts === 1
                ? Effect.fail(
                    new ProviderProcessTreeControlError({
                      operation: "resume",
                      leaseId: lease.leaseId,
                      resumeRequired: true,
                      cause: new Error("sidecar disconnected"),
                    }),
                  )
                : Effect.void;
            },
          },
        });
        const threadId = ThreadId.make("thread-telemetry-reconnect");
        const rootPid = 921;
        const startTimeMs = 92_000;
        yield* driveToProviderTreeThrottle(governor, { threadId, rootPid, startTimeMs });

        yield* governor.telemetryUnavailable;
        expect((yield* governor.latest).state).toBe("unavailable");
        const waiter = yield* governor
          .awaitAdmission(request("thread-after-reconnect", "config-after-reconnect"))
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        expect(waiter.pollUnsafe()).toBeUndefined();

        yield* governor.observe(
          sample({
            availableGiB: 12,
            sampledAtMs: 3_000,
            processes: growingProviderTree(rootPid, startTimeMs, 2.5),
          }),
        );

        expect(yield* Fiber.join(waiter)).toBe(true);
        expect(operations).toEqual([
          "suspend:lease-telemetry-reconnect",
          "resume:lease-telemetry-reconnect",
          "resume:lease-telemetry-reconnect",
        ]);
        expect((yield* governor.latest).state).not.toBe("throttled");
      }),
  );

  it.effect("keeps an unregistering lease until a later resume is confirmed", () =>
    Effect.gen(function* () {
      const resumed: Array<ProviderProcessTreeLease> = [];
      let resumeAttempts = 0;
      const governor = yield* makeSubagentResourceGovernor({
        createProcessTreeLeaseId: () => "lease-unregister-retry",
        processTreeController: {
          suspend: () => Effect.void,
          resume: (lease) => {
            resumed.push(lease);
            resumeAttempts += 1;
            return resumeAttempts === 1
              ? Effect.fail(
                  new ProviderProcessTreeControlError({
                    operation: "resume",
                    leaseId: lease.leaseId,
                    resumeRequired: true,
                    cause: new Error("transient control failure"),
                  }),
                )
              : Effect.void;
          },
        },
      });
      const threadId = ThreadId.make("thread-unregister-retry");
      const rootPid = 931;
      const startTimeMs = 93_000;
      yield* driveToProviderTreeThrottle(governor, { threadId, rootPid, startTimeMs });

      yield* governor.unregisterProviderProcess({ pid: rootPid, startTimeMs });
      const pending = yield* governor.latest;
      expect(pending.state).toBe("throttled");
      expect(pending.affectedThreadIds).toContain(threadId);

      yield* governor.observe(sample({ availableGiB: 12, sampledAtMs: 3_000 }));

      expect(resumed).toHaveLength(2);
      expect(resumed[0]).toEqual(resumed[1]);
      expect(resumed[0]?.leaseId).toBe("lease-unregister-retry");
      expect((yield* governor.latest).state).toBe("normal");
    }),
  );

  it.effect("retries the same lease during shutdown before clearing governor state", () =>
    Effect.gen(function* () {
      const resumed: Array<ProviderProcessTreeLease> = [];
      let resumeAttempts = 0;
      const governor = yield* makeSubagentResourceGovernor({
        createProcessTreeLeaseId: () => "lease-shutdown-retry",
        processTreeController: {
          suspend: () => Effect.void,
          resume: (lease) => {
            resumed.push(lease);
            resumeAttempts += 1;
            return resumeAttempts === 1
              ? Effect.fail(
                  new ProviderProcessTreeControlError({
                    operation: "resume",
                    leaseId: lease.leaseId,
                    resumeRequired: true,
                    cause: new Error("first shutdown resume failed"),
                  }),
                )
              : Effect.void;
          },
        },
      });
      yield* driveToProviderTreeThrottle(governor, {
        threadId: ThreadId.make("thread-shutdown-retry"),
        rootPid: 941,
        startTimeMs: 94_000,
      });

      yield* governor.shutdown;

      expect(resumed).toHaveLength(2);
      expect(resumed[0]).toEqual(resumed[1]);
      expect(resumed[0]?.leaseId).toBe("lease-shutdown-retry");
      expect((yield* governor.latest).state).toBe("unavailable");
    }),
  );

  it.effect("retains an outstanding lease when shutdown cannot confirm a resume", () =>
    Effect.gen(function* () {
      const resumed: Array<string> = [];
      const threadId = ThreadId.make("thread-shutdown-resume-failed");
      const governor = yield* makeSubagentResourceGovernor({
        createProcessTreeLeaseId: () => "lease-shutdown-unresolved",
        processTreeController: {
          suspend: () => Effect.void,
          resume: (lease) => {
            resumed.push(lease.leaseId);
            return Effect.fail(
              new ProviderProcessTreeControlError({
                operation: "resume",
                leaseId: lease.leaseId,
                resumeRequired: true,
                cause: new Error("sidecar unavailable during shutdown"),
              }),
            );
          },
        },
      });
      yield* driveToProviderTreeThrottle(governor, {
        threadId,
        rootPid: 951,
        startTimeMs: 95_000,
      });

      yield* governor.shutdown;

      expect(resumed).toEqual(["lease-shutdown-unresolved", "lease-shutdown-unresolved"]);
      const stopped = yield* governor.latest;
      expect(stopped.state).toBe("unavailable");
      expect(stopped.affectedThreadIds).toContain(threadId);
    }),
  );

  it.effect("projects the combined growth of all exact provider trees", () =>
    Effect.gen(function* () {
      const signals: Array<{ readonly pid: number; readonly signal: "SIGSTOP" | "SIGCONT" }> = [];
      const governor = yield* makeSubagentResourceGovernor({
        signalProcess: (identity, signal) =>
          Effect.sync(() => signals.push({ pid: identity.pid, signal })),
      });
      yield* governor.registerProviderProcess({
        threadId: ThreadId.make("thread-a"),
        provider: codex,
        providerInstanceId: instanceId,
        pid: 301,
        startTimeMs: 30_000,
      });
      yield* governor.registerProviderProcess({
        threadId: ThreadId.make("thread-b"),
        provider: codex,
        providerInstanceId: instanceId,
        pid: 302,
        startTimeMs: 31_000,
      });
      const processes = (rssGiB: number) => [
        { pid: 301, ppid: 1, startTimeMs: 30_000, residentBytes: rssGiB * GIBIBYTE },
        { pid: 302, ppid: 1, startTimeMs: 31_000, residentBytes: rssGiB * GIBIBYTE },
      ];

      yield* governor.observe(
        sample({ availableGiB: 5.5, sampledAtMs: 0, processes: processes(0.5) }),
      );
      yield* governor.observe(
        sample({ availableGiB: 5.5, sampledAtMs: 1_000, processes: processes(0.8) }),
      );
      expect(signals).toEqual([]);
      yield* governor.observe(
        sample({ availableGiB: 5.5, sampledAtMs: 2_000, processes: processes(1.1) }),
      );

      expect(signals).toEqual([{ pid: 301, signal: "SIGSTOP" }]);
      expect((yield* governor.latest).state).toBe("throttled");
    }),
  );

  it.effect("keeps starts gated after two critical projections when pausing fails", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor({
        signalProcess: (identity, signal) =>
          Effect.fail(
            new ProviderProcessSignalError({
              pid: identity.pid,
              signal,
              cause: new Error(`refused ${signal} for ${identity.pid}`),
            }),
          ),
      });
      yield* governor.registerProviderProcess({
        threadId: ThreadId.make("thread-growing"),
        provider: codex,
        providerInstanceId: instanceId,
        pid: 350,
        startTimeMs: 35_000,
      });
      const processes = (rssGiB: number) => [
        { pid: 350, ppid: 1, startTimeMs: 35_000, residentBytes: rssGiB * GIBIBYTE },
      ];
      yield* governor.observe(
        sample({ availableGiB: 8, sampledAtMs: 0, processes: processes(0.5) }),
      );
      yield* governor.observe(
        sample({ availableGiB: 8, sampledAtMs: 1_000, processes: processes(1.5) }),
      );
      yield* governor.observe(
        sample({ availableGiB: 8, sampledAtMs: 2_000, processes: processes(2.5) }),
      );

      const waiter = yield* governor
        .awaitAdmission(request("thread-waiting", "known-after-critical"))
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(waiter.pollUnsafe()).toBeUndefined();

      yield* governor.observe(
        sample({ availableGiB: 8, sampledAtMs: 3_000, processes: processes(2.5) }),
      );
      expect(yield* Fiber.join(waiter)).toBe(true);
    }),
  );

  it.effect("cancels a visible waiter and resumes its paused process tree", () =>
    Effect.gen(function* () {
      const signals: Array<{ readonly pid: number; readonly signal: "SIGSTOP" | "SIGCONT" }> = [];
      const governor = yield* makeSubagentResourceGovernor({
        signalProcess: (identity, signal) =>
          Effect.sync(() => signals.push({ pid: identity.pid, signal })),
      });
      const threadId = ThreadId.make("thread-cancelled");
      yield* governor.registerProviderProcess({
        threadId,
        provider: codex,
        providerInstanceId: instanceId,
        pid: 401,
        startTimeMs: 40_000,
      });
      const processes = (rssGiB: number) => [
        { pid: 401, ppid: 1, startTimeMs: 40_000, residentBytes: rssGiB * GIBIBYTE },
        { pid: 402, ppid: 401, startTimeMs: 40_100, residentBytes: rssGiB * GIBIBYTE },
      ];
      yield* governor.observe(
        sample({ availableGiB: 5, sampledAtMs: 0, processes: processes(0.5) }),
      );
      yield* governor.observe(
        sample({ availableGiB: 3.5, sampledAtMs: 1_000, processes: processes(1.5) }),
      );
      yield* governor.observe(
        sample({ availableGiB: 3, sampledAtMs: 2_000, processes: processes(2.5) }),
      );

      const waiter = yield* governor
        .awaitAdmission(request(String(threadId)))
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect((yield* governor.latest).waitingStarts).toBe(1);

      yield* governor.cancelThread(threadId);
      expect(yield* Fiber.join(waiter)).toBe(false);
      expect(signals).toEqual([
        { pid: 401, signal: "SIGSTOP" },
        { pid: 402, signal: "SIGSTOP" },
        { pid: 402, signal: "SIGCONT" },
        { pid: 401, signal: "SIGCONT" },
      ]);
      expect((yield* governor.latest).waitingStarts).toBe(0);
    }),
  );

  it.effect("returns registration monitoring demand to baseline after cleanup", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      const demands = yield* governor.monitoringDemand.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* governor.registerProviderProcess({
        threadId: ThreadId.make("thread-demand"),
        provider: codex,
        providerInstanceId: instanceId,
        pid: 501,
        startTimeMs: 50_000,
      });
      yield* governor.unregisterProviderProcess({ pid: 501, startTimeMs: 50_000 });

      expect(Array.from(yield* Fiber.join(demands))).toEqual([false, true, false]);
    }),
  );

  it.effect("releases an active reservation when its last exact provider process exits", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      const threadId = ThreadId.make("thread-provider-exit");
      yield* governor.registerProviderProcess({
        threadId,
        provider: codex,
        providerInstanceId: instanceId,
        pid: 601,
        startTimeMs: 60_000,
      });
      yield* governor.observe(
        sample({
          availableGiB: 10,
          sampledAtMs: 0,
          processes: [
            {
              pid: 601,
              ppid: 1,
              startTimeMs: 60_000,
              residentBytes: GIBIBYTE,
            },
          ],
        }),
      );
      expect(yield* governor.awaitAdmission(request(String(threadId)))).toBe(true);
      expect((yield* governor.latest).reservedMemoryBytes).toBe(4 * GIBIBYTE);

      yield* governor.unregisterProviderProcess({ pid: 601, startTimeMs: 60_000 });
      expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
    }),
  );

  it.effect("holds a root-turn reservation until the matching turn stops", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      const threadId = ThreadId.make("thread-root-turn");
      yield* governor.registerProviderProcess({
        threadId,
        provider: codex,
        providerInstanceId: instanceId,
        pid: 701,
        startTimeMs: 70_000,
      });
      const processes = [
        {
          pid: 701,
          ppid: 1,
          startTimeMs: 70_000,
          residentBytes: GIBIBYTE,
        },
      ];
      yield* governor.observe(sample({ availableGiB: 10, sampledAtMs: 0, processes }));

      expect(
        yield* governor.awaitAdmission({
          ...request(String(threadId), "root-config"),
          retention: { kind: "root-turn", lifecycleId: "turn-root-1" },
        }),
      ).toBe(true);
      expect(
        yield* governor.awaitAdmission({
          ...request(String(threadId), "root-config"),
          retention: { kind: "root-turn", lifecycleId: "turn-root-1" },
        }),
      ).toBe(true);
      expect((yield* governor.latest).reservedMemoryBytes).toBe(4 * GIBIBYTE);
      for (let index = 1; index <= 5; index += 1) {
        yield* governor.observe(
          sample({ availableGiB: 10, sampledAtMs: index * 1_000, processes }),
        );
      }

      expect((yield* governor.latest).reservedMemoryBytes).toBe(4 * GIBIBYTE);
      yield* governor.releaseRootTurn({
        threadId,
        provider: codex,
        providerInstanceId: instanceId,
        lifecycleId: "turn-root-1",
      });
      expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
    }),
  );

  it.effect("holds a confirmed subagent reservation until that agent stops", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      const threadId = ThreadId.make("thread-subagent-lifecycle");
      yield* governor.registerProviderProcess({
        threadId,
        provider: codex,
        providerInstanceId: instanceId,
        pid: 801,
        startTimeMs: 80_000,
      });
      const processes = [
        {
          pid: 801,
          ppid: 1,
          startTimeMs: 80_000,
          residentBytes: GIBIBYTE,
        },
      ];
      yield* governor.observe(sample({ availableGiB: 10, sampledAtMs: 0, processes }));
      expect(
        yield* governor.awaitAdmission({
          ...request(String(threadId), "subagent-config"),
          retention: { kind: "subagent", lifecycleId: "tool-use-1" },
        }),
      ).toBe(true);
      yield* governor.confirmSubagent({
        ...request(String(threadId), "subagent-config"),
        agentId: "agent-1",
      });
      for (let index = 1; index <= 5; index += 1) {
        yield* governor.observe(
          sample({ availableGiB: 10, sampledAtMs: index * 1_000, processes }),
        );
      }

      expect((yield* governor.latest).reservedMemoryBytes).toBe(4 * GIBIBYTE);
      yield* governor.releaseSubagent({
        threadId,
        provider: codex,
        providerInstanceId: instanceId,
        agentId: "agent-1",
      });
      expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
    }),
  );

  it.effect("tracks an already-started subagent once and releases it by agent id", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      const lifecycle = {
        ...request("thread-resumed-subagent", "resumed-config"),
        agentId: "agent-resumed",
      };
      yield* governor.observe(sample({ availableGiB: 10, sampledAtMs: 0 }));

      yield* governor.confirmSubagent(lifecycle);
      yield* governor.confirmSubagent(lifecycle);
      expect((yield* governor.latest).reservedMemoryBytes).toBe(4 * GIBIBYTE);

      yield* governor.releaseSubagent(lifecycle);
      expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
    }),
  );

  it.effect("unblocks all waiters when the governor scope shuts down", () =>
    Effect.gen(function* () {
      const governor = yield* makeSubagentResourceGovernor();
      yield* governor.observe(sample({ availableGiB: 3, sampledAtMs: 0 }));
      const waiter = yield* governor
        .awaitAdmission(request("thread-shutdown"))
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      yield* governor.shutdown;
      expect(yield* Fiber.join(waiter)).toBe(false);
      expect((yield* governor.latest).state).toBe("unavailable");
    }),
  );

  it.effect("refuses to signal a PID whose observed start time no longer matches", () =>
    Effect.gen(function* () {
      const signals: string[] = [];
      const governor = yield* makeSubagentResourceGovernor({
        signalProcess: (_identity, signal) => Effect.sync(() => signals.push(signal)),
      });
      yield* governor.registerProviderProcess({
        threadId: ThreadId.make("thread-reused"),
        provider: codex,
        providerInstanceId: instanceId,
        pid: 303,
        startTimeMs: 30_000,
      });

      const reused = [{ pid: 303, ppid: 1, startTimeMs: 31_000, residentBytes: 5 * GIBIBYTE }];
      yield* governor.observe(sample({ availableGiB: 4, sampledAtMs: 0, processes: reused }));
      yield* governor.observe(sample({ availableGiB: 3, sampledAtMs: 1_000, processes: reused }));
      yield* governor.observe(sample({ availableGiB: 2, sampledAtMs: 2_000, processes: reused }));

      expect(signals).toEqual([]);
    }),
  );
});
