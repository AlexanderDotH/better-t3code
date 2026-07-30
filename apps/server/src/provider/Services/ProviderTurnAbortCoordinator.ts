import type { ThreadId, TurnId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProviderServiceError } from "../Errors.ts";

export interface ProviderTurnAbortInput {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
}

export interface ProviderTurnAbortCoordinatorShape {
  readonly requestAbort: (
    input: ProviderTurnAbortInput,
  ) => Effect.Effect<boolean, ProviderServiceError>;
  readonly forceAbort: (
    input: ProviderTurnAbortInput,
  ) => Effect.Effect<boolean, ProviderServiceError>;
}

export class ProviderTurnAbortCoordinator extends Context.Service<
  ProviderTurnAbortCoordinator,
  ProviderTurnAbortCoordinatorShape
>()("t3/provider/Services/ProviderTurnAbortCoordinator") {}
