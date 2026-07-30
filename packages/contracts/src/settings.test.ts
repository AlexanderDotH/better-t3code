import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import {
  DEFAULT_AGENT_ENHANCEMENT_SETTINGS,
  ClientSettingsPatch,
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);

describe("ClientSettings word wrap", () => {
  it("defaults word wrap on", () => {
    expect(decodeClientSettings({}).wordWrap).toBe(true);
  });

  it("ignores obsolete wrapping preferences", () => {
    const decoded = decodeClientSettings({
      chatWordWrap: false,
      diffWordWrap: false,
    });

    expect(decoded.wordWrap).toBe(true);
    expect(decoded).not.toHaveProperty("chatWordWrap");
    expect(decoded).not.toHaveProperty("diffWordWrap");
  });
});

describe("ClientSettings experimental parallel plan implementation", () => {
  it("defaults the experiment off when legacy settings omit it", () => {
    const decoded = decodeClientSettings({});

    expect(decoded.experimentalParallelPlanImplementation).toBe(false);
    expect(DEFAULT_CLIENT_SETTINGS.experimentalParallelPlanImplementation).toBe(false);
  });

  it("accepts explicit enable and disable patches", () => {
    expect(
      decodeClientSettingsPatch({ experimentalParallelPlanImplementation: true })
        .experimentalParallelPlanImplementation,
    ).toBe(true);
    expect(
      decodeClientSettingsPatch({ experimentalParallelPlanImplementation: false })
        .experimentalParallelPlanImplementation,
    ).toBe(false);
  });
});

describe("ServerSettings.providerInstances (slice-2 invariant)", () => {
  it("defaults to an empty record so legacy configs without the key still decode", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
  });

  it("decodes a fully empty config (legacy on-disk shape) without complaint", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providerInstances).toEqual({});
    // Legacy `providers` struct is still hydrated with its per-driver defaults
    // so existing call sites keep working through the migration.
    expect(decoded.providers.codex.enabled).toBe(true);
  });

  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex (personal)",
          config: { homePath: "~/.codex_personal" },
        },
        codex_work: {
          driver: "codex",
          config: { homePath: "~/.codex_work" },
        },
        ollama_local: {
          driver: "ollama",
          displayName: "Ollama (local)",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const personalId = ProviderInstanceId.make("codex_personal");
    const workId = ProviderInstanceId.make("codex_work");
    const ollamaId = ProviderInstanceId.make("ollama_local");

    expect(decoded.providerInstances[personalId]?.driver).toBe("codex");
    expect(decoded.providerInstances[workId]?.config).toEqual({ homePath: "~/.codex_work" });
    // Critical: a config naming a driver this build does not know about
    // (`ollama` is not in `ProviderDriverKind`) must round-trip without loss.
    // The runtime handles "driver not installed" — the schema must not.
    expect(decoded.providerInstances[ollamaId]?.driver).toBe("ollama");
    expect(decoded.providerInstances[ollamaId]?.config).toEqual({
      endpoint: "http://localhost:11434",
    });
  });

  it("rejects instance keys that violate the slug pattern", () => {
    expect(() =>
      decodeServerSettings({
        providerInstances: { "1bad": { driver: "codex" } },
      }),
    ).toThrow();
  });
});

describe("ServerSettings handlebar provider defaults", () => {
  it("defaults new provider settings without enabling credential-backed providers", () => {
    const decoded = decodeServerSettings({});

    expect(decoded.providers.gemini.enabled).toBe(false);
    expect(decoded.providers.openrouter.enabled).toBe(false);
    expect(decoded.providers.openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(decoded.providers.nvidiaNim.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(decoded.providers.localOpenAi.v1BaseUrl).toBe("");
    expect(decoded.providers.localOpenAi.opencodeServerBase).toBe("");
    expect(decoded.providers.opencodeZen.baseUrl).toBe("https://opencode.ai/zen/v1");
    expect(decoded.providers.opencodeGo.baseUrl).toBe("https://opencode.ai/zen/go/v1");
    expect(decoded.providers.kiroAmazonQ.apiHost).toBe("https://q.us-east-1.amazonaws.com");
    expect(decoded.providers.kiroAmazonQ.refreshAuthRegion).toBe("us-east-1");
    expect(decoded.providers.hyperagent.baseUrl).toBe("https://hyperagent.com");
    expect(decoded.providers.hyperagent.model).toBe("sonnet-latest");
    expect(decoded.providers.hyperagent.fastMode).toBe(false);
    expect(decoded.providers.cursorSdk.manualModelIds).toEqual([]);
  });

  it("decodes provider setting patches for the new integration providers", () => {
    const patch = decodeServerSettingsPatch({
      providers: {
        gemini: { apiKey: "  gemini-key  " },
        openrouter: {
          apiKey: "  sk-or-key  ",
          contextCompression: true,
          preferredMaxCatalogContextTokens: "  200000  ",
        },
        nvidiaNim: { apiKey: "  nvapi-key  " },
        localOpenAi: {
          v1BaseUrl: "  http://127.0.0.1:11434/v1  ",
          opencodeServerBase: "  http://127.0.0.1:4096  ",
        },
        opencodeZen: { apiKey: "  zen-key  " },
        opencodeGo: { apiKey: "  go-key  " },
        kiroAmazonQ: {
          apiKey: "  kiro-key  ",
          profileArn: "  arn:aws:codewhisperer:us-east-1:123:profile/test  ",
        },
        hyperagent: {
          sessionCookie: "  session-token  ",
          model: "  opus-latest  ",
          fastMode: true,
        },
        cursorSdk: { apiKey: "  cursor-key  ", manualModelIds: ["  composer-2  "] },
      },
    });

    expect(patch.providers?.gemini?.apiKey).toBe("gemini-key");
    expect(patch.providers?.openrouter?.contextCompression).toBe(true);
    expect(patch.providers?.openrouter?.preferredMaxCatalogContextTokens).toBe("200000");
    expect(patch.providers?.nvidiaNim?.apiKey).toBe("nvapi-key");
    expect(patch.providers?.localOpenAi?.v1BaseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(patch.providers?.localOpenAi?.opencodeServerBase).toBe("http://127.0.0.1:4096");
    expect(patch.providers?.opencodeZen?.apiKey).toBe("zen-key");
    expect(patch.providers?.opencodeGo?.apiKey).toBe("go-key");
    expect(patch.providers?.kiroAmazonQ?.profileArn).toBe(
      "arn:aws:codewhisperer:us-east-1:123:profile/test",
    );
    expect(patch.providers?.hyperagent?.model).toBe("opus-latest");
    expect(patch.providers?.hyperagent?.fastMode).toBe(true);
    expect(patch.providers?.cursorSdk?.manualModelIds).toEqual(["composer-2"]);
  });
});

describe("AgentEnhancementSettings", () => {
  it("matches handlebar enhancement defaults", () => {
    expect(DEFAULT_SERVER_SETTINGS.agentEnhancement).toEqual(DEFAULT_AGENT_ENHANCEMENT_SETTINGS);
    expect(DEFAULT_AGENT_ENHANCEMENT_SETTINGS).toEqual({
      cavemanMode: "off",
      defaultReasoningEffort: "medium",
      deepThinking: {
        enabled: false,
        stepCount: 3,
        refinementPasses: 0,
        parallelEnabled: false,
        parallelBatchSize: 3,
        forceParallelForDurableProviders: false,
      },
    });
  });

  it("accepts valid enhancement patches and rejects out-of-range deep thinking values", () => {
    const patch = decodeServerSettingsPatch({
      agentEnhancement: {
        cavemanMode: "lite",
        defaultReasoningEffort: "xhigh",
        deepThinking: {
          enabled: true,
          stepCount: 8,
          refinementPasses: 3,
          parallelEnabled: true,
          parallelBatchSize: 8,
          forceParallelForDurableProviders: true,
        },
      },
    });

    expect(patch.agentEnhancement?.cavemanMode).toBe("lite");
    expect(patch.agentEnhancement?.deepThinking?.stepCount).toBe(8);

    expect(() =>
      decodeServerSettingsPatch({
        agentEnhancement: { deepThinking: { stepCount: 1 } },
      }),
    ).toThrow();
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults start-from-origin off for legacy configs", () => {
    expect(decodeServerSettings({}).newWorktreesStartFromOrigin).toBe(false);
  });

  it("accepts start-from-origin updates", () => {
    expect(
      decodeServerSettingsPatch({ newWorktreesStartFromOrigin: true }).newWorktreesStartFromOrigin,
    ).toBe(true);
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_personal: { driver: "codex", config: { homePath: "~/.codex" } },
      },
    });
    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
  });

  it("preserves a fork-defined driver entry through patch decoding", () => {
    const patch = decodeServerSettingsPatch({
      providerInstances: {
        ollama_local: {
          driver: "ollama",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const ollamaId = ProviderInstanceId.make("ollama_local");
    expect(patch.providerInstances?.[ollamaId]?.driver).toBe("ollama");
  });
});

describe("ServerSettingsPatch string normalization", () => {
  it("trims string settings while decoding patches", () => {
    const patch = decodeServerSettingsPatch({
      addProjectBaseDirectory: "  ~/Development  ",
      textGenerationModelSelection: { model: "  gpt-5.4-mini  " },
      observability: {
        otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
      },
      providers: {
        codex: {
          binaryPath: "  /opt/homebrew/bin/codex  ",
          homePath: "  ~/.codex  ",
        },
      },
      providerInstances: {
        codex_personal: {
          driver: "  codex  ",
          displayName: "  Codex Personal  ",
          config: { homePath: "  ~/.codex-personal  " },
        },
      },
    });

    expect(patch.addProjectBaseDirectory).toBe("~/Development");
    expect(patch.textGenerationModelSelection?.model).toBe("gpt-5.4-mini");
    expect(patch.observability?.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(patch.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(patch.providers?.codex?.homePath).toBe("~/.codex");
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.displayName).toBe(
      "Codex Personal",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.config).toEqual({
      homePath: "  ~/.codex-personal  ",
    });
  });

  it("trims encoded server settings values before validation", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      addProjectBaseDirectory: "  ~/Development  ",
      providers: {
        ...defaultSettings.providers,
        codex: {
          ...defaultSettings.providers.codex,
          binaryPath: "  /opt/homebrew/bin/codex  ",
        },
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
  });
});
