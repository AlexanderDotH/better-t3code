// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as ServerConfig from "../../config.ts";
import { makeChatGptCredentialStore } from "./ChatGptCredentialStore.ts";

const makeLayer = () =>
  ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-chatgpt-credentials-test-",
  }).pipe(Layer.provideMerge(NodeServices.layer));

const validAuthFile = {
  OPENAI_API_KEY: null,
  tokens: {
    id_token: "header.payload.signature",
    access_token: "access-secret",
    refresh_token: "refresh-secret",
    account_id: "account-123",
  },
  last_refresh: "2026-08-23T12:00:00.000Z",
};

describe("ChatGptCredentialStore", () => {
  it.effect("isolates each instance below secretsDir and hardens POSIX permissions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const store = yield* makeChatGptCredentialStore(ProviderInstanceId.make("chatgpt_personal"));

      yield* store.prepare;
      expect(store.home).toMatch(/\/secrets\/providers\/chatgpt\/chatgpt_personal\/codex-home$/u);
      expect(NodeFS.statSync(store.home).mode & 0o777).toBe(0o700);

      yield* fileSystem.writeFileString(store.authFilePath, JSON.stringify(validAuthFile));
      yield* fileSystem.chmod(store.authFilePath, 0o644);
      const credential = yield* store.read;

      assert.isTrue(Option.isSome(credential));
      expect(Redacted.value(credential.value.accessToken)).toBe("access-secret");
      expect(Redacted.value(credential.value.refreshToken)).toBe("refresh-secret");
      expect(credential.value.accountId).toBe("account-123");
      expect(NodeFS.statSync(store.authFilePath).mode & 0o777).toBe(0o600);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("returns none for a missing auth file", () =>
    Effect.gen(function* () {
      const store = yield* makeChatGptCredentialStore(ProviderInstanceId.make("chatgpt_empty"));
      yield* store.prepare;
      assert.isTrue(Option.isNone(yield* store.read));
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("accepts the current Codex ChatGPT auth metadata", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const store = yield* makeChatGptCredentialStore(
        ProviderInstanceId.make("chatgpt_current_codex"),
      );
      yield* store.prepare;
      yield* fileSystem.writeFileString(
        store.authFilePath,
        JSON.stringify({
          ...validAuthFile,
          auth_mode: "chatgpt",
          codexMultiAuthSyncVersion: 1,
          email: "alex@example.com",
        }),
      );

      const decoded = yield* store.read;
      assert.isTrue(Option.isSome(decoded));
      expect(decoded.value.accountId).toBe("account-123");
      expect(Redacted.value(decoded.value.accessToken)).toBe("access-secret");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("rejects schema drift without exposing credential contents", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const store = yield* makeChatGptCredentialStore(ProviderInstanceId.make("chatgpt_invalid"));
      yield* store.prepare;
      yield* fileSystem.writeFileString(
        store.authFilePath,
        JSON.stringify({ ...validAuthFile, unexpected_token_copy: "never-log-this-secret" }),
      );

      const error = yield* Effect.flip(store.read);
      expect(error._tag).toBe("ChatGptCredentialError");
      expect(error.message).toContain("schema");
      expect(JSON.stringify(error)).not.toContain("never-log-this-secret");
      expect(JSON.stringify(error)).not.toContain("access-secret");
    }).pipe(Effect.provide(makeLayer())),
  );
});
