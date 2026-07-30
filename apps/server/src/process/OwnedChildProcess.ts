import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

const DEFAULT_VERIFICATION_TIMEOUT = Duration.seconds(2);

export type OwnedChildProcessTerminationFailureReason =
  | "inspection-failed"
  | "kill-failed"
  | "still-running"
  | "verification-timeout";

export class OwnedChildProcessTerminationError extends Schema.TaggedErrorClass<OwnedChildProcessTerminationError>()(
  "OwnedChildProcessTerminationError",
  {
    pid: Schema.Number,
    reason: Schema.Literals([
      "inspection-failed",
      "kill-failed",
      "still-running",
      "verification-timeout",
    ]),
    timeoutMillis: Schema.Number,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to terminate owned child process ${this.pid}: ${this.reason}`;
  }
}

export interface ForceTerminateOwnedChildProcessInput {
  readonly child: ChildProcessSpawner.ChildProcessHandle;
  readonly verificationTimeout?: Duration.Input;
}

function terminationError(input: {
  readonly child: ChildProcessSpawner.ChildProcessHandle;
  readonly reason: OwnedChildProcessTerminationFailureReason;
  readonly timeout: Duration.Duration;
  readonly cause?: unknown;
}): OwnedChildProcessTerminationError {
  return new OwnedChildProcessTerminationError({
    pid: Number(input.child.pid),
    reason: input.reason,
    timeoutMillis: Duration.toMillis(input.timeout),
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

/**
 * Sends SIGKILL through the exact captured child handle. The Node process
 * backend targets the detached process group and only resolves `kill` after
 * the child exit has been observed.
 */
export const forceTerminateOwnedChildProcess = Effect.fn("OwnedChildProcess.forceTerminate")(
  function* (
    input: ForceTerminateOwnedChildProcessInput,
  ): Effect.fn.Return<void, OwnedChildProcessTerminationError> {
    const timeout = Duration.fromInputUnsafe(
      input.verificationTimeout ?? DEFAULT_VERIFICATION_TIMEOUT,
    );
    const inspectRunning = input.child.isRunning.pipe(
      Effect.mapError((cause) =>
        terminationError({
          child: input.child,
          reason: "inspection-failed",
          timeout,
          cause,
        }),
      ),
    );
    const terminateAndVerify = Effect.gen(function* () {
      if (!(yield* inspectRunning)) {
        return;
      }

      const killResult = yield* input.child.kill({ killSignal: "SIGKILL" }).pipe(Effect.result);
      const stillRunning = yield* inspectRunning;
      if (!stillRunning) {
        return;
      }
      if (Result.isFailure(killResult)) {
        return yield* terminationError({
          child: input.child,
          reason: "kill-failed",
          timeout,
          cause: killResult.failure,
        });
      }
      return yield* terminationError({
        child: input.child,
        reason: "still-running",
        timeout,
      });
    });

    const result = yield* terminateAndVerify.pipe(Effect.timeoutOption(timeout));
    if (Option.isSome(result)) {
      return result.value;
    }
    return yield* terminationError({
      child: input.child,
      reason: "verification-timeout",
      timeout,
    });
  },
);

/**
 * Keeps process-verification failure visible while guaranteeing that local
 * scopes, queues, and pending interactions are detached from the runtime.
 */
export function forceTerminateOwnedChildProcessAndCleanup<R>(
  input: ForceTerminateOwnedChildProcessInput,
  cleanup: Effect.Effect<void, never, R>,
): Effect.Effect<void, OwnedChildProcessTerminationError, R> {
  return forceTerminateOwnedChildProcess(input).pipe(Effect.ensuring(cleanup));
}
