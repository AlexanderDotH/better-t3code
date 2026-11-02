import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  SecretProviderId,
  SecretProviderKind,
  ServerSettings,
  ServerSettingsPatch,
  UsageLimitSourceId,
  ServerProvider,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { resolveServerBackgroundActivitySettings } from "./backgroundActivitySettings.ts";
import { createModelSelection } from "./model.ts";
import { resolveProjectScripts } from "./projectScripts.ts";
import {
  applyServerSettingsPatch,
  fallbackTextGenerationModelSelection,
  modelPreferencesMigrationPatch,
  resolveModelPreferences,
  isModelSelectionProviderEnabled,
  parsePersistedServerObservabilitySettings,
  resolveSourceControlWriterModelSelection,
} from "./serverSettings.ts";
import {
  DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
  McpServerId,
  resolveBetterT3FeatureFlag,
  resolveChatVisualModeRecord,
} from "@t3tools/contracts";
import {
  resolveVoiceTranslationModelSelection,
  resolveProjectAgentBrowserAccess,
  resolveProjectAutoPull,
} from "./serverSettings.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

const FOLDED_SERVER_SETTINGS = { ...DEFAULT_SERVER_SETTINGS, projectSettingsFolded: true };

describe("fallbackTextGenerationModelSelection", () => {
  it("uses Big Pickle when only OpenCode is enabled", () => {
    expect(
      fallbackTextGenerationModelSelection({}, (instanceId) => instanceId === "opencode"),
    ).toEqual({ instanceId: "opencode", model: "opencode/big-pickle" });
  });

  it("replaces and clears the fallback without carrying model options", () => {
    const fallbackModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "new" };
    const settings = applyServerSettingsPatch(
      {
        ...DEFAULT_SERVER_SETTINGS,
        fallbackModelSelection: {
          ...fallbackModelSelection,
          model: "old",
          options: [{ id: "effort", value: "high" }],
        },
      },
      { fallbackModelSelection },
    );
    expect(settings.fallbackModelSelection).toEqual(fallbackModelSelection);
    expect(
      applyServerSettingsPatch(settings, { fallbackModelSelection: null }).fallbackModelSelection,
    ).toBeNull();
  });
  it("ignores a configured non-default instance at machine scope, matching no fallback", () => {
    const configured = ProviderInstanceId.make("codex_work");
    const providerInstances = {
      [configured]: { driver: ProviderDriverKind.make("codex"), config: {} },
    };
    const fallback = fallbackTextGenerationModelSelection(
      providerInstances,
      (instanceId) => instanceId === configured,
    );
    expect(fallback).toBeNull();
  });

  it("considers a configured non-default instance only when asked to", () => {
    const configured = ProviderInstanceId.make("codex_work");
    const providerInstances = {
      [configured]: { driver: ProviderDriverKind.make("codex"), config: {} },
    };
    const fallback = fallbackTextGenerationModelSelection(
      providerInstances,
      (instanceId) => instanceId === configured,
      { includeConfiguredInstances: true },
    );
    expect(fallback?.instanceId).toBe(configured);
  });
});

describe("serverSettings helpers", () => {
  it("translates a shipped client's idle compaction switch into a mode", () => {
    const off = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { idleCompaction: "off" });
    expect([off.idleCompaction, off.compactIdleThreads]).toEqual(["off", false]);
    // Turning the old switch off keeps "Never" instead of reverting to the default.
    const stillOff = applyServerSettingsPatch(off, { compactIdleThreads: false });
    expect(stillOff.idleCompaction).toBe("off");
    const on = applyServerSettingsPatch(off, { compactIdleThreads: true });
    expect([on.idleCompaction, on.compactIdleThreads]).toEqual(["beforeCacheExpires", true]);
  });

  it("changes a cleanup rule without replacing the machine's other rules", () => {
    const enabled = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      storageCleanup: { worktreeAfterDays: 8, worktreeOnMerge: true, logsAfterDays: 30 },
    });
    expect(
      applyServerSettingsPatch(enabled, {
        storageCleanup: { worktreeAfterDays: null },
      }).storageCleanup,
    ).toEqual({
      worktreeAfterDays: null,
      worktreeSettledAfterDays: null,
      worktreeOnMerge: true,
      worktreeOnDelete: false,
      worktreeUnchanged: false,
      worktreeKeepWhen: "uncommitted-changes",
      browserArtifactsAfterDays: null,
      logsAfterDays: 30,
    });
  });
  it("replaces a source control host's patched field so a cleared account pin does not survive", () => {
    const pinned = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      sourceControlHosts: {
        github: { hosts: { "github.com": { account: "work", enabled: true } }, tokens: {} },
      },
    });
    const unpinned = applyServerSettingsPatch(pinned, {
      sourceControlHosts: { github: { hosts: { "github.com": { enabled: false } } } },
    });
    expect(unpinned.sourceControlHosts.github).toEqual({
      hosts: { "github.com": { enabled: false } },
      tokens: {},
    });
  });

  it("inherits actions, preserves existing actions, and supports empty overrides and reset", () => {
    const project = { id: ProjectId.make("project-actions"), scripts: [] };
    const action = {
      id: "check",
      name: "Check",
      command: "npm test",
      icon: "play" as const,
      runOnWorktreeCreate: false,
    };
    const existing = { ...project, scripts: [{ ...action, command: "npm run lint" }] };
    const unfolded = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      defaultProjectScripts: [action],
    });
    expect(resolveProjectScripts(unfolded, existing)).toEqual(existing.scripts);
    const defaults = applyServerSettingsPatch(FOLDED_SERVER_SETTINGS, {
      defaultProjectScripts: [action],
    });
    expect(resolveProjectScripts(defaults, project)).toEqual([action]);
    expect(resolveProjectScripts(defaults, existing)).toEqual([action]);
    const disabled = applyServerSettingsPatch(defaults, {
      projectScriptOverrides: { [project.id]: [] },
    });
    expect(resolveProjectScripts(disabled, project)).toEqual([]);
    const changedDefault = applyServerSettingsPatch(disabled, {
      defaultProjectScripts: [{ ...action, command: "npm run build" }],
    });
    expect(resolveProjectScripts(changedDefault, project)).toEqual([]);
    const reset = applyServerSettingsPatch(changedDefault, {
      projectScriptOverrides: { [project.id]: null },
    });
    expect(resolveProjectScripts(reset, existing)).toEqual(changedDefault.defaultProjectScripts);
    expect(
      resolveProjectScripts(
        applyServerSettingsPatch(reset, { defaultProjectScripts: [] }),
        existing,
      ),
    ).toEqual([]);
  });

  it("preserves other projects' actions when overriding, clearing, or resetting one project", () => {
    const firstProject = { id: ProjectId.make("first-project"), scripts: [] };
    const secondProject = { id: ProjectId.make("second-project"), scripts: [] };
    const defaultAction = {
      id: "check",
      name: "Check",
      command: "npm test",
      icon: "play" as const,
      runOnWorktreeCreate: false,
    };
    const firstAction = { ...defaultAction, command: "npm run lint" };
    const secondAction = { ...defaultAction, command: "npm run build" };
    const firstUpdate = applyServerSettingsPatch(FOLDED_SERVER_SETTINGS, {
      defaultProjectScripts: [defaultAction],
      projectScriptOverrides: { [firstProject.id]: [firstAction] },
    });
    const secondUpdate = applyServerSettingsPatch(firstUpdate, {
      projectScriptOverrides: { [secondProject.id]: [secondAction] },
    });
    expect(resolveProjectScripts(secondUpdate, firstProject)).toEqual([firstAction]);
    expect(resolveProjectScripts(secondUpdate, secondProject)).toEqual([secondAction]);

    const cleared = applyServerSettingsPatch(secondUpdate, {
      projectScriptOverrides: { [firstProject.id]: [] },
    });
    expect(resolveProjectScripts(cleared, firstProject)).toEqual([]);
    expect(resolveProjectScripts(cleared, secondProject)).toEqual([secondAction]);

    const reset = applyServerSettingsPatch(cleared, {
      projectScriptOverrides: { [firstProject.id]: null },
    });
    expect(resolveProjectScripts(reset, { ...firstProject, scripts: [firstAction] })).toEqual([
      defaultAction,
    ]);
    expect(resolveProjectScripts(reset, secondProject)).toEqual([secondAction]);
    expect(resolveProjectScripts(secondUpdate, firstProject)).toEqual([firstAction]);
  });

  it("preserves other projects' boolean overrides across separate updates and resets", () => {
    const firstProjectId = ProjectId.make("first-project");
    const secondProjectId = ProjectId.make("second-project");
    const firstUpdate = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      defaultAutoPull: true,
      projectAutoPullOverrides: { [firstProjectId]: false },
      projectAgentBrowserAccessOverrides: { [firstProjectId]: false },
    });
    const secondUpdate = applyServerSettingsPatch(firstUpdate, {
      projectAutoPullOverrides: { [secondProjectId]: false },
      projectAgentBrowserAccessOverrides: { [secondProjectId]: false },
    });
    expect(secondUpdate.projectAutoPullOverrides).toEqual({
      [firstProjectId]: false,
      [secondProjectId]: false,
    });
    expect(secondUpdate.projectAgentBrowserAccessOverrides).toEqual({
      [firstProjectId]: false,
      [secondProjectId]: false,
    });

    const reset = applyServerSettingsPatch(secondUpdate, {
      projectAutoPullOverrides: { [firstProjectId]: null },
      projectAgentBrowserAccessOverrides: { [firstProjectId]: null },
    });
    expect(reset.projectAutoPullOverrides[firstProjectId]).toBeUndefined();
    expect(reset.projectAgentBrowserAccessOverrides[firstProjectId]).toBeUndefined();
    expect(reset.projectAutoPullOverrides[secondProjectId]).toBe(false);
    expect(reset.projectAgentBrowserAccessOverrides[secondProjectId]).toBe(false);
    expect(secondUpdate.projectAutoPullOverrides[firstProjectId]).toBe(false);
    expect(secondUpdate.projectAgentBrowserAccessOverrides[firstProjectId]).toBe(false);
  });

  it("parses lenient persisted settings JSON and trims observability URLs", () => {
    expect(
      parsePersistedServerObservabilitySettings(
        JSON.stringify({
          observability: {
            otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
            otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
            otlpLogsUrl: "  http://localhost:4318/v1/logs  ",
          },
        }),
      ),
    ).toEqual({
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      otlpLogsUrl: "http://localhost:4318/v1/logs",
    });
  });

  it("falls back cleanly when persisted settings are invalid", () => {
    expect(parsePersistedServerObservabilitySettings("{")).toEqual({
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
    });
  });

  it("still deep merges text generation selection when only options are provided", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          options: [{ id: "fastMode", value: false }],
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4-mini",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: false },
      ],
    });
  });

  it("replaces text generation selection across providers without leaking stale options", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
    });
  });

  it("falls back from a disabled source control writer provider without clearing its selection", () => {
    const instanceId = ProviderInstanceId.make("codex_writer");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "gpt-5.4-mini");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: false,
          config: {},
        },
      },
      sourceControlWriterModelSelection,
    };

    expect(isModelSelectionProviderEnabled(settings, sourceControlWriterModelSelection)).toBe(
      false,
    );
    expect(resolveSourceControlWriterModelSelection(settings, undefined, null)).toBe(
      settings.textGenerationModelSelection,
    );
    expect(settings.sourceControlWriterModelSelection).toBe(sourceControlWriterModelSelection);
  });

  it("falls back from a writer provider that cannot generate application text", () => {
    const instanceId = ProviderInstanceId.make("acp_writer");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "default");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("acpRegistry"),
          enabled: true,
          config: {},
        },
      },
      sourceControlWriterModelSelection,
    };
    const incapableProvider = {
      instanceId,
      driver: ProviderDriverKind.make("acpRegistry"),
      supportsTextGeneration: false,
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-07-27T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    } satisfies ServerProvider;

    expect(resolveSourceControlWriterModelSelection(settings, [incapableProvider], null)).toBe(
      settings.textGenerationModelSelection,
    );
    expect(settings.sourceControlWriterModelSelection).toBe(sourceControlWriterModelSelection);
  });

  it("falls back from a writer provider a project turned off, keeping it for other projects", () => {
    const instanceId = ProviderInstanceId.make("codex_writer");
    const projectId = ProjectId.make("project-a");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "gpt-5.4-mini");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true, config: {} },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
      sourceControlWriterModelSelection,
    };
    const provider = {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-07-27T00:00:00.000Z",
      availability: "available",
      models: [],
      slashCommands: [],
      skills: [],
    } satisfies ServerProvider;

    expect(resolveSourceControlWriterModelSelection(settings, [provider], projectId)).toBe(
      settings.textGenerationModelSelection,
    );
    expect(resolveSourceControlWriterModelSelection(settings, [provider], null)).toBe(
      sourceControlWriterModelSelection,
    );
  });

  it("keeps a writer on an instance the project turned on while the machine has it off", () => {
    const instanceId = ProviderInstanceId.make("codex_writer");
    const projectId = ProjectId.make("project-a");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "gpt-5.4-mini");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: false, config: {} },
      },
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
      sourceControlWriterModelSelection,
    };
    const provider = {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-07-27T00:00:00.000Z",
      availability: "available",
      models: [],
      slashCommands: [],
      skills: [],
    } satisfies ServerProvider;

    expect(resolveSourceControlWriterModelSelection(settings, [provider], projectId)).toBe(
      sourceControlWriterModelSelection,
    );
    expect(resolveSourceControlWriterModelSelection(settings, [provider], null)).toBe(
      settings.textGenerationModelSelection,
    );
  });

  it("replaces providerInstances maps so omitted instance fields are cleared", () => {
    const codexId = ProviderInstanceId.make("codex");
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [codexId]: {
          driver: ProviderDriverKind.make("codex"),
          displayName: "Codex Work",
          accentColor: "#7c3aed",
          enabled: true,
          config: { homePath: "~/.codex" },
        },
      },
    };

    expect(
      applyServerSettingsPatch(current, {
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      }).providerInstances[codexId],
    ).toEqual({
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex Work",
      enabled: true,
      config: { homePath: "~/.codex" },
    });
  });

  it("keeps a project's providerInstances override when a patch entry omits the key", () => {
    const instanceId = ProviderInstanceId.make("codex_work");
    const projectId = ProjectId.make("project-a");
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [projectId]: {
          newWorktreesStartFromOrigin: true,
          providerInstances: { [instanceId]: { enabled: false } },
        },
      },
    };

    const patched = applyServerSettingsPatch(current, {
      projectSettingsOverrides: {
        [projectId]: { newWorktreesStartFromOrigin: false },
      },
    });

    expect(patched.projectSettingsOverrides[projectId]).toEqual({
      newWorktreesStartFromOrigin: false,
      providerInstances: { [instanceId]: { enabled: false } },
    });
  });

  // regression: #18334 a newer client must still see this server drop a key it does not know
  it("drops an override key this server does not know from a patch and keeps one it stored", () => {
    const projectId = ProjectId.make("project-a");
    const current = decodeServerSettings({
      projectSettingsFolded: true,
      projectSettingsOverrides: {
        [projectId]: { defaultAutoPull: true, addedByNewerServer: 3 },
      },
    });
    const patch = decodeServerSettingsPatch({
      projectSettingsOverrides: {
        [projectId]: { defaultAutoPull: false, addedByNewerServer: 4, addedByNewerClient: "x" },
      },
    });

    const updated = applyServerSettingsPatch(current, patch);
    expect(updated.projectSettingsOverrides[projectId]).toEqual({
      defaultAutoPull: false,
      addedByNewerServer: 3,
    });
    const reset = applyServerSettingsPatch(updated, {
      projectSettingsOverrides: { [projectId]: {} },
    });
    expect(reset.projectSettingsOverrides[projectId]).toEqual({ addedByNewerServer: 3 });
    expect(
      applyServerSettingsPatch(reset, {
        projectSettingsOverrides: { [projectId]: null },
      }).projectSettingsOverrides[projectId],
    ).toBeUndefined();
  });

  it("clears a project's providerInstances override when a patch entry sends an empty map", () => {
    const instanceId = ProviderInstanceId.make("codex_work");
    const projectId = ProjectId.make("project-a");
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [projectId]: {
          newWorktreesStartFromOrigin: true,
          providerInstances: { [instanceId]: { enabled: false } },
        },
      },
    };

    const patched = applyServerSettingsPatch(current, {
      projectSettingsOverrides: {
        [projectId]: { newWorktreesStartFromOrigin: true, providerInstances: {} },
      },
    });

    expect(patched.projectSettingsOverrides[projectId]).toEqual({
      newWorktreesStartFromOrigin: true,
      providerInstances: {},
    });
  });

  it("upserts and removes usageLimitSources per entry so concurrent edits cannot clobber", () => {
    const hubA = UsageLimitSourceId.make("cliproxy-a");
    const hubB = UsageLimitSourceId.make("cliproxy-b");
    const source = (url: string) => ({
      kind: "cliproxy" as const,
      url,
      managementKey: "secret",
      enabled: true,
    });
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      usageLimitSources: { [hubA]: source("http://a:8318") },
    };

    const added = applyServerSettingsPatch(current, {
      usageLimitSources: { [hubB]: source("http://b:8318") },
    });
    expect(Object.keys(added.usageLimitSources)).toEqual([hubA, hubB]);

    const removed = applyServerSettingsPatch(added, { usageLimitSources: { [hubA]: null } });
    expect(Object.keys(removed.usageLimitSources)).toEqual([hubB]);
  });

  it("upserts and removes secretProviders per entry so concurrent edits cannot clobber", () => {
    const personal = SecretProviderId.make("personal");
    const work = SecretProviderId.make("work");
    const onePassword = (label: string, account: string) => ({
      kind: SecretProviderKind.make("one_password"),
      label,
      config: { account },
    });
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      secretProviders: { [personal]: onePassword("Personal", "my.1password.com") },
    };

    const added = applyServerSettingsPatch(current, {
      secretProviders: { [work]: onePassword("Work", "team.1password.com") },
    });
    expect(Object.keys(added.secretProviders)).toEqual([personal, work]);

    const removed = applyServerSettingsPatch(added, { secretProviders: { [personal]: null } });
    expect(Object.keys(removed.secretProviders)).toEqual([work]);
  });

  it("replaces and removes individual usage prices without clobbering other models", () => {
    const prices = { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 };
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      usagePriceOverrides: { "example-model": { ...prices, cacheReadCostPerMillionTokens: 0.5 } },
    });
    const added = applyServerSettingsPatch(current, {
      usagePriceOverrides: { "other-model": prices },
    });
    const replaced = applyServerSettingsPatch(added, {
      usagePriceOverrides: { "example-model": prices },
    });
    expect(replaced.usagePriceOverrides).toEqual({
      "example-model": prices,
      "other-model": prices,
    });
    const removed = applyServerSettingsPatch(replaced, {
      usagePriceOverrides: { "example-model": null },
    });
    expect(removed.usagePriceOverrides).toEqual({ "other-model": prices });
    expect(current.usagePriceOverrides["example-model"]?.cacheReadCostPerMillionTokens).toBe(0.5);
  });

  it("stores background activity profiles as a versioned object and syncs legacy aliases", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivity: {
        schemaVersion: 1,
        profile: "battery-saver",
        overrides: {},
      },
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "battery-saver",
      overrides: {},
    });
    expect(next.backgroundActivityProfile).toBe("battery-saver");
    expect(Duration.toMillis(next.automaticGitFetchInterval)).toBe(0);
    expect(Duration.toMillis(next.providerHealthRefreshInterval)).toBe(
      Duration.toMillis(Duration.minutes(15)),
    );
  });

  it("turns legacy interval patches into custom background activity overrides", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      automaticGitFetchInterval: Duration.seconds(15),
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "balanced",
      overrides: {
        automaticGitFetchInterval: Duration.seconds(15),
      },
    });
    expect(resolveServerBackgroundActivitySettings(next).profile).toBe("balanced");
    expect(
      Duration.toMillis(resolveServerBackgroundActivitySettings(next).automaticGitFetchInterval),
    ).toBe(15_000);
  });

  it("preserves legacy background activity settings when applying an unrelated patch", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      backgroundActivityProfile: "performance" as const,
      automaticGitFetchInterval: Duration.seconds(7),
      providerHealthRefreshInterval: Duration.minutes(4),
    };

    const next = applyServerSettingsPatch(current, {
      sourceControlWriterModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
      ),
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval: Duration.seconds(7),
        providerHealthRefreshInterval: Duration.minutes(4),
      },
    });
    expect(next.backgroundActivityProfile).toBe("performance");
    expect(Duration.toMillis(next.automaticGitFetchInterval)).toBe(7_000);
    expect(Duration.toMillis(next.providerHealthRefreshInterval)).toBe(240_000);
  });

  it("does not reactivate dormant overrides from a concrete profile", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      backgroundActivity: {
        schemaVersion: 1 as const,
        profile: "battery-saver" as const,
        overrides: {
          providerHealthRefreshInterval: Duration.seconds(5),
        },
      },
    };

    const next = applyServerSettingsPatch(current, {
      automaticGitFetchInterval: Duration.seconds(15),
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "battery-saver",
      overrides: {
        automaticGitFetchInterval: Duration.seconds(15),
      },
    });
  });

  it("prefers structured background activity settings over legacy aliases", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivity: {
        schemaVersion: 1,
        profile: "battery-saver",
        overrides: {},
      },
      automaticGitFetchInterval: Duration.seconds(5),
      backgroundActivityProfile: "performance",
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "battery-saver",
      overrides: {},
    });
    expect(next.backgroundActivityProfile).toBe("battery-saver");
    expect(Duration.toMillis(next.automaticGitFetchInterval)).toBe(0);
  });

  it("reconciles custom background activity back to a preset when overrides match the preset", () => {
    const custom = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      automaticGitFetchInterval: Duration.seconds(15),
    });
    const next = applyServerSettingsPatch(custom, {
      automaticGitFetchInterval: Duration.seconds(30),
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "balanced",
      overrides: {},
    });
    expect(next.backgroundActivityProfile).toBe("balanced");
    expect(Duration.toMillis(next.automaticGitFetchInterval)).toBe(30_000);
  });

  it("replaces the complete background override record", () => {
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivity: {
        schemaVersion: 1,
        profile: "custom",
        baseProfile: "balanced",
        overrides: {
          automaticGitFetchInterval: Duration.seconds(15),
          providerHealthRefreshInterval: Duration.minutes(3),
        },
      },
    });

    const next = applyServerSettingsPatch(current, {
      backgroundActivity: {
        overrides: {
          automaticGitFetchInterval: Duration.seconds(10),
        },
      },
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "balanced",
      overrides: {
        automaticGitFetchInterval: Duration.seconds(10),
      },
    });
  });

  it("keeps interval overrides supplied with a profile patch", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivityProfile: "performance",
      automaticGitFetchInterval: Duration.seconds(0),
      providerHealthRefreshInterval: Duration.minutes(4),
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval: Duration.seconds(0),
        providerHealthRefreshInterval: Duration.minutes(4),
      },
    });
  });

  it("keeps unknown feature flags and explicit choices while patching project overrides", () => {
    const projectId = ProjectId.make("flag-preservation");
    const configured = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      betterT3Environment: {
        flags: { "chat.visual": true, "future.feature": false },
      },
    });
    const patched = applyServerSettingsPatch(configured, {
      betterT3Environment: { flags: { "chat.visual": false } },
      projectSettingsOverrides: { [projectId]: { defaultAutoPull: false } },
    });
    expect(patched.betterT3Environment.flags).toMatchObject({
      "chat.visual": false,
      "future.feature": false,
    });
    expect(patched.projectSettingsOverrides[projectId]?.defaultAutoPull).toBe(false);
    expect(patched.projectAutoPullOverrides[projectId]).toBe(false);
    expect(patched.betterT3Environment.initialization).toEqual(
      configured.betterT3Environment.initialization,
    );
  });
  it("replaces project indexing default models atomically and preserves explicit resets", () => {
    const original = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      projectIndexingEnabled: true,
      projectIndexingDefaultModelSelection: createModelSelection(
        ProviderInstanceId.make("first-provider"),
        "first-model",
        [{ id: "reasoningEffort", value: "high" }],
      ),
    });
    const selection = createModelSelection(
      ProviderInstanceId.make("second-provider"),
      "second-model",
    );
    const replaced = applyServerSettingsPatch(original, {
      projectIndexingDefaultModelSelection: selection,
    });
    expect(replaced.projectIndexingEnabled).toBe(true);
    expect(replaced.projectIndexingDefaultModelSelection).toEqual(selection);
    expect(replaced.projectIndexingDefaultModelSelection?.options).toBeUndefined();
    const disabled = applyServerSettingsPatch(replaced, { projectIndexingEnabled: false });
    expect(disabled.projectIndexingDefaultModelSelection).toEqual(selection);
    expect(disabled.projectIndexingEnabled).toBe(false);
    const reset = applyServerSettingsPatch(disabled, {
      projectIndexingDefaultModelSelection: null,
    });
    expect(reset.projectIndexingDefaultModelSelection).toBeNull();
    expect(
      applyServerSettingsPatch(reset, { defaultAutoPull: true })
        .projectIndexingDefaultModelSelection,
    ).toBeNull();
    expect(DEFAULT_SERVER_SETTINGS.projectIndexingEnabled).toBe(false);
    expect(DEFAULT_SERVER_SETTINGS.projectIndexingDefaultModelSelection).toBeNull();
  });
  it("updates voice defaults without losing the key and resets only the selected project", () => {
    const first = ProjectId.make("voice-one");
    const second = ProjectId.make("voice-two");
    const voice = DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS;
    const configured = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      speechTranscription: {
        assemblyAi: {
          apiKey: { value: "secret" },
          projectOverrides: {
            [first]: { ...voice, cleanupMode: "off" },
            [second]: { ...voice, cleanupMode: "compact" },
          },
        },
      },
    });
    const reset = applyServerSettingsPatch(configured, {
      speechTranscription: {
        assemblyAi: {
          voice: { ...voice, voiceFocus: "far-field" },
          projectOverrides: { [first]: null },
        },
      },
    });
    expect(reset.speechTranscription.assemblyAi.apiKey.value).toBe("secret");
    expect(reset.speechTranscription.assemblyAi.voice.voiceFocus).toBe("far-field");
    expect(reset.speechTranscription.assemblyAi.projectOverrides[first]).toBeUndefined();
    expect(reset.speechTranscription.assemblyAi.projectOverrides[second]?.cleanupMode).toBe(
      "compact",
    );
  });
  it("replaces SSH host lists when saving, editing, and removing hosts", () => {
    const host = { kind: "ssh" as const, id: "mini", label: "Mac mini", target: "mini" };
    const saved = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { deviceHosts: [host] });
    expect(saved.deviceHosts).toEqual([host]);
    const replacement = { ...host, target: "other-mini" };
    const edited = applyServerSettingsPatch(saved, { deviceHosts: [replacement] });
    expect(edited.deviceHosts).toEqual([replacement]);
    expect(applyServerSettingsPatch(edited, { deviceHosts: [] }).deviceHosts).toEqual([]);
  });
  it("keeps the Better T3 Deep Thinking flag and legacy setting bidirectionally compatible", () => {
    const enabledByCurrentClient = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      betterT3Environment: { flags: { "agent.deepThinking": true } },
    });
    expect(enabledByCurrentClient.agentEnhancement.deepThinking.enabled).toBe(true);

    const disabledByLegacyClient = applyServerSettingsPatch(enabledByCurrentClient, {
      agentEnhancement: { deepThinking: { enabled: false } },
    });
    expect(
      resolveBetterT3FeatureFlag(disabledByLegacyClient.betterT3Environment, "agent.deepThinking"),
    ).toBe(false);

    const currentClientWins = applyServerSettingsPatch(disabledByLegacyClient, {
      betterT3Environment: { flags: { "agent.deepThinking": true } },
      agentEnhancement: { deepThinking: { enabled: false } },
    });
    expect(
      resolveBetterT3FeatureFlag(currentClientWins.betterT3Environment, "agent.deepThinking"),
    ).toBe(true);
    expect(currentClientWins.agentEnhancement.deepThinking.enabled).toBe(true);
  });
  it("rejects stale locale writes while preserving the newest compatible legacy mirror", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      interfaceLanguageSyncRecord: {
        preference: "de" as const,
        updatedAt: 20,
        updateId: "desktop:de:20",
      },
      interfaceLocaleSyncRecordV1: {
        version: 1 as const,
        preference: "fr" as const,
        updatedAt: 30,
        updateId: "mobile:fr:30",
      },
    };

    const staleLocale = applyServerSettingsPatch(current, {
      interfaceLocaleSyncRecordV1: {
        version: 1,
        preference: "en",
        updatedAt: 10,
        updateId: "web:en:10",
      },
    });
    expect(staleLocale.interfaceLocaleSyncRecordV1).toEqual(current.interfaceLocaleSyncRecordV1);
    expect(staleLocale.interfaceLanguageSyncRecord).toEqual(current.interfaceLanguageSyncRecord);

    const staleLegacy = applyServerSettingsPatch(current, {
      interfaceLanguageSyncRecord: {
        preference: "en",
        updatedAt: 10,
        updateId: "legacy:en:10",
      },
    });
    expect(staleLegacy.interfaceLocaleSyncRecordV1).toEqual(current.interfaceLocaleSyncRecordV1);
    expect(staleLegacy.interfaceLanguageSyncRecord).toEqual(current.interfaceLanguageSyncRecord);
  });
  it("writes V2 chat modes and compatible legacy mirrors together", () => {
    for (const mode of ["current", "classic", "better-t3"] as const) {
      const record = { mode, updatedAt: 30, updateId: "device-b:30" };
      const configured = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        chatVisualModeSyncRecordV2: record,
      });
      expect(configured.chatVisualModeSyncRecordV2).toEqual(record);
      expect(configured.chatVisualModeSyncRecord).toEqual({
        ...record,
        mode: mode === "better-t3" ? "current" : mode,
      });
      const unrelated = applyServerSettingsPatch(configured, { defaultAutoPull: true });
      expect(unrelated.defaultAutoPull).toBe(true);
      expect(unrelated.chatVisualModeSyncRecordV2).toEqual(record);
      expect(unrelated.chatVisualModeSyncRecord).toEqual(configured.chatVisualModeSyncRecord);
    }
  });
  it("ignores stale chat mode writes and the echo of a V2 legacy mirror", () => {
    const record = { mode: "better-t3", updatedAt: 30, updateId: "device-b:30" } as const;
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      chatVisualModeSyncRecordV2: record,
    });
    for (const patch of [
      { chatVisualModeSyncRecord: { ...record, mode: "current" as const } },
      { chatVisualModeSyncRecord: { ...record, mode: "classic" as const, updatedAt: 29 } },
      {
        chatVisualModeSyncRecord: {
          ...record,
          mode: "classic" as const,
          updateId: "device-a:30",
        },
      },
      { chatVisualModeSyncRecordV2: { ...record, mode: "classic" as const, updatedAt: 29 } },
      { chatVisualModeSyncRecordV2: { ...record, mode: "classic" as const } },
    ]) {
      const patched = applyServerSettingsPatch(current, patch);
      expect(patched.chatVisualModeSyncRecordV2).toEqual(record);
      expect(patched.chatVisualModeSyncRecord).toEqual(current.chatVisualModeSyncRecord);
    }
  });
  it("lets newer legacy choices win regardless of arrival order", () => {
    const v2 = { mode: "better-t3", updatedAt: 30, updateId: "device-b:30" } as const;
    for (const legacy of [
      { mode: "classic", updatedAt: 31, updateId: "device-a:31" },
      { mode: "classic", updatedAt: 30, updateId: "device-c:30" },
    ] as const) {
      const patches = [{ chatVisualModeSyncRecordV2: v2 }, { chatVisualModeSyncRecord: legacy }];
      for (const ordered of [patches, patches.toReversed()]) {
        const saved = ordered.reduce(applyServerSettingsPatch, DEFAULT_SERVER_SETTINGS);
        expect(saved.chatVisualModeSyncRecordV2).toEqual(v2);
        expect(saved.chatVisualModeSyncRecord).toEqual(legacy);
        expect(
          resolveChatVisualModeRecord(
            saved.chatVisualModeSyncRecord,
            saved.chatVisualModeSyncRecordV2,
          ),
        ).toEqual(legacy);
      }
    }
  });
  it("resolves conflicting fields by clock and prefers V2 when their clocks match", () => {
    const v2 = { mode: "better-t3", updatedAt: 30, updateId: "device-b:30" } as const;
    for (const legacy of [
      { mode: "classic", updatedAt: 29, updateId: "device-b:29" },
      { mode: "classic", updatedAt: 30, updateId: "device-b:30" },
      { mode: "classic", updatedAt: 31, updateId: "device-b:31" },
    ] as const) {
      const saved = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        chatVisualModeSyncRecordV2: v2,
        chatVisualModeSyncRecord: legacy,
      });
      const expected = legacy.updatedAt > v2.updatedAt ? legacy : v2;
      expect(saved.chatVisualModeSyncRecordV2).toEqual(v2);
      expect(
        resolveChatVisualModeRecord(
          saved.chatVisualModeSyncRecord,
          saved.chatVisualModeSyncRecordV2,
        ),
      ).toEqual(expected);
      expect(saved.chatVisualModeSyncRecord).toEqual({
        ...expected,
        mode: expected.mode === "better-t3" ? "current" : expected.mode,
      });
    }
  });
  it("upgrades a legacy-only mirror when its matching V2 record arrives", () => {
    const record = { mode: "better-t3", updatedAt: 30, updateId: "device-b:30" } as const;
    const mirrorOnly = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      chatVisualModeSyncRecord: { ...record, mode: "current" },
    });
    expect(mirrorOnly.chatVisualModeSyncRecordV2).toBeUndefined();
    const saved = applyServerSettingsPatch(mirrorOnly, { chatVisualModeSyncRecordV2: record });
    expect(saved.chatVisualModeSyncRecordV2).toEqual(record);
  });
  it("restores Better T3 after another client promoted its mirror into V2", () => {
    const record = { mode: "better-t3", updatedAt: 30, updateId: "device-b:30" } as const;
    const promotedMirror = { ...record, mode: "current" } as const;
    const initial = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      chatVisualModeSyncRecordV2: promotedMirror,
    });
    const restored = applyServerSettingsPatch(initial, { chatVisualModeSyncRecordV2: record });
    const echoed = applyServerSettingsPatch(restored, {
      chatVisualModeSyncRecordV2: promotedMirror,
    });
    for (const saved of [restored, echoed]) {
      expect(saved.chatVisualModeSyncRecordV2).toEqual(record);
      expect(saved.chatVisualModeSyncRecord).toEqual(promotedMirror);
    }
  });
  it("maps former streaming choices without overriding the canonical mode", () => {
    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { enableAssistantStreaming: true })
        .responseStreamingMode,
    ).toBe("token");

    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        enableAssistantStreaming: true,
        enableLegacyTokenStreaming: false,
      }).responseStreamingMode,
    ).toBe("turn");
    const canonical = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      enableAssistantStreaming: true,
      enableLegacyTokenStreaming: true,
      responseStreamingMode: "paragraph",
    });
    expect(canonical.responseStreamingMode).toBe("paragraph");
    expect(Object.hasOwn(canonical, "enableAssistantStreaming")).toBe(false);
    expect(Object.hasOwn(canonical, "enableLegacyTokenStreaming")).toBe(false);
  });
  it("replaces the project thread preview sync record atomically and preserves it when omitted", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      projectThreadPreviewSyncRecord: {
        count: 3,
        updatedAt: 1_777_000_000_000,
        updateId: "device-a:initial",
      },
    };
    const replacement = {
      count: 6,
      updatedAt: 1_777_000_001_000,
      updateId: "device-b:replacement",
    };

    const replaced = applyServerSettingsPatch(current, {
      projectThreadPreviewSyncRecord: replacement,
    });
    const afterUnrelatedPatch = applyServerSettingsPatch(replaced, {
      addProjectBaseDirectory: "~/Development",
    });

    expect(replaced.projectThreadPreviewSyncRecord).toEqual(replacement);
    expect(afterUnrelatedPatch.projectThreadPreviewSyncRecord).toEqual(replacement);
    expect(afterUnrelatedPatch.addProjectBaseDirectory).toBe("~/Development");
  });
  it("replaces the chat visual mode sync record atomically and preserves it when omitted", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      chatVisualModeSyncRecord: {
        mode: "current" as const,
        updatedAt: 1_777_000_000_000,
        updateId: "device-a:current",
      },
    };
    const replacement = {
      mode: "classic" as const,
      updatedAt: 1_777_000_001_000,
      updateId: "device-b:classic",
    };

    const replaced = applyServerSettingsPatch(current, {
      chatVisualModeSyncRecord: replacement,
    });
    const afterUnrelatedPatch = applyServerSettingsPatch(replaced, {
      addProjectBaseDirectory: "~/Development",
    });

    expect(replaced.chatVisualModeSyncRecord).toEqual(replacement);
    expect(afterUnrelatedPatch.chatVisualModeSyncRecord).toEqual(replacement);
    expect(afterUnrelatedPatch.addProjectBaseDirectory).toBe("~/Development");
  });
  it("inherits automatic pull while preserving legacy opt-ins and explicit overrides", () => {
    const projectId = ProjectId.make("project-pull");
    expect(resolveProjectAutoPull(DEFAULT_SERVER_SETTINGS, projectId, false)).toBe(false);
    expect(resolveProjectAutoPull(DEFAULT_SERVER_SETTINGS, projectId, true)).toBe(true);
    const enabled = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { defaultAutoPull: true });
    expect(resolveProjectAutoPull(enabled, projectId, false)).toBe(true);
    const overridden = applyServerSettingsPatch(enabled, {
      projectAutoPullOverrides: { [projectId]: false },
    });
    expect(resolveProjectAutoPull(overridden, projectId, true)).toBe(false);
    const reset = applyServerSettingsPatch(overridden, {
      projectAutoPullOverrides: { [projectId]: null },
    });
    expect(resolveProjectAutoPull(reset, projectId, false)).toBe(true);
    const disabled = applyServerSettingsPatch(reset, {
      defaultAutoPull: false,
      projectAutoPullOverrides: { [projectId]: true },
    });
    expect(resolveProjectAutoPull(disabled, projectId, false)).toBe(true);
    expect(resolveProjectAutoPull(disabled, ProjectId.make("other-project"), false)).toBe(false);
  });
  it("inherits browser access and restores inheritance when a project override is removed", () => {
    const projectId = ProjectId.make("project-browser");
    const otherProjectId = ProjectId.make("other-project");
    const overridden = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      projectAgentBrowserAccessOverrides: { [projectId]: false },
    });
    expect(resolveProjectAgentBrowserAccess(overridden, projectId)).toBe(false);
    expect(resolveProjectAgentBrowserAccess(overridden, otherProjectId)).toBe(true);
    const reset = applyServerSettingsPatch(overridden, {
      projectAgentBrowserAccessOverrides: { [projectId]: null },
    });
    expect(resolveProjectAgentBrowserAccess(reset, projectId)).toBe(true);
    const enabled = applyServerSettingsPatch(reset, {
      enableAgentBrowserAccess: false,
      projectAgentBrowserAccessOverrides: { [projectId]: true },
    });
    expect(resolveProjectAgentBrowserAccess(enabled, projectId)).toBe(true);
    expect(resolveProjectAgentBrowserAccess(enabled, otherProjectId)).toBe(false);
  });
  it("replaces and clears conversation model defaults without retaining old options", () => {
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      defaultModelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
        { id: "reasoningEffort", value: "high" },
      ]),
    });
    const selection = createModelSelection(ProviderInstanceId.make("claudeAgent"), "sonnet");
    const updated = applyServerSettingsPatch(current, { defaultModelSelection: selection });
    expect(updated.defaultModelSelection).toEqual(selection);
    expect(
      applyServerSettingsPatch(updated, { defaultModelSelection: null }).defaultModelSelection,
    ).toBeNull();
  });
  it("ignores missing and blank persisted observability URLs", () => {
    expect(parsePersistedServerObservabilitySettings("{}")).toEqual({
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
    });
    expect(
      parsePersistedServerObservabilitySettings(
        JSON.stringify({
          observability: { otlpTracesUrl: "   ", otlpMetricsUrl: "", otlpLogsUrl: "   " },
        }),
      ),
    ).toEqual({
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
    });
  });
  it("replaces text generation selection when provider/model are provided", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4-mini",
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4-mini",
    });
  });
  it("accepts array-based text generation selection patches", () => {
    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
          options: [
            { id: "variant", value: "prod" },
            { id: "agent", value: "build" },
          ],
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
      options: [
        { id: "variant", value: "prod" },
        { id: "agent", value: "build" },
      ],
    });
  });
  it("replaces the parallel plan reviewer selection without leaking Codex options", () => {
    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        parallelPlanReviewModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
        },
      }).parallelPlanReviewModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
    });
  });
  it("merges option-only parallel plan reviewer patches by option id", () => {
    expect(
      applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        parallelPlanReviewModelSelection: {
          options: [{ id: "serviceTier", value: "standard" }],
        },
      }).parallelPlanReviewModelSelection,
    ).toEqual({
      instanceId: "codex",
      model: DEFAULT_SERVER_SETTINGS.parallelPlanReviewModelSelection.model,
      options: [
        { id: "reasoningEffort", value: "low" },
        { id: "serviceTier", value: "standard" },
      ],
    });
  });
  it("replaces source control writer selection without retaining stale options", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      sourceControlWriterModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [{ id: "reasoningEffort", value: "high" }],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        sourceControlWriterModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
        },
      }).sourceControlWriterModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
    });
  });
  it("clears source control writer selection with null", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      sourceControlWriterModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        sourceControlWriterModelSelection: null,
      }).sourceControlWriterModelSelection,
    ).toBeNull();
  });
  it("replaces and clears the voice translation model without retaining stale options", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      voiceTranslationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.6-luna",
        [{ id: "reasoningEffort", value: "high" }],
      ),
    };
    const replacement = applyServerSettingsPatch(current, {
      voiceTranslationModelSelection: {
        instanceId: ProviderInstanceId.make("opencode"),
        model: "openai/gpt-5",
      },
    });

    expect(replacement.voiceTranslationModelSelection).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
    });
    expect(
      applyServerSettingsPatch(replacement, { voiceTranslationModelSelection: null })
        .voiceTranslationModelSelection,
    ).toBeNull();
  });
  it("replaces and clears the Fetch model without retaining stale options", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      fetchModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.3-codex-spark",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "priority" },
        ],
      ),
    };
    const replacement = applyServerSettingsPatch(current, {
      fetchModelSelection: {
        instanceId: ProviderInstanceId.make("claude_work"),
        model: "claude-opus-4-6",
      },
    });

    expect(replacement.fetchModelSelection).toEqual({
      instanceId: "claude_work",
      model: "claude-opus-4-6",
    });
    expect(
      applyServerSettingsPatch(replacement, { fetchModelSelection: null }).fetchModelSelection,
    ).toBeNull();
  });
  it("falls back from a disabled voice translation provider without clearing the override", () => {
    const instanceId = ProviderInstanceId.make("codex_voice");
    const voiceTranslationModelSelection = createModelSelection(instanceId, "gpt-5.6-luna");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: false,
          config: {},
        },
      },
      voiceTranslationModelSelection,
    };

    expect(resolveVoiceTranslationModelSelection(settings)).toBe(
      settings.textGenerationModelSelection,
    );
    expect(settings.voiceTranslationModelSelection).toBe(voiceTranslationModelSelection);
  });
  it("falls back from an unavailable source control writer provider", () => {
    const instanceId = ProviderInstanceId.make("missing_writer");
    const sourceControlWriterModelSelection = createModelSelection(instanceId, "missing-model");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("missing-driver"),
          config: {},
        },
      },
      sourceControlWriterModelSelection,
    };
    const unavailableProvider = {
      instanceId,
      driver: ProviderDriverKind.make("missing-driver"),
      enabled: false,
      installed: false,
      version: null,
      status: "disabled",
      auth: { status: "unknown" },
      checkedAt: "2026-07-27T00:00:00.000Z",
      availability: "unavailable",
      unavailableReason: "This provider driver is not available in this build.",
      models: [],
      slashCommands: [],
      skills: [],
    } satisfies ServerProvider;

    expect(resolveSourceControlWriterModelSelection(settings, [unavailableProvider], null)).toBe(
      settings.textGenerationModelSelection,
    );
    expect(settings.sourceControlWriterModelSelection).toBe(sourceControlWriterModelSelection);
  });
  it("drops custom overrides that duplicate the base profile", () => {
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      backgroundActivity: {
        schemaVersion: 1,
        profile: "custom",
        baseProfile: "balanced",
        overrides: {
          automaticGitFetchInterval: Duration.seconds(30),
        },
      },
    });

    expect(next.backgroundActivity).toEqual({
      schemaVersion: 1,
      profile: "balanced",
      overrides: {},
    });
  });
  it("ignores overrides attached to a concrete background profile", () => {
    const resolved = resolveServerBackgroundActivitySettings({
      ...DEFAULT_SERVER_SETTINGS,
      backgroundActivity: {
        schemaVersion: 1,
        profile: "balanced",
        overrides: {
          pauseWhenOnBattery: true,
        },
      },
    });

    expect(resolved.pauseWhenOnBattery).toBe(false);
  });
  it("replaces disabled skill ids instead of deep-merging stale values", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      skills: {
        disabledSkillIds: [
          "global:/tmp/t3/skills/review/SKILL.md",
          "project:/tmp/repo/.t3code/skills/test/SKILL.md",
        ],
      },
    };

    expect(
      applyServerSettingsPatch(current, {
        skills: {
          disabledSkillIds: ["global:/tmp/t3/skills/review/SKILL.md"],
        },
      }).skills.disabledSkillIds,
    ).toEqual(["global:/tmp/t3/skills/review/SKILL.md"]);
  });
  it("replaces MCP server arrays instead of deep-merging stale entries", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      mcp: {
        servers: [
          {
            id: McpServerId.make("old"),
            scope: "global" as const,
            name: "old",
            enabled: true,
            providerRouting: { mode: "all" as const },
            transport: "stdio" as const,
            command: "old",
            args: [],
            env: {},
          },
        ],
      },
    };

    const servers = [
      {
        id: McpServerId.make("new"),
        scope: "global" as const,
        name: "new",
        enabled: true,
        providerRouting: { mode: "all" as const },
        transport: "stdio" as const,
        command: "new",
        args: [],
        env: {},
      },
    ];

    expect(applyServerSettingsPatch(current, { mcp: { servers } }).mcp.servers).toEqual(servers);
  });
});

describe("worktreesDirectory", () => {
  it("remembers previous custom locations so their worktrees stay managed", () => {
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { worktreesDirectory: "/a" });
    expect(first.previousWorktreesDirectories).toEqual([]);
    const second = applyServerSettingsPatch(first, { worktreesDirectory: "/b" });
    expect(second.previousWorktreesDirectories).toEqual(["/a"]);
    const reset = applyServerSettingsPatch(second, { worktreesDirectory: "" });
    expect(reset.previousWorktreesDirectories).toEqual(["/a", "/b"]);
    const back = applyServerSettingsPatch(reset, { worktreesDirectory: "/a" });
    expect(back.previousWorktreesDirectories).toEqual(["/b"]);
  });
});

describe("synchronized model preferences", () => {
  it("supports provider identifiers that match inherited object keys", () => {
    const provider = ProviderInstanceId.make("toString");
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      setModelsHidden: [{ provider, model: "example", hidden: true }],
    });
    expect(next.providerModelPreferences?.[provider]?.hiddenModels).toEqual(["example"]);
  });
  const provider = ProviderInstanceId.make("codex_work");
  const legacy = {
    favorites: [{ provider, model: "sol" }],
    providerModelPreferences: { [provider]: { hiddenModels: ["astra"], modelOrder: ["sol"] } },
  };

  it("keeps concurrent adds and removes of the same favorite idempotent", () => {
    const add = { setModelFavorites: [{ provider, model: "sol", favorite: true }] };
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, add);
    expect(applyServerSettingsPatch(first, add).favorites).toEqual([{ provider, model: "sol" }]);
    const remove = { setModelFavorites: [{ provider, model: "sol", favorite: false }] };
    const removed = applyServerSettingsPatch(first, remove);
    expect(applyServerSettingsPatch(removed, remove).favorites).toEqual([]);
    expect(first.favorites).toEqual([{ provider, model: "sol" }]);
  });

  it("preserves unrelated models and providers during bulk visibility and order edits", () => {
    const otherProvider = ProviderInstanceId.make("claude_work");
    const initial = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      providerModelPreferences: {
        ...legacy.providerModelPreferences,
        [otherProvider]: { hiddenModels: ["opus"], modelOrder: ["sonnet", "opus"] },
      },
    });
    const mobile = applyServerSettingsPatch(initial, {
      setModelsHidden: [{ provider, model: "luna", hidden: true }],
    });
    const web = applyServerSettingsPatch(mobile, {
      setModelsHidden: [
        { provider, model: "astra", hidden: false },
        { provider, model: "sol", hidden: true },
      ],
      setProviderModelOrder: { provider, modelOrder: ["sol", "luna", "astra"] },
    });
    expect(initial.providerModelPreferences?.[provider]).toEqual(
      legacy.providerModelPreferences[provider],
    );
    expect(web.providerModelPreferences?.[provider]).toEqual({
      hiddenModels: ["luna", "sol"],
      modelOrder: ["sol", "luna", "astra"],
    });
    expect(web.providerModelPreferences?.[otherProvider]).toEqual(
      initial.providerModelPreferences?.[otherProvider],
    );
    expect(
      applyServerSettingsPatch(web, {
        setProviderModelOrder: { provider, modelOrder: [] },
      }).providerModelPreferences?.[provider],
    ).toEqual({ hiddenModels: ["luna", "sol"], modelOrder: [] });
  });

  it("migrates saved lists independently without claiming empty legacy lists", () => {
    expect(modelPreferencesMigrationPatch(DEFAULT_SERVER_SETTINGS, {})).toBeNull();
    const patch = modelPreferencesMigrationPatch(DEFAULT_SERVER_SETTINGS, legacy)!;
    const migrated = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, patch);
    expect(resolveModelPreferences(migrated)).toEqual(legacy);
    expect(modelPreferencesMigrationPatch(migrated, legacy)).toBeNull();
    const favoritesOnly = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { favorites: [] });
    expect(modelPreferencesMigrationPatch(favoritesOnly, legacy)).toEqual({
      migrateModelPreferences: { providerModelPreferences: legacy.providerModelPreferences },
    });
  });

  it("keeps explicit clears when a delayed migration arrives from another device", () => {
    const staleMigration = modelPreferencesMigrationPatch(DEFAULT_SERVER_SETTINGS, legacy)!;
    const cleared = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      favorites: [],
      providerModelPreferences: {},
    });
    expect(
      resolveModelPreferences(applyServerSettingsPatch(cleared, staleMigration), legacy),
    ).toEqual({
      favorites: [],
      providerModelPreferences: {},
    });
  });

  it("replaces visibility records so showing every model clears removed entries", () => {
    const migrated = applyServerSettingsPatch(
      DEFAULT_SERVER_SETTINGS,
      modelPreferencesMigrationPatch(DEFAULT_SERVER_SETTINGS, legacy)!,
    );
    const cleared = applyServerSettingsPatch(migrated, { providerModelPreferences: {} });
    expect(cleared.providerModelPreferences).toEqual({});
    expect(cleared.favorites).toEqual(legacy.favorites);
  });

  it("sets favorites without losing changes from other clients", () => {
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      setModelFavorites: [{ provider, model: "sol", favorite: true }],
    });
    const second = applyServerSettingsPatch(first, {
      setModelFavorites: [{ provider, model: "astra", favorite: true }],
      migrateModelPreferences: { favorites: [] },
    });
    expect(second.favorites).toEqual([
      { provider, model: "sol" },
      { provider, model: "astra" },
    ]);
    const removed = applyServerSettingsPatch(second, {
      setModelFavorites: [{ provider, model: "sol", favorite: false }],
    });
    expect(removed.favorites).toEqual([{ provider, model: "astra" }]);
    expect(
      applyServerSettingsPatch(removed, {
        setModelFavorites: [{ provider, model: "astra", favorite: false }],
      }).favorites,
    ).toEqual([]);
  });

  it("keeps the same model on different provider instances as separate favorites", () => {
    const otherProvider = ProviderInstanceId.make("codex_personal");
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      setModelFavorites: [{ provider, model: "sol", favorite: true }],
    });
    const second = applyServerSettingsPatch(first, {
      setModelFavorites: [{ provider: otherProvider, model: "sol", favorite: true }],
    });
    expect(second.favorites).toEqual([
      { provider, model: "sol" },
      { provider: otherProvider, model: "sol" },
    ]);
    expect(
      applyServerSettingsPatch(second, {
        setModelFavorites: [{ provider, model: "sol", favorite: false }],
      }).favorites,
    ).toEqual([{ provider: otherProvider, model: "sol" }]);
  });
});
