import { describe, expect, it } from "vite-plus/test";

import { resolveComposerFloatingBubbleLayout } from "./composerFloatingBubble.logic";

describe("resolveComposerFloatingBubbleLayout", () => {
  it("keeps transient composer surfaces above the compact Chat card", () => {
    expect(
      resolveComposerFloatingBubbleLayout({
        isDraftHeroState: false,
        nonChatWorkspaceCardActive: false,
        workspaceCardExpanded: false,
      }),
    ).toEqual({ placement: "stacked", visible: true });
  });

  it("keeps the draft composer centered while placing its bubble above the hero", () => {
    expect(
      resolveComposerFloatingBubbleLayout({
        isDraftHeroState: true,
        nonChatWorkspaceCardActive: false,
        workspaceCardExpanded: false,
      }),
    ).toEqual({ placement: "hero", visible: true });
  });

  it.each([
    { nonChatWorkspaceCardActive: true, workspaceCardExpanded: false },
    { nonChatWorkspaceCardActive: false, workspaceCardExpanded: true },
  ])("hides and inerts the bubble when Chat is not interactive", (state) => {
    expect(
      resolveComposerFloatingBubbleLayout({
        isDraftHeroState: false,
        ...state,
      }),
    ).toEqual({ placement: "stacked", visible: false });
  });
});
