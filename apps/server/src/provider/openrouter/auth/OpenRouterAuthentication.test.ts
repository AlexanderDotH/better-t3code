import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import { ProviderAdapterRequestError, type ProviderAdapterError } from "../../Errors.ts";
import {
  makeOpenRouterCredentialStore,
  OpenRouterCredentialStoreError,
  type OpenRouterCredentialStore,
} from "./OpenRouterCredentialStore.ts";
import {
  makeOpenRouterAuthentication,
  openRouterAuthenticatedAuth,
} from "./OpenRouterAuthentication.ts";
import {
  OpenRouterKeyValidationError,
  type OpenRouterKeyValidator,
} from "./OpenRouterKeyValidation.ts";

const INSTANCE_ID = ProviderInstanceId.make("openrouter_personal");
const OTHER_INSTANCE_ID = ProviderInstanceId.make("openrouter_work");

function makeMemorySecretStore() {
  const values = new Map<string, Uint8Array>();
  return ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name, value) =>
      Effect.sync(() => {
        values.set(name, Uint8Array.from(value));
      }),
    create: (name, value) =>
      Effect.sync(() => {
        values.set(name, Uint8Array.from(value));
      }),
    getOrCreateRandom: (name, bytes) =>
      Effect.sync(() => {
        const value = values.get(name) ?? new Uint8Array(bytes);
        values.set(name, value);
        return Uint8Array.from(value);
      }),
    remove: (name) =>
      Effect.sync(() => {
        values.delete(name);
      }),
  });
}

const validProfile = {
  label: "sk-o…7890",
  isFreeTier: true,
  expiresAt: "2027-08-25T00:00:00.000Z",
} as const;

const acceptingValidator: OpenRouterKeyValidator = {
  validate: () => Effect.succeed(validProfile),
};

const rejectingValidator = (secret: string): OpenRouterKeyValidator => ({
  validate: () =>
    Effect.fail(
      new OpenRouterKeyValidationError({
        code: "credential-invalid",
        status: 401,
        retryable: false,
        message: `Rejected ${secret}`,
      }),
    ),
});

const managementKeyValidator: OpenRouterKeyValidator = {
  validate: () =>
    Effect.fail(
      new OpenRouterKeyValidationError({
        code: "credential-not-inference",
        retryable: false,
        message: "OpenRouter Management API keys cannot be used with model completion endpoints.",
      }),
    ),
};

const makeStore = (input?: { readonly environmentKey?: string }) =>
  makeOpenRouterCredentialStore({
    instanceId: INSTANCE_ID,
    environment: input?.environmentKey
      ? [
          {
            name: "OPENROUTER_API_KEY",
            value: input.environmentKey,
            sensitive: true,
          },
        ]
      : [],
  }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, makeMemorySecretStore()));

const makeAuthentication = (
  credentialStore: OpenRouterCredentialStore,
  keyValidator: OpenRouterKeyValidator = acceptingValidator,
  stopAll: Effect.Effect<void, ProviderAdapterError> = Effect.void,
) =>
  makeOpenRouterAuthentication({
    instanceId: INSTANCE_ID,
    credentialStore,
    keyValidator,
    stopAll,
    refreshSnapshot: Effect.void,
  });

describe("OpenRouterAuthentication", () => {
  it.effect("validates before atomically replacing the stored credential", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      yield* store.setStored("sk-or-old");
      const authentication = makeAuthentication(store, rejectingValidator("sk-or-new"));

      const error = yield* Effect.flip(
        authentication.setCredential!({
          instanceId: INSTANCE_ID,
          credential: "sk-or-new",
        }),
      );

      expect(error).toMatchObject({
        operation: "set-credential",
        code: "credential-invalid",
        retryable: false,
      });
      expect(JSON.stringify(error)).not.toContain("sk-or-new");
      expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-or-old");
    }),
  );

  it.effect("keeps the old credential and explains management keys cannot run inference", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      yield* store.setStored("sk-or-old");
      const authentication = makeAuthentication(store, managementKeyValidator);

      const error = yield* Effect.flip(
        authentication.setCredential!({
          instanceId: INSTANCE_ID,
          credential: "sk-or-management",
        }),
      );

      expect(error).toMatchObject({
        operation: "set-credential",
        code: "credential-invalid",
        retryable: false,
      });
      expect(error.reason).toContain("cannot run model inference");
      expect(JSON.stringify(error)).not.toContain("sk-or-management");
      expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-or-old");
    }),
  );

  it.effect("stores a validated credential and returns only safe key metadata", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      const authentication = makeAuthentication(store);

      const result = yield* authentication.setCredential!({
        instanceId: INSTANCE_ID,
        credential: "sk-or-v1-1234567890",
      });

      expect(result.instanceId).toBe(INSTANCE_ID);
      expect(result.auth).toEqual(openRouterAuthenticatedAuth(validProfile, { source: "stored" }));
      expect(result.auth).toMatchObject({
        status: "authenticated",
        label: "sk-o…7890",
        plan: { id: "free", label: "Free tier" },
        capabilities: { canDisconnect: true },
      });
      expect(JSON.stringify(result)).not.toContain("1234567890");
    }),
  );

  it.effect("keeps the previous key when secure replacement fails after validation", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      yield* store.setStored("sk-or-old");
      const failingStore: OpenRouterCredentialStore = {
        ...store,
        setStored: () =>
          Effect.fail(
            new OpenRouterCredentialStoreError({
              operation: "write",
              message: "simulated secure storage failure",
            }),
          ),
      };
      const authentication = makeAuthentication(failingStore);

      const error = yield* Effect.flip(
        authentication.setCredential!({
          instanceId: INSTANCE_ID,
          credential: "sk-or-new",
        }),
      );

      expect(error).toMatchObject({ code: "credential-storage-failed", retryable: true });
      expect(JSON.stringify(error)).not.toContain("sk-or-new");
      expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-or-old");
    }),
  );

  it.effect(
    "disconnect removes only the stored key and keeps an environment key authenticated",
    () =>
      Effect.gen(function* () {
        const store = yield* makeStore({ environmentKey: "sk-or-environment" });
        yield* store.setStored("sk-or-stored");
        const authentication = makeAuthentication(store);

        const result = yield* authentication.disconnect!({ instanceId: INSTANCE_ID });

        expect(result.auth).toMatchObject({
          status: "authenticated",
          capabilities: { canDisconnect: false },
        });
        expect((yield* store.resolve).source).toBe("environment");
      }),
  );

  it.effect("explains that an environment-only credential cannot be disconnected", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({ environmentKey: "sk-or-environment" });
      const authentication = makeAuthentication(store);

      const error = yield* Effect.flip(authentication.disconnect!({ instanceId: INSTANCE_ID }));

      expect(error).toMatchObject({ code: "auth-unsupported", retryable: false });
      expect(error.reason).toContain("OPENROUTER_API_KEY");
      expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-or-environment");
    }),
  );

  it.effect("rejects a request routed to a different provider instance", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      const authentication = makeAuthentication(store);

      const error = yield* Effect.flip(
        authentication.setCredential!({
          instanceId: OTHER_INSTANCE_ID,
          credential: "sk-or-never-store",
        }),
      );

      expect(error).toMatchObject({ code: "provider-not-found", retryable: false });
      expect(Option.isNone(yield* store.readStored)).toBe(true);
    }),
  );

  it.effect("leaves the stored key intact when active sessions cannot stop", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      yield* store.setStored("sk-or-stored");
      const authentication = makeAuthentication(
        store,
        acceptingValidator,
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "openrouter",
            method: "stopAll",
            detail: "turn still active",
          }),
        ),
      );

      const error = yield* Effect.flip(authentication.disconnect!({ instanceId: INSTANCE_ID }));

      expect(error).toMatchObject({ code: "disconnect-conflict", retryable: true });
      expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-or-stored");
    }),
  );
});
