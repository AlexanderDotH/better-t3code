import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  ChatVisualMode,
  ChatVisualModeSyncRecord,
  ChatGptSettings,
  ClientSettingsSchema,
  ClientSettingsPatch,
  DEFAULT_AGENT_ENHANCEMENT_SETTINGS,
  DEFAULT_CHAT_VISUAL_MODE,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_INTERFACE_LANGUAGE_PREFERENCE,
  DEFAULT_PARALLEL_PLAN_REVIEW_MODEL_SELECTION,
  DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
  ClaudeSettings,
  DEFAULT_SERVER_SETTINGS,
  InterfaceLanguagePreference,
  InterfaceLanguageSyncRecord,
  InterfaceLocalePreferenceV1,
  InterfaceLocaleSyncRecordV1,
  DEFAULT_INTERFACE_LOCALE_PREFERENCE_V1,
  OpenAiSettings,
  OpenRouterSettings,
  ProjectThreadPreviewCount,
  ProjectThreadPreviewSyncRecord,
  defaultEnabledForDriver,
  resolveProviderInstanceEnabled,
  ServerSettings,
  ServerSettingsPatch,
  SidebarThreadPreviewCount,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const decodeProjectThreadPreviewCount = Schema.decodeUnknownSync(ProjectThreadPreviewCount);
const decodeSidebarThreadPreviewCount = Schema.decodeUnknownSync(SidebarThreadPreviewCount);
const decodeProjectThreadPreviewSyncRecord = Schema.decodeUnknownSync(
  ProjectThreadPreviewSyncRecord,
);
const decodeChatVisualMode = Schema.decodeUnknownSync(ChatVisualMode);
const decodeChatVisualModeSyncRecord = Schema.decodeUnknownSync(ChatVisualModeSyncRecord);
const decodeInterfaceLanguagePreference = Schema.decodeUnknownSync(InterfaceLanguagePreference);
const decodeInterfaceLanguageSyncRecord = Schema.decodeUnknownSync(InterfaceLanguageSyncRecord);
const decodeInterfaceLocalePreferenceV1 = Schema.decodeUnknownSync(InterfaceLocalePreferenceV1);
const decodeInterfaceLocaleSyncRecordV1 = Schema.decodeUnknownSync(InterfaceLocaleSyncRecordV1);
const decodeChatGptSettings = Schema.decodeUnknownSync(ChatGptSettings);
const decodeOpenRouterSettings = Schema.decodeUnknownSync(OpenRouterSettings);
const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const encodeProjectThreadPreviewSyncRecord = Schema.encodeSync(ProjectThreadPreviewSyncRecord);
const encodeChatVisualModeSyncRecord = Schema.encodeSync(ChatVisualModeSyncRecord);
const encodeInterfaceLanguageSyncRecord = Schema.encodeSync(InterfaceLanguageSyncRecord);
const decodeClaudeSettings = Schema.decodeUnknownSync(ClaudeSettings);

describe("ClaudeSettings auto-compaction", () => {
  it("uses Claude's default threshold when no override is configured", () => {
    expect(decodeClaudeSettings({}).autoCompactWindow).toBe("");
  });

  it.each(["100000", "300000", "1000000"])(
    "accepts a supported auto-compaction threshold: %s",
    (value) => {
      expect(decodeClaudeSettings({ autoCompactWindow: value }).autoCompactWindow).toBe(value);
    },
  );

  it.each(["99999", "1000001", "300k", "invalid"])(
    "rejects an unsupported auto-compaction threshold: %s",
    (value) => {
      expect(() => decodeClaudeSettings({ autoCompactWindow: value })).toThrow();
    },
  );

  it("rejects an unsupported threshold at the settings patch boundary", () => {
    expect(() =>
      decodeServerSettingsPatch({ providers: { claudeAgent: { autoCompactWindow: "300k" } } }),
    ).toThrow();
    expect(
      decodeServerSettingsPatch({ providers: { claudeAgent: { autoCompactWindow: "300000" } } }),
    ).toBeDefined();
  });
});

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

describe("ClientSettings model reasoning display", () => {
  it("defaults the reasoning display off when existing preferences omit it", () => {
    expect(decodeClientSettings({}).showReasoning).toBe(false);
    expect(DEFAULT_CLIENT_SETTINGS.showReasoning).toBe(false);
  });

  it("accepts explicit enable and disable patches", () => {
    expect(decodeClientSettingsPatch({ showReasoning: true }).showReasoning).toBe(true);
    expect(decodeClientSettingsPatch({ showReasoning: false }).showReasoning).toBe(false);
  });
});

describe("ClientSettings expanded composer controls", () => {
  it("defaults expanded composer controls off when legacy settings omit it", () => {
    expect(decodeClientSettings({}).showExpandedComposerControls).toBe(false);
    expect(DEFAULT_CLIENT_SETTINGS.showExpandedComposerControls).toBe(false);
  });

  it("accepts explicit enable and disable patches", () => {
    expect(
      decodeClientSettingsPatch({ showExpandedComposerControls: true })
        .showExpandedComposerControls,
    ).toBe(true);
    expect(
      decodeClientSettingsPatch({ showExpandedComposerControls: false })
        .showExpandedComposerControls,
    ).toBe(false);
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

describe("ClientSettings experimental Fetch", () => {
  it("defaults the experiment off when legacy settings omit it", () => {
    const decoded = decodeClientSettings({});

    expect(decoded.experimentalFetch).toBe(false);
    expect(DEFAULT_CLIENT_SETTINGS.experimentalFetch).toBe(false);
  });

  it("accepts explicit enable and disable patches", () => {
    expect(decodeClientSettingsPatch({ experimentalFetch: true }).experimentalFetch).toBe(true);
    expect(decodeClientSettingsPatch({ experimentalFetch: false }).experimentalFetch).toBe(false);
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

describe("ClientSettings appearance contrast", () => {
  it("defaults macOS transparency off and validates its persisted and patch values", () => {
    expect(decodeClientSettings({}).macosWindowTransparency).toBe(false);
    expect(decodeClientSettings({ macosWindowTransparency: true }).macosWindowTransparency).toBe(
      true,
    );
    expect(
      decodeClientSettingsPatch({ macosWindowTransparency: false }).macosWindowTransparency,
    ).toBe(false);
    expect(() => decodeClientSettings({ macosWindowTransparency: "true" })).toThrow();
    expect(() => decodeClientSettingsPatch({ macosWindowTransparency: 1 })).toThrow();
  });
  it("defaults to the theme's original contrast", () => {
    expect(decodeClientSettings({}).appearanceContrast).toBe(100);
  });

  it.each([49, 201, 92.5])("rejects an invalid appearance contrast: %s", (value) => {
    expect(() => decodeClientSettings({ appearanceContrast: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ appearanceContrast: value })).toThrow();
  });

  it.each([50, 100, 150, 200])("accepts an appearance contrast in range: %s", (value) => {
    expect(decodeClientSettings({ appearanceContrast: value }).appearanceContrast).toBe(value);
    expect(decodeClientSettingsPatch({ appearanceContrast: value }).appearanceContrast).toBe(value);
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
  it("defaults to three visible chats per project when omitted", () => {
    expect(decodeClientSettings({}).sidebarThreadPreviewCount).toBe(3);
  });

  it("exposes three through both the project and legacy sidebar defaults", () => {
    expect(DEFAULT_PROJECT_THREAD_PREVIEW_COUNT).toBe(3);
    expect(DEFAULT_CLIENT_SETTINGS.sidebarThreadPreviewCount).toBe(3);
  });

  it("preserves an explicitly configured six-chat preview", () => {
    expect(decodeClientSettings({ sidebarThreadPreviewCount: 6 }).sidebarThreadPreviewCount).toBe(
      6,
    );
  });

  it("tracks completion of the one-time legacy preview migration", () => {
    expect(decodeClientSettings({}).projectThreadPreviewMigrationVersion).toBeUndefined();
    expect(
      decodeClientSettings({ projectThreadPreviewMigrationVersion: 1 })
        .projectThreadPreviewMigrationVersion,
    ).toBe(1);
    expect(
      decodeClientSettingsPatch({ projectThreadPreviewMigrationVersion: 1 })
        .projectThreadPreviewMigrationVersion,
    ).toBe(1);
    expect(() => decodeClientSettingsPatch({ projectThreadPreviewMigrationVersion: 2 })).toThrow();
  });

  it.each([1, 6, 15])("accepts a project preview count within 1..15: %s", (value) => {
    expect(decodeProjectThreadPreviewCount(value)).toBe(value);
    expect(decodeSidebarThreadPreviewCount(value)).toBe(value);
  });

  it.each([0, 16, 2.5])("rejects an invalid project preview count: %s", (value) => {
    expect(() => decodeProjectThreadPreviewCount(value)).toThrow();
    expect(() => decodeClientSettingsPatch({ sidebarThreadPreviewCount: value })).toThrow();
  });
});

describe("ProjectThreadPreviewSyncRecord", () => {
  const record = {
    count: 6,
    updatedAt: 1_787_178_400_000,
    updateId: "device-a:preview-6",
  } as const;

  it("round-trips a synchronized explicit six-chat preview", () => {
    const decoded = decodeProjectThreadPreviewSyncRecord(record);
    const encoded = encodeProjectThreadPreviewSyncRecord(decoded);

    expect(encoded).toEqual(record);
    expect(decodeProjectThreadPreviewSyncRecord(encoded)).toEqual(record);
  });

  it("is optional in legacy server settings and accepted by settings patches", () => {
    expect(decodeServerSettings({}).projectThreadPreviewSyncRecord).toBeUndefined();
    expect(decodeServerSettingsPatch({})).not.toHaveProperty("projectThreadPreviewSyncRecord");

    const decodedSettings = decodeServerSettings({ projectThreadPreviewSyncRecord: record });
    expect(encodeServerSettings(decodedSettings).projectThreadPreviewSyncRecord).toEqual(record);
    expect(
      decodeServerSettingsPatch({ projectThreadPreviewSyncRecord: record })
        .projectThreadPreviewSyncRecord,
    ).toEqual(record);
  });

  it.each([
    { ...record, count: 0 },
    { ...record, count: 16 },
    { ...record, updatedAt: -1 },
    { ...record, updatedAt: 1.5 },
    { ...record, updateId: "   " },
  ])("rejects an invalid synchronized record: $record", (invalidRecord) => {
    expect(() => decodeProjectThreadPreviewSyncRecord(invalidRecord)).toThrow();
    expect(() =>
      decodeServerSettingsPatch({ projectThreadPreviewSyncRecord: invalidRecord }),
    ).toThrow();
  });
});

describe("ChatVisualModeSyncRecord", () => {
  const record = {
    mode: "classic",
    updatedAt: 1_787_178_400_000,
    updateId: "device-a:classic",
  } as const;

  it("defaults to Current and accepts both supported chat visual modes", () => {
    expect(DEFAULT_CHAT_VISUAL_MODE).toBe("current");
    expect(decodeChatVisualMode("current")).toBe("current");
    expect(decodeChatVisualMode("classic")).toBe("classic");
    expect(() => decodeChatVisualMode("legacy")).toThrow();
  });

  it("round-trips a synchronized Classic selection", () => {
    const decoded = decodeChatVisualModeSyncRecord(record);
    const encoded = encodeChatVisualModeSyncRecord(decoded);

    expect(encoded).toEqual(record);
    expect(decodeChatVisualModeSyncRecord(encoded)).toEqual(record);
  });

  it("is optional in legacy server settings and accepted by settings patches", () => {
    expect(decodeServerSettings({}).chatVisualModeSyncRecord).toBeUndefined();
    expect(decodeServerSettingsPatch({})).not.toHaveProperty("chatVisualModeSyncRecord");

    const decodedSettings = decodeServerSettings({ chatVisualModeSyncRecord: record });
    expect(encodeServerSettings(decodedSettings).chatVisualModeSyncRecord).toEqual(record);
    expect(
      decodeServerSettingsPatch({ chatVisualModeSyncRecord: record }).chatVisualModeSyncRecord,
    ).toEqual(record);
  });

  it.each([
    { ...record, mode: "legacy" },
    { ...record, updatedAt: -1 },
    { ...record, updatedAt: 1.5 },
    { ...record, updateId: "   " },
  ])("rejects an invalid synchronized chat visual record: $record", (invalidRecord) => {
    expect(() => decodeChatVisualModeSyncRecord(invalidRecord)).toThrow();
    expect(() => decodeServerSettingsPatch({ chatVisualModeSyncRecord: invalidRecord })).toThrow();
  });
});

describe("InterfaceLanguageSyncRecord", () => {
  const record = {
    preference: "de",
    updatedAt: 1_787_178_400_000,
    updateId: "device-a:de",
  } as const;

  it("defaults to the system language and accepts the supported preferences", () => {
    expect(DEFAULT_INTERFACE_LANGUAGE_PREFERENCE).toBe("system");
    expect(decodeInterfaceLanguagePreference("system")).toBe("system");
    expect(decodeInterfaceLanguagePreference("en")).toBe("en");
    expect(decodeInterfaceLanguagePreference("de")).toBe("de");
    expect(() => decodeInterfaceLanguagePreference("fr")).toThrow();
  });

  it("round-trips a synchronized German selection", () => {
    const decoded = decodeInterfaceLanguageSyncRecord(record);
    const encoded = encodeInterfaceLanguageSyncRecord(decoded);

    expect(encoded).toEqual(record);
    expect(decodeInterfaceLanguageSyncRecord(encoded)).toEqual(record);
  });

  it("keeps the local cache nullable and the server record optional", () => {
    expect(decodeClientSettings({}).interfaceLanguageLocalRecord).toBeNull();
    expect(DEFAULT_CLIENT_SETTINGS.interfaceLanguageLocalRecord).toBeNull();
    expect(
      decodeClientSettingsPatch({ interfaceLanguageLocalRecord: record })
        .interfaceLanguageLocalRecord,
    ).toEqual(record);
    expect(decodeServerSettings({}).interfaceLanguageSyncRecord).toBeUndefined();
    expect(
      decodeServerSettingsPatch({ interfaceLanguageSyncRecord: record })
        .interfaceLanguageSyncRecord,
    ).toEqual(record);
  });

  it.each([
    { ...record, preference: "fr" },
    { ...record, updatedAt: -1 },
    { ...record, updatedAt: 1.5 },
    { ...record, updateId: "   " },
  ])("rejects an invalid synchronized language record: $record", (invalidRecord) => {
    expect(() => decodeInterfaceLanguageSyncRecord(invalidRecord)).toThrow();
    expect(() =>
      decodeServerSettingsPatch({ interfaceLanguageSyncRecord: invalidRecord }),
    ).toThrow();
  });
});

describe("InterfaceLocaleSyncRecordV1", () => {
  it("defaults new and migrated locale selectors to the system language", () => {
    expect(DEFAULT_INTERFACE_LOCALE_PREFERENCE_V1).toBe("system");
  });

  const french = {
    version: 1,
    preference: "fr",
    updatedAt: 1_787_178_500_000,
    updateId: "device-a:fr",
  } as const;

  it("adds French only to the new versioned record", () => {
    expect(() => decodeInterfaceLanguagePreference("fr")).toThrow();
    expect(decodeInterfaceLocalePreferenceV1("fr")).toBe("fr");
    expect(decodeInterfaceLocaleSyncRecordV1(french)).toEqual(french);
  });

  it("keeps the V1 local mirror nullable and the server record optional", () => {
    expect(decodeClientSettings({}).interfaceLocaleLocalRecordV1).toBeNull();
    expect(decodeServerSettings({}).interfaceLocaleSyncRecordV1).toBeUndefined();
    expect(
      decodeClientSettingsPatch({ interfaceLocaleLocalRecordV1: french })
        .interfaceLocaleLocalRecordV1,
    ).toEqual(french);
    expect(
      decodeServerSettingsPatch({ interfaceLocaleSyncRecordV1: french })
        .interfaceLocaleSyncRecordV1,
    ).toEqual(french);
  });
});

describe("OpenAiSettings", () => {
  const decodeOpenAiSettings = Schema.decodeUnknownSync(OpenAiSettings);

  it("is a distinct opt-in provider with no custom endpoint fields", () => {
    expect(decodeOpenAiSettings({})).toEqual({ enabled: false });
    expect(decodeOpenAiSettings({ enabled: true, baseUrl: "https://example.com" })).toEqual({
      enabled: true,
    });
    expect(decodeServerSettings({}).providers.openai).toEqual({ enabled: false });
    expect(decodeServerSettingsPatch({ providers: { openai: { enabled: true } } })).toEqual({
      providers: { openai: { enabled: true } },
    });
  });
});

describe("ClientSettings sidebar", () => {
  it("defaults to the current sidebar with automatic merge and inactivity settling", () => {
    const settings = decodeClientSettings({});
    expect(settings.legacySidebarEnabled).toBe(false);
    expect(settings.sidebarAutoSettleAfterDays).toBe(3);
    expect(settings.sidebarAutoSettleOnMerge).toBe(true);
    expect(settings.sidebarPosition).toBe("left");
    expect(decodeClientSettingsPatch({ sidebarPosition: "right" }).sidebarPosition).toBe("right");
  });

  it("drops the retired sidebar v2 beta keys, resetting everyone to the default", () => {
    const decoded = decodeClientSettings({
      sidebarV2Enabled: false,
      sidebarV2ConfiguredByUser: true,
    });
    expect(decoded.legacySidebarEnabled).toBe(false);
    expect(decoded).not.toHaveProperty("sidebarV2Enabled");
    expect(decoded).not.toHaveProperty("sidebarV2ConfiguredByUser");
  });

  it("preserves an explicit legacy sidebar opt-in", () => {
    expect(decodeClientSettings({ legacySidebarEnabled: true }).legacySidebarEnabled).toBe(true);
    expect(decodeClientSettingsPatch({ legacySidebarEnabled: true }).legacySidebarEnabled).toBe(
      true,
    );
    expect(decodeClientSettingsPatch({ legacySidebarEnabled: false }).legacySidebarEnabled).toBe(
      false,
    );
  });

  it("round-trips the classic sidebar preference under the existing settings key", () => {
    const encoded = encodeClientSettings({
      ...DEFAULT_CLIENT_SETTINGS,
      legacySidebarEnabled: true,
    });

    expect(encoded.legacySidebarEnabled).toBe(true);
    expect(decodeClientSettings(encoded).legacySidebarEnabled).toBe(true);
  });

  it("keeps unpin confirmation opt-in and patchable", () => {
    expect(decodeClientSettings({}).confirmThreadUnpin).toBe(false);
    expect(decodeClientSettingsPatch({ confirmThreadUnpin: true }).confirmThreadUnpin).toBe(true);
    expect(() => decodeClientSettingsPatch({ confirmThreadUnpin: "yes" })).toThrow();
  });

  it("allows auto-settle by inactivity to be disabled", () => {
    expect(
      decodeClientSettings({ sidebarAutoSettleAfterDays: null }).sidebarAutoSettleAfterDays,
    ).toBeNull();
  });

  it("allows auto-settle on merge to be disabled", () => {
    expect(decodeClientSettings({ sidebarAutoSettleOnMerge: false }).sidebarAutoSettleOnMerge).toBe(
      false,
    );
    expect(
      decodeClientSettingsPatch({ sidebarAutoSettleOnMerge: false }).sidebarAutoSettleOnMerge,
    ).toBe(false);
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
  it("defaults text generation to Luna at low reasoning effort", () => {
    expect(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-luna",
      options: [{ id: "reasoningEffort", value: "low" }],
    });
  });

  it("defaults Auto Reasoning to the shared text-generation model", () => {
    expect(DEFAULT_SERVER_SETTINGS.autoReasoningModelSelection).toBeNull();
    expect(decodeServerSettings({}).autoReasoningModelSelection).toBeNull();
  });

  it("round-trips an explicit Auto Reasoning evaluation model", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("openai_work"),
      model: "gpt-5.6-luna",
      options: [{ id: "reasoningEffort", value: "low" }],
    } as const;

    expect(
      decodeServerSettingsPatch({ autoReasoningModelSelection: selection })
        .autoReasoningModelSelection,
    ).toEqual(selection);
    expect(
      decodeServerSettingsPatch({ autoReasoningModelSelection: null }).autoReasoningModelSelection,
    ).toBeNull();
  });

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
  it("hydrates defaults for exactly the nine native providers", () => {
    const decoded = decodeServerSettings({});

    expect(Object.keys(decoded.providers)).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "opencode",
      "gemini",
      "chatgpt",
      "openrouter",
      "openai",
    ]);
    expect(decoded.providers.chatgpt).toEqual({ enabled: false, binaryPath: "codex" });
    expect(decoded.providers.openrouter).toEqual(decodeOpenRouterSettings({}));
  });

  it("keeps native patch fields and ignores removed legacy provider keys", () => {
    const patch = decodeServerSettingsPatch({
      providers: {
        codex: { binaryPath: "  /usr/local/bin/codex  " },
        claudeAgent: { binaryPath: "  /usr/local/bin/claude  " },
        cursor: { binaryPath: "  /usr/local/bin/cursor-agent  " },
        grok: { binaryPath: "  /usr/local/bin/grok  " },
        opencode: { binaryPath: "  /usr/local/bin/opencode  " },
        gemini: { enabled: true, customModels: ["gemini-custom"] },
        chatgpt: { enabled: true, binaryPath: "  /usr/local/bin/codex  " },
        openrouter: {
          protocol: "responses",
          defaultModel: "  openai/gpt-5.5  ",
          contextCompression: true,
        },
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
      "gemini",
      "chatgpt",
      "openrouter",
    ]);
    expect(patch.providers?.codex?.binaryPath).toBe("/usr/local/bin/codex");
    expect(patch.providers?.gemini).toEqual({
      enabled: true,
      customModels: ["gemini-custom"],
    });
    expect(patch.providers?.chatgpt).toEqual({
      enabled: true,
      binaryPath: "/usr/local/bin/codex",
    });
    expect(patch.providers?.openrouter).toEqual({
      protocol: "responses",
      defaultModel: "openai/gpt-5.5",
      contextCompression: true,
    });
  });
});

describe("ChatGptSettings", () => {
  it("defaults to a disabled subscription provider using the Codex auth broker binary", () => {
    expect(decodeChatGptSettings({})).toEqual({ enabled: false, binaryPath: "codex" });
  });

  it("normalizes an explicit auth broker binary without accepting credential settings", () => {
    expect(
      decodeChatGptSettings({
        enabled: true,
        binaryPath: "  /opt/openai/bin/codex  ",
        accessToken: "must-not-be-configurable",
      }),
    ).toEqual({ enabled: true, binaryPath: "/opt/openai/bin/codex" });
  });
});

describe("OpenRouterSettings", () => {
  it("defaults to a disabled, explicit-model Chat Completions provider", () => {
    expect(decodeOpenRouterSettings({})).toEqual({
      enabled: false,
      protocol: "chat-completions",
      defaultModel: "",
      customModels: [],
      contextCompression: false,
      routingMode: "openrouter-default",
      providerOrder: [],
      routingSort: "price",
      allowFallbacks: "inherit",
      dataCollection: "inherit",
      requireZdr: false,
    });
  });

  it("normalizes advanced routing values and rejects negative or non-finite numbers", () => {
    expect(
      decodeOpenRouterSettings({
        enabled: true,
        protocol: "responses",
        defaultModel: "  anthropic/claude-sonnet-4  ",
        customModels: ["  @preset/t3  "],
        contextCompression: true,
        routingMode: "provider-order",
        providerOrder: ["  anthropic  ", "google-vertex"],
        routingSort: "latency",
        allowFallbacks: "disabled",
        dataCollection: "deny",
        requireZdr: true,
        preferredMinThroughput: 12.5,
        preferredMaxLatency: 4,
        maxPromptPriceUsdPerMillion: 3,
        maxCompletionPriceUsdPerMillion: 15,
        maxRequestPriceUsd: 0.1,
      }),
    ).toEqual({
      enabled: true,
      protocol: "responses",
      defaultModel: "anthropic/claude-sonnet-4",
      customModels: ["@preset/t3"],
      contextCompression: true,
      routingMode: "provider-order",
      providerOrder: ["anthropic", "google-vertex"],
      routingSort: "latency",
      allowFallbacks: "disabled",
      dataCollection: "deny",
      requireZdr: true,
      preferredMinThroughput: 12.5,
      preferredMaxLatency: 4,
      maxPromptPriceUsdPerMillion: 3,
      maxCompletionPriceUsdPerMillion: 15,
      maxRequestPriceUsd: 0.1,
    });

    expect(() => decodeOpenRouterSettings({ preferredMinThroughput: -1 })).toThrow();
    expect(() =>
      decodeOpenRouterSettings({ preferredMaxLatency: Number.POSITIVE_INFINITY }),
    ).toThrow();
  });

  it("publishes renderer-neutral field annotations for advanced controls", () => {
    const defaultModelAnnotations = Schema.resolveAnnotationsKey(
      OpenRouterSettings.fields.defaultModel,
    )?.providerSettingsForm;
    const routingSortAnnotations = Schema.resolveAnnotationsKey(
      OpenRouterSettings.fields.routingSort,
    )?.providerSettingsForm;
    const maxRequestPriceAnnotations = Schema.resolveAnnotationsKey(
      OpenRouterSettings.fields.maxRequestPriceUsd,
    )?.providerSettingsForm;

    expect(defaultModelAnnotations).toMatchObject({
      control: "select",
      options: { source: "models" },
    });
    expect(routingSortAnnotations).toMatchObject({
      control: "select",
      visibleWhen: { field: "routingMode", equals: "sort" },
    });
    expect(maxRequestPriceAnnotations).toMatchObject({ control: "number", min: 0 });
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

describe("provider enabled defaults", () => {
  it("keeps optional providers off on clean installs", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providers.codex.enabled).toBe(true);
    expect(decoded.providers.claudeAgent.enabled).toBe(true);
    expect(decoded.providers.cursor.enabled).toBe(false);
    expect(decoded.providers.grok.enabled).toBe(false);
    expect(decoded.providers.opencode.enabled).toBe(false);
    expect(decoded.providers.gemini.enabled).toBe(false);
    expect(decoded.providers.openrouter.enabled).toBe(false);
  });

  it("derives per-driver defaults from the settings schemas", () => {
    expect(defaultEnabledForDriver(ProviderDriverKind.make("codex"))).toBe(true);
    expect(defaultEnabledForDriver(ProviderDriverKind.make("cursor"))).toBe(false);
    expect(defaultEnabledForDriver(ProviderDriverKind.make("grok"))).toBe(false);
    expect(defaultEnabledForDriver(ProviderDriverKind.make("opencode"))).toBe(false);
    expect(defaultEnabledForDriver(ProviderDriverKind.make("gemini"))).toBe(false);
    expect(defaultEnabledForDriver(ProviderDriverKind.make("openrouter"))).toBe(false);
    // Unknown fork drivers stay enabled; their own build decides otherwise.
    expect(defaultEnabledForDriver(ProviderDriverKind.make("ollama"))).toBe(true);
  });

  it("keeps Cursor enabled when an existing user explicitly opted in", () => {
    const cursor = ProviderDriverKind.make("cursor");
    const cursorId = ProviderInstanceId.make("cursor");
    const decoded = decodeServerSettings({
      providers: { cursor: { enabled: true } },
      providerInstances: {
        [cursorId]: { driver: cursor, enabled: true, config: {} },
      },
    });

    expect(decoded.providers.cursor.enabled).toBe(true);
    expect(resolveProviderInstanceEnabled(decoded.providerInstances[cursorId]!)).toBe(true);
  });

  it("resolves instance enabled state with explicit false winning", () => {
    const grok = ProviderDriverKind.make("grok");
    const codex = ProviderDriverKind.make("codex");
    // No flags anywhere: each driver's clean-install default applies.
    expect(resolveProviderInstanceEnabled({ driver: grok, config: {} })).toBe(false);
    expect(resolveProviderInstanceEnabled({ driver: codex, config: {} })).toBe(true);
    // Envelope flags can explicitly enable or disable a driver.
    expect(resolveProviderInstanceEnabled({ driver: grok, enabled: true, config: {} })).toBe(true);
    expect(resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: {} })).toBe(
      false,
    );
    // Legacy in-config flag fills in when the envelope is silent.
    expect(resolveProviderInstanceEnabled({ driver: grok, config: { enabled: false } })).toBe(
      false,
    );
    // Conflicting flags: the explicit false wins, whichever side it is on.
    expect(
      resolveProviderInstanceEnabled({ driver: grok, enabled: false, config: { enabled: true } }),
    ).toBe(false);
    expect(
      resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: { enabled: true } }),
    ).toBe(false);
  });
});

describe("ServerSettings agent browser access", () => {
  it("defaults preview automation access on for legacy settings", () => {
    expect(decodeServerSettings({}).enableAgentBrowserAccess).toBe(true);
  });

  it("preserves an explicit false in full settings and mixed-version patches", () => {
    expect(decodeServerSettings({ enableAgentBrowserAccess: false }).enableAgentBrowserAccess).toBe(
      false,
    );
    expect(
      decodeServerSettingsPatch({ enableAgentBrowserAccess: false }).enableAgentBrowserAccess,
    ).toBe(false);
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

describe("ServerSettings streaming compatibility", () => {
  it("decodes the former response key for older-client compatibility", () => {
    expect(decodeServerSettings({ enableAssistantStreaming: true }).enableAssistantStreaming).toBe(
      true,
    );
  });

  it("accepts the former streaming key from mixed-version clients", () => {
    expect(decodeServerSettingsPatch({ enableAssistantStreaming: true })).toEqual({
      enableAssistantStreaming: true,
    });
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

describe("ServerSettings Fetch model", () => {
  it("hydrates legacy settings as Auto", () => {
    const settings = decodeServerSettings({});

    expect(settings.fetchModelSelection).toBeNull();
    expect(DEFAULT_SERVER_SETTINGS.fetchModelSelection).toBeNull();
  });

  it("round-trips an exact cross-provider Fetch selection", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("claude_work"),
      model: "claude-opus-4-6",
      options: [
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
      ],
    } as const;
    const settings = decodeServerSettings(
      encodeServerSettings({
        ...decodeServerSettings({}),
        fetchModelSelection: selection,
      }),
    );

    expect(settings.fetchModelSelection).toEqual(selection);
  });

  it("patches Fetch selection atomically and accepts resetting to Auto", () => {
    const explicit = decodeServerSettingsPatch({
      fetchModelSelection: {
        instanceId: "opencode_work",
        model: " openai/gpt-5 ",
        options: [{ id: "variant", value: "fast" }],
      },
    });
    const automatic = decodeServerSettingsPatch({ fetchModelSelection: null });

    expect(explicit.fetchModelSelection).toEqual({
      instanceId: "opencode_work",
      model: "openai/gpt-5",
      options: [{ id: "variant", value: "fast" }],
    });
    expect(automatic.fetchModelSelection).toBeNull();
    expect(() =>
      decodeServerSettingsPatch({
        fetchModelSelection: { instanceId: "codex" },
      }),
    ).toThrow();
  });
});

describe("ServerSettings voice translation model", () => {
  it("inherits the global text generation model for legacy settings", () => {
    const settings = decodeServerSettings({});

    expect(settings.voiceTranslationModelSelection).toBeNull();
    expect(DEFAULT_SERVER_SETTINGS.voiceTranslationModelSelection).toBeNull();
  });

  it("accepts a dedicated provider model or null", () => {
    const selectionPatch = decodeServerSettingsPatch({
      voiceTranslationModelSelection: {
        instanceId: "codex_personal",
        model: "  gpt-5.6-luna  ",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    });
    const inheritedPatch = decodeServerSettingsPatch({ voiceTranslationModelSelection: null });

    expect(selectionPatch.voiceTranslationModelSelection).toEqual({
      instanceId: "codex_personal",
      model: "gpt-5.6-luna",
      options: [{ id: "reasoningEffort", value: "low" }],
    });
    expect(inheritedPatch.voiceTranslationModelSelection).toBeNull();
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
