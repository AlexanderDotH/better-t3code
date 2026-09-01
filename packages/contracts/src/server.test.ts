import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ProviderAuthConnectEvent,
  ProviderAuthConnectInput,
  ProviderAuthDisconnectResult,
  ProviderAuthSetCredentialInput,
  ProviderAuthSetCredentialResult,
  ServerConfig,
  ServerProvider,
  ServerProviders,
  ServerUpsertKeybindingResult,
} from "./server.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeServerProviders = Schema.decodeUnknownSync(ServerProviders);
const decodeProviderAuthConnectInput = Schema.decodeUnknownSync(ProviderAuthConnectInput);
const decodeProviderAuthConnectEvent = Schema.decodeUnknownSync(ProviderAuthConnectEvent);
const decodeProviderAuthDisconnectResult = Schema.decodeUnknownSync(ProviderAuthDisconnectResult);
const decodeProviderAuthSetCredentialInput = Schema.decodeUnknownSync(
  ProviderAuthSetCredentialInput,
);
const decodeProviderAuthSetCredentialResult = Schema.decodeUnknownSync(
  ProviderAuthSetCredentialResult,
);
const decodeUpsertKeybindingResult = Schema.decodeUnknownSync(ServerUpsertKeybindingResult);
const decodeAvailableEditors = Schema.decodeUnknownSync(ServerConfig.fields.availableEditors);

const baseProviderSnapshot = {
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
};

describe("ServerProvider", () => {
  it("decodes visible but non-selectable catalog models with a safe explanation", () => {
    const parsed = decodeServerProvider({
      ...baseProviderSnapshot,
      instanceId: "openrouter",
      driver: "openrouter",
      models: [
        {
          slug: "openai/no-tools",
          name: "No tools",
          isCustom: false,
          isSelectable: false,
          unavailableReason: "This model does not support tool calling.",
          capabilities: {
            outputModalities: ["text"],
            toolSupport: { tools: false, parallelToolCalls: false, toolChoice: false },
          },
        },
      ],
    });

    expect(parsed.models[0]).toMatchObject({
      isSelectable: false,
      unavailableReason: "This model does not support tool calling.",
    });
  });

  it("decodes subscription auth capabilities, plan, expiry, and rate-limit state", () => {
    const parsed = decodeServerProvider({
      ...baseProviderSnapshot,
      instanceId: "chatgpt_personal",
      driver: "chatgpt",
      auth: {
        status: "pending",
        type: "chatgpt-subscription",
        accountId: "account-1",
        email: "alex@example.com",
        expiresAt: "2026-04-10T01:00:00.000Z",
        capabilities: {
          flows: ["browser", "device-code"],
          canDisconnect: true,
        },
        plan: {
          id: "plus",
          label: "ChatGPT Plus",
        },
      },
      rateLimit: {
        status: "limited",
        limit: 80,
        remaining: 0,
        resetsAt: "2026-04-10T00:05:00.000Z",
        retryAfterSeconds: 30,
        message: "Try again shortly.",
      },
    });

    expect(parsed.auth).toEqual({
      status: "pending",
      type: "chatgpt-subscription",
      accountId: "account-1",
      email: "alex@example.com",
      expiresAt: "2026-04-10T01:00:00.000Z",
      capabilities: {
        flows: ["browser", "device-code"],
        canDisconnect: true,
      },
      plan: {
        id: "plus",
        label: "ChatGPT Plus",
      },
    });
    expect(parsed.rateLimit).toEqual({
      status: "limited",
      limit: 80,
      remaining: 0,
      resetsAt: "2026-04-10T00:05:00.000Z",
      retryAfterSeconds: 30,
      message: "Try again shortly.",
    });
  });

  it("decodes a generic API-key credential capability without admitting a credential value", () => {
    const parsed = decodeServerProvider({
      ...baseProviderSnapshot,
      instanceId: "openrouter_personal",
      driver: "openrouter",
      auth: {
        status: "unauthenticated",
        capabilities: {
          flows: [],
          canDisconnect: false,
          credential: {
            kind: "api-key",
            label: "OpenRouter API key",
            placeholder: "sk-or-v1-...",
            credential: "must-not-cross-the-wire",
          },
        },
      },
    });

    expect(parsed.auth.capabilities?.credential).toEqual({
      kind: "api-key",
      label: "OpenRouter API key",
      placeholder: "sk-or-v1-...",
    });
  });

  it("defaults capability arrays when decoding provider snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.versionAdvisory).toBeUndefined();
    expect(parsed.updateState).toBeUndefined();
    expect(parsed.nativeSubagents).toBeUndefined();
    expect(parsed.fetchWorkers).toBeUndefined();
  });

  it("decodes Fetch worker capabilities", () => {
    const parsed = decodeServerProvider({
      instanceId: "claude_work",
      driver: "claudeAgent",
      fetchWorkers: {
        maxRecommendedWorkers: 12,
        commandExecutionPolicy: "deny",
      },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.fetchWorkers).toEqual({
      maxRecommendedWorkers: 12,
      commandExecutionPolicy: "deny",
    });
  });

  it("rejects invalid Fetch worker budgets and policies", () => {
    const provider = {
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    };

    expect(() =>
      decodeServerProvider({
        ...provider,
        fetchWorkers: {
          maxRecommendedWorkers: 0,
          commandExecutionPolicy: "read-only-sandbox",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeServerProvider({
        ...provider,
        fetchWorkers: {
          maxRecommendedWorkers: 1.5,
          commandExecutionPolicy: "read-only-sandbox",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeServerProvider({
        ...provider,
        fetchWorkers: {
          maxRecommendedWorkers: 8,
          commandExecutionPolicy: "allow",
        },
      }),
    ).toThrow();
  });

  it("decodes native subagent capabilities", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      nativeSubagents: {
        toolName: "spawn_agent",
        maxRecommendedSubagents: 4,
      },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.nativeSubagents).toEqual({
      toolName: "spawn_agent",
      maxRecommendedSubagents: 4,
    });
  });

  it("rejects invalid native subagent capabilities", () => {
    const provider = {
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    };

    expect(() =>
      decodeServerProvider({
        ...provider,
        nativeSubagents: {
          toolName: " ",
          maxRecommendedSubagents: 4,
        },
      }),
    ).toThrow();
    expect(() =>
      decodeServerProvider({
        ...provider,
        nativeSubagents: {
          toolName: "spawn_agent",
          maxRecommendedSubagents: 0,
        },
      }),
    ).toThrow();
  });

  it("defaults one-click update support when decoding older advisory snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        updateCommand: "npm install -g @openai/codex@latest",
        checkedAt: "2026-04-10T00:00:00.000Z",
        message: "Update available.",
      },
    });

    expect(parsed.versionAdvisory?.canUpdate).toBe(false);
  });

  it("decodes continuation group metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex_personal",
      driver: "codex",
      continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.continuation?.groupKey).toBe("codex:home:/Users/julius/.codex");
  });

  it("decodes optional legacy model metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          isLegacy: true,
          capabilities: null,
        },
      ],
    });

    expect(parsed.models[0]?.isLegacy).toBe(true);
  });
});

describe("provider auth lifecycle", () => {
  it("decodes browser and device-code connection challenges", () => {
    expect(
      decodeProviderAuthConnectInput({ instanceId: "chatgpt_personal", flow: "browser" }),
    ).toEqual({ instanceId: "chatgpt_personal", flow: "browser" });

    expect(
      decodeProviderAuthConnectEvent({
        type: "browserChallenge",
        authorizationUrl: "https://auth.openai.com/authorize",
        expiresAt: "2026-04-10T00:10:00.000Z",
      }),
    ).toEqual({
      type: "browserChallenge",
      authorizationUrl: "https://auth.openai.com/authorize",
      expiresAt: "2026-04-10T00:10:00.000Z",
    });

    expect(
      decodeProviderAuthConnectEvent({
        type: "deviceCodeChallenge",
        verificationUrl: "https://auth.openai.com/device",
        userCode: "ABCD-EFGH",
        expiresAt: "2026-04-10T00:10:00.000Z",
        pollIntervalSeconds: 5,
      }),
    ).toEqual({
      type: "deviceCodeChallenge",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-04-10T00:10:00.000Z",
      pollIntervalSeconds: 5,
    });
  });

  it("decodes every terminal event without admitting credentials onto the wire", () => {
    expect(
      decodeProviderAuthConnectEvent({
        type: "connected",
        auth: {
          status: "authenticated",
          email: "alex@example.com",
          accessToken: "must-not-cross-the-wire",
          plan: { id: "plus", label: "ChatGPT Plus" },
        },
        accessToken: "must-not-cross-the-wire",
      }),
    ).toEqual({
      type: "connected",
      auth: {
        status: "authenticated",
        email: "alex@example.com",
        plan: { id: "plus", label: "ChatGPT Plus" },
      },
    });

    expect(
      decodeProviderAuthConnectEvent({
        type: "failed",
        failure: {
          code: "authorization-declined",
          reason: "The sign-in request was declined.",
          retryable: true,
        },
      }),
    ).toEqual({
      type: "failed",
      failure: {
        code: "authorization-declined",
        reason: "The sign-in request was declined.",
        retryable: true,
      },
    });
    expect(
      decodeProviderAuthConnectEvent({ type: "cancelled", reason: "User cancelled." }),
    ).toEqual({ type: "cancelled", reason: "User cancelled." });
  });

  it("rejects unsupported flows and invalid device-code polling intervals", () => {
    expect(() =>
      decodeProviderAuthConnectInput({ instanceId: "chatgpt_personal", flow: "api-key" }),
    ).toThrow();
    expect(() =>
      decodeProviderAuthConnectEvent({
        type: "deviceCodeChallenge",
        verificationUrl: "https://auth.openai.com/device",
        userCode: "ABCD-EFGH",
        expiresAt: "2026-04-10T00:10:00.000Z",
        pollIntervalSeconds: 0,
      }),
    ).toThrow();
  });

  it("decodes disconnect acknowledgements without token material", () => {
    expect(
      decodeProviderAuthDisconnectResult({
        instanceId: "chatgpt_personal",
        auth: { status: "unauthenticated", accessToken: "must-not-cross-the-wire" },
      }),
    ).toEqual({
      instanceId: "chatgpt_personal",
      auth: { status: "unauthenticated" },
    });
  });

  it("decodes API-key credential mutation input and a redacted acknowledgement", () => {
    expect(
      decodeProviderAuthSetCredentialInput({
        instanceId: "openrouter_personal",
        credential: "  sk-or-v1-secret  ",
      }),
    ).toEqual({
      instanceId: "openrouter_personal",
      credential: "sk-or-v1-secret",
    });

    expect(
      decodeProviderAuthSetCredentialResult({
        instanceId: "openrouter_personal",
        auth: {
          status: "authenticated",
          label: "sk-or-v1-...cdef",
          credential: "must-not-cross-the-wire",
        },
        credential: "must-not-cross-the-wire",
      }),
    ).toEqual({
      instanceId: "openrouter_personal",
      auth: {
        status: "authenticated",
        label: "sk-or-v1-...cdef",
      },
    });
  });

  it("rejects empty API-key credentials", () => {
    expect(() =>
      decodeProviderAuthSetCredentialInput({
        instanceId: "openrouter_personal",
        credential: "   ",
      }),
    ).toThrow();
  });
});

describe("server config forward compatibility", () => {
  it("drops config issues with kinds this build does not know", () => {
    const parsed = decodeUpsertKeybindingResult({
      keybindings: [],
      issues: [
        { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
        { kind: "keybindings.future-issue", message: "From a newer server" },
      ],
    });

    expect(parsed.issues).toEqual([
      { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
    ]);
  });

  it("drops editor ids this build does not know", () => {
    const parsed = decodeAvailableEditors(["zed", "some-future-editor", "vscode"]);

    expect(parsed).toEqual(["zed", "vscode"]);
  });

  // A provider status this build has never seen (a new ServerProviderState,
  // ServerProviderAuthStatus, etc. member) previously failed the whole
  // `providers` array, taking every other provider down with it and, since
  // `providers` sits inside `ServerConfig`, failing the whole config decode —
  // an older client would drop its connection over one provider it can't
  // render. Dropping just that element keeps every other provider working.
  it("drops providers this build cannot decode instead of failing the whole array", () => {
    const decodedBase = decodeServerProvider(baseProviderSnapshot);

    const parsed = decodeServerProviders([
      baseProviderSnapshot,
      { ...baseProviderSnapshot, instanceId: "future", status: "some-future-status" },
    ]);

    expect(parsed).toEqual([decodedBase]);
  });
});
