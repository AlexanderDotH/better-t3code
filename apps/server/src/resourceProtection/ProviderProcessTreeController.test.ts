import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import {
  makeDelegatingProviderProcessTreeController,
  makePosixProviderProcessTreeController,
  type ProviderProcessTreeLease,
} from "./ProviderProcessTreeController.ts";

const lease: ProviderProcessTreeLease = {
  leaseId: "lease-exact-tree",
  processIdentities: [
    { pid: 101, startTimeMs: 10_000 },
    { pid: 102, startTimeMs: 10_100 },
  ],
};

describe("ProviderProcessTreeController", () => {
  it.effect("pauses an exact POSIX tree in parent-first order and resumes it child-first", () =>
    Effect.gen(function* () {
      const signals: Array<string> = [];
      const controller = makePosixProviderProcessTreeController((identity, signal) =>
        Effect.sync(() => signals.push(`${signal}:${identity.pid}`)),
      );

      yield* controller.suspend(lease);
      yield* controller.resume(lease);

      expect(signals).toEqual(["SIGSTOP:101", "SIGSTOP:102", "SIGCONT:102", "SIGCONT:101"]);
    }),
  );

  it.effect("rolls back only the exact processes paused before a suspend failure", () =>
    Effect.gen(function* () {
      const signals: Array<string> = [];
      const controller = makePosixProviderProcessTreeController((identity, signal) => {
        signals.push(`${signal}:${identity.pid}`);
        if (signal === "SIGSTOP" && identity.pid === 102) {
          return Effect.fail(new Error("PID identity changed before suspend"));
        }
        return Effect.void;
      });

      const result = yield* controller.suspend(lease).pipe(Effect.exit);

      expect(Exit.isFailure(result)).toBe(true);
      expect(signals).toEqual(["SIGSTOP:101", "SIGSTOP:102", "SIGCONT:101"]);
      expect(signals.some((signal) => signal.endsWith(":999"))).toBe(false);
    }),
  );

  it.effect("marks a failed POSIX rollback as requiring compensation", () =>
    Effect.gen(function* () {
      const controller = makePosixProviderProcessTreeController((identity, signal) => {
        if (signal === "SIGSTOP" && identity.pid === 102) {
          return Effect.fail(new Error("suspend refused"));
        }
        if (signal === "SIGCONT" && identity.pid === 101) {
          return Effect.fail(new Error("rollback refused"));
        }
        return Effect.void;
      });

      const error = yield* controller.suspend(lease).pipe(Effect.flip);

      expect(error.resumeRequired).toBe(true);
    }),
  );

  it.effect("attempts every exact resume even when one process cannot be resumed", () =>
    Effect.gen(function* () {
      const signals: Array<string> = [];
      const controller = makePosixProviderProcessTreeController((identity, signal) => {
        signals.push(`${signal}:${identity.pid}`);
        if (signal === "SIGCONT" && identity.pid === 102) {
          return Effect.fail(new Error("resume refused"));
        }
        return Effect.void;
      });

      const result = yield* controller.resume(lease).pipe(Effect.exit);

      expect(Exit.isFailure(result)).toBe(true);
      expect(signals).toEqual(["SIGCONT:102", "SIGCONT:101"]);
    }),
  );

  it.effect("delegates the unchanged lease to native suspend and resume operations", () =>
    Effect.gen(function* () {
      const operations: Array<{
        readonly operation: "suspend" | "resume";
        readonly leaseId: string;
        readonly processIdentities: ProviderProcessTreeLease["processIdentities"];
      }> = [];
      const controller = makeDelegatingProviderProcessTreeController({
        suspendProcessTree: (leaseId, processIdentities) =>
          Effect.sync(() => operations.push({ operation: "suspend", leaseId, processIdentities })),
        resumeProcessTree: (leaseId, processIdentities) =>
          Effect.sync(() => operations.push({ operation: "resume", leaseId, processIdentities })),
      });

      yield* controller.suspend(lease);
      yield* controller.resume(lease);

      expect(operations).toEqual([
        {
          operation: "suspend",
          leaseId: lease.leaseId,
          processIdentities: lease.processIdentities,
        },
        {
          operation: "resume",
          leaseId: lease.leaseId,
          processIdentities: lease.processIdentities,
        },
      ]);
    }),
  );

  it.effect("preserves whether a rejected native suspend still owns a lease", () =>
    Effect.gen(function* () {
      const controller = makeDelegatingProviderProcessTreeController({
        suspendProcessTree: () =>
          Effect.fail(
            Object.assign(new Error("partial native suspend"), {
              _tag: "NativeTelemetryProcessControlFailed",
              resumeRequired: true,
            }),
          ),
        resumeProcessTree: () => Effect.void,
      });

      const error = yield* controller.suspend(lease).pipe(Effect.flip);

      expect(error.resumeRequired).toBe(true);
    }),
  );
});
