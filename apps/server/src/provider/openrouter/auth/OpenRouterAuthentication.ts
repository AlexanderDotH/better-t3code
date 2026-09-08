import {
  ProviderAuthOperationError,
  type ProviderInstanceId,
  type ServerProviderAuth,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import type { ProviderAdapterError } from "../../Errors.ts";
import type { ProviderAuthenticationFacet } from "../../Services/ProviderAuthentication.ts";
import type {
  OpenRouterCredentialSource,
  OpenRouterCredentialStore,
} from "./OpenRouterCredentialStore.ts";
import type {
  OpenRouterKeyProfile,
  OpenRouterKeyValidationError,
  OpenRouterKeyValidator,
} from "./OpenRouterKeyValidation.ts";

const CREDENTIAL_CAPABILITY = {
  kind: "api-key",
  label: "API key",
  placeholder: "sk-or-v1-…",
} as const;

const authCapabilities = (canDisconnect: boolean) => ({
  flows: [],
  canDisconnect,
  credential: CREDENTIAL_CAPABILITY,
});

export function openRouterUnauthenticatedAuth(): ServerProviderAuth {
  return {
    status: "unauthenticated",
    type: "api-key",
    capabilities: authCapabilities(false),
  };
}

export function openRouterAuthenticatedAuth(
  profile: OpenRouterKeyProfile,
  input: { readonly source: OpenRouterCredentialSource },
): ServerProviderAuth {
  return {
    status: "authenticated",
    type: "api-key",
    label: profile.label,
    ...(profile.expiresAt ? { expiresAt: profile.expiresAt } : {}),
    capabilities: authCapabilities(input.source === "stored"),
    plan: profile.isFreeTier
      ? { id: "free", label: "Free tier" }
      : { id: "paid", label: "Paid account" },
  };
}

const operationError = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly operation: ProviderAuthOperationError["operation"];
  readonly code: ProviderAuthOperationError["code"];
  readonly reason: string;
  readonly retryable: boolean;
}) => new ProviderAuthOperationError(input);

function validationOperationError(
  instanceId: ProviderInstanceId,
  operation: ProviderAuthOperationError["operation"],
  error: OpenRouterKeyValidationError,
): ProviderAuthOperationError {
  if (error.code === "credential-invalid") {
    return operationError({
      instanceId,
      operation,
      code: "credential-invalid",
      reason: "OpenRouter rejected this API key.",
      retryable: false,
    });
  }
  if (error.code === "credential-not-inference") {
    return operationError({
      instanceId,
      operation,
      code: "credential-invalid",
      reason:
        "OpenRouter Management API keys cannot run model inference. Create a standard API key on OpenRouter's Keys page.",
      retryable: false,
    });
  }
  return operationError({
    instanceId,
    operation,
    code: "unknown",
    reason: "OpenRouter could not validate the API key.",
    retryable: error.retryable,
  });
}

function requireInstance(
  expected: ProviderInstanceId,
  actual: ProviderInstanceId,
  operation: ProviderAuthOperationError["operation"],
): Effect.Effect<void, ProviderAuthOperationError> {
  if (expected === actual) return Effect.void;
  return Effect.fail(
    operationError({
      instanceId: expected,
      operation,
      code: "provider-not-found",
      reason: `Expected provider instance '${expected}'.`,
      retryable: false,
    }),
  );
}

export function makeOpenRouterAuthentication(input: {
  readonly instanceId: ProviderInstanceId;
  readonly credentialStore: OpenRouterCredentialStore;
  readonly keyValidator: OpenRouterKeyValidator;
  readonly stopAll: Effect.Effect<void, ProviderAdapterError>;
  readonly refreshSnapshot: Effect.Effect<unknown>;
}): ProviderAuthenticationFacet {
  const stopAll = Effect.fn("OpenRouterAuthentication.stopAll")(function* (
    operation: ProviderAuthOperationError["operation"],
  ) {
    yield* input.stopAll.pipe(
      Effect.mapError(() =>
        operationError({
          instanceId: input.instanceId,
          operation,
          code: "disconnect-conflict",
          reason: "Active OpenRouter sessions could not be stopped before changing credentials.",
          retryable: true,
        }),
      ),
    );
  });

  const validate = Effect.fn("OpenRouterAuthentication.validate")(function* (
    operation: ProviderAuthOperationError["operation"],
    apiKey: Redacted.Redacted<string>,
  ) {
    return yield* input.keyValidator
      .validate(apiKey)
      .pipe(
        Effect.mapError((error) => validationOperationError(input.instanceId, operation, error)),
      );
  });

  const refreshSnapshot = input.refreshSnapshot.pipe(Effect.ignoreCause({ log: true }));

  const setCredential: NonNullable<ProviderAuthenticationFacet["setCredential"]> = Effect.fn(
    "OpenRouterAuthentication.setCredential",
  )(function* (request) {
    yield* requireInstance(input.instanceId, request.instanceId, "set-credential");
    const apiKey = Redacted.make(request.credential.trim());
    const profile = yield* validate("set-credential", apiKey);
    yield* stopAll("set-credential");
    yield* input.credentialStore.setStored(Redacted.value(apiKey)).pipe(
      Effect.mapError(() =>
        operationError({
          instanceId: input.instanceId,
          operation: "set-credential",
          code: "credential-storage-failed",
          reason: "OpenRouter API key validation succeeded, but secure storage failed.",
          retryable: true,
        }),
      ),
    );
    yield* refreshSnapshot;
    return {
      instanceId: input.instanceId,
      auth: openRouterAuthenticatedAuth(profile, { source: "stored" }),
    };
  });

  const disconnect: NonNullable<ProviderAuthenticationFacet["disconnect"]> = Effect.fn(
    "OpenRouterAuthentication.disconnect",
  )(function* (request) {
    yield* requireInstance(input.instanceId, request.instanceId, "disconnect");
    const stored = yield* input.credentialStore.readStored.pipe(
      Effect.mapError(() =>
        operationError({
          instanceId: input.instanceId,
          operation: "disconnect",
          code: "credential-removal-failed",
          reason: "The stored OpenRouter API key could not be inspected.",
          retryable: true,
        }),
      ),
    );
    if (Option.isNone(stored)) {
      return yield* operationError({
        instanceId: input.instanceId,
        operation: "disconnect",
        code: "auth-unsupported",
        reason:
          "This OpenRouter credential is managed by the provider instance environment. Remove OPENROUTER_API_KEY from that instance instead.",
        retryable: false,
      });
    }

    yield* stopAll("disconnect");
    yield* input.credentialStore.removeStored.pipe(
      Effect.mapError(() =>
        operationError({
          instanceId: input.instanceId,
          operation: "disconnect",
          code: "credential-removal-failed",
          reason: "The stored OpenRouter API key could not be removed.",
          retryable: true,
        }),
      ),
    );
    const remaining = yield* input.credentialStore.resolveOption.pipe(
      Effect.mapError(() =>
        operationError({
          instanceId: input.instanceId,
          operation: "disconnect",
          code: "unknown",
          reason: "OpenRouter credential status could not be refreshed.",
          retryable: true,
        }),
      ),
    );
    const auth = yield* Option.match(remaining, {
      onNone: () => Effect.succeed(openRouterUnauthenticatedAuth()),
      onSome: (credential) =>
        validate("disconnect", credential.apiKey).pipe(
          Effect.map((profile) =>
            openRouterAuthenticatedAuth(profile, { source: credential.source }),
          ),
        ),
    });
    yield* refreshSnapshot;
    return { instanceId: input.instanceId, auth };
  });

  return { setCredential, disconnect };
}
