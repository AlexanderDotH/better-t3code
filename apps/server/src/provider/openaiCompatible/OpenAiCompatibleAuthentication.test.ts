import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { ProviderAdapterRequestError } from "../Errors.ts";
import { makeOpenAiCompatibleAuthentication } from "./OpenAiCompatibleAuthentication.ts";
import {
  OpenAiCompatibleCredentialStoreError,
  type OpenAiCompatibleCredentialStore,
} from "./OpenAiCompatibleCredentialStore.ts";
import {
  OpenAiCompatibleAuthenticationError,
  OpenAiCompatibleHttpError,
} from "./OpenAiCompatibleTransport.ts";

const INSTANCE_ID = ProviderInstanceId.make("endpoint_personal");
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function makeStore(initial?: string) {
  let key = initial;
  const store: OpenAiCompatibleCredentialStore = {
    instanceId: INSTANCE_ID,
    baseUrl: "http://localhost:1234/v1",
    readStored: Effect.sync(() => Option.map(Option.fromNullishOr(key), Redacted.make)),
    setStored: (value) =>
      Effect.sync(() => {
        key = value;
      }),
    removeStored: Effect.sync(() => {
      key = undefined;
    }),
  };
  return { store, getKey: () => key };
}

const makeAuthentication = (
  credentialStore: OpenAiCompatibleCredentialStore,
  overrides: Partial<Parameters<typeof makeOpenAiCompatibleAuthentication>[0]> = {},
) =>
  makeOpenAiCompatibleAuthentication({
    instanceId: INSTANCE_ID,
    scope: Scope.makeUnsafe(),
    credentialStore,
    validateCredential: () => Effect.void,
    stopAll: Effect.void,
    refreshSnapshot: Effect.void,
    ...overrides,
  });

describe("OpenAiCompatibleAuthentication", () => {
  it.effect("validates a candidate before stopping sessions or replacing the old key", () =>
    Effect.gen(function* () {
      const memory = makeStore("old-key");
      let stops = 0;
      const auth = makeAuthentication(memory.store, {
        validateCredential: () =>
          Effect.fail(
            new OpenAiCompatibleAuthenticationError({
              status: 401,
              message: "rejected-secret-key",
            }),
          ),
        stopAll: Effect.sync(() => {
          stops += 1;
        }),
      });
      const error = yield* Effect.flip(
        auth.setCredential!({ instanceId: INSTANCE_ID, credential: "rejected-secret-key" }),
      );
      expect(error).toMatchObject({ code: "credential-invalid", retryable: false });
      expect(encodeJson(error)).not.toContain("rejected-secret-key");
      expect(memory.getKey()).toBe("old-key");
      expect(stops).toBe(0);
    }),
  );

  it.effect("replaces a valid key and publishes only safe credential metadata", () =>
    Effect.gen(function* () {
      const memory = makeStore("old-key");
      const operations: string[] = [];
      const auth = makeAuthentication(memory.store, {
        validateCredential: (key) =>
          Effect.sync(() => {
            expect(Redacted.value(key)).toBe("new-secret-key");
            expect(memory.getKey()).toBe("old-key");
            operations.push("validate");
          }),
        stopAll: Effect.sync(() => {
          operations.push("stop");
        }),
        refreshSnapshot: Effect.sync(() => {
          expect(memory.getKey()).toBe("new-secret-key");
          operations.push("refresh");
        }),
      });
      const result = yield* auth.setCredential!({
        instanceId: INSTANCE_ID,
        credential: " new-secret-key ",
      });
      expect(result.auth).toMatchObject({
        status: "authenticated",
        type: "api-key-optional",
        capabilities: { canDisconnect: true },
      });
      expect(encodeJson(result)).not.toContain("new-secret-key");
      expect(operations).toEqual(["validate", "stop", "refresh"]);
    }),
  );

  it.effect("accepts an unverified key when the endpoint does not implement /models", () =>
    Effect.gen(function* () {
      const memory = makeStore();
      const auth = makeAuthentication(memory.store, {
        validateCredential: () =>
          Effect.fail(
            new OpenAiCompatibleHttpError({
              operation: "models",
              category: "catalog-not-found",
              status: 404,
              message: "No catalog",
            }),
          ),
      });
      const result = yield* auth.setCredential!({
        instanceId: INSTANCE_ID,
        credential: "manual-key",
      });
      expect(memory.getKey()).toBe("manual-key");
      expect(result.auth).toMatchObject({
        status: "unknown",
        capabilities: { canDisconnect: true },
      });
    }),
  );

  it.effect("preserves the old key on connection, storage, or session-stop failure", () =>
    Effect.gen(function* () {
      const memory = makeStore("old-key");
      const failures = [
        makeAuthentication(memory.store, {
          validateCredential: () =>
            Effect.fail(
              new OpenAiCompatibleHttpError({
                operation: "models",
                category: "network",
                message: "Offline",
              }),
            ),
        }),
        makeAuthentication({
          ...memory.store,
          setStored: () =>
            Effect.fail(
              new OpenAiCompatibleCredentialStoreError({
                operation: "write",
                message: "No storage",
              }),
            ),
        }),
        makeAuthentication(memory.store, {
          stopAll: Effect.fail(
            new ProviderAdapterRequestError({
              provider: "lmstudio",
              method: "stop",
              detail: "Busy",
            }),
          ),
        }),
      ];
      for (const auth of failures) {
        yield* Effect.flip(auth.setCredential!({ instanceId: INSTANCE_ID, credential: "new-key" }));
        expect(memory.getKey()).toBe("old-key");
      }
    }),
  );

  it.effect("removes keys without introducing a sign-in requirement for keyless endpoints", () =>
    Effect.gen(function* () {
      const memory = makeStore("old-key");
      const auth = makeAuthentication(memory.store);
      const result = yield* auth.disconnect!({ instanceId: INSTANCE_ID });
      expect(memory.getKey()).toBeUndefined();
      expect(result.auth).toMatchObject({
        status: "unknown",
        type: "api-key-optional",
        label: "No API key",
        capabilities: { canDisconnect: false },
      });
    }),
  );

  it.effect("rejects cross-instance and empty key writes before validation", () =>
    Effect.gen(function* () {
      const memory = makeStore();
      const auth = makeAuthentication(memory.store, {
        validateCredential: () => Effect.die("Validation must not run"),
      });
      expect(
        yield* Effect.flip(
          auth.setCredential!({ instanceId: ProviderInstanceId.make("other"), credential: "key" }),
        ),
      ).toMatchObject({ code: "provider-not-found" });
      expect(
        yield* Effect.flip(auth.setCredential!({ instanceId: INSTANCE_ID, credential: " " })),
      ).toMatchObject({ code: "credential-invalid" });
      expect(
        yield* Effect.flip(auth.disconnect!({ instanceId: ProviderInstanceId.make("other") })),
      ).toMatchObject({ code: "provider-not-found" });
      expect(memory.getKey()).toBeUndefined();
    }),
  );

  it.effect(
    "cancels validation when the instance closes and prevents stale credential writes and removals",
    () =>
      Effect.gen(function* () {
        const memory = makeStore("old-key");
        const scope = yield* Scope.make();
        const validationStarted = yield* Deferred.make<void>();
        const validationAllowed = yield* Deferred.make<void>();
        const auth = makeAuthentication(memory.store, {
          scope,
          validateCredential: () =>
            Deferred.succeed(validationStarted, undefined).pipe(
              Effect.andThen(Deferred.await(validationAllowed)),
            ),
          stopAll: Effect.die("Closed instances must not stop sessions or modify credentials"),
        });
        const operation = yield* auth.setCredential!({
          instanceId: INSTANCE_ID,
          credential: "stale-key",
        }).pipe(Effect.forkChild);
        yield* Deferred.await(validationStarted);
        yield* Scope.close(scope, Exit.void);
        const cancelled = yield* Fiber.await(operation);
        expect(Exit.isFailure(cancelled)).toBe(true);
        if (Exit.isFailure(cancelled)) expect(Cause.hasInterruptsOnly(cancelled.cause)).toBe(true);

        yield* memory.store.setStored("new-target-key");
        yield* Deferred.succeed(validationAllowed, undefined);
        for (const staleOperation of [
          auth.setCredential!({ instanceId: INSTANCE_ID, credential: "stale-key" }),
          auth.disconnect!({ instanceId: INSTANCE_ID }),
        ]) {
          const result = yield* Effect.exit(staleOperation);
          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) expect(Cause.hasInterruptsOnly(result.cause)).toBe(true);
          expect(memory.getKey()).toBe("new-target-key");
        }
      }),
  );

  it.effect("cancels validation with the caller while keeping the instance available", () =>
    Effect.gen(function* () {
      const memory = makeStore("old-key");
      const validationStarted = yield* Deferred.make<void>();
      const validationAllowed = yield* Deferred.make<void>();
      const auth = makeAuthentication(memory.store, {
        validateCredential: () =>
          Deferred.succeed(validationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(validationAllowed)),
          ),
      });
      const operation = yield* auth.setCredential!({
        instanceId: INSTANCE_ID,
        credential: "cancelled-key",
      }).pipe(Effect.forkChild);
      yield* Deferred.await(validationStarted);
      yield* Fiber.interrupt(operation);
      yield* Deferred.succeed(validationAllowed, undefined);
      expect(memory.getKey()).toBe("old-key");
      yield* auth.setCredential!({ instanceId: INSTANCE_ID, credential: "current-key" });
      expect(memory.getKey()).toBe("current-key");
    }),
  );
});
