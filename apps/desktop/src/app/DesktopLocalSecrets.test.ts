// @effect-diagnostics nodeBuiltinImport:off - These tests exercise real temporary key files and the cipher boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { afterEach, beforeEach, describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { createLocalSecretCipher, createLocalTokenStorage } from "./DesktopLocalSecrets.ts";

const onHost = (run: (platform: NodeJS.Platform) => Promise<void>) =>
  HostProcessPlatform.pipe(Effect.flatMap((platform) => Effect.promise(() => run(platform))));

let directory: string;
beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-local-secrets-"));
});
afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});
const keyPath = () => NodePath.join(directory, "private", "desktop.key");

describe("local secret encryption", () => {
  it.effect("encrypts with a private random key, fresh nonces, and survives a new instance", () =>
    onHost(async (platform) => {
      const cipher = createLocalSecretCipher(keyPath());
      const plaintext = "A test secret with ü and 😀";
      const first = await cipher.encrypt(plaintext);
      const second = await cipher.encrypt(plaintext);
      expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
      expect(Buffer.from(first).includes(Buffer.from(plaintext))).toBe(false);
      expect(await createLocalSecretCipher(keyPath()).decrypt(first)).toBe(plaintext);
      expect((await NodeFSP.readFile(keyPath())).length).toBe(32);
      if (platform !== "win32") expect((await NodeFSP.stat(keyPath())).mode & 0o777).toBe(0o600);
    }),
  );

  it.effect("rejects altered ciphertext and an unrelated key", () =>
    onHost(async () => {
      const cipher = createLocalSecretCipher(keyPath());
      const encrypted = Buffer.from(await cipher.encrypt("test-secret"));
      const modified = Buffer.from(encrypted);
      modified[modified.length - 1] = modified[modified.length - 1]! ^ 1;
      await expect(cipher.decrypt(modified)).rejects.toThrow();
      const other = createLocalSecretCipher(NodePath.join(directory, "other.key"));
      await other.encrypt("create-another-key");
      await expect(other.decrypt(encrypted)).rejects.toThrow();
      await expect(cipher.decrypt(encrypted.subarray(0, 12))).rejects.toThrow();
    }),
  );

  it.effect("rejects old OS ciphertext without creating a local key", () =>
    onHost(async () => {
      await expect(
        createLocalSecretCipher(keyPath()).decrypt(Buffer.from("v10-old-secret")),
      ).rejects.toThrow();
      await expect(NodeFSP.stat(keyPath())).rejects.toMatchObject({ code: "ENOENT" });
    }),
  );

  it.effect("preserves encrypted data when its key is missing or invalid", () =>
    onHost(async () => {
      const file = NodePath.join(directory, "encrypted.bin");
      const cipher = createLocalSecretCipher(keyPath(), [file]);
      const encrypted = await cipher.encrypt("persisted-test-secret");
      await NodeFSP.writeFile(file, encrypted);
      await NodeFSP.unlink(keyPath());
      const reopened = createLocalSecretCipher(keyPath(), [file]);
      await expect(reopened.decrypt(encrypted)).rejects.toThrow();
      await expect(reopened.encrypt("new-value")).rejects.toThrow("missing");
      await expect(NodeFSP.stat(keyPath())).rejects.toMatchObject({ code: "ENOENT" });
      expect((await NodeFSP.readFile(file)).equals(Buffer.from(encrypted))).toBe(true);
      await NodeFSP.writeFile(keyPath(), "invalid-key", { mode: 0o600 });
      await expect(createLocalSecretCipher(keyPath()).encrypt("new-value")).rejects.toThrow(
        "invalid",
      );
      expect(await NodeFSP.readFile(keyPath(), "utf8")).toBe("invalid-key");
    }),
  );

  it.effect("publishes one complete key across concurrent instances", () =>
    onHost(async () => {
      const ciphers = Array.from({ length: 8 }, () => createLocalSecretCipher(keyPath()));
      const encrypted = await Promise.all(ciphers.map((cipher) => cipher.encrypt("same-secret")));
      const reader = createLocalSecretCipher(keyPath());
      expect(await Promise.all(encrypted.map((value) => reader.decrypt(value)))).toEqual(
        Array(8).fill("same-secret"),
      );
      expect(await NodeFSP.readdir(NodePath.dirname(keyPath()))).toEqual(["desktop.key"]);
    }),
  );

  it.effect("does not follow a key-file symlink", () =>
    onHost(async (platform) => {
      if (platform === "win32") return;
      const destination = NodePath.join(directory, "real.key");
      await NodeFSP.writeFile(destination, Buffer.alloc(32), { mode: 0o640 });
      await NodeFSP.symlink(destination, NodePath.join(directory, "linked.key"));
      await expect(
        createLocalSecretCipher(NodePath.join(directory, "linked.key")).encrypt("secret"),
      ).rejects.toThrow();
      expect((await NodeFSP.stat(destination)).mode & 0o777).toBe(0o640);
    }),
  );
});

describe("local account-token storage", () => {
  it.effect("keeps concurrent changes encrypted and preserves newer values during import", () =>
    onHost(async (platform) => {
      const path = NodePath.join(directory, "tokens.local.json");
      const cipher = createLocalSecretCipher(keyPath(), [path]);
      const storage = createLocalTokenStorage(path, cipher);
      await Promise.all([
        storage.setItem("one", "first-secret"),
        storage.setItem("two", "second-secret"),
        storage.setItem("__proto__", "literal-key-secret"),
      ]);
      const raw = await NodeFSP.readFile(path, "utf8");
      expect(raw.includes("first-secret")).toBe(false);
      expect(raw.includes("second-secret")).toBe(false);
      await storage.importItems([
        ["one", "old-secret"],
        ["old", "imported-secret"],
      ]);
      const reopened = createLocalTokenStorage(path, createLocalSecretCipher(keyPath(), [path]));
      expect(await reopened.getItem("one")).toBe("first-secret");
      expect(await reopened.getItem("two")).toBe("second-secret");
      expect(await reopened.getItem("old")).toBe("imported-secret");
      expect(await reopened.getItem("__proto__")).toBe("literal-key-secret");
      expect(await reopened.getItem("toString")).toBe(null);
      await reopened.removeItem("one");
      expect(await reopened.getItem("one")).toBe(null);
      if (platform !== "win32") expect((await NodeFSP.stat(path)).mode & 0o777).toBe(0o600);
    }),
  );

  it.effect("preserves a malformed file and allows retry after fixing the cause", () =>
    onHost(async () => {
      const path = NodePath.join(directory, "tokens.local.json");
      await NodeFSP.writeFile(path, "{invalid");
      const storage = createLocalTokenStorage(path, createLocalSecretCipher(keyPath()));
      await expect(storage.setItem("one", "secret")).rejects.toThrow();
      expect(await NodeFSP.readFile(path, "utf8")).toBe("{invalid");
      await NodeFSP.unlink(path);
      await storage.setItem("one", "secret");
      expect(await storage.getItem("one")).toBe("secret");
    }),
  );
});
