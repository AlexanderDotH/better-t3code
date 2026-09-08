import type {
  BetterT3FeatureDescriptor,
  KnowledgeGraphStatusV1,
  McpRuntimeServer,
  ServerProviderSkill,
  SkillDescriptor,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BETTER_T3_ANALYTICS_BUILD_STATUS,
  prepareBetterT3StatusModel,
  prepareCheckpointStatus,
  prepareCompatibilityStatus,
  prepareKnowledgeGraphStatus,
  prepareLifecycleStatus,
  prepareMcpStatus,
  prepareRemoteReadinessStatus,
  prepareSkillsStatus,
} from "./betterT3Status.ts";

const capabilityDescriptor = (
  id: BetterT3FeatureDescriptor["id"],
  capability: string,
  surfaces: BetterT3FeatureDescriptor["availability"]["surfaces"] = [
    "web",
    "desktop",
    "phone",
    "tablet",
  ],
): BetterT3FeatureDescriptor => ({
  id,
  section: "integration-status",
  scope: "environment",
  controlKind: "status-only",
  labelMessageId: `betterT3.${id}.label`,
  descriptionMessageId: `betterT3.${id}.description`,
  defaults: { clean: false, existing: false },
  dependencies: [],
  availability: {
    surfaces,
    capabilities: [{ name: capability, minimumVersion: 1 }],
  },
  compatibilityMirrors: [],
});

const runtimeServer = (
  state: McpRuntimeServer["state"],
  authState: McpRuntimeServer["authState"] = "none",
): McpRuntimeServer =>
  ({
    source: "t3-managed",
    state,
    authState,
    configDrift: "none",
  }) as McpRuntimeServer;

const graphStatus = (state: KnowledgeGraphStatusV1["state"]): KnowledgeGraphStatusV1 =>
  ({
    version: 1,
    scopeId: "scope:test",
    state,
    revision: 12,
    indexedFileCount: 40,
    nodeCount: 75,
    edgeCount: 91,
    evidenceCount: 120,
    semanticQueueDepth: 4,
    progress: {
      version: 1,
      phase: "semantic",
      discoveredFileCount: 50,
      processedFileCount: 40,
      totalFileCount: 50,
      queuedSemanticNodeCount: 4,
    },
    truncated: {
      eligibleFiles: false,
      nodes: false,
      visibleNodes: true,
      omittedFileCount: 0,
      omittedNodeCount: 25,
    },
  }) as KnowledgeGraphStatusV1;

describe("Better T3 prepared statuses", () => {
  it("does not call a disconnected or repository-limited environment remote-ready", () => {
    expect(
      prepareRemoteReadinessStatus({ connectionPhase: "offline", repositoryIdentity: true }),
    ).toEqual({ state: "unavailable", connectionPhase: "offline", repositoryIdentity: true });
    expect(
      prepareRemoteReadinessStatus({ connectionPhase: "connected", repositoryIdentity: false }),
    ).toEqual({ state: "degraded", connectionPhase: "connected", repositoryIdentity: false });
    expect(
      prepareRemoteReadinessStatus({ connectionPhase: "connected", repositoryIdentity: true }),
    ).toEqual({ state: "ready", connectionPhase: "connected", repositoryIdentity: true });
    expect(
      prepareRemoteReadinessStatus({ connectionPhase: "connected", repositoryIdentity: null }),
    ).toEqual({ state: "unknown", connectionPhase: "connected", repositoryIdentity: null });
  });

  it("reports only an observed lifecycle receipt as ready", () => {
    expect(prepareLifecycleStatus({ connectionPhase: "connected", receipt: null })).toEqual({
      state: "unknown",
      connectionPhase: "connected",
      receipt: null,
    });
    expect(prepareLifecycleStatus({ connectionPhase: "connected", receipt: "welcome" })).toEqual({
      state: "ready",
      connectionPhase: "connected",
      receipt: "welcome",
    });
    expect(prepareLifecycleStatus({ connectionPhase: "error", receipt: "ready" })).toEqual({
      state: "unavailable",
      connectionPhase: "error",
      receipt: "ready",
    });
  });

  it("evaluates compatibility from surface-specific capability requirements", () => {
    const registry = [
      capabilityDescriptor("integration.mcp", "mcpWorkspaceVersion"),
      capabilityDescriptor("knowledge.progress", "knowledgeGraphVersion"),
      capabilityDescriptor("chat.workspaceCardDeck", "gitWorkbenchVersion", ["web", "desktop"]),
    ];

    expect(prepareCompatibilityStatus({ surface: "phone", capabilities: null, registry })).toEqual({
      state: "unknown",
      supportedFeatureCount: 0,
      totalFeatureCount: 2,
      unsupportedFeatureIds: [],
      missingCapabilities: [],
    });
    expect(
      prepareCompatibilityStatus({
        surface: "phone",
        capabilities: { mcpWorkspaceVersion: 1 },
        registry,
      }),
    ).toEqual({
      state: "degraded",
      supportedFeatureCount: 1,
      totalFeatureCount: 2,
      unsupportedFeatureIds: ["knowledge.progress"],
      missingCapabilities: ["knowledgeGraphVersion"],
    });
  });

  it("prepares MCP counts without hiding auth, drift, or pending runtime state", () => {
    expect(
      prepareMcpStatus({
        capability: "supported",
        configuredCount: 2,
        runtimeServers: [runtimeServer("connected"), runtimeServer("auth-required", "required")],
      }),
    ).toMatchObject({
      state: "degraded",
      configuredCount: 2,
      runtimeCount: 2,
      connectedCount: 1,
      authRequiredCount: 1,
      attentionCount: 1,
      pendingCount: 0,
    });
    expect(
      prepareMcpStatus({
        capability: "supported",
        configuredCount: 1,
        runtimeServers: [runtimeServer("starting")],
      }).state,
    ).toBe("unknown");
    expect(
      prepareMcpStatus({
        capability: "unsupported",
        configuredCount: null,
        runtimeServers: null,
      }).state,
    ).toBe("unsupported");
  });

  it("keeps advertised and loaded skill counts separate", () => {
    const advertised = [
      { name: "solid", path: "/skills/solid", enabled: true },
    ] as ReadonlyArray<ServerProviderSkill>;
    const loaded = [
      {
        id: "solid",
        name: "solid",
        path: "/skills/solid",
        scope: "global",
        enabled: true,
        readOnly: false,
        providerSupport: [],
      },
      {
        id: "disabled",
        name: "disabled",
        path: "/skills/disabled",
        scope: "global",
        enabled: false,
        readOnly: false,
        providerSupport: [],
      },
    ] as ReadonlyArray<SkillDescriptor>;

    expect(
      prepareSkillsStatus({
        capability: "supported",
        advertisedSkills: advertised,
        loadedSkills: loaded,
      }),
    ).toEqual({
      state: "ready",
      advertisedCount: 1,
      advertisedEnabledCount: 1,
      loadedCount: 2,
      loadedEnabledCount: 1,
    });
    expect(
      prepareSkillsStatus({
        capability: "supported",
        advertisedSkills: advertised,
        loadedSkills: null,
      }).state,
    ).toBe("unknown");
  });

  it("distinguishes project-required, unknown, enabled, and disabled checkpoints", () => {
    expect(prepareCheckpointStatus({ capability: "supported", project: null }).state).toBe(
      "project-required",
    );
    expect(
      prepareCheckpointStatus({
        capability: "supported",
        project: { projectId: "project-1", checkpointsEnabled: null },
      }).state,
    ).toBe("unknown");
    expect(
      prepareCheckpointStatus({
        capability: "supported",
        project: { projectId: "project-1", checkpointsEnabled: true },
      }).state,
    ).toBe("ready");
    expect(
      prepareCheckpointStatus({
        capability: "supported",
        project: { projectId: "project-1", checkpointsEnabled: false },
      }).state,
    ).toBe("disabled");
  });

  it("preserves real Knowledge Graph progress and never invents availability", () => {
    expect(
      prepareKnowledgeGraphStatus({ capability: "supported", project: null, status: null }).state,
    ).toBe("project-required");
    expect(
      prepareKnowledgeGraphStatus({
        capability: "supported",
        project: { projectId: "project-1" },
        status: null,
      }).state,
    ).toBe("unknown");
    expect(
      prepareKnowledgeGraphStatus({
        capability: "supported",
        project: { projectId: "project-1" },
        status: graphStatus("semantic"),
      }),
    ).toMatchObject({
      state: "ready",
      graphState: "semantic",
      revision: 12,
      indexedFileCount: 40,
      semanticQueueDepth: 4,
      progress: { phase: "semantic", processedFileCount: 40, totalFileCount: 50 },
      truncated: true,
    });
    expect(
      prepareKnowledgeGraphStatus({
        capability: "supported",
        project: { projectId: "project-1" },
        status: graphStatus("error"),
      }).state,
    ).toBe("degraded");
  });

  it("marks analytics removal as a static build contract", () => {
    expect(BETTER_T3_ANALYTICS_BUILD_STATUS).toEqual({
      state: "ready",
      outboundAnalytics: "removed",
      source: "client-build-policy",
    });
  });

  it("builds all status-only and owning-page projections from the same inputs", () => {
    const model = prepareBetterT3StatusModel({
      surface: "web",
      connectionPhase: "connected",
      capabilities: {
        repositoryIdentity: true,
        midChatProviderSwitching: false,
        mcpWorkspaceVersion: 1,
        environmentSettingsVersion: 1,
        projectSettingsVersion: 1,
        knowledgeGraphVersion: 1,
      },
      lifecycleReceipt: "welcome",
      registry: [capabilityDescriptor("knowledge.progress", "knowledgeGraphVersion")],
      mcp: { configuredCount: 0, runtimeServers: [] },
      skills: { advertisedSkills: [], loadedSkills: [] },
      project: { projectId: "project-1", checkpointsEnabled: true },
      knowledgeGraphStatus: graphStatus("ready"),
    });

    expect(model["integration.remoteReadiness"].state).toBe("ready");
    expect(model["integration.lifecycleHealth"].receipt).toBe("welcome");
    expect(model["integration.mcp"].configuredCount).toBe(0);
    expect(model["integration.skills"].loadedCount).toBe(0);
    expect(model["integration.compatibility"].unsupportedFeatureIds).toEqual([]);
    expect(model["workspace.checkpoints"].state).toBe("ready");
    expect(model["knowledge.progress"].graphState).toBe("ready");
  });
});
