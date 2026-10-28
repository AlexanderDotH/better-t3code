import { assert, describe, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import { expect, vi } from "vite-plus/test";
import {
  CursorKeychainTimeoutError,
  makeCachedCursorAccessTokenReader,
  readMacKeychainPassword,
} from "./cursorCredentialStore.ts";

describe("Cursor background credentials", () => {
  it("shares concurrent reads and rechecks after the cache expires", async () => {
    let reads = 0;
    let time = 0;
    const read = makeCachedCursorAccessTokenReader(
      async () => {
        reads++;
        return `token-${reads}`;
      },
      () => time,
    );
    assert.deepStrictEqual(await Promise.all([read(), read()]), ["token-1", "token-1"]);
    assert.strictEqual(await read(), "token-1");
    assert.strictEqual(reads, 1);
    time = 5 * 60_000;
    assert.strictEqual(await read(), "token-2");
  });

  it("caches an inaccessible login instead of probing it on every refresh", async () => {
    let reads = 0;
    let time = 0;
    const read = makeCachedCursorAccessTokenReader(
      async () => {
        reads++;
        return null;
      },
      () => time,
    );
    assert.deepStrictEqual(await Promise.all([read(), read(), read()]), [null, null, null]);
    assert.isNull(await read());
    assert.strictEqual(reads, 1);
    time = 5 * 60_000;
    assert.isNull(await read());
    assert.strictEqual(reads, 2);
  });

  it("bounds a slow read and shares it until it settles", async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      let finish!: (token: string) => void;
      const read = makeCachedCursorAccessTokenReader(
        () => {
          reads++;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
        () => 0,
        5_000,
      );
      const result = read().catch((cause: unknown) => cause);
      await vi.advanceTimersByTimeAsync(5_000);
      assert.instanceOf(await result, CursorKeychainTimeoutError);
      const retry = read();
      finish("token");
      assert.strictEqual(await retry, "token");
      assert.strictEqual(reads, 1);
      assert.strictEqual(vi.getTimerCount(), 0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not turn read failures into cached empty credentials", async () => {
    let reads = 0;
    const failure = new Error("native query failed");
    const read = makeCachedCursorAccessTokenReader(async () => {
      reads++;
      if (reads === 1) throw failure;
      return "recovered-token";
    });
    assert.strictEqual(await read().catch((cause: unknown) => cause), failure);
    assert.strictEqual(await read(), "recovered-token");
  });

  it("skips missing, locked, and unapproved credentials without another read", async () => {
    for (const status of [-25300, -25308, -25293]) {
      let calls = 0;
      const result = await readMacKeychainPassword(
        "cursor-access-token",
        "cursor-user",
        async () => {
          calls++;
          return JSON.stringify({ status });
        },
      );
      assert.isNull(result);
      assert.strictEqual(calls, 1);
    }
  });

  it("accepts an already accessible credential and rejects invalid query responses", async () => {
    assert.strictEqual(
      await readMacKeychainPassword("cursor-access-token", "cursor-user", async () =>
        JSON.stringify({ status: 0, token: "accessible-token" }),
      ),
      "accessible-token",
    );
    for (const response of ['{"status":-50}', '{"status":0}', "invalid"]) {
      await expect(
        readMacKeychainPassword("cursor-access-token", "cursor-user", async () => response),
      ).rejects.toThrow();
    }
  });

  it.effect("runs the non-interactive macOS query without changing Keychain entries", () =>
    Effect.gen(function* () {
      if ((yield* HostProcessPlatform) !== "darwin") return;
      const result = yield* Effect.promise(() =>
        readMacKeychainPassword("com.t3tools.test.nonexistent-cursor-credential", "test"),
      );
      assert.isNull(result);
    }),
  );
});
