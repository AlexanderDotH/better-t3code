import { DEFAULT_SERVER_SETTINGS, makeBetterT3SettingsV1 } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveResourceProtectionPolicy } from "./ResourceProtectionPolicy.ts";

describe("resource protection policy", () => {
  it("preserves both protections for migrated installations", () => {
    expect(
      resolveResourceProtectionPolicy({
        ...DEFAULT_SERVER_SETTINGS,
        betterT3Environment: makeBetterT3SettingsV1("existing-install-migration"),
      }),
    ).toEqual({ adaptiveAdmission: true, processSuspension: true });
  });

  it("keeps both protections off for clean installations until explicitly enabled", () => {
    expect(
      resolveResourceProtectionPolicy({
        ...DEFAULT_SERVER_SETTINGS,
        betterT3Environment: makeBetterT3SettingsV1("clean-install"),
      }),
    ).toEqual({ adaptiveAdmission: false, processSuspension: false });
  });

  it("resolves adaptive admission and process suspension independently", () => {
    expect(
      resolveResourceProtectionPolicy({
        ...DEFAULT_SERVER_SETTINGS,
        betterT3Environment: makeBetterT3SettingsV1("clean-install", {
          "resource.adaptiveAdmission": true,
          "resource.processSuspension": false,
        }),
      }),
    ).toEqual({ adaptiveAdmission: true, processSuspension: false });
  });
});
