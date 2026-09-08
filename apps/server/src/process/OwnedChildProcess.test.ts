import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  forceTerminateOwnedChildProcess,
  forceTerminateOwnedChildProcessAndCleanup,
  OwnedChildProcessTerminationError,
} from "./OwnedChildProcess.ts";

function makeHandle(input: {
  readonly isRunning: Effect.Effect<boolean, PlatformError.PlatformError>;
  readonly kill: (
    options?: ChildProcess.KillOptions,
  ) => Effect.Effect<void, PlatformError.PlatformError>;
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(4242),
    exitCode: Effect.never,
    isRunning: input.isRunning,
    kill: input.kill,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

describe("forceTerminateOwnedChildProcess", () => {
  it.effect("uses SIGKILL and verifies that the exact captured child exited", () =>
    Effect.gen(function* () {
      let running = true;
      let receivedOptions: ChildProcess.KillOptions | undefined;
      const child = makeHandle({
        isRunning: Effect.sync(() => running),
        kill: (options) =>
          Effect.sync(() => {
            receivedOptions = options;
            running = false;
          }),
      });

      yield* forceTerminateOwnedChildProcess({ child });

      expect(receivedOptions).toEqual({ killSignal: "SIGKILL" });
      expect(running).toBe(false);
    }),
  );

  it.effect("treats a kill race as success when the exact child has exited", () =>
    Effect.gen(function* () {
      let inspectionCount = 0;
      const child = makeHandle({
        isRunning: Effect.sync(() => {
          inspectionCount += 1;
          return inspectionCount === 1;
        }),
        kill: () =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "NotFound",
              module: "ChildProcess",
              method: "kill",
              syscall: "kill",
              pathOrDescriptor: "4242",
            }),
          ),
      });

      yield* forceTerminateOwnedChildProcess({ child });

      expect(inspectionCount).toBe(2);
    }),
  );

  it.effect("runs local cleanup when SIGKILL verification fails", () =>
    Effect.gen(function* () {
      let cleanedUp = false;
      const child = makeHandle({
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
      });

      const error = yield* forceTerminateOwnedChildProcessAndCleanup(
        { child },
        Effect.sync(() => {
          cleanedUp = true;
        }),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(OwnedChildProcessTerminationError);
      expect(error.reason).toBe("still-running");
      expect(cleanedUp).toBe(true);
    }),
  );

  it.effect("bounds the full kill and exit verification wait", () =>
    Effect.gen(function* () {
      const killStarted = yield* Deferred.make<void>();
      const child = makeHandle({
        isRunning: Effect.succeed(true),
        kill: () => Deferred.succeed(killStarted, undefined).pipe(Effect.andThen(Effect.never)),
      });
      const errorFiber = yield* forceTerminateOwnedChildProcess({
        child,
        verificationTimeout: "2 seconds",
      }).pipe(Effect.flip, Effect.forkScoped);

      yield* Deferred.await(killStarted);
      yield* TestClock.adjust(Duration.seconds(2));
      const error = yield* Fiber.join(errorFiber);

      expect(error).toMatchObject({
        pid: 4242,
        reason: "verification-timeout",
        timeoutMillis: 2_000,
      });
    }),
  );
});
