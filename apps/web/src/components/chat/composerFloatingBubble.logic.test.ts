import {
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveComposerFloatingBubbleEnabled,
  resolveComposerFloatingBubbleLayout,
} from "./composerFloatingBubble.logic";

describe("resolveComposerFloatingBubbleEnabled", () => {
  it("floats activity for the desktop Card Deck with either plan presentation", () => {
    expect(resolveComposerFloatingBubbleEnabled(DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1, true)).toBe(
      false,
    );
    expect(resolveComposerFloatingBubbleEnabled(DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1, true)).toBe(
      true,
    );

    const bubbleSettings = {
      ...DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
      flags: {
        ...DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1.flags,
        "chat.classicBubbleOnly": true,
        "chat.workspaceCardDeck": true,
      },
    };
    expect(resolveComposerFloatingBubbleEnabled(bubbleSettings, true)).toBe(true);
    expect(
      resolveComposerFloatingBubbleEnabled(
        {
          ...bubbleSettings,
          flags: { ...bubbleSettings.flags, "chat.classicBubbleOnly": false },
        },
        true,
      ),
    ).toBe(true);
    expect(resolveComposerFloatingBubbleEnabled(bubbleSettings, false)).toBe(false);
    expect(
      resolveComposerFloatingBubbleEnabled(
        {
          ...bubbleSettings,
          flags: { ...bubbleSettings.flags, "chat.workspaceCardDeck": false },
        },
        true,
      ),
    ).toBe(false);
  });
});

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
