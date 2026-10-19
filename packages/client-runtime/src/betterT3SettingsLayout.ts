import type { BetterT3FeatureId } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

const subgroupDefinitions = [
  {
    id: "language",
    categoryId: "general",
    featureIds: [],
    targetIds: ["interface-language", "better-t3-interface", "better-t3-interface-language"],
    collapsible: false,
  },
  {
    id: "warnings",
    categoryId: "general",
    featureIds: ["integration.suppressErrorsAndWarnings"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "glass",
    categoryId: "appearance",
    featureIds: [],
    targetIds: ["setting-glass-opacity", "macos-window-transparency"],
    collapsible: false,
  },
  {
    id: "chat-display",
    categoryId: "chat",
    featureIds: ["chat.visualizations", "chat.presentation", "chat.characterStreamingMotion"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "messages",
    categoryId: "chat",
    featureIds: ["chat.messageEditing", "chat.messageReplies"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "reasoning",
    categoryId: "chat",
    featureIds: ["agent.reasoningVisibility", "agent.reasoningWorkingOverlay"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "response-metrics",
    categoryId: "chat",
    featureIds: [],
    targetIds: ["response-metrics"],
    collapsible: false,
  },
  {
    id: "chat-width",
    categoryId: "chat",
    featureIds: [],
    targetIds: ["setting-chat-content-width"],
    collapsible: false,
  },
  {
    id: "composer-input",
    categoryId: "composer",
    featureIds: ["agent.promptImprovement", "agent.expandedComposerControls"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "context-display",
    categoryId: "composer",
    featureIds: ["chat.contextWindowSelector"],
    targetIds: ["legacy-context-window-indicator"],
    collapsible: false,
  },
  {
    id: "composer-cards",
    categoryId: "composer",
    featureIds: [
      "chat.workspaceCardDeck",
      "chat.cardMorphing",
      "chat.hideComposerDivider",
      "chat.classicBubbleOnly",
    ],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "sidebar-layout",
    categoryId: "sidebar",
    featureIds: ["chat.classicSidebar", "chat.sidebarPosition"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "sidebar-previews",
    categoryId: "sidebar",
    featureIds: ["chat.previewCount", "chat.shiftClickShowLess", "chat.draftIndicators"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "sidebar-sorting",
    categoryId: "sidebar",
    featureIds: ["chat.sorting"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "sidebar-cleanup",
    categoryId: "sidebar",
    featureIds: ["chat.settling"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "usage-display",
    categoryId: "usage",
    featureIds: [],
    targetIds: ["usage-pacing"],
    collapsible: false,
  },
  {
    id: "daily-budget",
    categoryId: "usage",
    featureIds: [],
    targetIds: ["usage-hard-budget"],
    collapsible: false,
  },
  {
    id: "workday",
    categoryId: "usage",
    featureIds: [],
    targetIds: ["usage-workday"],
    collapsible: false,
  },
  {
    id: "fetch",
    categoryId: "agents",
    featureIds: ["agent.fetch", "agent.fetchModel"],
    targetIds: [],
    collapsible: true,
  },
  {
    id: "parallel-plan",
    categoryId: "agents",
    featureIds: ["agent.parallelPlanImplementation", "agent.parallelPlanReviewer"],
    targetIds: [],
    collapsible: true,
  },
  {
    id: "context-compaction",
    categoryId: "agents",
    featureIds: ["agent.contextCompaction", "agent.contextCompactionModel"],
    targetIds: [],
    collapsible: true,
  },
  {
    id: "auto-reasoning",
    categoryId: "agents",
    featureIds: ["agent.autoReasoningModel"],
    targetIds: [],
    collapsible: true,
  },
  {
    id: "agent-workflow",
    categoryId: "agents",
    featureIds: ["agent.planMode", "agent.deepThinking", "agent.cavemanMode"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "agent-collaboration",
    categoryId: "agents",
    featureIds: [
      "agent.generalSubagents",
      "agent.nativeSubagentDisplay",
      "agent.projectCoordination",
    ],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "git",
    categoryId: "workspace",
    featureIds: ["workspace.gitWorkbench"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "checkpoints",
    categoryId: "workspace",
    featureIds: ["workspace.checkpoints"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "chat-transfer",
    categoryId: "workspace",
    featureIds: ["workspace.chatPortability"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "voice-access",
    categoryId: "voice",
    featureIds: ["voice.assemblyAi", "voice.credentials"],
    targetIds: ["voice-input"],
    collapsible: false,
  },
  {
    id: "voice-translation",
    categoryId: "voice",
    featureIds: ["voice.outputLanguage"],
    targetIds: ["voice-translation-model"],
    collapsible: true,
  },
  {
    id: "voice-recording",
    categoryId: "voice",
    featureIds: [],
    targetIds: ["voice-recording-options"],
    collapsible: false,
  },
  {
    id: "voice-cleanup",
    categoryId: "voice",
    featureIds: [],
    targetIds: ["voice-cleanup-model", "voice-cleanup-mode", "voice-cleanup-instructions"],
    collapsible: true,
  },
  {
    id: "voice-project-context",
    categoryId: "voice",
    featureIds: [],
    targetIds: ["project-speech-context"],
    collapsible: false,
  },
  {
    id: "voice-transcript-transfer",
    categoryId: "voice",
    featureIds: ["voice.transcriptPortability"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "knowledge-graph",
    categoryId: "knowledge",
    featureIds: ["knowledge.graph"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "project-indexing",
    categoryId: "knowledge",
    featureIds: [
      "knowledge.projectIndexing",
      "knowledge.projectIndexingMaster",
      "knowledge.projectIndexingReview",
    ],
    targetIds: ["better-t3-project-indexing"],
    collapsible: false,
  },
  {
    id: "indexing-models",
    categoryId: "knowledge",
    featureIds: ["knowledge.projectIndexingDefaultModel", "knowledge.projectIndexingDecisionModel"],
    targetIds: ["knowledge.projectIndexingReviewDefaults"],
    collapsible: true,
  },
  {
    id: "resources",
    categoryId: "system",
    featureIds: ["resource.adaptiveAdmission", "resource.processSuspension"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "diagnostics",
    categoryId: "system",
    featureIds: ["resource.diagnostics"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "connection",
    categoryId: "integrations",
    featureIds: [
      "integration.remoteReadiness",
      "integration.lifecycleHealth",
      "integration.compatibility",
    ],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "mcp-skills",
    categoryId: "integrations",
    featureIds: ["integration.mcp", "integration.skills"],
    targetIds: [],
    collapsible: false,
  },
  {
    id: "privacy",
    categoryId: "integrations",
    featureIds: ["integration.analyticsRemoval"],
    targetIds: [],
    collapsible: false,
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly categoryId: string;
  readonly featureIds: ReadonlyArray<BetterT3FeatureId>;
  readonly targetIds: ReadonlyArray<string>;
  readonly collapsible: boolean;
}>;

export type BetterT3SettingsSubgroupId = (typeof subgroupDefinitions)[number]["id"];
export type BetterT3SettingsCategoryId = (typeof subgroupDefinitions)[number]["categoryId"];

export interface BetterT3SettingsSubgroup {
  readonly id: BetterT3SettingsSubgroupId;
  readonly categoryId: BetterT3SettingsCategoryId;
  readonly titleMessageId: InterfaceMessageKey;
  readonly featureIds: ReadonlyArray<BetterT3FeatureId>;
  readonly targetIds: ReadonlyArray<string>;
  readonly collapsible: boolean;
  readonly order: number;
}

export const BETTER_T3_SETTINGS_SUBGROUPS: ReadonlyArray<BetterT3SettingsSubgroup> =
  subgroupDefinitions.map((group, order) => ({
    ...group,
    order,
    titleMessageId: `settings.betterT3.subgroup.${group.id}` as const,
    targetIds: [...group.featureIds, ...group.targetIds],
  }));

export function getBetterT3SettingsSubgroups(
  categoryId: string,
): ReadonlyArray<BetterT3SettingsSubgroup> {
  return BETTER_T3_SETTINGS_SUBGROUPS.filter((group) => group.categoryId === categoryId);
}

export function getBetterT3SettingsSubgroupForFeature(
  featureId: string,
): BetterT3SettingsSubgroup | undefined {
  return BETTER_T3_SETTINGS_SUBGROUPS.find((group) =>
    group.featureIds.some((id) => id === featureId),
  );
}

export function getBetterT3SettingsSubgroupForTarget(
  targetId: string,
): BetterT3SettingsSubgroup | undefined {
  return BETTER_T3_SETTINGS_SUBGROUPS.find((group) => group.targetIds.includes(targetId));
}

export function sanitizeBetterT3ExpandedSettingsGroups(
  value: unknown,
): BetterT3SettingsSubgroupId[] {
  if (!Array.isArray(value)) return [];
  const expanded = new Set<BetterT3SettingsSubgroupId>();
  for (const candidate of value) {
    const group = BETTER_T3_SETTINGS_SUBGROUPS.find((entry) => entry.id === candidate);
    if (group?.collapsible) expanded.add(group.id);
  }
  return [...expanded];
}
