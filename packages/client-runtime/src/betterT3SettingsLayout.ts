import type { BetterT3FeatureId } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

const subgroupDefinitions = [
  {
    id: "language",
    categoryId: "general",
    featureIds: [],
    targetIds: ["interface-language", "better-t3-interface", "better-t3-interface-language"],
  },
  {
    id: "warnings",
    categoryId: "general",
    featureIds: ["integration.suppressErrorsAndWarnings"],
    targetIds: [],
  },
  {
    id: "glass",
    categoryId: "appearance",
    featureIds: [],
    targetIds: ["setting-glass-opacity", "macos-window-transparency"],
  },
  {
    id: "chat-display",
    categoryId: "chat",
    featureIds: [
      "chat.visualizations",
      "chat.presentation",
      "chat.presentationMotion",
      "chat.characterStreamingMotion",
      "chat.workingStatusInHeader",
    ],
    targetIds: [],
  },
  {
    id: "messages",
    categoryId: "chat",
    featureIds: ["chat.messageEditing", "chat.messageReplies"],
    targetIds: [],
  },
  {
    id: "reasoning",
    categoryId: "chat",
    featureIds: [
      "agent.reasoningVisibility",
      "agent.reasoningWorkingOverlay",
      "agent.reasoningInMessage",
    ],
    targetIds: [],
  },
  {
    id: "response-metrics",
    categoryId: "chat",
    featureIds: [],
    targetIds: ["response-metrics"],
  },
  {
    id: "chat-width",
    categoryId: "chat",
    featureIds: [],
    targetIds: ["setting-chat-content-width"],
  },
  {
    id: "composer-input",
    categoryId: "composer",
    featureIds: ["agent.promptImprovement", "agent.expandedComposerControls"],
    targetIds: [],
  },
  {
    id: "context-display",
    categoryId: "composer",
    featureIds: ["chat.contextWindowSelector"],
    targetIds: ["legacy-context-window-indicator"],
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
  },
  {
    id: "sidebar-layout",
    categoryId: "sidebar",
    featureIds: ["chat.classicSidebar", "chat.sidebarPosition"],
    targetIds: [],
  },
  {
    id: "sidebar-previews",
    categoryId: "sidebar",
    featureIds: ["chat.previewCount", "chat.shiftClickShowLess", "chat.draftIndicators"],
    targetIds: [],
  },
  {
    id: "sidebar-sorting",
    categoryId: "sidebar",
    featureIds: ["chat.sorting"],
    targetIds: [],
  },
  {
    id: "sidebar-cleanup",
    categoryId: "sidebar",
    featureIds: ["chat.settling"],
    targetIds: [],
  },
  {
    id: "usage-display",
    categoryId: "usage",
    featureIds: [],
    targetIds: ["usage-pacing"],
  },
  {
    id: "daily-budget",
    categoryId: "usage",
    featureIds: [],
    targetIds: ["usage-hard-budget"],
  },
  {
    id: "workday",
    categoryId: "usage",
    featureIds: [],
    targetIds: ["usage-workday"],
  },
  {
    id: "fetch",
    categoryId: "agents",
    featureIds: ["agent.fetch", "agent.fetchModel"],
    targetIds: [],
  },
  {
    id: "parallel-plan",
    categoryId: "agents",
    featureIds: ["agent.parallelPlanImplementation", "agent.parallelPlanReviewer"],
    targetIds: [],
  },
  {
    id: "context-compaction",
    categoryId: "agents",
    featureIds: ["agent.contextCompaction", "agent.contextCompactionModel"],
    targetIds: [],
  },
  {
    id: "auto-reasoning",
    categoryId: "agents",
    featureIds: ["agent.autoReasoningModel"],
    targetIds: [],
  },
  {
    id: "agent-workflow",
    categoryId: "agents",
    featureIds: ["agent.planMode", "agent.deepThinking", "agent.cavemanMode"],
    targetIds: [],
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
  },
  {
    id: "git",
    categoryId: "workspace",
    featureIds: ["workspace.gitWorkbench"],
    targetIds: [],
  },
  {
    id: "checkpoints",
    categoryId: "workspace",
    featureIds: ["workspace.checkpoints"],
    targetIds: [],
  },
  {
    id: "chat-transfer",
    categoryId: "workspace",
    featureIds: ["workspace.chatPortability"],
    targetIds: [],
  },
  {
    id: "voice-access",
    categoryId: "voice",
    featureIds: ["voice.assemblyAi", "voice.credentials"],
    targetIds: ["voice-input"],
  },
  {
    id: "voice-translation",
    categoryId: "voice",
    featureIds: ["voice.outputLanguage"],
    targetIds: ["voice-translation-model"],
  },
  {
    id: "voice-recording",
    categoryId: "voice",
    featureIds: [],
    targetIds: ["voice-recording-options"],
  },
  {
    id: "voice-cleanup",
    categoryId: "voice",
    featureIds: [],
    targetIds: ["voice-cleanup-model", "voice-cleanup-mode", "voice-cleanup-instructions"],
  },
  {
    id: "voice-project-context",
    categoryId: "voice",
    featureIds: [],
    targetIds: ["project-speech-context"],
  },
  {
    id: "voice-transcript-transfer",
    categoryId: "voice",
    featureIds: ["voice.transcriptPortability"],
    targetIds: [],
  },
  {
    id: "knowledge-graph",
    categoryId: "knowledge",
    featureIds: ["knowledge.graph"],
    targetIds: [],
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
  },
  {
    id: "indexing-models",
    categoryId: "knowledge",
    featureIds: ["knowledge.projectIndexingDefaultModel", "knowledge.projectIndexingDecisionModel"],
    targetIds: ["knowledge.projectIndexingReviewDefaults"],
  },
  {
    id: "resources",
    categoryId: "system",
    featureIds: ["resource.adaptiveAdmission", "resource.processSuspension"],
    targetIds: [],
  },
  {
    id: "diagnostics",
    categoryId: "system",
    featureIds: ["resource.diagnostics"],
    targetIds: [],
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
  },
  {
    id: "mcp-skills",
    categoryId: "integrations",
    featureIds: ["integration.mcp", "integration.skills"],
    targetIds: [],
  },
  {
    id: "privacy",
    categoryId: "integrations",
    featureIds: ["integration.analyticsRemoval"],
    targetIds: [],
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly categoryId: string;
  readonly featureIds: ReadonlyArray<BetterT3FeatureId>;
  readonly targetIds: ReadonlyArray<string>;
}>;

export type BetterT3SettingsSubgroupId = (typeof subgroupDefinitions)[number]["id"];
export type BetterT3SettingsCategoryId = (typeof subgroupDefinitions)[number]["categoryId"];

export interface BetterT3SettingsSubgroup {
  readonly id: BetterT3SettingsSubgroupId;
  readonly categoryId: BetterT3SettingsCategoryId;
  readonly titleMessageId: InterfaceMessageKey;
  readonly featureIds: ReadonlyArray<BetterT3FeatureId>;
  readonly targetIds: ReadonlyArray<string>;
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

export const BETTER_T3_SETTINGS_CATEGORY_IDS: ReadonlyArray<BetterT3SettingsCategoryId> = [
  ...new Set(BETTER_T3_SETTINGS_SUBGROUPS.map((group) => group.categoryId)),
];

const CATEGORY_TARGET_PREFIX = "better-t3-group-";

/** The category holding a deep-link target, so a link can open that category's page. */
export function resolveBetterT3SettingsCategoryForTarget(
  targetId: string,
): BetterT3SettingsCategoryId | null {
  if (targetId.startsWith(CATEGORY_TARGET_PREFIX)) {
    const categoryId = targetId.slice(CATEGORY_TARGET_PREFIX.length);
    return BETTER_T3_SETTINGS_CATEGORY_IDS.find((id) => id === categoryId) ?? null;
  }
  return getBetterT3SettingsSubgroupForTarget(targetId)?.categoryId ?? null;
}
