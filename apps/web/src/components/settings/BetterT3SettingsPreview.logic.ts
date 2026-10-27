import type {
  BetterT3FeatureControlStateV1,
  BetterT3FeatureId,
  ChatVisualMode,
  ChatWidth,
  ContextWindowSelector,
  SidebarPosition,
} from "@t3tools/contracts";

import { resolveChatContentPreviewWidthPercent } from "../chat/chatContentWidth";

export interface BetterT3AgentPreviewModel {
  readonly animationKey: string;
  readonly deepThinking: boolean;
  readonly generalSubagents: boolean;
  readonly planMode: boolean;
  readonly projectCoordination: boolean;
  readonly promptImprovement: boolean;
  readonly reasoningVisibility: boolean;
  readonly reasoningWorkingOverlay: boolean;
  readonly reasoningInMessage: boolean;
}

export interface BetterT3ChatPreviewModel {
  readonly animationKey: string;
  readonly cardMorphing: boolean;
  readonly characterStreamingMotion: boolean;
  readonly composerPlanBubble: boolean;
  readonly expandedComposerControls: boolean;
  readonly classicSidebar: boolean;
  readonly draftIndicators: boolean;
  readonly presentation: ChatVisualMode;
  readonly presentationMotion: boolean;
  readonly contentWidthPercent: number;
  readonly contextWindowSelector: ContextWindowSelector;
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

function animationKey(values: ReadonlyArray<boolean | string | number>): string {
  return values.map((value) => (typeof value === "boolean" ? Number(value) : value)).join(":");
}

export function buildBetterT3SettingsPreviewModel(input: {
  readonly features: ReadonlyArray<BetterT3FeatureControlStateV1>;
  readonly chatVisualMode: ChatVisualMode;
  readonly contextWindowSelector: ContextWindowSelector;
  readonly sidebarPosition: SidebarPosition;
  readonly showReasoning?: boolean;
  readonly reasoningWorkingOverlay?: boolean;
  readonly reasoningInMessage?: boolean;
  readonly chatWidth?: ChatWidth;
  readonly chatWidthCustomizationEnabled?: boolean;
  readonly chatWidthAdjustmentPercent?: number;
}): BetterT3SettingsPreviewModel {
  const reasoningVisibility =
    input.showReasoning ?? effectiveFeatureEnabled(input.features, "agent.reasoningVisibility");
  const reasoningWorkingOverlay =
    reasoningVisibility &&
    (input.reasoningWorkingOverlay ??
      effectiveFeatureEnabled(input.features, "agent.reasoningWorkingOverlay"));
  const contentWidthPercent = input.chatWidthCustomizationEnabled
    ? resolveChatContentPreviewWidthPercent(true, input.chatWidthAdjustmentPercent ?? 0)
    : input.chatWidth === "full"
      ? 100
      : input.chatWidth === "wide"
        ? 90
        : 60;
  const agent = {
    planMode: effectiveFeatureEnabled(input.features, "agent.planMode"),
    deepThinking: effectiveFeatureEnabled(input.features, "agent.deepThinking"),
    promptImprovement: effectiveFeatureEnabled(input.features, "agent.promptImprovement"),
    reasoningVisibility,
    reasoningWorkingOverlay,
    reasoningInMessage:
      reasoningVisibility &&
      !reasoningWorkingOverlay &&
      (input.reasoningInMessage ??
        effectiveFeatureEnabled(input.features, "agent.reasoningInMessage")),
    generalSubagents: effectiveFeatureEnabled(input.features, "agent.generalSubagents"),
    projectCoordination: effectiveFeatureEnabled(input.features, "agent.projectCoordination"),
  };
  const chat = {
    expandedComposerControls: effectiveFeatureEnabled(
      input.features,
      "agent.expandedComposerControls",
    ),
    workspaceCardDeck: effectiveFeatureEnabled(input.features, "chat.workspaceCardDeck"),
    cardMorphing: effectiveFeatureEnabled(input.features, "chat.cardMorphing"),
    characterStreamingMotion: effectiveFeatureEnabled(
      input.features,
      "chat.characterStreamingMotion",
    ),
    composerPlanBubble: effectiveFeatureEnabled(input.features, "chat.classicBubbleOnly"),
    classicSidebar: effectiveFeatureEnabled(input.features, "chat.classicSidebar"),
    draftIndicators: effectiveFeatureEnabled(input.features, "chat.draftIndicators"),
    presentation: input.chatVisualMode,
    presentationMotion: effectiveFeatureEnabled(input.features, "chat.presentationMotion"),
    contentWidthPercent,
    contextWindowSelector: input.contextWindowSelector,
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
