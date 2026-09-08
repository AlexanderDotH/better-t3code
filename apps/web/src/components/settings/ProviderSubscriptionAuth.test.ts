import { describe, expect, it } from "vite-plus/test";

import {
  deriveProviderSubscriptionPresentation,
  reduceProviderAuthDialogState,
  toProviderAuthDialogEvent,
} from "./ProviderSubscriptionAuth";

describe("deriveProviderSubscriptionPresentation", () => {
  it("offers generic interactive connect from advertised capabilities", () => {
    expect(
      deriveProviderSubscriptionPresentation({
        providerName: "ChatGPT Subscription",
        auth: {
          status: "unauthenticated",
          capabilities: { flows: ["browser", "device-code"], canDisconnect: true },
        },
      }),
    ).toMatchObject({
      action: "connect",
      actionLabel: "Connect",
      providerName: "ChatGPT Subscription",
      account: null,
      plan: null,
    });
  });

  it("shows account, plan, rate-limit state, and disconnect when authenticated", () => {
    expect(
      deriveProviderSubscriptionPresentation({
        providerName: "ChatGPT Subscription",
        auth: {
          status: "authenticated",
          email: "alex@example.com",
          plan: { label: "Pro" },
          capabilities: { flows: ["browser", "device-code"], canDisconnect: true },
        },
        rateLimit: { status: "limited", retryAfterSeconds: 120 },
      }),
    ).toEqual({
      action: "disconnect",
      actionLabel: "Disconnect",
      providerName: "ChatGPT Subscription",
      flows: ["browser", "device-code"],
      credential: null,
      canDisconnect: true,
      environmentCredential: false,
      account: "alex@example.com",
      plan: "Pro",
      rateLimit: "Rate limited · Retry in 2 minutes",
      tone: "warning",
    });
  });

  it("offers reconnect after a visible auth failure without falling back", () => {
    expect(
      deriveProviderSubscriptionPresentation({
        providerName: "ChatGPT Subscription",
        auth: {
          status: "unauthenticated",
          capabilities: { flows: ["browser"], canDisconnect: true },
        },
        message: "Subscription refresh failed.",
      }),
    ).toMatchObject({
      action: "reconnect",
      actionLabel: "Reconnect",
      rateLimit: null,
      tone: "error",
    });
  });

  it("keeps provider status copy out of the auth detail row", () => {
    const presentation = deriveProviderSubscriptionPresentation({
      providerName: "OpenRouter",
      auth: {
        status: "unauthenticated",
        capabilities: {
          flows: [],
          canDisconnect: false,
          credential: { kind: "api-key", label: "API key" },
        },
      },
      message: "OpenRouter Management API keys cannot be used with model completion endpoints.",
    });

    expect(presentation).toMatchObject({
      action: "set-credential",
      rateLimit: null,
      tone: "neutral",
    });
  });

  it("offers reconnect for expired credentials even without a provider message", () => {
    expect(
      deriveProviderSubscriptionPresentation({
        providerName: "ChatGPT Subscription",
        auth: {
          status: "expired",
          capabilities: { flows: ["browser"], canDisconnect: true },
        },
      }),
    ).toMatchObject({ action: "reconnect", actionLabel: "Reconnect", tone: "error" });
  });

  it("offers a generic API-key action without driver branching", () => {
    expect(
      deriveProviderSubscriptionPresentation({
        providerName: "OpenRouter",
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
    ).toMatchObject({
      action: "set-credential",
      actionLabel: "Add API key",
      providerName: "OpenRouter",
      credential: { kind: "api-key", label: "API key" },
      environmentCredential: false,
    });
  });

  it("keeps replace and disconnect capabilities for an authenticated stored API key", () => {
    expect(
      deriveProviderSubscriptionPresentation({
        providerName: "OpenRouter",
        auth: {
          status: "authenticated",
          label: "or-key-…cafe",
          capabilities: {
            flows: [],
            canDisconnect: true,
            credential: { kind: "api-key", label: "API key" },
          },
        },
        message: "Remove OPENROUTER_API_KEY from this provider instance to disconnect.",
      }),
    ).toMatchObject({
      action: "set-credential",
      actionLabel: "Replace API key",
      canDisconnect: true,
      environmentCredential: false,
    });
  });

  it("explains an environment-backed credential and offers a stored override", () => {
    expect(
      deriveProviderSubscriptionPresentation({
        providerName: "OpenRouter Work",
        auth: {
          status: "authenticated",
          label: "or-key-…cafe",
          capabilities: {
            flows: [],
            canDisconnect: false,
            credential: { kind: "api-key", label: "API key" },
          },
        },
      }),
    ).toMatchObject({
      action: "set-credential",
      actionLabel: "Replace API key",
      account: "or-key-…cafe",
      environmentCredential: true,
      tone: "neutral",
    });
  });

  it("renders no auth controls when the provider advertises no auth capability", () => {
    expect(
      deriveProviderSubscriptionPresentation({
        providerName: "Gemini",
        auth: { status: "authenticated" },
      }),
    ).toBeNull();
  });
});

describe("reduceProviderAuthDialogState", () => {
  it("presents browser and device-code challenges without exposing credentials", () => {
    expect(
      reduceProviderAuthDialogState(
        { status: "starting" },
        { status: "browser", authorizationUrl: "https://auth.openai.com/authorize" },
      ),
    ).toEqual({
      status: "browser",
      authorizationUrl: "https://auth.openai.com/authorize",
    });

    expect(
      reduceProviderAuthDialogState(
        { status: "starting" },
        {
          status: "device-code",
          verificationUrl: "https://auth.openai.com/device",
          userCode: "ABCD-EFGH",
        },
      ),
    ).toEqual({
      status: "device-code",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
    });
  });

  it("keeps terminal failure and cancellation states visible", () => {
    expect(
      reduceProviderAuthDialogState(
        { status: "starting" },
        { status: "failed", message: "Device code expired." },
      ),
    ).toEqual({ status: "failed", message: "Device code expired." });
    expect(reduceProviderAuthDialogState({ status: "starting" }, { status: "cancelled" })).toEqual({
      status: "cancelled",
    });
  });
});

describe("toProviderAuthDialogEvent", () => {
  it("maps exact browser and device challenge events into client-only dialog state", () => {
    expect(
      toProviderAuthDialogEvent({
        type: "browserChallenge",
        authorizationUrl: "https://auth.openai.com/authorize",
      }),
    ).toEqual({
      status: "browser",
      authorizationUrl: "https://auth.openai.com/authorize",
    });
    expect(
      toProviderAuthDialogEvent({
        type: "deviceCodeChallenge",
        verificationUrl: "https://auth.openai.com/device",
        userCode: "ABCD-EFGH",
        expiresAt: "2026-08-23T16:00:00.000Z",
        pollIntervalSeconds: 5,
      }),
    ).toEqual({
      status: "device-code",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
    });
  });

  it("maps typed failures and cancellation reasons without leaking auth payloads", () => {
    expect(
      toProviderAuthDialogEvent({
        type: "failed",
        failure: {
          code: "challenge-expired",
          reason: "Device code expired.",
          retryable: true,
        },
      }),
    ).toEqual({ status: "failed", message: "Device code expired." });
    expect(toProviderAuthDialogEvent({ type: "cancelled", reason: "User cancelled." })).toEqual({
      status: "cancelled",
    });
  });
});
