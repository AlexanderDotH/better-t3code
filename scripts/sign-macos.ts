import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

import { loadRepoEnv } from "./lib/public-config.ts";

/** Seal local app bundles too; a configured certificate preserves their privacy-grant identity. */
export default async function sign(options: SignOptions): Promise<void> {
  const signingOptions =
    options.identity === "-"
      ? ({
          ...options,
          identity: loadRepoEnv().T3CODE_DESKTOP_LOCAL_SIGNING_IDENTITY?.trim() || "-",
          identityValidation: false,
          preAutoEntitlements: false,
          preEmbedProvisioningProfile: false,
          optionsForFile: (filePath, context) => ({
            ...options.optionsForFile?.(filePath, context),
            hardenedRuntime: false,
            timestamp: "none",
          }),
        } satisfies SignOptions)
      : options;
  await signApplication({ ...signingOptions, batchCodesignCalls: true });
}
