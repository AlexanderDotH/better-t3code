import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { beforeEach, vi } from "vite-plus/test";

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`legacy:${value}`)),
  decryptString: vi.fn(() => "legacy-secret"),
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  encryptStringAsync: vi.fn(async () => Buffer.from("OS-encrypted")),
  decryptStringAsync: vi.fn(async () => ({ result: "saved-secret", shouldReEncrypt: false })),
  getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
}));
vi.mock("electron", () => ({ safeStorage }));

import * as ElectronSafeStorage from "./ElectronSafeStorage.ts";
import * as DesktopLocalSecrets from "../app/DesktopLocalSecrets.ts";

const cipher = {
  encrypt: vi.fn(async (value: string) => Buffer.from(`local:${value}`)),
  decrypt: vi.fn(async (_value: Uint8Array) => "local-secret"),
};
const withSafeStorage = <A, E>(
  platform: NodeJS.Platform,
  effect: Effect.Effect<A, E, ElectronSafeStorage.ElectronSafeStorage>,
) =>
  effect.pipe(
    Effect.provide(ElectronSafeStorage.layer),
    Effect.provideService(HostProcessPlatform, platform),
    Effect.provideService(DesktopLocalSecrets.DesktopLocalSecrets, {
      cipher,
      tokens: {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
        importItems: async () => undefined,
      },
    }),
  );
const assertNoKeychainCalls = () => {
  for (const method of [
    safeStorage.isEncryptionAvailable,
    safeStorage.encryptString,
    safeStorage.decryptString,
    safeStorage.isAsyncEncryptionAvailable,
    safeStorage.encryptStringAsync,
    safeStorage.decryptStringAsync,
  ])
    assert.equal(method.mock.calls.length, 0);
};

describe("ElectronSafeStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.effect("uses local encryption on macOS without calling either OS key provider", () =>
    withSafeStorage(
      "darwin",
      Effect.gen(function* () {
        const storage = yield* ElectronSafeStorage.ElectronSafeStorage;
        const [available, encrypted, decrypted] = yield* Effect.all(
          [
            storage.isEncryptionAvailable,
            storage.encryptString("new-secret"),
            storage.decryptString(Buffer.from("local-ciphertext")),
          ],
          { concurrency: "unbounded" },
        );
        assert.isTrue(available);
        assert.equal(Buffer.from(encrypted).toString(), "local:new-secret");
        assert.equal(decrypted, "local-secret");
        assert.deepEqual(yield* storage.selectedStorageBackend, Option.some("local-file"));
        assertNoKeychainCalls();
      }),
    ),
  );

  it.effect("propagates local cipher failures without falling back to the keychain", () =>
    withSafeStorage(
      "darwin",
      Effect.gen(function* () {
        const storage = yield* ElectronSafeStorage.ElectronSafeStorage;
        const cause = new Error("local key unavailable");
        cipher.encrypt.mockRejectedValueOnce(cause);
        cipher.decrypt.mockRejectedValueOnce(cause);
        const encryptError = yield* storage.encryptString("secret").pipe(Effect.flip);
        const decryptError = yield* storage
          .decryptString(Buffer.from("ciphertext"))
          .pipe(Effect.flip);
        assert.instanceOf(encryptError, ElectronSafeStorage.ElectronSafeStorageEncryptError);
        assert.instanceOf(decryptError, ElectronSafeStorage.ElectronSafeStorageDecryptError);
        assert.strictEqual(encryptError.cause, cause);
        assert.strictEqual(decryptError.cause, cause);
        assertNoKeychainCalls();
      }),
    ),
  );

  for (const platform of ["win32", "linux"] as const) {
    it.effect(`preserves the existing ${platform} storage backend`, () =>
      withSafeStorage(
        platform,
        Effect.gen(function* () {
          const storage = yield* ElectronSafeStorage.ElectronSafeStorage;
          assert.isTrue(yield* storage.isEncryptionAvailable);
          assert.equal(
            Buffer.from(yield* storage.encryptString("secret")).toString(),
            "legacy:secret",
          );
          assert.equal(yield* storage.decryptString(Buffer.from("ciphertext")), "legacy-secret");
          assert.equal(cipher.encrypt.mock.calls.length, 0);
          assert.equal(cipher.decrypt.mock.calls.length, 0);
          assert.equal(safeStorage.isAsyncEncryptionAvailable.mock.calls.length, 0);
          assert.deepEqual(
            yield* storage.selectedStorageBackend,
            platform === "linux" ? Option.some("gnome_libsecret") : Option.none(),
          );
        }),
      ),
    );
  }
});
