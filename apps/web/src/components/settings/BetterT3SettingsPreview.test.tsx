import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  BETTER_T3_VISUAL_FEATURE_IDS,
  BetterT3FeatureChoice,
  BetterT3FeatureVisual,
} from "./BetterT3SettingsPreview";
import type {
  BetterT3AgentPreviewModel,
  BetterT3ChatPreviewModel,
} from "./BetterT3SettingsPreview.logic";

const translate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;

const agentModel: BetterT3AgentPreviewModel = {
  animationKey: "agent-preview",
  deepThinking: true,
  generalSubagents: true,
  planMode: true,
  projectCoordination: true,
  promptImprovement: true,
  reasoningVisibility: true,
};

const chatModel: BetterT3ChatPreviewModel = {
  animationKey: "chat-preview",
  cardMorphing: true,
  characterStreamingMotion: true,
  classicSidebar: false,
  draftIndicators: true,
  presentation: "current",
  sidebarPosition: "left",
  workspaceCardDeck: true,
};

describe("Better T3 settings previews", () => {
  it("provides one non-interactive visual for every represented setting", () => {
    for (const featureId of BETTER_T3_VISUAL_FEATURE_IDS) {
      const markup = renderToStaticMarkup(
        <BetterT3FeatureVisual
          featureId={featureId}
          model={{ agent: agentModel, chat: chatModel }}
          translate={translate}
        />,
      );

      expect(markup).toContain(`data-better-t3-feature-visual="${featureId}"`);
      expect(markup.match(/data-better-t3-feature-visual=/g)).toHaveLength(1);
      expect(markup).not.toContain("<button");
    }
  });

  it("shows the current setting state in the visual without becoming a second control", () => {
    const markup = renderToStaticMarkup(
      <BetterT3FeatureVisual
        featureId="agent.reasoningVisibility"
        model={{ agent: { ...agentModel, reasoningVisibility: false }, chat: chatModel }}
        translate={translate}
      />,
    );

    expect(markup).toContain("Disabled");
    expect(markup).toContain("opacity-40");
    expect(markup).not.toContain("aria-pressed");
  });

  it("offers both visual states as accessible side-by-side choices", () => {
    const markup = renderToStaticMarkup(
      <BetterT3FeatureChoice
        disabled={false}
        featureId="agent.planMode"
        model={{ agent: agentModel, chat: chatModel }}
        onChange={() => undefined}
        translate={translate}
        value={true}
      />,
    );

    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)).toHaveLength(2);
    expect(markup.match(/data-better-t3-feature-visual="agent\.planMode"/g)).toHaveLength(2);
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(markup).toContain("Build");
    expect(markup).toContain("Plan");
    expect(markup).not.toContain('role="switch"');
  });
});
