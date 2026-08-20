import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderSettingsFields } from "./ProviderSettingsForm";
import { DRIVER_OPTION_BY_VALUE, DRIVER_OPTIONS } from "./providerDriverMeta";

const NATIVE_PROVIDER_DRIVERS = [
  {
    kind: "codex",
    label: "Codex",
    fields: ["binaryPath", "homePath", "shadowHomePath", "launchArgs"],
  },
  {
    kind: "claudeAgent",
    label: "Claude",
    fields: ["binaryPath", "homePath", "launchArgs"],
  },
  {
    kind: "cursor",
    label: "Cursor",
    badgeLabel: "Early Access",
    fields: ["binaryPath", "apiEndpoint"],
  },
  {
    kind: "grok",
    label: "Grok",
    badgeLabel: "Early Access",
    fields: ["binaryPath"],
  },
  {
    kind: "opencode",
    label: "OpenCode",
    fields: ["binaryPath", "serverUrl", "serverPassword"],
  },
  {
    kind: "gemini",
    label: "Gemini",
    badgeLabel: "Early Access",
    fields: [],
  },
] as const;

describe("providerDriverMeta", () => {
  it("exposes exactly the six native provider drivers in upstream order", () => {
    expect(
      DRIVER_OPTIONS.map(({ value, label, badgeLabel }) => ({
        value,
        label,
        ...(badgeLabel ? { badgeLabel } : {}),
      })),
    ).toEqual(
      NATIVE_PROVIDER_DRIVERS.map(({ kind, label, ...driver }) => ({
        value: ProviderDriverKind.make(kind),
        label,
        ...("badgeLabel" in driver && driver.badgeLabel ? { badgeLabel: driver.badgeLabel } : {}),
      })),
    );
  });

  it("derives settings fields for every native provider driver", () => {
    for (const driver of NATIVE_PROVIDER_DRIVERS) {
      const definition = DRIVER_OPTION_BY_VALUE[ProviderDriverKind.make(driver.kind)];

      expect(definition).toMatchObject({
        value: ProviderDriverKind.make(driver.kind),
        label: driver.label,
      });
      expect(deriveProviderSettingsFields(definition!).map((field) => field.key)).toEqual(
        driver.fields,
      );
    }
  });
});
