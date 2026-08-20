import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  DEFAULT_SERVER_SETTINGS,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  providerEnabledSettingsPatch,
  providerStatusLabel,
  supportsEnvironmentAgentSettings,
} from "./environment-agent-settings";

function provider(input: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.2.3",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-13T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...input,
  };
}

describe("environment agent settings", () => {
  it("gates settings on the advertised version", () => {
    expect(supportsEnvironmentAgentSettings(undefined)).toBe(false);
    expect(
      supportsEnvironmentAgentSettings({
        repositoryIdentity: true,
        midChatProviderSwitching: true,
        environmentSettingsVersion: 1,
      }),
    ).toBe(true);
  });

  it("patches a legacy default provider without replacing unrelated settings", () => {
    expect(
      providerEnabledSettingsPatch({
        provider: provider(),
        settings: DEFAULT_SERVER_SETTINGS,
        enabled: false,
      }),
    ).toEqual({ providers: { codex: { enabled: false } } });
    expect(
      providerEnabledSettingsPatch({
        provider: provider({
          instanceId: ProviderInstanceId.make("gemini"),
          driver: ProviderDriverKind.make("gemini"),
        }),
        settings: DEFAULT_SERVER_SETTINGS,
        enabled: true,
      }),
    ).toEqual({ providers: { gemini: { enabled: true } } });
  });

  it("replaces the provider instance map for configured instances", () => {
    const instanceId = ProviderInstanceId.make("codex_work");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
    };
    expect(
      providerEnabledSettingsPatch({
        provider: provider({ instanceId }),
        settings,
        enabled: false,
      }),
    ).toEqual({
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: false },
      },
    });
  });

  it("refuses to invent configuration for an unknown custom instance", () => {
    expect(
      providerEnabledSettingsPatch({
        provider: provider({
          instanceId: ProviderInstanceId.make("custom"),
          driver: ProviderDriverKind.make("custom"),
        }),
        settings: DEFAULT_SERVER_SETTINGS,
        enabled: false,
      }),
    ).toBeNull();
  });

  it("summarizes provider readiness without hiding auth failures", () => {
    expect(providerStatusLabel(provider())).toBe("Ready · 1.2.3");
    expect(providerStatusLabel(provider({ auth: { status: "unauthenticated" } }))).toBe(
      "Sign-in required",
    );
  });
});
