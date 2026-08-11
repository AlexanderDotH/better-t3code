import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isPlanModeAvailable } from "./providerModels";

const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");
const OPENCODE = ProviderDriverKind.make("opencode");

function provider(driver: ProviderDriverKind, showInteractionModeToggle: boolean): ServerProvider {
  return {
    instanceId: defaultInstanceIdForDriver(driver),
    driver,
    enabled: true,
    installed: true,
    version: "test",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-11T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    showInteractionModeToggle,
  };
}

describe("isPlanModeAvailable", () => {
  it("makes plan mode available for Codex without the legacy setting", () => {
    expect(
      isPlanModeAvailable({
        providers: [provider(CODEX, true)],
        provider: CODEX,
        legacyPlanModeEnabled: false,
      }),
    ).toBe(true);
  });

  it("keeps the legacy setting for other providers that support plan mode", () => {
    const providers = [provider(CLAUDE, true)];

    expect(
      isPlanModeAvailable({
        providers,
        provider: CLAUDE,
        legacyPlanModeEnabled: false,
      }),
    ).toBe(false);
    expect(
      isPlanModeAvailable({
        providers,
        provider: CLAUDE,
        legacyPlanModeEnabled: true,
      }),
    ).toBe(true);
  });

  it("respects providers that do not implement plan mode", () => {
    expect(
      isPlanModeAvailable({
        providers: [provider(OPENCODE, false)],
        provider: OPENCODE,
        legacyPlanModeEnabled: true,
      }),
    ).toBe(false);
  });
});
