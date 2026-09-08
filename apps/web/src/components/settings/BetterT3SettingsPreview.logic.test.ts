import {
  BETTER_T3_FEATURE_REGISTRY,
  type BetterT3FeatureControlStateV1,
  type BetterT3FeatureId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildBetterT3SettingsPreviewModel } from "./BetterT3SettingsPreview.logic";

function feature(
  id: BetterT3FeatureId,
  value: boolean,
  availability: BetterT3FeatureControlStateV1["availability"]["state"] = "available",
): BetterT3FeatureControlStateV1 {
  const descriptor = BETTER_T3_FEATURE_REGISTRY.find((entry) => entry.id === id);
  if (!descriptor) throw new Error(`Missing Better T3 descriptor: ${id}`);
  return {
    descriptor,
    availability: { state: availability },
    value,
    source: "better-t3",
  };
}

describe("buildBetterT3SettingsPreviewModel", () => {
  it("previews effective workflow and layout settings immediately", () => {
    const model = buildBetterT3SettingsPreviewModel({
      features: [
        feature("agent.planMode", true),
        feature("agent.deepThinking", true),
        feature("agent.promptImprovement", true),
        feature("agent.reasoningVisibility", true),
        feature("agent.generalSubagents", true),
        feature("agent.projectCoordination", false),
        feature("chat.workspaceCardDeck", true),
        feature("chat.cardMorphing", true),
        feature("chat.characterStreamingMotion", true),
        feature("chat.classicSidebar", true),
        feature("chat.draftIndicators", true),
      ],
      chatVisualMode: "classic",
      sidebarPosition: "right",
    });

    expect(model.agent).toMatchObject({
      planMode: true,
      deepThinking: true,
      promptImprovement: true,
      reasoningVisibility: true,
      generalSubagents: true,
      projectCoordination: false,
    });
    expect(model.chat).toMatchObject({
      workspaceCardDeck: true,
      cardMorphing: true,
      characterStreamingMotion: true,
      classicSidebar: true,
      draftIndicators: true,
      presentation: "classic",
      sidebarPosition: "right",
    });
  });

  it("does not animate a stored child feature while its dependency is blocked", () => {
    const model = buildBetterT3SettingsPreviewModel({
      features: [
        feature("chat.workspaceCardDeck", false),
        feature("chat.cardMorphing", true, "blocked"),
        feature("chat.characterStreamingMotion", true),
      ],
      chatVisualMode: "current",
      sidebarPosition: "left",
    });

    expect(model.chat.workspaceCardDeck).toBe(false);
    expect(model.chat.cardMorphing).toBe(false);
    expect(model.chat.characterStreamingMotion).toBe(true);
  });

  it("changes only the relevant animation key when a previewed setting changes", () => {
    const base = {
      chatVisualMode: "current" as const,
      sidebarPosition: "left" as const,
    };
    const before = buildBetterT3SettingsPreviewModel({
      ...base,
      features: [feature("chat.workspaceCardDeck", true), feature("chat.cardMorphing", false)],
    });
    const after = buildBetterT3SettingsPreviewModel({
      ...base,
      features: [feature("chat.workspaceCardDeck", true), feature("chat.cardMorphing", true)],
    });

    expect(after.chat.animationKey).not.toBe(before.chat.animationKey);
    expect(after.agent.animationKey).toBe(before.agent.animationKey);
  });
});
