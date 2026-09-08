import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type ProviderInstanceEnvironment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import {
  makeOpenRouterCredentialStore,
  openRouterApiKeySecretName,
} from "./OpenRouterCredentialStore.ts";

function makeMemorySecretStore() {
  const values = new Map<string, Uint8Array>();
  const store = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.succeed(Option.fromNullishOr(values.get(name))),
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
  return { store, values };
}

const environment = (value: string): ProviderInstanceEnvironment => [
  {
    name: "OPENROUTER_API_KEY",
    value,
    sensitive: true,
  },
];

describe("OpenRouterCredentialStore", () => {
  it.effect("isolates stored API keys by provider instance", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      const personal = yield* makeOpenRouterCredentialStore({
        instanceId: ProviderInstanceId.make("openrouter_personal"),
        environment: [],
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));
      const work = yield* makeOpenRouterCredentialStore({
        instanceId: ProviderInstanceId.make("openrouter_work"),
        environment: [],
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));

      yield* personal.setStored("sk-or-personal");
      yield* work.setStored("sk-or-work");

      expect(Redacted.value((yield* personal.resolve).apiKey)).toBe("sk-or-personal");
      expect(Redacted.value((yield* work.resolve).apiKey)).toBe("sk-or-work");
      expect(memory.values.has(openRouterApiKeySecretName(personal.instanceId))).toBe(true);
      expect(memory.values.has(openRouterApiKeySecretName(work.instanceId))).toBe(true);
    }),
  );

  it.effect(
    "prefers a stored key and reveals the explicit instance environment key on removal",
    () =>
      Effect.gen(function* () {
        const memory = makeMemorySecretStore();
        const store = yield* makeOpenRouterCredentialStore({
          instanceId: ProviderInstanceId.make("openrouter"),
          environment: environment("sk-or-environment"),
        }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));

        yield* store.setStored("sk-or-stored");
        expect(yield* store.resolve).toMatchObject({ source: "stored" });
        expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-or-stored");

        yield* store.removeStored;
        expect(yield* store.resolve).toMatchObject({ source: "environment" });
        expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-or-environment");
      }),
  );

  it.effect("does not read OPENROUTER_API_KEY from the ambient process environment", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      const previous = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = "sk-or-ambient-must-not-be-used";
      try {
        const store = yield* makeOpenRouterCredentialStore({
          instanceId: ProviderInstanceId.make("openrouter"),
          environment: [],
        }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));

        expect(Option.isNone(yield* store.resolveOption)).toBe(true);
      } finally {
        if (previous === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = previous;
        }
      }
    }),
  );

  it.effect("ignores a provider environment key that is not marked sensitive", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      const store = yield* makeOpenRouterCredentialStore({
        instanceId: ProviderInstanceId.make("openrouter"),
        environment: [
          {
            name: "OPENROUTER_API_KEY",
            value: "sk-or-visible-setting",
            sensitive: false,
          },
        ],
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));

      expect(Option.isNone(yield* store.resolveOption)).toBe(true);
    }),
  );

  it.effect("rejects an empty stored key without persisting or exposing its input", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      const store = yield* makeOpenRouterCredentialStore({
        instanceId: ProviderInstanceId.make("openrouter"),
        environment: [],
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));

      const error = yield* Effect.flip(store.setStored("   "));
      expect(error._tag).toBe("OpenRouterCredentialStoreError");
      expect(error.message).toBe("OpenRouter API key must not be empty.");
      expect(Option.isNone(yield* store.readStored)).toBe(true);
    }),
  );
});
