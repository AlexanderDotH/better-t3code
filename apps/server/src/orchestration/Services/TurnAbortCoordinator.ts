/**
 * Coordinates cooperative turn interruption with a generation-fenced
 * force-stop watchdog owned by the server runtime.
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
  readonly requestAbort: (
    input: RequestTurnAbortInput,
  ) => Effect.Effect<void, TurnAbortCoordinatorError>;

  /**
   * Returns true only when this event authoritatively settles the exact
   * runtime-generation and turn targeted by the active abort attempt.
   */
  readonly settleCooperative: (
    input: SettleCooperativeTurnAbortInput,
  ) => Effect.Effect<boolean, TurnAbortCoordinatorError>;
}

export class TurnAbortCoordinator extends Context.Service<
  TurnAbortCoordinator,
  TurnAbortCoordinatorShape
>()("t3/orchestration/Services/TurnAbortCoordinator") {}
