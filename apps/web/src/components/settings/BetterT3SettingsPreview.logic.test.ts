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
        feature("agent.expandedComposerControls", true),
        feature("agent.reasoningVisibility", true),
        feature("agent.generalSubagents", true),
        feature("agent.projectCoordination", false),
        feature("chat.workspaceCardDeck", true),
        feature("chat.cardMorphing", true),
        feature("chat.characterStreamingMotion", true),
        feature("chat.classicBubbleOnly", true),
        feature("chat.classicSidebar", true),
        feature("chat.draftIndicators", true),
      ],
      chatVisualMode: "classic",
      contextWindowSelector: "native",
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
      composerPlanBubble: true,
      expandedComposerControls: true,
      classicSidebar: true,
      draftIndicators: true,
      presentation: "classic",
      contextWindowSelector: "native",
      sidebarPosition: "right",
    });
  });

  it("does not animate a stored child feature while its dependency is blocked", () => {
    const model = buildBetterT3SettingsPreviewModel({
      features: [
        feature("chat.workspaceCardDeck", false),
        feature("chat.cardMorphing", true, "blocked"),
        feature("chat.characterStreamingMotion", true),
        feature("chat.classicBubbleOnly", true, "blocked"),
      ],
      chatVisualMode: "current",
      contextWindowSelector: "better-t3",
      sidebarPosition: "left",
    });

    expect(model.chat.workspaceCardDeck).toBe(false);
    expect(model.chat.cardMorphing).toBe(false);
    expect(model.chat.characterStreamingMotion).toBe(true);
    expect(model.chat.composerPlanBubble).toBe(false);
  });

  it("changes only the relevant animation key when a previewed setting changes", () => {
    const base = {
      chatVisualMode: "current" as const,
      contextWindowSelector: "better-t3" as const,
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

it("uses the actual reasoning setting even when a stale feature flag disagrees", () => {
  const input = {
    features: [
      feature("agent.reasoningVisibility", false),
      feature("agent.reasoningWorkingOverlay", true, "blocked"),
    ],
    chatVisualMode: "better-t3" as const,
    reasoningWorkingOverlay: true,
    contextWindowSelector: "native" as const,
    sidebarPosition: "left" as const,
  };
  expect(buildBetterT3SettingsPreviewModel({ ...input, showReasoning: false }).agent).toMatchObject(
    {
      reasoningVisibility: false,
      reasoningWorkingOverlay: false,
    },
  );
  expect(buildBetterT3SettingsPreviewModel({ ...input, showReasoning: true }).agent).toMatchObject({
    reasoningVisibility: true,
    reasoningWorkingOverlay: true,
  });
});

it("keeps motion choices independent and follows the actual chat width", () => {
  const input = {
    features: [
      feature("chat.presentationMotion", false),
      feature("chat.characterStreamingMotion", true),
    ],
    chatVisualMode: "better-t3" as const,
    contextWindowSelector: "native" as const,
    sidebarPosition: "left" as const,
  };
  expect(buildBetterT3SettingsPreviewModel({ ...input, chatWidth: "full" }).chat).toMatchObject({
    presentationMotion: false,
    characterStreamingMotion: true,
    contentWidthPercent: 100,
  });
  expect(
    buildBetterT3SettingsPreviewModel({
      ...input,
      chatWidth: "wide",
      chatWidthCustomizationEnabled: true,
      chatWidthAdjustmentPercent: -100,
    }).chat.contentWidthPercent,
  ).toBe(30);
});
