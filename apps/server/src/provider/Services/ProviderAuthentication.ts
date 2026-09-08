import type {
  ProviderAuthConnectEvent,
  ProviderAuthConnectInput,
  ProviderAuthDisconnectInput,
  ProviderAuthDisconnectResult,
  ProviderAuthOperationError,
  ProviderAuthSetCredentialInput,
  ProviderAuthSetCredentialResult,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

/**
 * Optional account-authentication control surface owned by one provider
 * instance. The registry routes by instance id before invoking this facet, so
 * implementations must never reach into another instance's credential state.
 */
export interface ProviderAuthenticationFacet {
  readonly connect?: (
    input: ProviderAuthConnectInput,
  ) => Stream.Stream<ProviderAuthConnectEvent, ProviderAuthOperationError>;
  readonly setCredential?: (
    input: ProviderAuthSetCredentialInput,
  ) => Effect.Effect<ProviderAuthSetCredentialResult, ProviderAuthOperationError>;
  readonly disconnect?: (
    input: ProviderAuthDisconnectInput,
  ) => Effect.Effect<ProviderAuthDisconnectResult, ProviderAuthOperationError>;
}
