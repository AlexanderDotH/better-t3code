import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import {
  makeOpenAiCompatibleCredentialStore,
  openAiCompatibleApiKeySecretName,
} from "./OpenAiCompatibleCredentialStore.ts";

const INSTANCE_ID = ProviderInstanceId.make("local_personal");
const OTHER_INSTANCE_ID = ProviderInstanceId.make("local_work");

function makeMemorySecretStore() {
  const values = new Map<string, Uint8Array>();
  const store = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name, value) => Effect.sync(() => void values.set(name, Uint8Array.from(value))),
    create: (name, value) => Effect.sync(() => void values.set(name, Uint8Array.from(value))),
    getOrCreateRandom: () => Effect.die("Credential storage does not generate keys"),
    remove: (name) => Effect.sync(() => void values.delete(name)),
  });
  return { store, values };
}

afterEach(() => vi.unstubAllEnvs());

describe("OpenAiCompatibleCredentialStore", () => {
  it.effect("binds secrets to the provider instance and normalized target URL", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      const makeStore = (instanceId: ProviderInstanceId, baseUrl: string) =>
        makeOpenAiCompatibleCredentialStore({ instanceId, baseUrl }).pipe(
          Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store),
        );
      const personal = yield* makeStore(INSTANCE_ID, " http://localhost:1234/ ");
      const sameTarget = yield* makeStore(INSTANCE_ID, "http://localhost:1234/v1/");
      const changedTarget = yield* makeStore(INSTANCE_ID, "http://other.local:1234/v1");
      const changedPath = yield* makeStore(INSTANCE_ID, "http://localhost:1234/api/v1");
      const work = yield* makeStore(OTHER_INSTANCE_ID, "http://localhost:1234/v1");

      yield* personal.setStored(" key-personal ");
      expect(Redacted.value(Option.getOrThrow(yield* sameTarget.readStored))).toBe("key-personal");
      expect(Option.isNone(yield* changedTarget.readStored)).toBe(true);
      expect(Option.isNone(yield* changedPath.readStored)).toBe(true);
      expect(Option.isNone(yield* work.readStored)).toBe(true);
      yield* work.setStored("key-work");
      yield* changedTarget.removeStored;
      expect(Option.isNone(yield* personal.readStored)).toBe(true);
      expect(Redacted.value(Option.getOrThrow(yield* work.readStored))).toBe("key-work");
      expect(memory.values.has(openAiCompatibleApiKeySecretName(INSTANCE_ID))).toBe(false);
      expect(memory.values.has(openAiCompatibleApiKeySecretName(OTHER_INSTANCE_ID))).toBe(true);
    }),
  );

  it.effect("never inherits ambient OpenAI keys", () =>
    Effect.gen(function* () {
      vi.stubEnv("OPENAI_API_KEY", "ambient-key-must-not-be-forwarded");
      const memory = makeMemorySecretStore();
      const store = yield* makeOpenAiCompatibleCredentialStore({
        instanceId: INSTANCE_ID,
        baseUrl: "http://localhost:1234",
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));
      expect(Option.isNone(yield* store.readStored)).toBe(true);
    }),
  );

  it.effect("rejects blank keys and missing targets before persisting", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      const missing = yield* makeOpenAiCompatibleCredentialStore({
        instanceId: INSTANCE_ID,
        baseUrl: "",
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));
      expect(yield* Effect.flip(missing.setStored("key"))).toMatchObject({ operation: "write" });
      const configured = yield* makeOpenAiCompatibleCredentialStore({
        instanceId: INSTANCE_ID,
        baseUrl: "http://localhost:1234/v1",
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));
      expect(yield* Effect.flip(configured.setStored("  "))).toMatchObject({ operation: "write" });
      expect(memory.values.size).toBe(0);
    }),
  );

  it.effect("fails closed on malformed secret data without exposing its contents", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      memory.values.set(
        openAiCompatibleApiKeySecretName(INSTANCE_ID),
        new TextEncoder().encode("private-malformed-secret"),
      );
      const store = yield* makeOpenAiCompatibleCredentialStore({
        instanceId: INSTANCE_ID,
        baseUrl: "http://localhost:1234/v1",
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));
      expect(yield* Effect.flip(store.readStored)).toMatchObject({
        operation: "read",
        message: "Could not read the stored endpoint API key.",
      });
    }),
  );
});
