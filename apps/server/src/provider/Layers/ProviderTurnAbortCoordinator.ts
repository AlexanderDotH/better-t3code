import type { ThreadId, TurnId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import type { ProviderServiceError } from "../Errors.ts";
import {
  ProviderService,
  type ProviderAbortTarget,
  type ProviderForceStopResult,
} from "../Services/ProviderService.ts";
import {
  ProviderTurnAbortCoordinator,
  type ProviderTurnAbortCoordinatorShape,
  type ProviderTurnAbortInput,
} from "../Services/ProviderTurnAbortCoordinator.ts";

export const FORCE_ABORT_GRACE_PERIOD = Duration.seconds(5);

export interface ProviderAbortControl {
  readonly captureAbortTarget: (
    threadId: ThreadId,
  ) => Effect.Effect<ProviderAbortTarget | null, ProviderServiceError>;
  readonly interruptAbortTarget: (
    target: ProviderAbortTarget,
  ) => Effect.Effect<void, ProviderServiceError>;
  readonly forceStopAbortTarget: (
    target: ProviderAbortTarget,
  ) => Effect.Effect<ProviderForceStopResult, ProviderServiceError>;
}

interface AbortAttempt {
  readonly orchestrationTurnId: TurnId;
  readonly target: ProviderAbortTarget;
}

function sameAbortTarget(left: ProviderAbortTarget, right: ProviderAbortTarget): boolean {
  return (
    left.threadId === right.threadId &&
    left.providerInstanceId === right.providerInstanceId &&
    left.providerSessionId === right.providerSessionId &&
    left.turnGeneration === right.turnGeneration
  );
}

export const makeProviderTurnAbortCoordinator = Effect.fn("makeProviderTurnAbortCoordinator")(
  function* (options: {
    readonly abortControl: ProviderAbortControl;
    readonly gracePeriod?: Duration.Input;
  }) {
    const scope = yield* Scope.Scope;
    const attempts = yield* Ref.make(new Map<ThreadId, AbortAttempt>());
    const gracePeriod = options.gracePeriod ?? FORCE_ABORT_GRACE_PERIOD;

    const removeAttempt = Effect.fn("ProviderTurnAbortCoordinator.removeAttempt")(function* (
      attempt: AbortAttempt,
    ) {
      yield* Ref.update(attempts, (current) => {
        const existing = current.get(attempt.target.threadId);
        if (
          existing?.orchestrationTurnId !== attempt.orchestrationTurnId ||
          !sameAbortTarget(existing.target, attempt.target)
        ) {
          return current;
        }
        const next = new Map(current);
        next.delete(attempt.target.threadId);
        return next;
      });
    });

    const forceAttempt = Effect.fn("ProviderTurnAbortCoordinator.forceAttempt")(function* (
      attempt: AbortAttempt,
    ) {
      const result = yield* options.abortControl.forceStopAbortTarget(attempt.target);
      yield* removeAttempt(attempt);
      return result;
    });

    const forcePendingAttempt = Effect.fn("ProviderTurnAbortCoordinator.forcePendingAttempt")(
      function* (input: ProviderTurnAbortInput) {
        const current = yield* Ref.get(attempts);
        const attempt = current.get(input.threadId);
        if (attempt?.orchestrationTurnId !== input.turnId) {
          return false;
        }
        yield* forceAttempt(attempt);
        return true;
      },
    );

    const requestAbort: ProviderTurnAbortCoordinatorShape["requestAbort"] = Effect.fn(
      "ProviderTurnAbortCoordinator.requestAbort",
    )(function* (input) {
      const target = yield* options.abortControl.captureAbortTarget(input.threadId);
      if (target === null) {
        return false;
      }
      const attempt: AbortAttempt = {
        orchestrationTurnId: input.turnId,
        target,
      };
      const inserted = yield* Ref.modify(attempts, (current) => {
        const existing = current.get(input.threadId);
        if (
          existing?.orchestrationTurnId === input.turnId &&
          sameAbortTarget(existing.target, target)
        ) {
          return [false, current] as const;
        }
        const next = new Map(current);
        next.set(input.threadId, attempt);
        return [true, next] as const;
      });
      if (!inserted) {
        return true;
      }

      yield* options.abortControl.interruptAbortTarget(target).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "cooperative provider turn interruption failed; force-abort remains armed",
            {
              threadId: input.threadId,
              providerInstanceId: target.providerInstanceId,
              cause: Cause.pretty(cause),
            },
          ),
        ),
        Effect.forkIn(scope),
      );
      yield* Effect.sleep(gracePeriod).pipe(
        Effect.andThen(forcePendingAttempt(input)),
        Effect.catchCause((cause) =>
          Effect.logWarning("automatic provider turn force-abort failed", {
            threadId: input.threadId,
            providerInstanceId: target.providerInstanceId,
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.forkIn(scope),
      );
      return true;
    });

    const forceAbort: ProviderTurnAbortCoordinatorShape["forceAbort"] = Effect.fn(
      "ProviderTurnAbortCoordinator.forceAbort",
    )(function* (input) {
      const forcedPending = yield* forcePendingAttempt(input);
      if (forcedPending) {
        return true;
      }
      const target = yield* options.abortControl.captureAbortTarget(input.threadId);
      if (target === null) {
        return false;
      }
      yield* forceAttempt({
        orchestrationTurnId: input.turnId,
        target,
      });
      return true;
    });

    return ProviderTurnAbortCoordinator.of({
      requestAbort,
      forceAbort,
    });
  },
);

export const ProviderTurnAbortCoordinatorLive = Layer.effect(
  ProviderTurnAbortCoordinator,
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    return yield* makeProviderTurnAbortCoordinator({
      abortControl: {
        captureAbortTarget: providerService.captureAbortTarget,
        interruptAbortTarget: providerService.interruptAbortTarget,
        forceStopAbortTarget: providerService.forceStopAbortTarget,
      },
    });
  }),
);
