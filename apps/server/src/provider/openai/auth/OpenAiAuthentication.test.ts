import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import type { ProviderAdapterError } from "../../Errors.ts";
import { makeOpenAiCredentialStore, type OpenAiCredentialStore } from "./OpenAiCredentialStore.ts";
import { makeOpenAiAuthentication, openAiAuthenticatedAuth } from "./OpenAiAuthentication.ts";
import { OpenAiKeyValidationError, type OpenAiKeyValidator } from "./OpenAiKeyValidation.ts";

const INSTANCE_ID = ProviderInstanceId.make("openai_personal");
const OTHER_INSTANCE_ID = ProviderInstanceId.make("openai_work");
const PROFILE = { label: "sk-p…7890", supportedModelCount: 3 } as const;

function makeMemorySecretStore() {
  const values = new Map<string, Uint8Array>();
  return ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name, value) => Effect.sync(() => void values.set(name, Uint8Array.from(value))),
    create: (name, value) => Effect.sync(() => void values.set(name, Uint8Array.from(value))),
    getOrCreateRandom: (name, bytes) =>
      Effect.sync(() => {
        const value = values.get(name) ?? new Uint8Array(bytes);
        values.set(name, value);
        return Uint8Array.from(value);
      }),
    remove: (name) => Effect.sync(() => void values.delete(name)),
  });
}

const makeStore = (environmentKey?: string) =>
  makeOpenAiCredentialStore({
    instanceId: INSTANCE_ID,
    environment: environmentKey
      ? [{ name: "OPENAI_API_KEY", value: environmentKey, sensitive: true }]
      : [],
  }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, makeMemorySecretStore()));

const acceptingValidator: OpenAiKeyValidator = { validate: () => Effect.succeed(PROFILE) };
const rejectingValidator: OpenAiKeyValidator = {
  validate: () =>
    Effect.fail(
      new OpenAiKeyValidationError({
        code: "credential-invalid",
        status: 401,
        retryable: false,
        message: "OpenAI rejected this key",
      }),
    ),
};

const authentication = (
  store: OpenAiCredentialStore,
  validator: OpenAiKeyValidator = acceptingValidator,
  stopAll: Effect.Effect<void, ProviderAdapterError> = Effect.void,
) =>
  makeOpenAiAuthentication({
    instanceId: INSTANCE_ID,
    credentialStore: store,
    keyValidator: validator,
    stopAll,
    refreshSnapshot: Effect.void,
  });

describe("OpenAiAuthentication", () => {
  it.effect("validates before atomically replacing a stored credential", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      yield* store.setStored("sk-old");
      const auth = authentication(store, rejectingValidator);

      const error = yield* Effect.flip(
        auth.setCredential!({ instanceId: INSTANCE_ID, credential: "sk-new-secret" }),
      );

      expect(error).toMatchObject({ code: "credential-invalid", retryable: false });
      expect(JSON.stringify(error)).not.toContain("sk-new-secret");
      expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-old");
    }),
  );

  it.effect("stores a valid credential and returns only safe auth metadata", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      const auth = authentication(store);

      const result = yield* auth.setCredential!({
        instanceId: INSTANCE_ID,
        credential: "sk-proj-1234567890",
      });

      expect(result.auth).toEqual(openAiAuthenticatedAuth(PROFILE, { source: "stored" }));
      expect(result.auth).toMatchObject({
        status: "authenticated",
        label: "sk-p…7890",
        capabilities: { canDisconnect: true },
      });
      expect(JSON.stringify(result)).not.toContain("1234567890");
    }),
  );

  it.effect("disconnect removes only stored credentials and preserves environment ownership", () =>
    Effect.gen(function* () {
      const store = yield* makeStore("sk-environment");
      yield* store.setStored("sk-stored");
      const auth = authentication(store);

      const result = yield* auth.disconnect!({ instanceId: INSTANCE_ID });

      expect(result.auth).toMatchObject({
        status: "authenticated",
        capabilities: { canDisconnect: false },
      });
      expect((yield* store.resolve).source).toBe("environment");
    }),
  );

  it.effect("rejects cross-instance credential writes", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      const auth = authentication(store);

      const error = yield* Effect.flip(
        auth.setCredential!({ instanceId: OTHER_INSTANCE_ID, credential: "sk-never-store" }),
      );

      expect(error).toMatchObject({ code: "provider-not-found", retryable: false });
      expect(Option.isNone(yield* store.readStored)).toBe(true);
    }),
  );

  it.effect("explains that an environment-only credential cannot be disconnected", () =>
    Effect.gen(function* () {
      const store = yield* makeStore("sk-environment");
      const auth = authentication(store);

      const error = yield* Effect.flip(auth.disconnect!({ instanceId: INSTANCE_ID }));

      expect(error).toMatchObject({ code: "auth-unsupported", retryable: false });
      expect(error.reason).toContain("OPENAI_API_KEY");
      expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-environment");
    }),
  );
});
