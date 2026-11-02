import { describe, expect, it } from "vite-plus/test";

import { readMacKeychainPassword } from "./macKeychainPassword.ts";

describe("non-interactive macOS credentials", () => {
  it.each([-25300, -25308, -25293])(
    "leaves unavailable credentials unavailable (%s)",
    async (status) => {
      let reads = 0;
      const value = await readMacKeychainPassword("service", "account", async () => {
        reads++;
        return JSON.stringify({ status });
      });
      expect(value).toBeNull();
      expect(reads).toBe(1);
    },
  );

  it("decodes an accessible credential", async () => {
    await expect(
      readMacKeychainPassword("service", "account", async () =>
        JSON.stringify({ status: 0, token: " accessible " }),
      ),
    ).resolves.toBe("accessible");
  });

  it.each(["invalid", '{"status":0}', '{"status":-50}'])(
    "rejects a failed or malformed read (%s)",
    async (response) => {
      await expect(
        readMacKeychainPassword("service", "account", async () => response),
      ).rejects.toThrow();
    },
  );

  it("propagates a helper failure", async () => {
    const failure = new Error("helper failed");
    await expect(
      readMacKeychainPassword("service", "account", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
