import { resolveBetterT3FeatureFlag, type BetterT3SettingsV1 } from "@t3tools/contracts";

export type ComposerFloatingBubbleLayout = {
  readonly placement: "hero" | "stacked";
  readonly visible: boolean;
};

export function resolveComposerFloatingBubbleLayout(input: {
  readonly isDraftHeroState: boolean;
  readonly nonChatWorkspaceCardActive: boolean;
  readonly workspaceCardExpanded: boolean;
}): ComposerFloatingBubbleLayout {
  return {
    placement: input.isDraftHeroState && !input.workspaceCardExpanded ? "hero" : "stacked",
    visible: !input.nonChatWorkspaceCardActive && !input.workspaceCardExpanded,
  };
}

export function resolveComposerFloatingBubbleEnabled(
  settings: BetterT3SettingsV1,
  desktopLayout: boolean,
): boolean {
  return desktopLayout && resolveBetterT3FeatureFlag(settings, "chat.workspaceCardDeck");
}
