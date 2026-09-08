import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type ProviderInstanceEnvironment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import { makeOpenAiCredentialStore, openAiApiKeySecretName } from "./OpenAiCredentialStore.ts";

function makeMemorySecretStore() {
  const values = new Map<string, Uint8Array>();
  const store = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.succeed(Option.fromNullishOr(values.get(name))),
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
  return { store, values };
}

const environment = (value: string, sensitive = true): ProviderInstanceEnvironment => [
  { name: "OPENAI_API_KEY", value, sensitive },
];

describe("OpenAiCredentialStore", () => {
  it.effect("isolates stored keys by provider instance", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      const personal = yield* makeOpenAiCredentialStore({
        instanceId: ProviderInstanceId.make("openai_personal"),
        environment: [],
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));
      const work = yield* makeOpenAiCredentialStore({
        instanceId: ProviderInstanceId.make("openai_work"),
        environment: [],
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));

      yield* personal.setStored("sk-personal");
      yield* work.setStored("sk-work");

      expect(Redacted.value((yield* personal.resolve).apiKey)).toBe("sk-personal");
      expect(Redacted.value((yield* work.resolve).apiKey)).toBe("sk-work");
      expect(memory.values.has(openAiApiKeySecretName(personal.instanceId))).toBe(true);
      expect(memory.values.has(openAiApiKeySecretName(work.instanceId))).toBe(true);
    }),
  );

  it.effect(
    "prefers stored credentials and falls back to an explicit sensitive environment key",
    () =>
      Effect.gen(function* () {
        const memory = makeMemorySecretStore();
        const store = yield* makeOpenAiCredentialStore({
          instanceId: ProviderInstanceId.make("openai"),
          environment: environment("sk-environment"),
        }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));

        yield* store.setStored("sk-stored");
        expect(yield* store.resolve).toMatchObject({ source: "stored" });
        yield* store.removeStored;
        expect(yield* store.resolve).toMatchObject({ source: "environment" });
        expect(Redacted.value((yield* store.resolve).apiKey)).toBe("sk-environment");
      }),
  );

  it.effect("ignores ambient and non-sensitive OPENAI_API_KEY values", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      const previous = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-ambient-must-not-be-used";
      try {
        const ambient = yield* makeOpenAiCredentialStore({
          instanceId: ProviderInstanceId.make("openai"),
          environment: [],
        }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));
        const visible = yield* makeOpenAiCredentialStore({
          instanceId: ProviderInstanceId.make("openai_visible"),
          environment: environment("sk-visible-setting", false),
        }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));

        expect(Option.isNone(yield* ambient.resolveOption)).toBe(true);
        expect(Option.isNone(yield* visible.resolveOption)).toBe(true);
      } finally {
        if (previous === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previous;
      }
    }),
  );

  it.effect("rejects an empty stored key without persisting it", () =>
    Effect.gen(function* () {
      const memory = makeMemorySecretStore();
      const store = yield* makeOpenAiCredentialStore({
        instanceId: ProviderInstanceId.make("openai"),
        environment: [],
      }).pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, memory.store));

      const error = yield* Effect.flip(store.setStored("   "));
      expect(error).toMatchObject({
        _tag: "OpenAiCredentialStoreError",
        operation: "write",
        message: "OpenAI API key must not be empty.",
      });
      expect(Option.isNone(yield* store.readStored)).toBe(true);
    }),
  );
});
