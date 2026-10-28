import { assert, describe, it } from "@effect/vitest";

import { CursorKeychainTimeoutError } from "../provider/cursorCredentialStore.ts";
import { readCursorAccountUsage } from "./cursorUsageReader.ts";

describe("readCursorAccountUsage", () => {
  it("leaves account usage unavailable when the login would require approval", async () => {
    let requests = 0;
    const result = await readCursorAccountUsage(
      { kind: "keychain" },
      0,
      1,
      async () => {
        requests++;
        throw new Error("No network expected without a login");
      },
      async () => null,
    );
    assert.isTrue(result.missing);
    assert.isNull(result.accountKey);
    assert.isEmpty(result.records);
    assert.include(result.error ?? "", "accessible without a macOS password dialog");
    assert.strictEqual(requests, 0);
  });

  it("reports a failed background read without requesting Keychain approval", async () => {
    const result = await readCursorAccountUsage(
      { kind: "keychain" },
      0,
      1,
      () => Promise.reject(new Error("no network expected")),
      () => Promise.reject(new CursorKeychainTimeoutError()),
    );
    assert.deepStrictEqual(result, {
      accountKey: null,
      records: [],
      missing: false,
      error: "Cursor credentials could not be read without a macOS password dialog.",
    });
  });
});
