import * as Schema from "effect/Schema";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const BETTER_T3_SETTINGS_VERSION = 1 as const;

export const BetterT3FeatureSection = Schema.Literals([
  "agent-workflows",
  "chat-layout",
  "workspace-source-control",
  "voice-synchronization",
  "knowledge-automation",
  "resource-protection",
  "integration-status",
]);
export type BetterT3FeatureSection = typeof BetterT3FeatureSection.Type;

export const BetterT3FeatureScope = Schema.Literals([
  "device",
  "environment",
  "synchronized",
  "project",
]);
export type BetterT3FeatureScope = typeof BetterT3FeatureScope.Type;

export const BetterT3FeatureControlKind = Schema.Literals([
  "switch",
  "selector",
  "action",
  "link",
  "status-only",
]);
export type BetterT3FeatureControlKind = typeof BetterT3FeatureControlKind.Type;

const featureIds = [
  "agent.fetch",
  "agent.fetchModel",
  "agent.parallelPlanImplementation",
  "agent.parallelPlanReviewer",
  "agent.autoReasoningModel",
  "agent.planMode",
  "agent.deepThinking",
  "agent.cavemanMode",
  "agent.promptImprovement",
  "agent.expandedComposerControls",
  "agent.reasoningVisibility",
  "agent.generalSubagents",
  "agent.projectCoordination",
  "chat.workspaceCardDeck",
  "chat.cardMorphing",
  "chat.characterStreamingMotion",
  "chat.presentation",
  "chat.classicBubbleOnly",
  "chat.classicSidebar",
  "chat.previewCount",
  "chat.sorting",
  "chat.settling",
  "chat.shiftClickShowLess",
  "chat.draftIndicators",
  "chat.sidebarPosition",
  "workspace.gitWorkbench",
  "workspace.checkpoints",
  "workspace.chatPortability",
  "voice.assemblyAi",
  "voice.outputLanguage",
  "voice.transcriptPortability",
  "voice.credentials",
  "knowledge.graph",
  "knowledge.model",
  "knowledge.progress",
  "knowledge.rebuild",
  "knowledge.pause",
  "knowledge.clear",
  "resource.adaptiveAdmission",
  "resource.processSuspension",
  "resource.diagnostics",
  "integration.remoteReadiness",
  "integration.analyticsRemoval",
  "integration.lifecycleHealth",
  "integration.mcp",
  "integration.skills",
  "integration.compatibility",
] as const;

export const BetterT3FeatureId = Schema.Literals(featureIds);
export type BetterT3FeatureId = typeof BetterT3FeatureId.Type;

const switchFeatureIds = [
  "agent.fetch",
  "agent.parallelPlanImplementation",
  "agent.planMode",
  "agent.deepThinking",
  "agent.promptImprovement",
  "agent.expandedComposerControls",
  "agent.reasoningVisibility",
  "agent.generalSubagents",
  "agent.projectCoordination",
  "chat.workspaceCardDeck",
  "chat.cardMorphing",
  "chat.characterStreamingMotion",
  "chat.classicBubbleOnly",
  "chat.classicSidebar",
  "chat.shiftClickShowLess",
  "chat.draftIndicators",
  "workspace.gitWorkbench",
  "voice.assemblyAi",
  "knowledge.graph",
  "resource.adaptiveAdmission",
  "resource.processSuspension",
] as const;

export const BetterT3SwitchFeatureId = Schema.Literals(switchFeatureIds);
export type BetterT3SwitchFeatureId = typeof BetterT3SwitchFeatureId.Type;

export const BetterT3FeatureDependency = Schema.Struct({
  featureId: BetterT3FeatureId,
  condition: Schema.Literals(["enabled", "available"]),
});
export type BetterT3FeatureDependency = typeof BetterT3FeatureDependency.Type;

export const BetterT3Surface = Schema.Literals(["web", "desktop", "phone", "tablet"]);
export type BetterT3Surface = typeof BetterT3Surface.Type;

export const BetterT3CapabilityRequirement = Schema.Struct({
  name: TrimmedNonEmptyString,
  minimumVersion: Schema.optionalKey(PositiveInt),
});
export type BetterT3CapabilityRequirement = typeof BetterT3CapabilityRequirement.Type;

export const BetterT3FeatureAvailability = Schema.Struct({
  surfaces: Schema.Array(BetterT3Surface),
  capabilities: Schema.Array(BetterT3CapabilityRequirement),
});
export type BetterT3FeatureAvailability = typeof BetterT3FeatureAvailability.Type;

export const BetterT3CompatibilityMirror = Schema.Struct({
  store: Schema.Literals([
    "client-settings",
    "mobile-preferences",
    "server-settings",
    "project-settings",
    "capability",
    "rpc",
  ]),
  path: TrimmedNonEmptyString,
  access: Schema.Literals(["read-write", "read-only", "deep-link"]),
});
export type BetterT3CompatibilityMirror = typeof BetterT3CompatibilityMirror.Type;

export const BetterT3FeatureDescriptor = Schema.Struct({
  id: BetterT3FeatureId,
  section: BetterT3FeatureSection,
  scope: BetterT3FeatureScope,
  controlKind: BetterT3FeatureControlKind,
  labelMessageId: TrimmedNonEmptyString,
  descriptionMessageId: TrimmedNonEmptyString,
  defaults: Schema.Struct({ clean: Schema.Boolean, existing: Schema.Boolean }),
  dependencies: Schema.Array(BetterT3FeatureDependency),
  availability: BetterT3FeatureAvailability,
  compatibilityMirrors: Schema.Array(BetterT3CompatibilityMirror),
});
export type BetterT3FeatureDescriptor = typeof BetterT3FeatureDescriptor.Type;

type DescriptorInput = {
  readonly id: BetterT3FeatureId;
  readonly section: BetterT3FeatureSection;
  readonly scope: BetterT3FeatureScope;
  readonly controlKind: BetterT3FeatureControlKind;
  readonly existing?: boolean;
  readonly dependencies?: ReadonlyArray<BetterT3FeatureDependency>;
  readonly surfaces?: ReadonlyArray<BetterT3Surface>;
  readonly capabilities?: ReadonlyArray<BetterT3CapabilityRequirement>;
  readonly mirrors?: ReadonlyArray<BetterT3CompatibilityMirror>;
};

const descriptor = (input: DescriptorInput): BetterT3FeatureDescriptor => ({
  id: input.id,
  section: input.section,
  scope: input.scope,
  controlKind: input.controlKind,
  labelMessageId: `betterT3.${input.id}.label`,
  descriptionMessageId: `betterT3.${input.id}.description`,
  defaults: { clean: false, existing: input.existing ?? false },
  dependencies: input.dependencies ?? [],
  availability: {
    surfaces: input.surfaces ?? ["web", "desktop", "phone", "tablet"],
    capabilities: input.capabilities ?? [],
  },
  compatibilityMirrors: input.mirrors ?? [],
});

const clientMirror = (path: string): BetterT3CompatibilityMirror => ({
  store: "client-settings",
  path,
  access: "read-write",
});
const mobileMirror = (path: string): BetterT3CompatibilityMirror => ({
  store: "mobile-preferences",
  path,
  access: "read-write",
});
const serverMirror = (path: string): BetterT3CompatibilityMirror => ({
  store: "server-settings",
  path,
  access: "read-write",
});
const capability = (name: string, minimumVersion?: number): BetterT3CapabilityRequirement => ({
  name,
  ...(minimumVersion === undefined ? {} : { minimumVersion }),
});

export const BETTER_T3_FEATURE_REGISTRY = [
  descriptor({
    id: "agent.fetch",
    section: "agent-workflows",
    scope: "device",
    controlKind: "switch",
    capabilities: [capability("agentWorkflowVersion", 1)],
    mirrors: [clientMirror("experimentalFetch")],
  }),
  descriptor({
    id: "agent.fetchModel",
    section: "agent-workflows",
    scope: "environment",
    controlKind: "selector",
    capabilities: [capability("agentWorkflowVersion", 1)],
    mirrors: [serverMirror("fetchModelSelection")],
  }),
  descriptor({
    id: "agent.parallelPlanImplementation",
    section: "agent-workflows",
    scope: "device",
    controlKind: "switch",
    capabilities: [capability("agentWorkflowVersion", 1)],
    mirrors: [clientMirror("experimentalParallelPlanImplementation")],
  }),
  descriptor({
    id: "agent.parallelPlanReviewer",
    section: "agent-workflows",
    scope: "environment",
    controlKind: "selector",
    dependencies: [{ featureId: "agent.parallelPlanImplementation", condition: "enabled" }],
    capabilities: [capability("agentWorkflowVersion", 1)],
    mirrors: [serverMirror("parallelPlanReviewModelSelection")],
  }),
  descriptor({
    id: "agent.autoReasoningModel",
    section: "agent-workflows",
    scope: "environment",
    controlKind: "selector",
    capabilities: [capability("agentWorkflowVersion", 1)],
    mirrors: [serverMirror("autoReasoningModelSelection")],
  }),
  descriptor({
    id: "agent.planMode",
    section: "agent-workflows",
    scope: "device",
    controlKind: "switch",
    mirrors: [clientMirror("planModeEnabled")],
  }),
  descriptor({
    id: "agent.deepThinking",
    section: "agent-workflows",
    scope: "environment",
    controlKind: "switch",
    capabilities: [capability("environmentSettingsVersion", 1)],
    mirrors: [serverMirror("agentEnhancement.deepThinking.enabled")],
  }),
  descriptor({
    id: "agent.cavemanMode",
    section: "agent-workflows",
    scope: "environment",
    controlKind: "selector",
    capabilities: [capability("environmentSettingsVersion", 1)],
    mirrors: [serverMirror("agentEnhancement.cavemanMode")],
  }),
  descriptor({
    id: "agent.promptImprovement",
    section: "agent-workflows",
    scope: "device",
    controlKind: "switch",
    capabilities: [capability("agentWorkflowVersion", 1)],
    mirrors: [clientMirror("improvePromptBeforeSend")],
  }),
  descriptor({
    id: "agent.expandedComposerControls",
    section: "agent-workflows",
    scope: "device",
    controlKind: "switch",
    surfaces: ["web", "desktop"],
    mirrors: [clientMirror("showExpandedComposerControls")],
  }),
  descriptor({
    id: "agent.reasoningVisibility",
    section: "agent-workflows",
    scope: "device",
    controlKind: "switch",
    surfaces: ["web", "desktop"],
    mirrors: [clientMirror("showReasoning")],
  }),
  descriptor({
    id: "agent.generalSubagents",
    section: "agent-workflows",
    scope: "environment",
    controlKind: "switch",
    existing: true,
    capabilities: [capability("agentWorkflowVersion", 1)],
  }),
  descriptor({
    id: "agent.projectCoordination",
    section: "agent-workflows",
    scope: "environment",
    controlKind: "switch",
    existing: true,
    capabilities: [capability("projectSettingsVersion", 1)],
  }),
  descriptor({
    id: "chat.workspaceCardDeck",
    section: "chat-layout",
    scope: "device",
    controlKind: "switch",
    existing: true,
    surfaces: ["web", "desktop"],
  }),
  descriptor({
    id: "chat.cardMorphing",
    section: "chat-layout",
    scope: "device",
    controlKind: "switch",
    existing: true,
    dependencies: [{ featureId: "chat.workspaceCardDeck", condition: "enabled" }],
    surfaces: ["web", "desktop"],
  }),
  descriptor({
    id: "chat.characterStreamingMotion",
    section: "chat-layout",
    scope: "device",
    controlKind: "switch",
    existing: true,
    surfaces: ["web", "desktop"],
  }),
  descriptor({
    id: "chat.presentation",
    section: "chat-layout",
    scope: "synchronized",
    controlKind: "selector",
    mirrors: [serverMirror("chatVisualModeSyncRecord.mode")],
  }),
  descriptor({
    id: "chat.classicBubbleOnly",
    section: "chat-layout",
    scope: "device",
    controlKind: "switch",
    existing: true,
    surfaces: ["web", "desktop"],
  }),
  descriptor({
    id: "chat.classicSidebar",
    section: "chat-layout",
    scope: "device",
    controlKind: "switch",
    mirrors: [clientMirror("legacySidebarEnabled"), mobileMirror("legacyThreadListEnabled")],
  }),
  descriptor({
    id: "chat.previewCount",
    section: "chat-layout",
    scope: "synchronized",
    controlKind: "selector",
    mirrors: [
      serverMirror("projectThreadPreviewSyncRecord.count"),
      clientMirror("sidebarThreadPreviewCount"),
    ],
  }),
  descriptor({
    id: "chat.sorting",
    section: "chat-layout",
    scope: "device",
    controlKind: "selector",
    mirrors: [clientMirror("sidebarProjectSortOrder"), clientMirror("sidebarThreadSortOrder")],
  }),
  descriptor({
    id: "chat.settling",
    section: "chat-layout",
    scope: "device",
    controlKind: "selector",
    mirrors: [clientMirror("sidebarAutoSettleAfterDays"), clientMirror("sidebarAutoSettleOnMerge")],
  }),
  descriptor({
    id: "chat.shiftClickShowLess",
    section: "chat-layout",
    scope: "device",
    controlKind: "switch",
    existing: true,
    surfaces: ["web", "desktop"],
    dependencies: [{ featureId: "chat.classicSidebar", condition: "enabled" }],
  }),
  descriptor({
    id: "chat.draftIndicators",
    section: "chat-layout",
    scope: "device",
    controlKind: "switch",
    existing: true,
    surfaces: ["web", "desktop"],
  }),
  descriptor({
    id: "chat.sidebarPosition",
    section: "chat-layout",
    scope: "device",
    controlKind: "selector",
    surfaces: ["web", "desktop"],
    mirrors: [clientMirror("sidebarPosition")],
  }),
  descriptor({
    id: "workspace.gitWorkbench",
    section: "workspace-source-control",
    scope: "device",
    controlKind: "switch",
    existing: true,
    surfaces: ["web", "desktop", "phone", "tablet"],
    capabilities: [capability("gitWorkbenchVersion", 1)],
  }),
  descriptor({
    id: "workspace.checkpoints",
    section: "workspace-source-control",
    scope: "project",
    controlKind: "link",
    capabilities: [capability("projectSettingsVersion", 1)],
    mirrors: [{ store: "project-settings", path: "checkpointsEnabled", access: "deep-link" }],
  }),
  descriptor({
    id: "workspace.chatPortability",
    section: "workspace-source-control",
    scope: "environment",
    controlKind: "action",
    capabilities: [capability("harnessChatSyncVersion", 1)],
    mirrors: [{ store: "rpc", path: "harnessChatSync", access: "deep-link" }],
  }),
  descriptor({
    id: "voice.assemblyAi",
    section: "voice-synchronization",
    scope: "environment",
    controlKind: "switch",
    existing: true,
    capabilities: [capability("environmentSettingsVersion", 1)],
  }),
  descriptor({
    id: "voice.outputLanguage",
    section: "voice-synchronization",
    scope: "device",
    controlKind: "selector",
    mirrors: [clientMirror("voiceInputOutputLanguage")],
  }),
  descriptor({
    id: "voice.transcriptPortability",
    section: "voice-synchronization",
    scope: "environment",
    controlKind: "action",
    capabilities: [capability("agentWorkflowVersion", 1)],
    mirrors: [{ store: "rpc", path: "chatPortability", access: "deep-link" }],
  }),
  descriptor({
    id: "voice.credentials",
    section: "voice-synchronization",
    scope: "environment",
    controlKind: "link",
    capabilities: [capability("environmentSettingsVersion", 1)],
    mirrors: [
      {
        store: "server-settings",
        path: "speechTranscription.assemblyAi.apiKey",
        access: "deep-link",
      },
    ],
  }),
  descriptor({
    id: "knowledge.graph",
    section: "knowledge-automation",
    scope: "environment",
    controlKind: "switch",
    capabilities: [capability("knowledgeGraphVersion", 1)],
  }),
  descriptor({
    id: "knowledge.model",
    section: "knowledge-automation",
    scope: "environment",
    controlKind: "selector",
    dependencies: [{ featureId: "knowledge.graph", condition: "enabled" }],
    mirrors: [serverMirror("knowledgeGraphModelSelection")],
  }),
  descriptor({
    id: "knowledge.progress",
    section: "knowledge-automation",
    scope: "environment",
    controlKind: "status-only",
    dependencies: [{ featureId: "knowledge.graph", condition: "available" }],
    capabilities: [capability("knowledgeGraphVersion", 1)],
  }),
  descriptor({
    id: "knowledge.rebuild",
    section: "knowledge-automation",
    scope: "environment",
    controlKind: "action",
    dependencies: [{ featureId: "knowledge.graph", condition: "enabled" }],
    capabilities: [capability("knowledgeGraphVersion", 1)],
  }),
  descriptor({
    id: "knowledge.pause",
    section: "knowledge-automation",
    scope: "environment",
    controlKind: "action",
    dependencies: [{ featureId: "knowledge.graph", condition: "enabled" }],
    capabilities: [capability("knowledgeGraphVersion", 1)],
  }),
  descriptor({
    id: "knowledge.clear",
    section: "knowledge-automation",
    scope: "environment",
    controlKind: "action",
    dependencies: [{ featureId: "knowledge.graph", condition: "available" }],
    capabilities: [capability("knowledgeGraphVersion", 1)],
  }),
  descriptor({
    id: "resource.adaptiveAdmission",
    section: "resource-protection",
    scope: "environment",
    controlKind: "switch",
    existing: true,
    capabilities: [capability("resourceProtectionVersion", 1)],
  }),
  descriptor({
    id: "resource.processSuspension",
    section: "resource-protection",
    scope: "environment",
    controlKind: "switch",
    existing: true,
    capabilities: [capability("resourceProtectionVersion", 1)],
  }),
  descriptor({
    id: "resource.diagnostics",
    section: "resource-protection",
    scope: "environment",
    controlKind: "link",
    capabilities: [capability("resourceDiagnosticsVersion", 1)],
    mirrors: [{ store: "rpc", path: "resourceDiagnostics", access: "deep-link" }],
  }),
  descriptor({
    id: "integration.remoteReadiness",
    section: "integration-status",
    scope: "environment",
    controlKind: "status-only",
    mirrors: [{ store: "capability", path: "repositoryIdentity", access: "read-only" }],
  }),
  descriptor({
    id: "integration.analyticsRemoval",
    section: "integration-status",
    scope: "environment",
    controlKind: "status-only",
  }),
  descriptor({
    id: "integration.lifecycleHealth",
    section: "integration-status",
    scope: "environment",
    controlKind: "status-only",
  }),
  descriptor({
    id: "integration.mcp",
    section: "integration-status",
    scope: "environment",
    controlKind: "link",
    capabilities: [capability("mcpWorkspaceVersion", 1)],
    mirrors: [{ store: "server-settings", path: "mcp", access: "deep-link" }],
  }),
  descriptor({
    id: "integration.skills",
    section: "integration-status",
    scope: "environment",
    controlKind: "link",
    capabilities: [capability("environmentSettingsVersion", 1)],
    mirrors: [{ store: "server-settings", path: "skills", access: "deep-link" }],
  }),
  descriptor({
    id: "integration.compatibility",
    section: "integration-status",
    scope: "environment",
    controlKind: "status-only",
  }),
] as const satisfies ReadonlyArray<BetterT3FeatureDescriptor>;

export const BetterT3SettingsInitialization = Schema.Literals([
  "clean-install",
  "existing-install-migration",
]);
export type BetterT3SettingsInitialization = typeof BetterT3SettingsInitialization.Type;

const BetterT3FeatureFlagRecord = Schema.Record(TrimmedNonEmptyString, Schema.Boolean);

export const BetterT3SettingsV1 = Schema.Struct({
  version: Schema.Literal(BETTER_T3_SETTINGS_VERSION),
  initialization: BetterT3SettingsInitialization,
  flags: BetterT3FeatureFlagRecord,
});
export type BetterT3SettingsV1 = typeof BetterT3SettingsV1.Type;

export const BetterT3SettingsPatchV1 = Schema.Struct({
  version: Schema.optionalKey(Schema.Literal(BETTER_T3_SETTINGS_VERSION)),
  flags: Schema.optionalKey(BetterT3FeatureFlagRecord),
});
export type BetterT3SettingsPatchV1 = typeof BetterT3SettingsPatchV1.Type;

export const BetterT3CompatibilityFlagV1 = Schema.Struct({
  featureId: BetterT3SwitchFeatureId,
  enabled: Schema.Boolean,
});
export type BetterT3CompatibilityFlagV1 = typeof BetterT3CompatibilityFlagV1.Type;

export const BetterT3SettingsBootstrapInputV1 = Schema.Struct({
  version: Schema.Literal(BETTER_T3_SETTINGS_VERSION),
  initialization: BetterT3SettingsInitialization,
  persistedSettings: Schema.NullOr(BetterT3SettingsV1),
  compatibilityFlags: Schema.Array(BetterT3CompatibilityFlagV1),
});
export type BetterT3SettingsBootstrapInputV1 = typeof BetterT3SettingsBootstrapInputV1.Type;

export function makeBetterT3SettingsV1(
  initialization: BetterT3SettingsInitialization,
  flags: Readonly<Partial<Record<BetterT3SwitchFeatureId, boolean>>> = {},
): BetterT3SettingsV1 {
  return { version: BETTER_T3_SETTINGS_VERSION, initialization, flags: { ...flags } };
}

export const DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1 = makeBetterT3SettingsV1("clean-install");
export const DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1 = makeBetterT3SettingsV1(
  "existing-install-migration",
);

/**
 * Seeds only missing Better T3 flags from values that were explicitly present
 * in an older owning settings store. Callers must not pass schema defaults as
 * compatibility values because their presence is what distinguishes an
 * existing installation from a clean one.
 */
export function bootstrapBetterT3SettingsV1(
  input: BetterT3SettingsBootstrapInputV1,
): BetterT3SettingsV1 {
  const settings = input.persistedSettings ?? makeBetterT3SettingsV1(input.initialization);
  const flags: Record<string, boolean> = { ...settings.flags };
  for (const compatibilityFlag of input.compatibilityFlags) {
    if (Object.hasOwn(flags, compatibilityFlag.featureId)) continue;
    flags[compatibilityFlag.featureId] = compatibilityFlag.enabled;
  }
  return { ...settings, flags };
}

const descriptorsById = new Map(
  BETTER_T3_FEATURE_REGISTRY.map((entry) => [entry.id, entry] as const),
);

export function resolveBetterT3FeatureFlag(
  settings: BetterT3SettingsV1,
  featureId: BetterT3SwitchFeatureId,
): boolean {
  if (Object.hasOwn(settings.flags, featureId)) {
    return settings.flags[featureId] === true;
  }
  const defaults = descriptorsById.get(featureId)?.defaults;
  return settings.initialization === "existing-install-migration"
    ? (defaults?.existing ?? false)
    : (defaults?.clean ?? false);
}

export const BetterT3FeatureAvailabilityState = Schema.Struct({
  state: Schema.Literals(["available", "unavailable", "blocked", "unsupported"]),
  reasonMessageId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type BetterT3FeatureAvailabilityState = typeof BetterT3FeatureAvailabilityState.Type;

export const BetterT3ControlValueV1 = Schema.NullOr(
  Schema.Union([Schema.Boolean, Schema.String, Schema.Number]),
);
export type BetterT3ControlValueV1 = typeof BetterT3ControlValueV1.Type;

export const BetterT3FeatureControlStateV1 = Schema.Struct({
  descriptor: BetterT3FeatureDescriptor,
  availability: BetterT3FeatureAvailabilityState,
  value: BetterT3ControlValueV1,
  source: Schema.Literals(["better-t3", "compatibility-mirror", "default", "runtime"]),
});
export type BetterT3FeatureControlStateV1 = typeof BetterT3FeatureControlStateV1.Type;

export const BetterT3SettingsReadModelV1 = Schema.Struct({
  version: Schema.Literal(BETTER_T3_SETTINGS_VERSION),
  features: Schema.Array(BetterT3FeatureControlStateV1),
});
export type BetterT3SettingsReadModelV1 = typeof BetterT3SettingsReadModelV1.Type;
