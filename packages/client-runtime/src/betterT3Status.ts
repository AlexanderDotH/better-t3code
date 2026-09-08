import type {
  BetterT3FeatureDescriptor,
  BetterT3FeatureId,
  BetterT3Surface,
  ExecutionEnvironmentCapabilities,
  KnowledgeGraphStatusV1,
  McpRuntimeServer,
  ServerProviderSkill,
  SkillDescriptor,
} from "@t3tools/contracts";

import type { EnvironmentConnectionPhase } from "./connection/presentation.ts";

export type BetterT3PreparedStatusState =
  | "ready"
  | "degraded"
  | "disabled"
  | "unavailable"
  | "unsupported"
  | "unknown"
  | "project-required";

export type BetterT3CapabilitySupport = "supported" | "unsupported" | "unknown";

interface PreparedStatusBase {
  readonly state: BetterT3PreparedStatusState;
}

function unavailableConnectionState(
  connectionPhase: EnvironmentConnectionPhase,
): "unavailable" | "unknown" | null {
  switch (connectionPhase) {
    case "connected":
      return null;
    case "connecting":
    case "reconnecting":
      return "unknown";
    case "available":
    case "offline":
    case "error":
      return "unavailable";
  }
}

export interface BetterT3RemoteReadinessStatus extends PreparedStatusBase {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly repositoryIdentity: boolean | null;
}

export function prepareRemoteReadinessStatus(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly repositoryIdentity: boolean | null;
}): BetterT3RemoteReadinessStatus {
  const disconnectedState = unavailableConnectionState(input.connectionPhase);
  if (disconnectedState !== null) return { state: disconnectedState, ...input };
  if (input.repositoryIdentity === null) return { state: "unknown", ...input };
  return { state: input.repositoryIdentity ? "ready" : "degraded", ...input };
}

export type BetterT3LifecycleReceipt = "welcome" | "ready";

export interface BetterT3LifecycleStatus extends PreparedStatusBase {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly receipt: BetterT3LifecycleReceipt | null;
}

export function prepareLifecycleStatus(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly receipt: BetterT3LifecycleReceipt | null;
}): BetterT3LifecycleStatus {
  const disconnectedState = unavailableConnectionState(input.connectionPhase);
  if (disconnectedState !== null) return { state: disconnectedState, ...input };
  return { state: input.receipt === null ? "unknown" : "ready", ...input };
}

type CapabilityValues = Readonly<Record<string, unknown>>;

export function resolveBetterT3CapabilitySupport(
  capabilities: CapabilityValues | null,
  name: string,
  minimumVersion?: number,
): BetterT3CapabilitySupport {
  if (capabilities === null) return "unknown";
  const value = capabilities[name];
  if (minimumVersion !== undefined) {
    return typeof value === "number" && value >= minimumVersion ? "supported" : "unsupported";
  }
  return value === true || typeof value === "number" ? "supported" : "unsupported";
}

export interface BetterT3CompatibilityStatus extends PreparedStatusBase {
  readonly supportedFeatureCount: number;
  readonly totalFeatureCount: number;
  readonly unsupportedFeatureIds: ReadonlyArray<BetterT3FeatureId>;
  readonly missingCapabilities: ReadonlyArray<string>;
}

export function prepareCompatibilityStatus(input: {
  readonly surface: BetterT3Surface;
  readonly capabilities: CapabilityValues | null;
  readonly registry: ReadonlyArray<BetterT3FeatureDescriptor>;
}): BetterT3CompatibilityStatus {
  const applicable = input.registry.filter((descriptor) =>
    descriptor.availability.surfaces.includes(input.surface),
  );
  if (input.capabilities === null) {
    return {
      state: "unknown",
      supportedFeatureCount: 0,
      totalFeatureCount: applicable.length,
      unsupportedFeatureIds: [],
      missingCapabilities: [],
    };
  }

  const unsupportedFeatureIds: BetterT3FeatureId[] = [];
  const missingCapabilities = new Set<string>();
  for (const descriptor of applicable) {
    const unsupportedRequirements = descriptor.availability.capabilities.filter(
      (requirement) =>
        resolveBetterT3CapabilitySupport(
          input.capabilities,
          requirement.name,
          requirement.minimumVersion,
        ) !== "supported",
    );
    if (unsupportedRequirements.length === 0) continue;
    unsupportedFeatureIds.push(descriptor.id);
    for (const requirement of unsupportedRequirements) missingCapabilities.add(requirement.name);
  }

  return {
    state: unsupportedFeatureIds.length === 0 ? "ready" : "degraded",
    supportedFeatureCount: applicable.length - unsupportedFeatureIds.length,
    totalFeatureCount: applicable.length,
    unsupportedFeatureIds,
    missingCapabilities: [...missingCapabilities].sort(),
  };
}

export interface BetterT3McpStatus extends PreparedStatusBase {
  readonly configuredCount: number | null;
  readonly runtimeCount: number | null;
  readonly connectedCount: number | null;
  readonly authRequiredCount: number | null;
  readonly attentionCount: number | null;
  readonly pendingCount: number | null;
  readonly disabledCount: number | null;
  readonly builtInCount: number | null;
}

const MCP_ATTENTION_STATES = new Set<McpRuntimeServer["state"]>([
  "auth-required",
  "setup-required",
  "failed",
  "unsupported",
  "stale",
]);
const MCP_PENDING_STATES = new Set<McpRuntimeServer["state"]>([
  "not-started",
  "starting",
  "unknown",
]);

export function prepareMcpStatus(input: {
  readonly capability: BetterT3CapabilitySupport;
  readonly configuredCount: number | null;
  readonly runtimeServers: ReadonlyArray<McpRuntimeServer> | null;
}): BetterT3McpStatus {
  const emptyCounts = {
    configuredCount: input.configuredCount,
    runtimeCount: null,
    connectedCount: null,
    authRequiredCount: null,
    attentionCount: null,
    pendingCount: null,
    disabledCount: null,
    builtInCount: null,
  } as const;
  if (input.capability !== "supported") return { state: input.capability, ...emptyCounts };
  if (input.configuredCount === null || input.runtimeServers === null) {
    return { state: "unknown", ...emptyCounts };
  }

  const authRequiredCount = input.runtimeServers.filter(
    (server) => server.authState === "required" || server.state === "auth-required",
  ).length;
  const attentionCount = input.runtimeServers.filter(
    (server) =>
      MCP_ATTENTION_STATES.has(server.state) ||
      server.authState === "required" ||
      server.configDrift !== "none" ||
      server.issue !== undefined,
  ).length;
  const pendingCount = input.runtimeServers.filter((server) =>
    MCP_PENDING_STATES.has(server.state),
  ).length;

  return {
    state: attentionCount > 0 ? "degraded" : pendingCount > 0 ? "unknown" : "ready",
    configuredCount: input.configuredCount,
    runtimeCount: input.runtimeServers.length,
    connectedCount: input.runtimeServers.filter((server) => server.state === "connected").length,
    authRequiredCount,
    attentionCount,
    pendingCount,
    disabledCount: input.runtimeServers.filter((server) => server.state === "disabled").length,
    builtInCount: input.runtimeServers.filter((server) => server.source === "t3-built-in").length,
  };
}

export interface BetterT3SkillsStatus extends PreparedStatusBase {
  readonly advertisedCount: number | null;
  readonly advertisedEnabledCount: number | null;
  readonly loadedCount: number | null;
  readonly loadedEnabledCount: number | null;
}

export function prepareSkillsStatus(input: {
  readonly capability: BetterT3CapabilitySupport;
  readonly advertisedSkills: ReadonlyArray<ServerProviderSkill> | null;
  readonly loadedSkills: ReadonlyArray<SkillDescriptor> | null;
}): BetterT3SkillsStatus {
  const counts = {
    advertisedCount: input.advertisedSkills?.length ?? null,
    advertisedEnabledCount: input.advertisedSkills?.filter((skill) => skill.enabled).length ?? null,
    loadedCount: input.loadedSkills?.length ?? null,
    loadedEnabledCount: input.loadedSkills?.filter((skill) => skill.enabled).length ?? null,
  };
  if (input.capability !== "supported") return { state: input.capability, ...counts };
  if (input.advertisedSkills === null || input.loadedSkills === null) {
    return { state: "unknown", ...counts };
  }
  return { state: "ready", ...counts };
}

export interface BetterT3StatusProject {
  readonly projectId: string;
  readonly checkpointsEnabled: boolean | null;
}

export interface BetterT3CheckpointStatus extends PreparedStatusBase {
  readonly projectId: string | null;
  readonly checkpointsEnabled: boolean | null;
}

export function prepareCheckpointStatus(input: {
  readonly capability: BetterT3CapabilitySupport;
  readonly project: BetterT3StatusProject | null;
}): BetterT3CheckpointStatus {
  if (input.capability !== "supported") {
    return {
      state: input.capability,
      projectId: input.project?.projectId ?? null,
      checkpointsEnabled: null,
    };
  }
  if (input.project === null) {
    return { state: "project-required", projectId: null, checkpointsEnabled: null };
  }
  if (input.project.checkpointsEnabled === null) {
    return { state: "unknown", ...input.project };
  }
  return {
    state: input.project.checkpointsEnabled ? "ready" : "disabled",
    ...input.project,
  };
}

export interface BetterT3KnowledgeGraphProject {
  readonly projectId: string;
}

export interface BetterT3KnowledgeGraphStatus extends PreparedStatusBase {
  readonly projectId: string | null;
  readonly graphState: KnowledgeGraphStatusV1["state"] | null;
  readonly revision: number | null;
  readonly indexedFileCount: number | null;
  readonly nodeCount: number | null;
  readonly edgeCount: number | null;
  readonly evidenceCount: number | null;
  readonly semanticQueueDepth: number | null;
  readonly progress: KnowledgeGraphStatusV1["progress"] | null;
  readonly retryAt: number | null;
  readonly errorMessage: string | null;
  readonly truncated: boolean | null;
}

export function prepareKnowledgeGraphStatus(input: {
  readonly capability: BetterT3CapabilitySupport;
  readonly project: BetterT3KnowledgeGraphProject | null;
  readonly status: KnowledgeGraphStatusV1 | null;
}): BetterT3KnowledgeGraphStatus {
  const empty = {
    projectId: input.project?.projectId ?? null,
    graphState: null,
    revision: null,
    indexedFileCount: null,
    nodeCount: null,
    edgeCount: null,
    evidenceCount: null,
    semanticQueueDepth: null,
    progress: null,
    retryAt: null,
    errorMessage: null,
    truncated: null,
  } as const;
  if (input.capability !== "supported") return { state: input.capability, ...empty };
  if (input.project === null) return { state: "project-required", ...empty };
  if (input.status === null) return { state: "unknown", ...empty };

  const statusState: BetterT3PreparedStatusState =
    input.status.state === "disabled"
      ? "disabled"
      : input.status.state === "error" || input.status.state === "rate-limited"
        ? "degraded"
        : "ready";
  return {
    state: statusState,
    projectId: input.project.projectId,
    graphState: input.status.state,
    revision: input.status.revision,
    indexedFileCount: input.status.indexedFileCount,
    nodeCount: input.status.nodeCount,
    edgeCount: input.status.edgeCount,
    evidenceCount: input.status.evidenceCount,
    semanticQueueDepth: input.status.semanticQueueDepth,
    progress: input.status.progress ?? null,
    retryAt: input.status.retryAt ?? null,
    errorMessage: input.status.errorMessage ?? null,
    truncated:
      input.status.truncated.eligibleFiles ||
      input.status.truncated.nodes ||
      input.status.truncated.visibleNodes,
  };
}

export const BETTER_T3_ANALYTICS_BUILD_STATUS = {
  state: "ready",
  outboundAnalytics: "removed",
  source: "client-build-policy",
} as const satisfies PreparedStatusBase & {
  readonly outboundAnalytics: "removed";
  readonly source: "client-build-policy";
};

export interface BetterT3PreparedStatusModel {
  readonly "workspace.checkpoints": BetterT3CheckpointStatus;
  readonly "knowledge.progress": BetterT3KnowledgeGraphStatus;
  readonly "integration.remoteReadiness": BetterT3RemoteReadinessStatus;
  readonly "integration.analyticsRemoval": typeof BETTER_T3_ANALYTICS_BUILD_STATUS;
  readonly "integration.lifecycleHealth": BetterT3LifecycleStatus;
  readonly "integration.mcp": BetterT3McpStatus;
  readonly "integration.skills": BetterT3SkillsStatus;
  readonly "integration.compatibility": BetterT3CompatibilityStatus;
}

export function prepareBetterT3StatusModel(input: {
  readonly surface: BetterT3Surface;
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly capabilities: ExecutionEnvironmentCapabilities | null;
  readonly lifecycleReceipt: BetterT3LifecycleReceipt | null;
  readonly registry: ReadonlyArray<BetterT3FeatureDescriptor>;
  readonly mcp: {
    readonly configuredCount: number | null;
    readonly runtimeServers: ReadonlyArray<McpRuntimeServer> | null;
  } | null;
  readonly skills: {
    readonly advertisedSkills: ReadonlyArray<ServerProviderSkill> | null;
    readonly loadedSkills: ReadonlyArray<SkillDescriptor> | null;
  } | null;
  readonly project: BetterT3StatusProject | null;
  readonly knowledgeGraphStatus: KnowledgeGraphStatusV1 | null;
}): BetterT3PreparedStatusModel {
  const capabilities = input.capabilities as CapabilityValues | null;
  return {
    "workspace.checkpoints": prepareCheckpointStatus({
      capability: resolveBetterT3CapabilitySupport(capabilities, "projectSettingsVersion", 1),
      project: input.project,
    }),
    "knowledge.progress": prepareKnowledgeGraphStatus({
      capability: resolveBetterT3CapabilitySupport(capabilities, "knowledgeGraphVersion", 1),
      project: input.project,
      status: input.knowledgeGraphStatus,
    }),
    "integration.remoteReadiness": prepareRemoteReadinessStatus({
      connectionPhase: input.connectionPhase,
      repositoryIdentity: input.capabilities?.repositoryIdentity ?? null,
    }),
    "integration.analyticsRemoval": BETTER_T3_ANALYTICS_BUILD_STATUS,
    "integration.lifecycleHealth": prepareLifecycleStatus({
      connectionPhase: input.connectionPhase,
      receipt: input.lifecycleReceipt,
    }),
    "integration.mcp": prepareMcpStatus({
      capability: resolveBetterT3CapabilitySupport(capabilities, "mcpWorkspaceVersion", 1),
      configuredCount: input.mcp?.configuredCount ?? null,
      runtimeServers: input.mcp?.runtimeServers ?? null,
    }),
    "integration.skills": prepareSkillsStatus({
      capability: resolveBetterT3CapabilitySupport(capabilities, "environmentSettingsVersion", 1),
      advertisedSkills: input.skills?.advertisedSkills ?? null,
      loadedSkills: input.skills?.loadedSkills ?? null,
    }),
    "integration.compatibility": prepareCompatibilityStatus({
      surface: input.surface,
      capabilities,
      registry: input.registry,
    }),
  };
}
