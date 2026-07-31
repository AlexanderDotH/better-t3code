import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import {
  ClientSettingsSchema,
  ClientSettingsPatch,
  DEFAULT_AGENT_ENHANCEMENT_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_PARALLEL_PLAN_REVIEW_MODEL_SELECTION,
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

describe("ClientSettings glass opacity", () => {
  it("defaults to a readable translucent surface", () => {
    expect(decodeClientSettings({}).glassOpacity).toBe(80);
  });

  it.each([39, 101, 72.5])("rejects an invalid glass opacity: %s", (value) => {
    expect(() => decodeClientSettings({ glassOpacity: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ glassOpacity: value })).toThrow();
  });

  it.each([40, 75, 100])("accepts a glass opacity within the supported range: %s", (value) => {
    expect(decodeClientSettings({ glassOpacity: value }).glassOpacity).toBe(value);
    expect(decodeClientSettingsPatch({ glassOpacity: value }).glassOpacity).toBe(value);
  });
});

describe("ClientSettings environment identification", () => {
  it("defaults to artwork and accepts each presentation mode", () => {
    expect(decodeClientSettings({}).environmentIdentificationMode).toBe("artwork");

    for (const mode of ["artwork", "pill", "none"] as const) {
      expect(
        decodeClientSettingsPatch({ environmentIdentificationMode: mode })
          .environmentIdentificationMode,
      ).toBe(mode);
    }
  });

  it("rejects unsupported presentation modes", () => {
    expect(() => decodeClientSettings({ environmentIdentificationMode: "badge" })).toThrow();
    expect(() => decodeClientSettingsPatch({ environmentIdentificationMode: "badge" })).toThrow();
  });
});

describe("ClientSettings sidebar thread preview count", () => {
  it("defaults to four visible chats per project when omitted", () => {
    expect(decodeClientSettings({}).sidebarThreadPreviewCount).toBe(4);
  });

  it("exposes four as the default client setting", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarThreadPreviewCount).toBe(4);
  });

  it("preserves an explicitly configured six-chat preview", () => {
    expect(decodeClientSettings({ sidebarThreadPreviewCount: 6 }).sidebarThreadPreviewCount).toBe(
      6,
    );
  });
});

describe("ClientSettings sidebar v2", () => {
  it("defaults the beta off with a three-day auto-settle threshold", () => {
    const settings = decodeClientSettings({});
    expect(settings.sidebarV2Enabled).toBe(false);
    expect(settings.sidebarAutoSettleAfterDays).toBe(3);
  });

  it("treats settings written before the beta had a per-channel default as unconfigured", () => {
    // The stored blob always carries `sidebarV2Enabled`, so only the companion
    // flag can distinguish "user opted out" from "never touched it".
    expect(decodeClientSettings({ sidebarV2Enabled: false }).sidebarV2ConfiguredByUser).toBe(false);
    expect(decodeClientSettings({ sidebarV2Enabled: true }).sidebarV2ConfiguredByUser).toBe(false);
  });

  it("preserves an explicit beta choice", () => {
    const settings = decodeClientSettings({
      sidebarV2Enabled: false,
      sidebarV2ConfiguredByUser: true,
    });
    expect(settings.sidebarV2Enabled).toBe(false);
    expect(settings.sidebarV2ConfiguredByUser).toBe(true);
  });

  it("carries an explicit beta opt-out through the patch the beta toggle writes", () => {
    const patch = decodeClientSettingsPatch({
      sidebarV2Enabled: false,
      sidebarV2ConfiguredByUser: true,
    });
    expect(patch.sidebarV2Enabled).toBe(false);
    expect(patch.sidebarV2ConfiguredByUser).toBe(true);
  });

  it("allows auto-settle by inactivity to be disabled", () => {
    expect(
      decodeClientSettings({ sidebarAutoSettleAfterDays: null }).sidebarAutoSettleAfterDays,
    ).toBeNull();
  });

  it.each([-1, 0, 91])("rejects an auto-settle threshold outside 1..90: %s", (value) => {
    expect(() => decodeClientSettings({ sidebarAutoSettleAfterDays: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ sidebarAutoSettleAfterDays: value })).toThrow();
  });
});

describe("ClientSettings prompt processing", () => {
  it("uses backward-compatible defaults", () => {
    const settings = decodeClientSettings({});

    expect(settings.voiceInputOutputLanguage).toBe("native");
    expect(settings.improvePromptBeforeSend).toBe(false);
  });

  it("accepts English voice output and prompt improvement", () => {
    const settings = decodeClientSettings({
      voiceInputOutputLanguage: "english",
      improvePromptBeforeSend: true,
    });

    expect(settings.voiceInputOutputLanguage).toBe("english");
    expect(settings.improvePromptBeforeSend).toBe(true);
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

describe("ServerSettings native provider boundary", () => {
  it("hydrates defaults for exactly the five native providers", () => {
    const decoded = decodeServerSettings({});

    expect(Object.keys(decoded.providers)).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "opencode",
    ]);
  });

  it("keeps native patch fields and ignores removed legacy provider keys", () => {
    const patch = decodeServerSettingsPatch({
      providers: {
        codex: { binaryPath: "  /usr/local/bin/codex  " },
        claudeAgent: { binaryPath: "  /usr/local/bin/claude  " },
        cursor: { binaryPath: "  /usr/local/bin/cursor-agent  " },
        grok: { binaryPath: "  /usr/local/bin/grok  " },
        opencode: { binaryPath: "  /usr/local/bin/opencode  " },
        gemini: { apiKey: "  gemini-key  " },
        openrouter: { apiKey: "  gateway-key  " },
        nvidiaNim: { apiKey: "  nvapi-key  " },
        localOpenAi: { v1BaseUrl: "  http://127.0.0.1:11434/v1  " },
        opencodeZen: { apiKey: "  zen-key  " },
        opencodeGo: { apiKey: "  go-key  " },
        kiroAmazonQ: { apiKey: "  editor-token  " },
        hyperagent: { sessionCookie: "  session-token  " },
        cursorSdk: { apiKey: "  cursor-key  ", manualModelIds: ["  composer-2  "] },
      },
    });

    expect(Object.keys(patch.providers ?? {})).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "opencode",
    ]);
    expect(patch.providers?.codex?.binaryPath).toBe("/usr/local/bin/codex");
  });
});

describe("AgentEnhancementSettings", () => {
  it("provides conservative backward-compatible defaults", () => {
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

  it("accepts bounded enhancement patches and rejects invalid deep-thinking values", () => {
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
  it("defaults start-from-origin on for legacy configs", () => {
    expect(decodeServerSettings({}).newWorktreesStartFromOrigin).toBe(true);
  });

  it("accepts start-from-origin updates", () => {
    expect(
      decodeServerSettingsPatch({ newWorktreesStartFromOrigin: false }).newWorktreesStartFromOrigin,
    ).toBe(false);
  });
});

describe("ServerSettings parallel plan review model", () => {
  it("hydrates legacy settings with the fast Codex reviewer default", () => {
    const settings = decodeServerSettings({});

    expect(settings.parallelPlanReviewModelSelection).toEqual({
      instanceId: "codex",
      model: "gpt-5.6-luna",
      options: [
        { id: "reasoningEffort", value: "low" },
        { id: "serviceTier", value: "priority" },
      ],
    });
    expect(DEFAULT_SERVER_SETTINGS.parallelPlanReviewModelSelection).toEqual(
      DEFAULT_PARALLEL_PLAN_REVIEW_MODEL_SELECTION,
    );
  });

  it("accepts partial reviewer selection patches", () => {
    const patch = decodeServerSettingsPatch({
      parallelPlanReviewModelSelection: {
        instanceId: "opencode_work",
        model: " openai/gpt-5 ",
        options: [{ id: "variant", value: "fast" }],
      },
    });

    expect(patch.parallelPlanReviewModelSelection).toEqual({
      instanceId: "opencode_work",
      model: "openai/gpt-5",
      options: [{ id: "variant", value: "fast" }],
    });
  });
});

describe("ServerSettings.sourceControlWritingStyle", () => {
  it("defaults all style settings for legacy configs", () => {
    const settings = decodeServerSettings({});

    expect(settings.sourceControlWritingStyle).toEqual({
      mode: "repo_conventions",
      customInstructions: "",
      followChangeRequestTemplates: true,
    });
    expect(settings.sourceControlWriterModelSelection).toBeNull();
  });

  it("trims partial style updates", () => {
    const patch = decodeServerSettingsPatch({
      sourceControlWritingStyle: {
        mode: "custom",
        customInstructions: "  Prefer concise wording.  ",
      },
    });

    expect(patch.sourceControlWritingStyle).toEqual({
      mode: "custom",
      customInstructions: "Prefer concise wording.",
    });
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
          launchArgs: "  --strict-config --enable foo  ",
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
    expect(patch.providers?.codex?.launchArgs).toBe("--strict-config --enable foo");
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
          launchArgs: "  --strict-config  ",
        },
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(encoded.providers?.codex?.launchArgs).toBe("--strict-config");
  });
});
