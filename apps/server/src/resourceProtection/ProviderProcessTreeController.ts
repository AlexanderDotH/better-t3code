import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

export interface ProviderProcessIdentity {
  readonly pid: number;
  readonly startTimeMs: number;
}

export type ProviderProcessTreeIdentities = readonly [
  ProviderProcessIdentity,
  ...Array<ProviderProcessIdentity>,
];

export interface ProviderProcessTreeLease {
  readonly leaseId: string;
  readonly processIdentities: ProviderProcessTreeIdentities;
}

export class ProviderProcessTreeControlError extends Schema.TaggedErrorClass<ProviderProcessTreeControlError>()(
  "ProviderProcessTreeControlError",
  {
    operation: Schema.Literals(["suspend", "resume"]),
    leaseId: Schema.String,
    /** Whether the same lease must be resumed before it can be forgotten. */
    resumeRequired: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {}

export interface ProviderProcessTreeController {
  readonly suspend: (
    lease: ProviderProcessTreeLease,
  ) => Effect.Effect<void, ProviderProcessTreeControlError>;
  readonly resume: (
    lease: ProviderProcessTreeLease,
  ) => Effect.Effect<void, ProviderProcessTreeControlError>;
}

type ExactProcessSignaler = (
  identity: ProviderProcessIdentity,
  signal: "SIGSTOP" | "SIGCONT",
) => Effect.Effect<void, Error>;

export function makePosixProviderProcessTreeController(
  signalProcess: ExactProcessSignaler,
): ProviderProcessTreeController {
  const suspend = Effect.fnUntraced(function* (lease: ProviderProcessTreeLease) {
    const paused: Array<ProviderProcessIdentity> = [];
    for (const identity of lease.processIdentities) {
      const result = yield* signalProcess(identity, "SIGSTOP").pipe(Effect.exit);
      if (Exit.isSuccess(result)) {
        paused.push(identity);
        continue;
      }

      const rollbackFailures: Array<unknown> = [];
      for (const pausedIdentity of paused.toReversed()) {
        const rollback = yield* signalProcess(pausedIdentity, "SIGCONT").pipe(Effect.exit);
        if (Exit.isFailure(rollback)) rollbackFailures.push(rollback.cause);
      }
      return yield* new ProviderProcessTreeControlError({
        operation: "suspend",
        leaseId: lease.leaseId,
        resumeRequired: rollbackFailures.length > 0,
        cause: { suspend: result.cause, rollbackFailures },
      });
    }
  });

  const resume = Effect.fnUntraced(function* (lease: ProviderProcessTreeLease) {
    const failures: Array<unknown> = [];
    for (const identity of lease.processIdentities.toReversed()) {
      const result = yield* signalProcess(identity, "SIGCONT").pipe(Effect.exit);
      if (Exit.isFailure(result)) failures.push(result.cause);
    }
    if (failures.length > 0) {
      return yield* new ProviderProcessTreeControlError({
        operation: "resume",
        leaseId: lease.leaseId,
        resumeRequired: true,
        cause: failures,
      });
    }
  });

  return { suspend, resume };
}

interface ProviderProcessTreeDelegateError extends Error {
  readonly _tag?: string;
  readonly resumeRequired?: boolean;
}

function delegatedSuspendFailureRequiresResume(error: ProviderProcessTreeDelegateError): boolean {
  if (typeof error.resumeRequired === "boolean") {
    return error.resumeRequired;
  }
  if (error._tag === "NativeTelemetryUnavailable") return false;
  // Timeouts, write failures, and sidecar exits are ambiguous: the command may
  // have acquired increments before the client lost its receipt.
  return true;
}

export function makeDelegatingProviderProcessTreeController(options: {
  readonly suspendProcessTree: (
    leaseId: string,
    processes: ProviderProcessTreeIdentities,
  ) => Effect.Effect<void, ProviderProcessTreeDelegateError>;
  readonly resumeProcessTree: (
    leaseId: string,
    processes: ProviderProcessTreeIdentities,
  ) => Effect.Effect<void, ProviderProcessTreeDelegateError>;
}): ProviderProcessTreeController {
  const delegate = (
    operation: "suspend" | "resume",
    lease: ProviderProcessTreeLease,
  ): Effect.Effect<void, ProviderProcessTreeControlError> =>
    options[operation === "suspend" ? "suspendProcessTree" : "resumeProcessTree"](
      lease.leaseId,
      lease.processIdentities,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderProcessTreeControlError({
            operation,
            leaseId: lease.leaseId,
            resumeRequired: operation === "resume" || delegatedSuspendFailureRequiresResume(cause),
            cause,
          }),
      ),
    );

  return {
    suspend: (lease) => delegate("suspend", lease),
    resume: (lease) => delegate("resume", lease),
  };
}
