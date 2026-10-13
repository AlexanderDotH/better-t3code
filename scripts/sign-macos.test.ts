import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { expect, it, vi } from "vite-plus/test";

import sign from "./sign-macos.ts";

const localSigning = vi.hoisted(() => ({ identity: undefined as string | undefined }));
vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));
vi.mock("./lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ T3CODE_DESKTOP_LOCAL_SIGNING_IDENTITY: localSigning.identity }),
}));

it("batches codesign calls without changing existing signing options", async () => {
  const options = {
    app: "/tmp/T3 Code.app",
    identity: "Developer ID Application: T3 Tools, Inc.",
    keychain: "/tmp/t3code.keychain",
    provisioningProfile: "/tmp/t3code.provisionprofile",
    optionsForFile: () => ({
      entitlements: "/tmp/t3code.entitlements.plist",
      hardenedRuntime: true,
    }),
  } satisfies SignOptions;

  await sign(options);

  expect(signApplication).toHaveBeenCalledExactlyOnceWith({
    ...options,
    batchCodesignCalls: true,
  });
});

it.each([undefined, "Local Development"])(
  "seals local builds with identity %s without Apple distribution services",
  async (identity) => {
    vi.mocked(signApplication).mockClear();
    localSigning.identity = identity;
    const options = {
      app: "/tmp/Better T3 Code (Alpha).app",
      identity: "-",
      optionsForFile: () => ({
        entitlements: "/tmp/local.entitlements.plist",
        hardenedRuntime: true,
      }),
    } satisfies SignOptions;
    try {
      await sign(options);
      const signed = vi.mocked(signApplication).mock.calls[0]![0];
      expect(signed.identity).toBe(identity ?? "-");
      expect(signed.identityValidation).toBe(false);
      expect(signed.preAutoEntitlements).toBe(false);
      expect(signed.preEmbedProvisioningProfile).toBe(false);
      expect(signed.optionsForFile?.(options.app, { platform: "darwin" })).toEqual({
        entitlements: "/tmp/local.entitlements.plist",
        hardenedRuntime: false,
        timestamp: "none",
      });
    } finally {
      localSigning.identity = undefined;
    }
  },
);
