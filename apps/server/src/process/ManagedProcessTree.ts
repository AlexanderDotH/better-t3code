// @effect-diagnostics nodeBuiltinImport:off - SDK process hooks expose native Node child handles.
import * as NodeChildProcess from "node:child_process";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

export const MANAGED_PROCESS_EXIT_CONFIRMATION_TIMEOUT = Duration.seconds(2);

export class ManagedProcessTreeTerminationError extends Data.TaggedError(
  "ManagedProcessTreeTerminationError",
)<{
  readonly pid: number;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

class ManagedProcessTreeSignalError extends Data.TaggedError("ManagedProcessTreeSignalError")<{
  readonly cause: unknown;
}> {}

export type ManagedProcessTreeTerminationResult = "forced" | "already-stopped";

export interface ManagedNodeProcess {
  readonly pid?: number | undefined;
  readonly killed: boolean;
  readonly exitCode: number | null;
  readonly kill: (signal: NodeJS.Signals) => boolean;
  readonly once: (
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => void;
  readonly off: (
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => void;
}

/**
 * Force-terminates an Effect child-process handle and confirms that its exit
 * signal settled. Effect's Node/Bun process implementations target the
 * detached process group on POSIX and use `taskkill /T /F` on Windows, with a
 * direct-child fallback when group termination is unavailable.
 */
export const forceTerminateManagedProcessTree = Effect.fn("forceTerminateManagedProcessTree")(
  function* (
    child: ChildProcessSpawner.ChildProcessHandle,
    confirmationTimeout: Duration.Input = MANAGED_PROCESS_EXIT_CONFIRMATION_TIMEOUT,
  ) {
    const initialRunning = yield* child.isRunning.pipe(Effect.exit);
    if (Exit.isSuccess(initialRunning) && !initialRunning.value) {
      return "already-stopped" as const;
    }

    const killExit = yield* child.kill({ killSignal: "SIGKILL" }).pipe(Effect.exit);
    const exitConfirmation = yield* Effect.exit(child.exitCode).pipe(
      Effect.timeoutOption(confirmationTimeout),
    );
    if (Option.isSome(exitConfirmation)) {
      return "forced" as const;
    }

    const finalRunning = yield* child.isRunning.pipe(Effect.exit);
    if (Exit.isSuccess(finalRunning) && !finalRunning.value) {
      return "forced" as const;
    }

    return yield* new ManagedProcessTreeTerminationError({
      pid: Number(child.pid),
      detail: `Process tree ${String(child.pid)} did not confirm exit within ${Duration.format(
        Duration.fromInputUnsafe(confirmationTimeout),
      )}.`,
      ...(Exit.isFailure(killExit) ? { cause: killExit.cause } : {}),
    });
  },
);

const awaitNodeProcessExit = (child: ManagedNodeProcess) =>
  Effect.callback<void>((resume) => {
    if (child.exitCode !== null) {
      resume(Effect.void);
      return;
    }
    const onExit = () => resume(Effect.void);
    child.once("exit", onExit);
    return Effect.sync(() => child.off("exit", onExit));
  });

const killNodeProcessTree = (child: ManagedNodeProcess) =>
  Effect.gen(function* () {
    const platform = yield* HostProcessPlatform;
    return yield* Effect.callback<void, ManagedProcessTreeSignalError>((resume) => {
      const pid = child.pid;
      const directKill = () => {
        try {
          if (!child.kill("SIGKILL") && child.exitCode === null) {
            throw new Error("Direct child-process SIGKILL was rejected.");
          }
          resume(Effect.void);
        } catch (cause) {
          resume(Effect.fail(new ManagedProcessTreeSignalError({ cause })));
        }
      };

      if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) {
        directKill();
        return;
      }
      if (platform !== "win32") {
        try {
          process.kill(-pid, "SIGKILL");
          resume(Effect.void);
        } catch {
          directKill();
        }
        return;
      }

      NodeChildProcess.execFile("taskkill", ["/PID", String(pid), "/T", "/F"], (error) => {
        if (error && child.exitCode === null) {
          directKill();
          return;
        }
        resume(Effect.void);
      });
    });
  });

/**
 * Equivalent process-tree force termination for SDK hooks that expose a Node
 * child process instead of Effect's ChildProcessHandle.
 */
export const forceTerminateNodeProcessTree = Effect.fn("forceTerminateNodeProcessTree")(function* (
  child: ManagedNodeProcess,
  confirmationTimeout: Duration.Input = MANAGED_PROCESS_EXIT_CONFIRMATION_TIMEOUT,
) {
  if (child.exitCode !== null) {
    return "already-stopped" as const;
  }
  const killExit = yield* killNodeProcessTree(child).pipe(Effect.exit);
  const confirmed = yield* awaitNodeProcessExit(child).pipe(
    Effect.timeoutOption(confirmationTimeout),
  );
  if (Option.isSome(confirmed) || child.exitCode !== null) {
    return "forced" as const;
  }
  return yield* new ManagedProcessTreeTerminationError({
    pid: child.pid ?? -1,
    detail: `Process tree ${String(child.pid ?? "unknown")} did not confirm exit within ${Duration.format(
      Duration.fromInputUnsafe(confirmationTimeout),
    )}.`,
    ...(Exit.isFailure(killExit) ? { cause: killExit.cause } : {}),
  });
});
