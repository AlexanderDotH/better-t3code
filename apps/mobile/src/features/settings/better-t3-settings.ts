import {
  resolveBetterT3FeatureFlag,
  type CavemanMode,
  type ModelSelection,
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
  type BetterT3FeatureAvailabilityState,
  type BetterT3FeatureControlKind,
  type BetterT3FeatureDescriptor,
  type BetterT3FeatureId,
  type BetterT3FeatureSection,
  type BetterT3SettingsV1,
  type BetterT3Surface,
  type BetterT3SwitchFeatureId,
  type EnvironmentId,
  type ExecutionEnvironmentCapabilities,
  type ProjectId,
  type ServerLifecycleWelcomePayload,
  type ServerSettingsPatch,
  type ThreadId,
} from "@t3tools/contracts";
import type { BetterT3PreparedStatusModel } from "@t3tools/client-runtime/better-t3-status";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { stripAutoReasoning } from "@t3tools/shared/model";
import { knowledgeGraphStatusMessageKey } from "../knowledge-graph/mobile-knowledge-graph";

export type MobilePreparedStatusInput = {
  [FeatureId in keyof BetterT3PreparedStatusModel]: {
    readonly featureId: FeatureId;
    readonly status: BetterT3PreparedStatusModel[FeatureId];
  };
}[keyof BetterT3PreparedStatusModel];

export function mobileBetterT3PreparedStatusInput(
  model: BetterT3PreparedStatusModel,
  featureId: BetterT3FeatureId,
): MobilePreparedStatusInput | null {
  switch (featureId) {
    case "workspace.checkpoints":
      return { featureId, status: model[featureId] };
    case "knowledge.progress":
      return { featureId, status: model[featureId] };
    case "integration.remoteReadiness":
      return { featureId, status: model[featureId] };
    case "integration.analyticsRemoval":
      return { featureId, status: model[featureId] };
    case "integration.lifecycleHealth":
      return { featureId, status: model[featureId] };
    case "integration.mcp":
      return { featureId, status: model[featureId] };
    case "integration.skills":
      return { featureId, status: model[featureId] };
    case "integration.compatibility":
      return { featureId, status: model[featureId] };
    default:
      return null;
  }
}

function unavailableStatusMessageKey(
  state: BetterT3PreparedStatusModel[keyof BetterT3PreparedStatusModel]["state"],
): InterfaceMessageKey {
  if (state === "unsupported") return "settings.betterT3.status.unsupported";
  if (state === "project-required") return "settings.betterT3.status.projectRequired";
  if (state === "disabled") return "settings.betterT3.control.statusDisabled";
  if (state === "degraded") return "settings.betterT3.status.lifecycleAttention";
  if (state === "unavailable") return "settings.betterT3.availability.unavailable";
  return "settings.betterT3.status.unknown";
}

export function mobileBetterT3PreparedStatusMessageKey(
  input: MobilePreparedStatusInput,
): InterfaceMessageKey {
  switch (input.featureId) {
    case "integration.remoteReadiness":
      return input.status.state === "ready"
        ? "settings.betterT3.status.remoteReady"
        : unavailableStatusMessageKey(input.status.state);
    case "integration.analyticsRemoval":
      return "settings.betterT3.status.analyticsRemoved";
    case "integration.lifecycleHealth":
      if (input.status.state === "ready") return "settings.betterT3.status.lifecycleHealthy";
      if (
        input.status.state === "unknown" &&
        (input.status.connectionPhase === "connecting" ||
          input.status.connectionPhase === "reconnecting")
      ) {
        return "settings.betterT3.status.lifecycleReconnecting";
      }
      return input.status.state === "unavailable" || input.status.state === "degraded"
        ? "settings.betterT3.status.lifecycleAttention"
        : unavailableStatusMessageKey(input.status.state);
    case "integration.mcp":
    case "integration.skills":
      return input.status.state === "ready"
        ? "settings.betterT3.status.supported"
        : unavailableStatusMessageKey(input.status.state);
    case "integration.compatibility":
      if (input.status.state === "ready") {
        return "settings.betterT3.status.compatibilityCurrent";
      }
      return input.status.state === "degraded"
        ? "settings.betterT3.status.compatibilityLimited"
        : unavailableStatusMessageKey(input.status.state);
    case "workspace.checkpoints":
      return input.status.state === "ready"
        ? "settings.betterT3.control.statusEnabled"
        : unavailableStatusMessageKey(input.status.state);
    case "knowledge.progress":
      return input.status.graphState === null
        ? unavailableStatusMessageKey(input.status.state)
        : knowledgeGraphStatusMessageKey(input.status.graphState);
  }
}

export type MobileBetterT3PreparedStatusDetail =
  | {
      readonly kind: "mcp-runtime";
      readonly configuredCount: number;
      readonly runtimeCount: number;
      readonly connectedCount: number;
      readonly attentionCount: number;
      readonly authRequiredCount: number;
    }
  | { readonly kind: "mcp-configured"; readonly configuredCount: number }
  | { readonly kind: "skills-loaded"; readonly enabledCount: number; readonly totalCount: number }
  | {
      readonly kind: "skills-advertised";
      readonly enabledCount: number;
      readonly totalCount: number;
    }
  | {
      readonly kind: "compatibility";
      readonly supportedCount: number;
      readonly totalCount: number;
    }
  | {
      readonly kind: "knowledge-graph";
      readonly nodeCount: number;
      readonly processedFileCount: number | null;
      readonly totalFileCount: number | null;
      readonly queuedSemanticNodeCount: number | null;
    };

export function mobileBetterT3PreparedStatusDetail(
  input: MobilePreparedStatusInput,
): MobileBetterT3PreparedStatusDetail | null {
  switch (input.featureId) {
    case "integration.mcp":
      if (input.status.runtimeCount !== null) {
        return {
          kind: "mcp-runtime",
          configuredCount: input.status.configuredCount ?? 0,
          runtimeCount: input.status.runtimeCount,
          connectedCount: input.status.connectedCount ?? 0,
          attentionCount: input.status.attentionCount ?? 0,
          authRequiredCount: input.status.authRequiredCount ?? 0,
        };
      }
      return input.status.configuredCount === null
        ? null
        : { kind: "mcp-configured", configuredCount: input.status.configuredCount };
    case "integration.skills":
      if (input.status.loadedCount !== null) {
        return {
          kind: "skills-loaded",
          enabledCount: input.status.loadedEnabledCount ?? 0,
          totalCount: input.status.loadedCount,
        };
      }
      return input.status.advertisedCount === null
        ? null
        : {
            kind: "skills-advertised",
            enabledCount: input.status.advertisedEnabledCount ?? 0,
            totalCount: input.status.advertisedCount,
          };
    case "integration.compatibility":
      return input.status.state === "ready" || input.status.state === "degraded"
        ? {
            kind: "compatibility",
            supportedCount: input.status.supportedFeatureCount,
            totalCount: input.status.totalFeatureCount,
          }
        : null;
    case "knowledge.progress":
      return input.status.graphState === null || input.status.nodeCount === null
        ? null
        : {
            kind: "knowledge-graph",
            nodeCount: input.status.nodeCount,
            processedFileCount: input.status.progress?.processedFileCount ?? null,
            totalFileCount: input.status.progress?.totalFileCount ?? null,
            queuedSemanticNodeCount: input.status.progress?.queuedSemanticNodeCount ?? null,
          };
    default:
      return null;
  }
}

export function shouldSubscribeMobileKnowledgeGraphProgress(input: {
  readonly environmentAvailable: boolean;
  readonly knowledgeGraphVersion: number | undefined;
  readonly enabled: boolean;
  readonly projectAvailable: boolean;
}): boolean {
  return (
    input.environmentAvailable &&
    (input.knowledgeGraphVersion ?? 0) >= 1 &&
    input.enabled &&
    input.projectAvailable
  );
}

export function resolveMobileBetterT3EnvironmentTarget(input: {
  readonly environmentId: EnvironmentId | null;
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly serverConfigAvailable: boolean;
}): EnvironmentId | null {
  if (input.environmentId === null) return null;
  if (input.connectionPhase !== "connected") return null;
  return input.serverConfigAvailable ? input.environmentId : null;
}

export type MobileBetterT3SettingsDestination =
  | "GitOverview"
  | "SettingsAgents"
  | "SettingsAppearance"
  | "SettingsBetterT3ResourceDiagnostics"
  | "SettingsBetterT3TranscriptPortability"
  | "SettingsEnvironments"
  | "SettingsProjects";

export const MOBILE_BETTER_T3_DIRECT_CONTROL_IDS = [
  "agent.autoReasoningModel",
  "agent.cavemanMode",
  "chat.sorting",
  "chat.settling",
  "knowledge.model",
] as const satisfies ReadonlyArray<BetterT3FeatureId>;

export function resolveMobileBetterT3Destination(
  featureId: BetterT3FeatureId,
): MobileBetterT3SettingsDestination | null {
  if (featureId === "workspace.gitWorkbench") return "GitOverview";
  if (featureId === "workspace.chatPortability") return "SettingsProjects";
  if (featureId === "voice.transcriptPortability") {
    return "SettingsBetterT3TranscriptPortability";
  }
  if (featureId === "resource.diagnostics") {
    return "SettingsBetterT3ResourceDiagnostics";
  }
  if (featureId === "knowledge.progress") return null;
  if (featureId.startsWith("chat.")) return "SettingsAppearance";
  if (featureId.startsWith("workspace.") || featureId.startsWith("knowledge.")) {
    return "SettingsProjects";
  }
  if (
    featureId === "integration.remoteReadiness" ||
    featureId === "integration.analyticsRemoval" ||
    featureId === "integration.lifecycleHealth" ||
    featureId === "integration.compatibility"
  ) {
    return null;
  }
  return "SettingsAgents";
}

type MobileBetterT3DeviceControlUpdate =
  | {
      readonly id: "chat.sorting.projects";
      readonly value: Exclude<SidebarProjectSortOrder, "manual">;
    }
  | { readonly id: "chat.sorting.threads"; readonly value: SidebarThreadSortOrder }
  | { readonly id: "chat.settling.days"; readonly value: number | null }
  | { readonly id: "chat.settling.onMerge"; readonly value: boolean };

export interface MobileBetterT3DeviceControlPatch {
  readonly sidebarProjectSortOrder?: Exclude<SidebarProjectSortOrder, "manual">;
  readonly sidebarThreadSortOrder?: SidebarThreadSortOrder;
  readonly sidebarAutoSettleAfterDays?: number | null;
  readonly sidebarAutoSettleOnMerge?: boolean;
  readonly autoSettleOnMerge?: boolean;
}

export function createMobileBetterT3DeviceControlPatch(
  update: MobileBetterT3DeviceControlUpdate,
): MobileBetterT3DeviceControlPatch {
  switch (update.id) {
    case "chat.sorting.projects":
      return { sidebarProjectSortOrder: update.value };
    case "chat.sorting.threads":
      return { sidebarThreadSortOrder: update.value };
    case "chat.settling.days":
      return { sidebarAutoSettleAfterDays: update.value };
    case "chat.settling.onMerge":
      return {
        sidebarAutoSettleOnMerge: update.value,
        autoSettleOnMerge: update.value,
      };
  }
}

type MobileBetterT3EnvironmentControlUpdate =
  | { readonly id: "agent.cavemanMode"; readonly value: CavemanMode }
  | { readonly id: "agent.autoReasoningModel"; readonly value: ModelSelection | null }
  | { readonly id: "knowledge.model"; readonly value: ModelSelection | null };

export function createMobileBetterT3EnvironmentControlPatch(
  update: MobileBetterT3EnvironmentControlUpdate,
): ServerSettingsPatch {
  switch (update.id) {
    case "agent.cavemanMode":
      return { agentEnhancement: { cavemanMode: update.value } };
    case "agent.autoReasoningModel":
      return {
        autoReasoningModelSelection:
          update.value === null ? null : stripAutoReasoning(update.value),
      };
    case "knowledge.model":
      return { knowledgeGraphModelSelection: update.value };
  }
}

const MOBILE_AUTO_REASONING_EVALUATION_DRIVER_KINDS: ReadonlySet<string> = new Set([
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

export function supportsMobileAutoReasoningModelOption(option: {
  readonly providerDriver: string;
  readonly isSelectable: boolean;
}): boolean {
  return (
    MOBILE_AUTO_REASONING_EVALUATION_DRIVER_KINDS.has(option.providerDriver) && option.isSelectable
  );
}

export function supportsMobileKnowledgeGraphModelOption(option: {
  readonly providerDriver: string;
  readonly isSelectable: boolean;
}): boolean {
  return option.providerDriver === "openai" && option.isSelectable;
}

export interface MobileTranscriptPortabilityThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export function buildMobileTranscriptPortabilityOptions(
  threads: ReadonlyArray<MobileTranscriptPortabilityThread>,
  environmentId: EnvironmentId,
): ReadonlyArray<{
  readonly threadId: ThreadId;
  readonly label: string;
  readonly selected: false;
}> {
  return threads
    .filter((thread) => thread.environmentId === environmentId && thread.archivedAt === null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((thread) => ({ threadId: thread.id, label: thread.title, selected: false as const }));
}

export function formatMobileResourceBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes / 1_024;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

export function supportsMobileResourceDiagnostics(version: number | undefined): boolean {
  return (version ?? 0) >= 1;
}

export function supportsMobileTranscriptPortability(version: number | undefined): boolean {
  return (version ?? 0) >= 1;
}

export function mobileLifecycleReceiptFromWelcome(
  welcome: ServerLifecycleWelcomePayload | null,
): "welcome" | null {
  return welcome === null ? null : "welcome";
}

export function resolveMobileBetterT3ProjectSelection<
  Project extends { readonly environmentId: EnvironmentId; readonly id: ProjectId },
>(
  projects: ReadonlyArray<Project>,
  environmentId: EnvironmentId | null,
  requestedProjectId: ProjectId | null,
): Project | null {
  if (environmentId === null || requestedProjectId === null) return null;
  return (
    projects.find(
      (project) => project.environmentId === environmentId && project.id === requestedProjectId,
    ) ?? null
  );
}

const MOBILE_SECTION_ORDER: ReadonlyArray<BetterT3FeatureSection> = [
  "agent-workflows",
  "chat-layout",
  "workspace-source-control",
  "voice-synchronization",
  "knowledge-automation",
  "resource-protection",
  "integration-status",
];

export interface MobileBetterT3Control {
  readonly id: BetterT3FeatureId;
  readonly descriptor: BetterT3FeatureDescriptor;
  readonly controlKind: BetterT3FeatureControlKind;
  readonly availability: BetterT3FeatureAvailabilityState;
  readonly value: boolean | null;
}

export interface MobileBetterT3Section {
  readonly id: BetterT3FeatureSection;
  readonly controls: ReadonlyArray<MobileBetterT3Control>;
}

export function mobileBetterT3SurfaceForWidth(
  width: number,
): Extract<BetterT3Surface, "phone" | "tablet"> {
  return width >= 768 ? "tablet" : "phone";
}

function capabilityMeetsRequirement(
  capabilities: ExecutionEnvironmentCapabilities,
  requirement: BetterT3FeatureDescriptor["availability"]["capabilities"][number],
): boolean {
  if (!Object.hasOwn(capabilities, requirement.name)) return false;
  const value = (capabilities as Readonly<Record<string, unknown>>)[requirement.name];
  if (requirement.minimumVersion === undefined) return value === true || typeof value === "number";
  return typeof value === "number" && value >= requirement.minimumVersion;
}

function switchValue(
  descriptor: BetterT3FeatureDescriptor,
  deviceSettings: BetterT3SettingsV1,
  environmentSettings: BetterT3SettingsV1,
): boolean | null {
  if (descriptor.controlKind !== "switch") return null;
  const settings = descriptor.scope === "device" ? deviceSettings : environmentSettings;
  return resolveBetterT3FeatureFlag(settings, descriptor.id as BetterT3SwitchFeatureId);
}

function dependencyAvailability(
  descriptor: BetterT3FeatureDescriptor,
  controlsById: ReadonlyMap<BetterT3FeatureId, MobileBetterT3Control>,
): BetterT3FeatureAvailabilityState | null {
  for (const dependency of descriptor.dependencies) {
    const control = controlsById.get(dependency.featureId);
    if (!control) {
      return { state: "blocked", reasonMessageId: "settings.betterT3.availability.blocked" };
    }
    const satisfied =
      dependency.condition === "available"
        ? control.availability.state === "available"
        : control.availability.state === "available" && control.value === true;
    if (!satisfied) {
      return { state: "blocked", reasonMessageId: "settings.betterT3.availability.blocked" };
    }
  }
  return null;
}

export function buildMobileBetterT3Sections(input: {
  readonly registry: ReadonlyArray<BetterT3FeatureDescriptor>;
  readonly surface: Extract<BetterT3Surface, "phone" | "tablet">;
  readonly deviceAvailable: boolean;
  readonly environmentAvailable: boolean;
  readonly deviceSettings: BetterT3SettingsV1;
  readonly environmentSettings: BetterT3SettingsV1;
  readonly capabilities: ExecutionEnvironmentCapabilities;
}): ReadonlyArray<MobileBetterT3Section> {
  const controlsById = new Map<BetterT3FeatureId, MobileBetterT3Control>();

  for (const descriptor of input.registry) {
    if (!descriptor.availability.surfaces.includes(input.surface)) continue;
    const value = switchValue(descriptor, input.deviceSettings, input.environmentSettings);
    const unsupported = descriptor.availability.capabilities.some(
      (requirement) => !capabilityMeetsRequirement(input.capabilities, requirement),
    );
    const dependency = dependencyAvailability(descriptor, controlsById);
    const requiresDevice = descriptor.scope === "device";
    const requiresEnvironment = descriptor.scope !== "device";
    const availability: BetterT3FeatureAvailabilityState =
      requiresDevice && !input.deviceAvailable
        ? { state: "unavailable", reasonMessageId: "settings.betterT3.deviceLoading" }
        : requiresEnvironment && !input.environmentAvailable
          ? { state: "unavailable", reasonMessageId: "settings.betterT3.noEnvironment" }
          : unsupported
            ? {
                state: "unsupported",
                reasonMessageId: "settings.betterT3.availability.unsupported",
              }
            : (dependency ?? { state: "available" });
    controlsById.set(descriptor.id, {
      id: descriptor.id,
      descriptor,
      controlKind: descriptor.controlKind,
      availability,
      value,
    });
  }

  return MOBILE_SECTION_ORDER.flatMap((sectionId): ReadonlyArray<MobileBetterT3Section> => {
    const controls = [...controlsById.values()].filter(
      (control) => control.descriptor.section === sectionId,
    );
    return controls.length === 0 ? [] : [{ id: sectionId, controls }];
  });
}

export interface MobileBetterT3DevicePreferencePatch {
  readonly betterT3Device: BetterT3SettingsV1;
  readonly experimentalFetch?: boolean;
  readonly experimentalParallelPlanImplementation?: boolean;
  readonly improvePromptBeforeSend?: boolean;
  readonly legacyThreadListEnabled?: boolean;
  readonly planModeEnabled?: boolean;
}

const compatibilityPreferencePatch = (
  featureId: BetterT3SwitchFeatureId,
  enabled: boolean,
): Omit<MobileBetterT3DevicePreferencePatch, "betterT3Device"> => {
  switch (featureId) {
    case "agent.fetch":
      return { experimentalFetch: enabled };
    case "agent.parallelPlanImplementation":
      return { experimentalParallelPlanImplementation: enabled };
    case "agent.promptImprovement":
      return { improvePromptBeforeSend: enabled };
    case "agent.planMode":
      return { planModeEnabled: enabled };
    case "chat.classicSidebar":
      return { legacyThreadListEnabled: enabled };
    default:
      return {};
  }
};

export function createMobileBetterT3DevicePreferencePatch(input: {
  readonly settings: BetterT3SettingsV1;
  readonly featureId: BetterT3SwitchFeatureId;
  readonly enabled: boolean;
}): MobileBetterT3DevicePreferencePatch {
  return {
    betterT3Device: {
      ...input.settings,
      flags: { ...input.settings.flags, [input.featureId]: input.enabled },
    },
    ...compatibilityPreferencePatch(input.featureId, input.enabled),
  };
}

export function createMobileBetterT3EnvironmentPatch(input: {
  readonly settings: BetterT3SettingsV1;
  readonly featureId: BetterT3SwitchFeatureId;
  readonly enabled: boolean;
}): ServerSettingsPatch {
  return {
    betterT3Environment: {
      flags: { ...input.settings.flags, [input.featureId]: input.enabled },
    },
  };
}
