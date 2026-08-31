import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  DEFAULT_SERVER_SETTINGS,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mobileProviderAuthEventPresentation,
  providerAuthenticationPresentation,
  providerAuthMutationAccess,
  providerConfigSettingsPatch,
  providerEnabledSettingsPatch,
  providerRateLimitLabel,
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

  it("presents interactive authentication from capabilities instead of the driver name", () => {
    expect(
      providerAuthenticationPresentation(
        provider({
          driver: ProviderDriverKind.make("chatgpt"),
          displayName: "ChatGPT Subscription",
          auth: {
            status: "authenticated",
            email: "alex@example.com",
            plan: { label: "Pro" },
            capabilities: { flows: ["device-code"], canDisconnect: true },
          },
        }),
      ),
    ).toEqual({
      action: "disconnect",
      actionLabel: "Disconnect",
      detail: "alex@example.com · Pro",
      providerLabel: "ChatGPT Subscription",
      method: "device-code",
    });

    expect(
      providerAuthenticationPresentation(
        provider({
          driver: ProviderDriverKind.make("openrouter"),
          displayName: "OpenRouter",
          auth: {
            status: "unauthenticated",
            capabilities: {
              flows: [],
              canDisconnect: false,
              credential: {
                kind: "api-key",
                label: "API key",
                placeholder: "sk-or-v1-…",
              },
            },
          },
        }),
      ),
    ).toEqual({
      action: "connect",
      actionLabel: "Save API key",
      credentialActionLabel: "Save API key",
      credentialLabel: "API key",
      credentialPlaceholder: "sk-or-v1-…",
      detail: "OpenRouter API key required",
      providerLabel: "OpenRouter",
      method: "api-key",
    });

    expect(
      providerAuthenticationPresentation(
        provider({
          driver: ProviderDriverKind.make("openrouter"),
          displayName: "OpenRouter",
          auth: {
            status: "authenticated",
            label: "Saved API key",
            capabilities: {
              flows: [],
              canDisconnect: true,
              credential: { kind: "api-key", label: "API key" },
            },
          },
        }),
      ),
    ).toEqual({
      action: "disconnect",
      actionLabel: "Disconnect",
      credentialActionLabel: "Replace API key",
      credentialLabel: "API key",
      detail: "Saved API key",
      providerLabel: "OpenRouter",
      method: "api-key",
    });
  });

  it("explains environment-backed authentication without offering a fake disconnect", () => {
    expect(
      providerAuthenticationPresentation(
        provider({
          driver: ProviderDriverKind.make("openrouter"),
          displayName: "OpenRouter",
          message: "Using the instance OPENROUTER_API_KEY environment entry.",
          auth: {
            status: "authenticated",
            label: "Environment API key",
            capabilities: {
              flows: [],
              canDisconnect: false,
              credential: { kind: "api-key", label: "API key" },
            },
          },
        }),
      ),
    ).toEqual({
      action: "none",
      actionLabel: "",
      credentialActionLabel: "Replace API key",
      credentialLabel: "API key",
      detail: "Using the instance OPENROUTER_API_KEY environment entry.",
      providerLabel: "OpenRouter",
      method: "api-key",
    });
  });

  it("keeps device challenges and failures visible on mobile", () => {
    expect(
      mobileProviderAuthEventPresentation(
        {
          type: "deviceCodeChallenge",
          verificationUrl: "https://auth.openai.com/device",
          userCode: "ABCD-EFGH",
          expiresAt: "2026-08-23T16:00:00.000Z",
          pollIntervalSeconds: 5,
        },
        "ChatGPT Subscription",
      ),
    ).toEqual({
      kind: "device-code",
      message: "Enter ABCD-EFGH at https://auth.openai.com/device",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
    });
    expect(
      mobileProviderAuthEventPresentation(
        {
          type: "failed",
          failure: { code: "broker-failed", reason: "Broker stopped.", retryable: true },
        },
        "ChatGPT Subscription",
      ),
    ).toEqual({ kind: "error", message: "Broker stopped." });

    expect(
      mobileProviderAuthEventPresentation(
        { type: "starting", flow: "device-code" },
        "Another Provider",
      ),
    ).toEqual({ kind: "progress", message: "Preparing secure Another Provider sign-in…" });

    expect(
      mobileProviderAuthEventPresentation(
        {
          type: "browserChallenge",
          authorizationUrl: "https://provider.example/authorize",
        },
        "Another Provider",
      ),
    ).toEqual({
      kind: "browser",
      message: "Continue Another Provider sign-in in your browser.",
      authorizationUrl: "https://provider.example/authorize",
    });
  });

  it("patches one provider config without replacing instance metadata or its peers", () => {
    const instanceId = ProviderInstanceId.make("openrouter_work");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("openrouter"),
          displayName: "Work OpenRouter",
          enabled: true,
          config: { protocol: "chat-completions" },
        },
        codex_work: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
        },
      },
    };

    expect(
      providerConfigSettingsPatch({
        instanceId,
        settings,
        config: {
          protocol: "responses",
          contextCompression: true,
        },
      }),
    ).toEqual({
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("openrouter"),
          displayName: "Work OpenRouter",
          enabled: true,
          config: {
            protocol: "responses",
            contextCompression: true,
          },
        },
        codex_work: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
        },
      },
    });
  });

  it("shows retry timing and removes auth actions for known read-only sessions", () => {
    expect(providerRateLimitLabel({ status: "limited", retryAfterSeconds: 90 })).toBe(
      "Rate limited · Retry in 2 minutes",
    );
    expect(
      providerAuthMutationAccess({
        authenticated: true,
        scopes: ["orchestration:read"],
      }),
    ).toBe("read-only");
    expect(providerAuthMutationAccess(null)).toBe("editable");
  });
});
