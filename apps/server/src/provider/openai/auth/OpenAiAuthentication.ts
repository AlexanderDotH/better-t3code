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
import type { OpenAiCredentialSource, OpenAiCredentialStore } from "./OpenAiCredentialStore.ts";
import type {
  OpenAiKeyProfile,
  OpenAiKeyValidationError,
  OpenAiKeyValidator,
} from "./OpenAiKeyValidation.ts";

const CREDENTIAL_CAPABILITY = {
  kind: "api-key",
  label: "API key",
  placeholder: "sk-…",
} as const;

const authCapabilities = (canDisconnect: boolean) => ({
  flows: [],
  canDisconnect,
  credential: CREDENTIAL_CAPABILITY,
});

export function openAiUnauthenticatedAuth(): ServerProviderAuth {
  return {
    status: "unauthenticated",
    type: "api-key",
    capabilities: authCapabilities(false),
  };
}

export function openAiAuthenticatedAuth(
  profile: OpenAiKeyProfile,
  input: { readonly source: OpenAiCredentialSource },
): ServerProviderAuth {
  return {
    status: "authenticated",
    type: "api-key",
    label: profile.label,
    capabilities: authCapabilities(input.source === "stored"),
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
  error: OpenAiKeyValidationError,
): ProviderAuthOperationError {
  if (error.code === "credential-invalid") {
    return operationError({
      instanceId,
      operation,
      code: "credential-invalid",
      reason: "OpenAI rejected this API key.",
      retryable: false,
    });
  }
  return operationError({
    instanceId,
    operation,
    code: "unknown",
    reason:
      error.code === "rate-limited"
        ? "OpenAI rate limited API-key validation."
        : "OpenAI could not validate this API key.",
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

export function makeOpenAiAuthentication(input: {
  readonly instanceId: ProviderInstanceId;
  readonly credentialStore: OpenAiCredentialStore;
  readonly keyValidator: OpenAiKeyValidator;
  readonly stopAll: Effect.Effect<void, ProviderAdapterError>;
  readonly refreshSnapshot: Effect.Effect<unknown>;
}): ProviderAuthenticationFacet {
  const stopAll = Effect.fn("OpenAiAuthentication.stopAll")(function* (
    operation: ProviderAuthOperationError["operation"],
  ) {
    yield* input.stopAll.pipe(
      Effect.mapError(() =>
        operationError({
          instanceId: input.instanceId,
          operation,
          code: "disconnect-conflict",
          reason: "Active OpenAI sessions could not be stopped before changing credentials.",
          retryable: true,
        }),
      ),
    );
  });

  const validate = Effect.fn("OpenAiAuthentication.validate")(function* (
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
    "OpenAiAuthentication.setCredential",
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
          reason: "OpenAI API-key validation succeeded, but secure storage failed.",
          retryable: true,
        }),
      ),
    );
    yield* refreshSnapshot;
    return {
      instanceId: input.instanceId,
      auth: openAiAuthenticatedAuth(profile, { source: "stored" }),
    };
  });

  const disconnect: NonNullable<ProviderAuthenticationFacet["disconnect"]> = Effect.fn(
    "OpenAiAuthentication.disconnect",
  )(function* (request) {
    yield* requireInstance(input.instanceId, request.instanceId, "disconnect");
    const stored = yield* input.credentialStore.readStored.pipe(
      Effect.mapError(() =>
        operationError({
          instanceId: input.instanceId,
          operation: "disconnect",
          code: "credential-removal-failed",
          reason: "The stored OpenAI API key could not be inspected.",
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
          "This OpenAI credential is managed by the provider instance environment. Remove OPENAI_API_KEY from that instance instead.",
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
          reason: "The stored OpenAI API key could not be removed.",
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
          reason: "OpenAI credential status could not be refreshed.",
          retryable: true,
        }),
      ),
    );
    const auth = yield* Option.match(remaining, {
      onNone: () => Effect.succeed(openAiUnauthenticatedAuth()),
      onSome: (credential) =>
        validate("disconnect", credential.apiKey).pipe(
          Effect.map((profile) => openAiAuthenticatedAuth(profile, { source: credential.source })),
        ),
    });
    yield* refreshSnapshot;
    return { instanceId: input.instanceId, auth };
  });

  return { setCredential, disconnect };
}
