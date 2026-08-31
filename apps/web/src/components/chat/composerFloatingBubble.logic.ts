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
