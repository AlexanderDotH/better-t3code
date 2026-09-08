import type {
  BetterT3FeatureControlStateV1,
  BetterT3FeatureId,
  ChatVisualMode,
  SidebarPosition,
} from "@t3tools/contracts";

export interface BetterT3AgentPreviewModel {
  readonly animationKey: string;
  readonly deepThinking: boolean;
  readonly generalSubagents: boolean;
  readonly planMode: boolean;
  readonly projectCoordination: boolean;
  readonly promptImprovement: boolean;
  readonly reasoningVisibility: boolean;
}

export interface BetterT3ChatPreviewModel {
  readonly animationKey: string;
  readonly cardMorphing: boolean;
  readonly characterStreamingMotion: boolean;
  readonly classicSidebar: boolean;
  readonly draftIndicators: boolean;
  readonly presentation: ChatVisualMode;
  readonly sidebarPosition: SidebarPosition;
  readonly workspaceCardDeck: boolean;
}

export interface BetterT3SettingsPreviewModel {
  readonly agent: BetterT3AgentPreviewModel;
  readonly chat: BetterT3ChatPreviewModel;
}

function effectiveFeatureEnabled(
  features: ReadonlyArray<BetterT3FeatureControlStateV1>,
  featureId: BetterT3FeatureId,
): boolean {
  const feature = features.find((entry) => entry.descriptor.id === featureId);
  return feature?.value === true && feature.availability.state === "available";
}

function animationKey(values: ReadonlyArray<boolean | string>): string {
  return values.map((value) => (typeof value === "boolean" ? Number(value) : value)).join(":");
}

export function buildBetterT3SettingsPreviewModel(input: {
  readonly features: ReadonlyArray<BetterT3FeatureControlStateV1>;
  readonly chatVisualMode: ChatVisualMode;
  readonly sidebarPosition: SidebarPosition;
}): BetterT3SettingsPreviewModel {
  const agent = {
    planMode: effectiveFeatureEnabled(input.features, "agent.planMode"),
    deepThinking: effectiveFeatureEnabled(input.features, "agent.deepThinking"),
    promptImprovement: effectiveFeatureEnabled(input.features, "agent.promptImprovement"),
    reasoningVisibility: effectiveFeatureEnabled(input.features, "agent.reasoningVisibility"),
    generalSubagents: effectiveFeatureEnabled(input.features, "agent.generalSubagents"),
    projectCoordination: effectiveFeatureEnabled(input.features, "agent.projectCoordination"),
  };
  const chat = {
    workspaceCardDeck: effectiveFeatureEnabled(input.features, "chat.workspaceCardDeck"),
    cardMorphing: effectiveFeatureEnabled(input.features, "chat.cardMorphing"),
    characterStreamingMotion: effectiveFeatureEnabled(
      input.features,
      "chat.characterStreamingMotion",
    ),
    classicSidebar: effectiveFeatureEnabled(input.features, "chat.classicSidebar"),
    draftIndicators: effectiveFeatureEnabled(input.features, "chat.draftIndicators"),
    presentation: input.chatVisualMode,
    sidebarPosition: input.sidebarPosition,
  };

  return {
    agent: {
      ...agent,
      animationKey: animationKey(Object.values(agent)),
    },
    chat: {
      ...chat,
      animationKey: animationKey(Object.values(chat)),
    },
  };
}
