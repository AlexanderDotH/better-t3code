/**
 * TurnAbortCoordinator - Coordinates cooperative turn interruption and the
 * generation-fenced force-stop watchdog.
 *
 * The coordinator deliberately owns a lane separate from the provider command
 * reactor. A provider interrupt RPC is allowed to hang without delaying the
 * five-second watchdog.
 *
 * @module TurnAbortCoordinator
 */
import type { IsoDateTime, RuntimeSessionId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import type { ProviderServiceError } from "../../provider/Errors.ts";
import type { OrchestrationDispatchError } from "../Errors.ts";

export interface RequestTurnAbortInput {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly requestedAt: IsoDateTime;
}

export interface SettleCooperativeTurnAbortInput {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly turnId: TurnId | null;
  readonly settledAt: IsoDateTime;
}

export type TurnAbortCoordinatorError =
  | OrchestrationDispatchError
  | ProjectionRepositoryError
  | ProviderServiceError
  | PlatformError.PlatformError;

export interface TurnAbortCoordinatorShape {
  /**
   * Starts an idempotent abort attempt for the exact current runtime lease.
   */
  readonly requestAbort: (
    input: RequestTurnAbortInput,
  ) => Effect.Effect<void, TurnAbortCoordinatorError>;

  /**
   * Called by runtime ingestion when the targeted runtime reports a matching
   * terminal event before force escalation has completed.
   *
   * Returns true only when it authoritatively settled the current attempt.
   */
  readonly settleCooperative: (
    input: SettleCooperativeTurnAbortInput,
  ) => Effect.Effect<boolean, TurnAbortCoordinatorError>;
}

export class TurnAbortCoordinator extends Context.Service<
  TurnAbortCoordinator,
  TurnAbortCoordinatorShape
>()("t3/orchestration/Services/TurnAbortCoordinator") {}
