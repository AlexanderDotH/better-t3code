import {
  ProviderAuthOperationError,
  type ProviderInstanceId,
  type ServerProviderAuth,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import type * as Scope from "effect/Scope";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAuthenticationFacet } from "../Services/ProviderAuthentication.ts";
import type { OpenAiCompatibleCredentialStore } from "./OpenAiCompatibleCredentialStore.ts";
import type { OpenAiCompatibleTransportError } from "./OpenAiCompatibleTransport.ts";

export function openAiCompatibleAuth(input: {
  readonly hasCredential: boolean;
  readonly status?: ServerProviderAuth["status"];
}): ServerProviderAuth {
  return {
    status: input.status ?? "unknown",
    type: "api-key-optional",
    label: input.hasCredential ? "API key saved" : "No API key",
    capabilities: {
      flows: [],
      canDisconnect: input.hasCredential,
      credential: { kind: "api-key", label: "API key" },
    },
  };
}

export function makeOpenAiCompatibleAuthentication(input: {
  readonly instanceId: ProviderInstanceId;
  readonly scope: Scope.Scope;
  readonly credentialStore: OpenAiCompatibleCredentialStore;
  readonly validateCredential: (
    apiKey: Redacted.Redacted<string>,
  ) => Effect.Effect<unknown, OpenAiCompatibleTransportError>;
  readonly stopAll: Effect.Effect<void, ProviderAdapterError>;
  readonly refreshSnapshot: Effect.Effect<unknown>;
}): ProviderAuthenticationFacet {
  const withinInstance = <A>(effect: Effect.Effect<A, ProviderAuthOperationError>) =>
    Effect.acquireUseRelease(Effect.forkIn(effect, input.scope), Fiber.join, Fiber.interrupt);

  const operationError = (
    operation: ProviderAuthOperationError["operation"],
    code: ProviderAuthOperationError["code"],
    reason: string,
    retryable: boolean,
  ) =>
    new ProviderAuthOperationError({
      instanceId: input.instanceId,
      operation,
      code,
      reason,
      retryable,
    });

  const requireInstance = (
    actual: ProviderInstanceId,
    operation: ProviderAuthOperationError["operation"],
  ) =>
    actual === input.instanceId
      ? Effect.void
      : Effect.fail(
          operationError(
            operation,
            "provider-not-found",
            "Provider instance does not match.",
            false,
          ),
        );

  const stopAll = (operation: ProviderAuthOperationError["operation"]) =>
    input.stopAll.pipe(
      Effect.mapError(() =>
        operationError(
          operation,
          "disconnect-conflict",
          "Active endpoint sessions could not be stopped before changing credentials.",
          true,
        ),
      ),
    );

  const refreshSnapshot = input.refreshSnapshot.pipe(Effect.ignoreCause({ log: true }));

  const setCredential: NonNullable<ProviderAuthenticationFacet["setCredential"]> = Effect.fn(
    "OpenAiCompatibleAuthentication.setCredential",
  )(function* (request) {
    yield* requireInstance(request.instanceId, "set-credential");
    const normalized = request.credential.trim();
    if (!normalized) {
      return yield* operationError(
        "set-credential",
        "credential-invalid",
        "API key must not be empty.",
        false,
      );
    }
    if (!input.credentialStore.baseUrl) {
      return yield* operationError(
        "set-credential",
        "unknown",
        "Configure an endpoint base URL before saving an API key.",
        false,
      );
    }
    const verified = yield* input.validateCredential(Redacted.make(normalized)).pipe(
      Effect.as(true),
      Effect.catch((error) => {
        if (error._tag === "OpenAiCompatibleHttpError" && error.category === "catalog-not-found") {
          return Effect.succeed(false);
        }
        const rejected = error._tag === "OpenAiCompatibleAuthenticationError";
        const retryable =
          error._tag === "OpenAiCompatibleHttpError" &&
          ["network", "timeout", "rate-limit", "service-unavailable"].includes(error.category);
        return Effect.fail(
          operationError(
            "set-credential",
            rejected ? "credential-invalid" : "unknown",
            rejected
              ? "The configured endpoint rejected this API key."
              : "The configured endpoint could not validate this API key.",
            retryable,
          ),
        );
      }),
    );
    yield* stopAll("set-credential");
    yield* input.credentialStore
      .setStored(normalized)
      .pipe(
        Effect.mapError(() =>
          operationError(
            "set-credential",
            "credential-storage-failed",
            "The endpoint API key could not be saved securely.",
            true,
          ),
        ),
      );
    yield* refreshSnapshot;
    return {
      instanceId: input.instanceId,
      auth: openAiCompatibleAuth({
        hasCredential: true,
        status: verified ? "authenticated" : "unknown",
      }),
    };
  });

  const disconnect: NonNullable<ProviderAuthenticationFacet["disconnect"]> = Effect.fn(
    "OpenAiCompatibleAuthentication.disconnect",
  )(function* (request) {
    yield* requireInstance(request.instanceId, "disconnect");
    yield* stopAll("disconnect");
    yield* input.credentialStore.removeStored.pipe(
      Effect.mapError(() =>
        operationError(
          "disconnect",
          "credential-removal-failed",
          "The stored endpoint API key could not be removed.",
          true,
        ),
      ),
    );
    yield* refreshSnapshot;
    return { instanceId: input.instanceId, auth: openAiCompatibleAuth({ hasCredential: false }) };
  });

  return {
    setCredential: (request) => withinInstance(setCredential(request)),
    disconnect: (request) => withinInstance(disconnect(request)),
  };
}
