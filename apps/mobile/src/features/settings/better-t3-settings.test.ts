import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type BetterT3FeatureId,
  type ExecutionEnvironmentCapabilities,
  type KnowledgeGraphStatusV1,
  type ServerLifecycleWelcomePayload,
} from "@t3tools/contracts";
import {
  BETTER_T3_ANALYTICS_BUILD_STATUS,
  prepareCheckpointStatus,
  prepareCompatibilityStatus,
  prepareKnowledgeGraphStatus,
  prepareLifecycleStatus,
  prepareMcpStatus,
  prepareRemoteReadinessStatus,
  prepareSkillsStatus,
} from "@t3tools/client-runtime/better-t3-status";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMobileBetterT3Sections,
  createMobileBetterT3DeviceControlPatch,
  createMobileBetterT3DevicePreferencePatch,
  createMobileBetterT3EnvironmentControlPatch,
  createMobileBetterT3EnvironmentPatch,
  MOBILE_BETTER_T3_DIRECT_CONTROL_IDS,
  mobileBetterT3SurfaceForWidth,
  mobileBetterT3PreparedStatusMessageKey,
  mobileLifecycleReceiptFromWelcome,
  mobileBetterT3PreparedStatusDetail,
  resolveMobileBetterT3EnvironmentTarget,
  resolveMobileBetterT3Destination,
  resolveMobileBetterT3ProjectSelection,
  shouldSubscribeMobileKnowledgeGraphProgress,
  supportsMobileKnowledgeGraphModelOption,
  buildMobileTranscriptPortabilityOptions,
  formatMobileResourceBytes,
  supportsMobileResourceDiagnostics,
  supportsMobileTranscriptPortability,
} from "./better-t3-settings";

function graphStatus(state: KnowledgeGraphStatusV1["state"]): KnowledgeGraphStatusV1 {
  return {
    version: 1,
    scopeId: "scope:mobile-status",
    state,
    revision: 3,
    indexedFileCount: 12,
    nodeCount: 42,
    edgeCount: 56,
    evidenceCount: 60,
    semanticQueueDepth: 2,
    truncated: {
      eligibleFiles: false,
      nodes: false,
      visibleNodes: false,
      omittedFileCount: 0,
      omittedNodeCount: 0,
    },
  } as KnowledgeGraphStatusV1;
}

const capabilities = (
  overrides: Partial<ExecutionEnvironmentCapabilities> = {},
): ExecutionEnvironmentCapabilities => ({
  repositoryIdentity: true,
  midChatProviderSwitching: false,
  agentWorkflowVersion: 1,
  ...overrides,
});

function feature(sections: ReturnType<typeof buildMobileBetterT3Sections>, id: BetterT3FeatureId) {
  return sections.flatMap((section) => section.controls).find((control) => control.id === id);
}

describe("mobile Better T3 settings", () => {
  it("requires a connected environment with current server settings before enabling mutations", () => {
    const environmentId = EnvironmentId.make("environment-connected");

    expect(
      resolveMobileBetterT3EnvironmentTarget({
        environmentId,
        connectionPhase: "connected",
        serverConfigAvailable: true,
      }),
    ).toBe(environmentId);
    expect(
      resolveMobileBetterT3EnvironmentTarget({
        environmentId,
        connectionPhase: "reconnecting",
        serverConfigAvailable: true,
      }),
    ).toBeNull();
    expect(
      resolveMobileBetterT3EnvironmentTarget({
        environmentId,
        connectionPhase: "connected",
        serverConfigAvailable: false,
      }),
    ).toBeNull();
    expect(
      resolveMobileBetterT3EnvironmentTarget({
        environmentId: null,
        connectionPhase: "connected",
        serverConfigAvailable: true,
      }),
    ).toBeNull();
  });

  it("requires an explicit project selection and never guesses the first environment project", () => {
    const environmentId = EnvironmentId.make("environment-projects");
    const first = { environmentId, id: ProjectId.make("first"), title: "First" };
    const second = { environmentId, id: ProjectId.make("second"), title: "Second" };
    const other = {
      environmentId: EnvironmentId.make("other-environment"),
      id: ProjectId.make("other"),
      title: "Other",
    };

    expect(
      resolveMobileBetterT3ProjectSelection([first, second, other], environmentId, null),
    ).toBeNull();
    expect(
      resolveMobileBetterT3ProjectSelection([first, second, other], environmentId, second.id),
    ).toBe(second);
    expect(
      resolveMobileBetterT3ProjectSelection([first, second, other], environmentId, other.id),
    ).toBeNull();
  });

  it("marks lifecycle observed only after the welcome subscription yields", () => {
    expect(mobileLifecycleReceiptFromWelcome(null)).toBeNull();
    expect(mobileLifecycleReceiptFromWelcome({} as ServerLifecycleWelcomePayload)).toBe("welcome");
  });

  it("uses phone and tablet registry surfaces without exposing desktop-only controls", () => {
    expect(mobileBetterT3SurfaceForWidth(767)).toBe("phone");
    expect(mobileBetterT3SurfaceForWidth(768)).toBe("tablet");

    const sections = buildMobileBetterT3Sections({
      registry: BETTER_T3_FEATURE_REGISTRY,
      surface: "phone",
      deviceAvailable: true,
      environmentAvailable: true,
      deviceSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environmentSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      capabilities: capabilities(),
    });

    expect(feature(sections, "chat.sidebarPosition")).toBeUndefined();
    expect(feature(sections, "agent.fetch")?.availability).toEqual({ state: "available" });
  });

  it("honors clean versus migrated defaults and blocks dependent controls reversibly", () => {
    const clean = buildMobileBetterT3Sections({
      registry: BETTER_T3_FEATURE_REGISTRY,
      surface: "phone",
      deviceAvailable: true,
      environmentAvailable: true,
      deviceSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environmentSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      capabilities: capabilities({ knowledgeGraphVersion: 1 }),
    });
    const migrated = buildMobileBetterT3Sections({
      registry: BETTER_T3_FEATURE_REGISTRY,
      surface: "phone",
      deviceAvailable: true,
      environmentAvailable: true,
      deviceSettings: DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
      environmentSettings: DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
      capabilities: capabilities({ knowledgeGraphVersion: 1 }),
    });

    expect(feature(clean, "chat.characterStreamingMotion")).toBeUndefined();
    expect(feature(migrated, "chat.characterStreamingMotion")).toBeUndefined();
    expect(feature(clean, "voice.assemblyAi")?.value).toBe(false);
    expect(feature(migrated, "voice.assemblyAi")?.value).toBe(true);
    expect(feature(clean, "knowledge.model")?.availability.state).toBe("blocked");

    const enabled = buildMobileBetterT3Sections({
      registry: BETTER_T3_FEATURE_REGISTRY,
      surface: "phone",
      deviceAvailable: true,
      environmentAvailable: true,
      deviceSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environmentSettings: {
        ...DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
        flags: { "knowledge.graph": true },
      },
      capabilities: capabilities({ knowledgeGraphVersion: 1 }),
    });
    expect(feature(enabled, "knowledge.model")?.availability).toEqual({ state: "available" });
  });

  it("marks version-gated controls unsupported on mixed-version environments", () => {
    const legacy = buildMobileBetterT3Sections({
      registry: BETTER_T3_FEATURE_REGISTRY,
      surface: "tablet",
      deviceAvailable: true,
      environmentAvailable: true,
      deviceSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environmentSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      capabilities: capabilities(),
    });
    const current = buildMobileBetterT3Sections({
      registry: BETTER_T3_FEATURE_REGISTRY,
      surface: "tablet",
      deviceAvailable: true,
      environmentAvailable: true,
      deviceSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environmentSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      capabilities: capabilities({ knowledgeGraphVersion: 1 }),
    });

    expect(feature(legacy, "knowledge.graph")?.availability.state).toBe("unsupported");
    expect(feature(current, "knowledge.graph")?.availability.state).toBe("available");
  });

  it("keeps device controls available while disabling environment controls without a target", () => {
    const sections = buildMobileBetterT3Sections({
      registry: BETTER_T3_FEATURE_REGISTRY,
      surface: "phone",
      deviceAvailable: true,
      environmentAvailable: false,
      deviceSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environmentSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      capabilities: capabilities({ knowledgeGraphVersion: 1 }),
    });

    expect(feature(sections, "agent.fetch")?.availability).toEqual({ state: "available" });
    expect(feature(sections, "knowledge.graph")?.availability).toEqual({
      state: "unavailable",
      reasonMessageId: "settings.betterT3.noEnvironment",
    });
    expect(feature(sections, "chat.presentation")?.availability.state).toBe("unavailable");
    expect(feature(sections, "workspace.checkpoints")?.availability.state).toBe("unavailable");
  });

  it("blocks device switches until persisted preferences finish loading", () => {
    const sections = buildMobileBetterT3Sections({
      registry: BETTER_T3_FEATURE_REGISTRY,
      surface: "phone",
      deviceAvailable: false,
      environmentAvailable: true,
      deviceSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environmentSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      capabilities: capabilities({ knowledgeGraphVersion: 1 }),
    });

    expect(feature(sections, "agent.fetch")?.availability).toEqual({
      state: "unavailable",
      reasonMessageId: "settings.betterT3.deviceLoading",
    });
    expect(feature(sections, "knowledge.graph")?.availability).toEqual({ state: "available" });
  });

  it("persists feature flags with compatibility mirrors without discarding other values", () => {
    expect(
      createMobileBetterT3DevicePreferencePatch({
        settings: {
          ...DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
          flags: { "chat.characterStreamingMotion": true },
        },
        featureId: "agent.fetch",
        enabled: true,
      }),
    ).toEqual({
      betterT3Device: {
        ...DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
        flags: { "chat.characterStreamingMotion": true, "agent.fetch": true },
      },
      experimentalFetch: true,
    });

    expect(
      createMobileBetterT3EnvironmentPatch({
        settings: {
          ...DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
          flags: { "resource.adaptiveAdmission": true },
        },
        featureId: "resource.processSuspension",
        enabled: false,
      }),
    ).toEqual({
      betterT3Environment: {
        flags: {
          "resource.adaptiveAdmission": true,
          "resource.processSuspension": false,
        },
      },
    });

    const disabledGit = createMobileBetterT3DevicePreferencePatch({
      settings: {
        ...DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
        flags: {
          ...DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1.flags,
          "chat.classicSidebar": true,
        },
      },
      featureId: "workspace.gitWorkbench",
      enabled: false,
    });
    const reenabledGit = createMobileBetterT3DevicePreferencePatch({
      settings: disabledGit.betterT3Device,
      featureId: "workspace.gitWorkbench",
      enabled: true,
    });
    expect(disabledGit.betterT3Device.flags["chat.classicSidebar"]).toBe(true);
    expect(disabledGit.betterT3Device.flags["workspace.gitWorkbench"]).toBe(false);
    expect(reenabledGit.betterT3Device.flags["chat.classicSidebar"]).toBe(true);
    expect(reenabledGit.betterT3Device.flags["workspace.gitWorkbench"]).toBe(true);
  });

  it("gives every visible non-switch control a real direct control, destination, or status path", () => {
    const sections = buildMobileBetterT3Sections({
      registry: BETTER_T3_FEATURE_REGISTRY,
      surface: "phone",
      deviceAvailable: true,
      environmentAvailable: true,
      deviceSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environmentSettings: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      capabilities: capabilities({
        agentWorkflowVersion: 1,
        harnessChatSyncVersion: 1,
        knowledgeGraphVersion: 1,
        mcpWorkspaceVersion: 1,
        projectSettingsVersion: 1,
      }),
    });
    const direct = new Set<BetterT3FeatureId>(MOBILE_BETTER_T3_DIRECT_CONTROL_IDS);

    expect(direct.has("agent.autoReasoningModel")).toBe(true);

    for (const control of sections.flatMap((section) => section.controls)) {
      if (control.controlKind === "switch") continue;
      if (control.controlKind === "status-only") {
        expect(resolveMobileBetterT3Destination(control.id)).toBeNull();
        continue;
      }
      expect(direct.has(control.id) || resolveMobileBetterT3Destination(control.id) !== null).toBe(
        true,
      );
    }
  });

  it("routes portability and diagnostics to their real native owners", () => {
    expect(resolveMobileBetterT3Destination("workspace.gitWorkbench")).toBe("GitOverview");
    expect(resolveMobileBetterT3Destination("workspace.chatPortability")).toBe("SettingsProjects");
    expect(resolveMobileBetterT3Destination("voice.transcriptPortability")).toBe(
      "SettingsBetterT3TranscriptPortability",
    );
    expect(resolveMobileBetterT3Destination("resource.diagnostics")).toBe(
      "SettingsBetterT3ResourceDiagnostics",
    );
    expect(resolveMobileBetterT3Destination("workspace.checkpoints")).toBe("SettingsProjects");
    expect(resolveMobileBetterT3Destination("integration.mcp")).toBe("SettingsAgents");
    expect(resolveMobileBetterT3Destination("integration.skills")).toBe("SettingsAgents");
    expect(
      BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "resource.diagnostics")?.availability,
    ).toEqual({
      surfaces: ["web", "desktop", "phone", "tablet"],
      capabilities: [{ name: "resourceDiagnosticsVersion", minimumVersion: 1 }],
    });
  });

  it("uses real integration states instead of generic availability labels", () => {
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.remoteReadiness",
        status: prepareRemoteReadinessStatus({
          connectionPhase: "connected",
          repositoryIdentity: true,
        }),
      }),
    ).toBe("settings.betterT3.status.remoteReady");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.remoteReadiness",
        status: prepareRemoteReadinessStatus({
          connectionPhase: "connected",
          repositoryIdentity: false,
        }),
      }),
    ).toBe("settings.betterT3.status.lifecycleAttention");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.analyticsRemoval",
        status: BETTER_T3_ANALYTICS_BUILD_STATUS,
      }),
    ).toBe("settings.betterT3.status.analyticsRemoved");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.lifecycleHealth",
        status: prepareLifecycleStatus({ connectionPhase: "connected", receipt: "welcome" }),
      }),
    ).toBe("settings.betterT3.status.lifecycleHealthy");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.lifecycleHealth",
        status: prepareLifecycleStatus({ connectionPhase: "reconnecting", receipt: null }),
      }),
    ).toBe("settings.betterT3.status.lifecycleReconnecting");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.lifecycleHealth",
        status: prepareLifecycleStatus({ connectionPhase: "error", receipt: "ready" }),
      }),
    ).toBe("settings.betterT3.status.lifecycleAttention");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.remoteReadiness",
        status: prepareRemoteReadinessStatus({
          connectionPhase: "offline",
          repositoryIdentity: true,
        }),
      }),
    ).toBe("settings.betterT3.availability.unavailable");
  });

  it("reports MCP, skills, and mixed-version compatibility explicitly", () => {
    const current = capabilities({
      environmentSettingsVersion: 1,
      projectSettingsVersion: 1,
      harnessChatSyncVersion: 1,
      knowledgeGraphVersion: 1,
      gitWorkbenchVersion: 1,
      resourceProtectionVersion: 1,
      resourceDiagnosticsVersion: 1,
      mcpWorkspaceVersion: 1,
    });
    const mcp = prepareMcpStatus({
      capability: "supported",
      configuredCount: 0,
      runtimeServers: [],
    });
    expect(
      mobileBetterT3PreparedStatusMessageKey({ featureId: "integration.mcp", status: mcp }),
    ).toBe("settings.betterT3.status.supported");
    expect(
      mobileBetterT3PreparedStatusDetail({ featureId: "integration.mcp", status: mcp }),
    ).toEqual({
      kind: "mcp-runtime",
      configuredCount: 0,
      runtimeCount: 0,
      connectedCount: 0,
      attentionCount: 0,
      authRequiredCount: 0,
    });
    const skills = prepareSkillsStatus({
      capability: "supported",
      advertisedSkills: [{ name: "solid", path: "/solid", enabled: true }],
      loadedSkills: [],
    });
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.skills",
        status: skills,
      }),
    ).toBe("settings.betterT3.status.supported");
    expect(
      mobileBetterT3PreparedStatusDetail({ featureId: "integration.skills", status: skills }),
    ).toEqual({ kind: "skills-loaded", enabledCount: 0, totalCount: 0 });
    const currentCompatibility = prepareCompatibilityStatus({
      surface: "phone",
      capabilities: current,
      registry: BETTER_T3_FEATURE_REGISTRY,
    });
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.compatibility",
        status: currentCompatibility,
      }),
    ).toBe("settings.betterT3.status.compatibilityCurrent");
    expect(
      mobileBetterT3PreparedStatusDetail({
        featureId: "integration.compatibility",
        status: currentCompatibility,
      }),
    ).toEqual({
      kind: "compatibility",
      supportedCount: currentCompatibility.supportedFeatureCount,
      totalCount: currentCompatibility.totalFeatureCount,
    });
    const limitedCompatibility = prepareCompatibilityStatus({
      surface: "phone",
      capabilities: { ...current, knowledgeGraphVersion: undefined },
      registry: BETTER_T3_FEATURE_REGISTRY,
    });
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.compatibility",
        status: limitedCompatibility,
      }),
    ).toBe("settings.betterT3.status.compatibilityLimited");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.mcp",
        status: prepareMcpStatus({
          capability: "unsupported",
          configuredCount: null,
          runtimeServers: null,
        }),
      }),
    ).toBe("settings.betterT3.status.unsupported");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "integration.compatibility",
        status: prepareCompatibilityStatus({
          surface: "phone",
          capabilities: null,
          registry: BETTER_T3_FEATURE_REGISTRY,
        }),
      }),
    ).toBe("settings.betterT3.status.unknown");
  });

  it("reports checkpoint state or the exact project requirement", () => {
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "workspace.checkpoints",
        status: prepareCheckpointStatus({ capability: "unknown", project: null }),
      }),
    ).toBe("settings.betterT3.status.unknown");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "workspace.checkpoints",
        status: prepareCheckpointStatus({ capability: "unsupported", project: null }),
      }),
    ).toBe("settings.betterT3.status.unsupported");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "workspace.checkpoints",
        status: prepareCheckpointStatus({ capability: "supported", project: null }),
      }),
    ).toBe("settings.betterT3.status.projectRequired");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "workspace.checkpoints",
        status: prepareCheckpointStatus({
          capability: "supported",
          project: { projectId: "project", checkpointsEnabled: true },
        }),
      }),
    ).toBe("settings.betterT3.control.statusEnabled");
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "workspace.checkpoints",
        status: prepareCheckpointStatus({
          capability: "supported",
          project: { projectId: "project", checkpointsEnabled: false },
        }),
      }),
    ).toBe("settings.betterT3.control.statusDisabled");
  });

  it("reports Knowledge Graph progress without subscribing before its prerequisites exist", () => {
    const base = {
      environmentAvailable: true,
      knowledgeGraphVersion: 1,
      enabled: true,
      projectAvailable: true,
      error: false,
      snapshot: null,
    } as const;
    expect(shouldSubscribeMobileKnowledgeGraphProgress(base)).toBe(true);
    expect(
      shouldSubscribeMobileKnowledgeGraphProgress({ ...base, environmentAvailable: false }),
    ).toBe(false);
    expect(
      shouldSubscribeMobileKnowledgeGraphProgress({
        ...base,
        knowledgeGraphVersion: undefined,
      }),
    ).toBe(false);
    expect(shouldSubscribeMobileKnowledgeGraphProgress({ ...base, enabled: false })).toBe(false);
    expect(shouldSubscribeMobileKnowledgeGraphProgress({ ...base, projectAvailable: false })).toBe(
      false,
    );
    expect(
      prepareKnowledgeGraphStatus({ capability: "unknown", project: null, status: null }).state,
    ).toBe("unknown");
    expect(
      prepareKnowledgeGraphStatus({ capability: "unsupported", project: null, status: null }).state,
    ).toBe("unsupported");
    expect(
      prepareKnowledgeGraphStatus({ capability: "supported", project: null, status: null }).state,
    ).toBe("project-required");
    expect(
      prepareKnowledgeGraphStatus({
        capability: "supported",
        project: { projectId: "project" },
        status: null,
      }).state,
    ).toBe("unknown");
    expect(
      prepareKnowledgeGraphStatus({
        capability: "supported",
        project: { projectId: "project" },
        status: graphStatus("disabled"),
      }).state,
    ).toBe("disabled");
    expect(
      prepareKnowledgeGraphStatus({
        capability: "supported",
        project: { projectId: "project" },
        status: graphStatus("ready"),
      }),
    ).toMatchObject({ state: "ready", graphState: "ready", nodeCount: 42 });
    const readyGraph = prepareKnowledgeGraphStatus({
      capability: "supported",
      project: { projectId: "project" },
      status: graphStatus("ready"),
    });
    expect(
      mobileBetterT3PreparedStatusMessageKey({
        featureId: "knowledge.progress",
        status: readyGraph,
      }),
    ).toBe("knowledgeGraph.status.ready");
    expect(
      mobileBetterT3PreparedStatusDetail({
        featureId: "knowledge.progress",
        status: readyGraph,
      }),
    ).toEqual({
      kind: "knowledge-graph",
      nodeCount: 42,
      processedFileCount: null,
      totalFileCount: null,
      queuedSemanticNodeCount: null,
    });
  });

  it("builds effective device patches for native sorting and settling controls", () => {
    expect(
      createMobileBetterT3DeviceControlPatch({
        id: "chat.sorting.projects",
        value: "created_at",
      }),
    ).toEqual({ sidebarProjectSortOrder: "created_at" });
    expect(
      createMobileBetterT3DeviceControlPatch({
        id: "chat.sorting.threads",
        value: "updated_at",
      }),
    ).toEqual({ sidebarThreadSortOrder: "updated_at" });
    expect(
      createMobileBetterT3DeviceControlPatch({ id: "chat.settling.days", value: null }),
    ).toEqual({ sidebarAutoSettleAfterDays: null });
    expect(
      createMobileBetterT3DeviceControlPatch({ id: "chat.settling.onMerge", value: false }),
    ).toEqual({ sidebarAutoSettleOnMerge: false, autoSettleOnMerge: false });
  });

  it("builds exact Caveman, Auto reasoning, and Knowledge Graph model server patches", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("openai"),
      model: "gpt-5.5",
    };
    expect(
      createMobileBetterT3EnvironmentControlPatch({
        id: "agent.cavemanMode",
        value: "ultra",
      }),
    ).toEqual({ agentEnhancement: { cavemanMode: "ultra" } });
    expect(
      createMobileBetterT3EnvironmentControlPatch({ id: "knowledge.model", value: selection }),
    ).toEqual({ knowledgeGraphModelSelection: selection });
    expect(
      createMobileBetterT3EnvironmentControlPatch({ id: "knowledge.model", value: null }),
    ).toEqual({ knowledgeGraphModelSelection: null });
    expect(
      createMobileBetterT3EnvironmentControlPatch({
        id: "agent.autoReasoningModel",
        value: selection,
      }),
    ).toEqual({ autoReasoningModelSelection: selection });
    expect(
      createMobileBetterT3EnvironmentControlPatch({
        id: "agent.autoReasoningModel",
        value: null,
      }),
    ).toEqual({ autoReasoningModelSelection: null });
  });

  it("offers only selectable OpenAI models for Knowledge Graph enrichment", () => {
    expect(
      supportsMobileKnowledgeGraphModelOption({ providerDriver: "openai", isSelectable: true }),
    ).toBe(true);
    expect(
      supportsMobileKnowledgeGraphModelOption({ providerDriver: "openai", isSelectable: false }),
    ).toBe(false);
    expect(
      supportsMobileKnowledgeGraphModelOption({
        providerDriver: "openrouter",
        isSelectable: true,
      }),
    ).toBe(false);
  });

  it("requires an explicit transcript choice from the selected environment", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const options = buildMobileTranscriptPortabilityOptions(
      [
        {
          environmentId,
          id: ThreadId.make("older"),
          title: "Older",
          updatedAt: "2026-08-01T00:00:00.000Z",
          archivedAt: null,
        },
        {
          environmentId,
          id: ThreadId.make("newer"),
          title: "Newer",
          updatedAt: "2026-08-02T00:00:00.000Z",
          archivedAt: null,
        },
        {
          environmentId: EnvironmentId.make("other"),
          id: ThreadId.make("other"),
          title: "Other",
          updatedAt: "2026-08-03T00:00:00.000Z",
          archivedAt: null,
        },
        {
          environmentId,
          id: ThreadId.make("archived"),
          title: "Archived",
          updatedAt: "2026-08-04T00:00:00.000Z",
          archivedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
      environmentId,
    );

    expect(options.map(({ threadId }) => threadId)).toEqual(["newer", "older"]);
    expect(options.every(({ selected }) => selected === false)).toBe(true);
  });

  it("formats bounded resource-protection memory values", () => {
    expect(formatMobileResourceBytes(0)).toBe("0 B");
    expect(formatMobileResourceBytes(1_536)).toBe("1.5 KiB");
    expect(formatMobileResourceBytes(1_610_612_736)).toBe("1.5 GiB");
  });

  it("keeps diagnostics and transcript routes inert without their exact capabilities", () => {
    for (const version of [undefined, 0]) {
      expect(supportsMobileResourceDiagnostics(version)).toBe(false);
      expect(supportsMobileTranscriptPortability(version)).toBe(false);
    }
    expect(supportsMobileResourceDiagnostics(1)).toBe(true);
    expect(supportsMobileTranscriptPortability(1)).toBe(true);
  });
});
