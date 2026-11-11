import { BETTER_T3_FEATURE_REGISTRY } from "@t3tools/contracts";
import { translateInterfaceMessage } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import {
  BETTER_T3_SETTINGS_SUBGROUPS,
  getBetterT3SettingsSubgroupForFeature,
  getBetterT3SettingsSubgroupForTarget,
  getBetterT3SettingsSubgroups,
  resolveBetterT3SettingsCategoryForTarget,
} from "./betterT3SettingsLayout.ts";

describe("Better T3 settings layout", () => {
  it("resolves deep-link targets to the category page that shows them", () => {
    expect(resolveBetterT3SettingsCategoryForTarget("chat.classicSidebar")).toBe("sidebar");
    expect(resolveBetterT3SettingsCategoryForTarget("voice-cleanup-model")).toBe("voice");
    expect(resolveBetterT3SettingsCategoryForTarget("better-t3-group-usage")).toBe("usage");
    expect(resolveBetterT3SettingsCategoryForTarget("better-t3-group-missing")).toBeNull();
    expect(resolveBetterT3SettingsCategoryForTarget("")).toBeNull();
  });

  it("assigns every registry feature to exactly one subgroup", () => {
    const featureIds = BETTER_T3_SETTINGS_SUBGROUPS.flatMap((group) => group.featureIds);
    expect(featureIds.toSorted()).toEqual(
      BETTER_T3_FEATURE_REGISTRY.map((feature) => feature.id).toSorted(),
    );
    expect(new Set(featureIds).size).toBe(featureIds.length);
  });

  it("keeps dependent model choices beside their main control", () => {
    for (const [control, model] of [
      ["agent.fetch", "agent.fetchModel"],
      ["agent.parallelPlanImplementation", "agent.parallelPlanReviewer"],
      ["agent.contextCompaction", "agent.contextCompactionModel"],
      ["voice.outputLanguage", "voice-translation-model"],
    ] as const) {
      expect(getBetterT3SettingsSubgroupForTarget(control)?.id).toBe(
        getBetterT3SettingsSubgroupForTarget(model)?.id,
      );
    }
  });

  it("preserves Composer cards and the combined reasoning control", () => {
    expect(getBetterT3SettingsSubgroupForFeature("chat.classicBubbleOnly")).toMatchObject({
      id: "composer-cards",
      categoryId: "composer",
    });
    expect(getBetterT3SettingsSubgroupForFeature("chat.workspaceCardDeck")?.id).toBe(
      "composer-cards",
    );
    expect(getBetterT3SettingsSubgroupForFeature("agent.reasoningWorkingOverlay")?.id).toBe(
      getBetterT3SettingsSubgroupForFeature("agent.reasoningVisibility")?.id,
    );
    expect(getBetterT3SettingsSubgroupForFeature("agent.reasoningVisibility")?.categoryId).toBe(
      "chat",
    );
    expect(
      getBetterT3SettingsSubgroupForFeature("integration.suppressErrorsAndWarnings")?.categoryId,
    ).toBe("general");
  });

  it("gives specialized contents and their direct links a single owner", () => {
    const targetIds = BETTER_T3_SETTINGS_SUBGROUPS.flatMap((group) => group.targetIds);
    expect(new Set(targetIds).size).toBe(targetIds.length);
    for (const [target, owner] of [
      ["better-t3-interface-language", "language"],
      ["setting-glass-opacity", "glass"],
      ["response-metrics", "response-metrics"],
      ["setting-chat-content-width", "chat-width"],
      ["legacy-context-window-indicator", "context-display"],
      ["usage-pacing", "usage-display"],
      ["usage-hard-budget", "daily-budget"],
      ["usage-workday", "workday"],
      ["voice.credentials", "voice-access"],
      ["voice-cleanup-model", "voice-cleanup"],
      ["project-speech-context", "voice-project-context"],
      ["knowledge.projectIndexingMaster", "project-indexing"],
      ["knowledge.projectIndexingDefaultModel", "indexing-models"],
      ["knowledge.projectIndexingDecisionModel", "indexing-models"],
      ["knowledge.projectIndexingReviewDefaults", "indexing-models"],
    ] as const) {
      expect(getBetterT3SettingsSubgroupForTarget(target)?.id).toBe(owner);
    }
  });

  it("lists a category's groups in order", () => {
    expect(getBetterT3SettingsSubgroups("agents").map((group) => group.id)).toEqual([
      "fetch",
      "parallel-plan",
      "context-compaction",
      "auto-reasoning",
      "agent-workflow",
      "agent-collaboration",
    ]);
    expect(getBetterT3SettingsSubgroups("unknown")).toEqual([]);
    expect(getBetterT3SettingsSubgroupForTarget("unknown")).toBeUndefined();
    expect(getBetterT3SettingsSubgroupForFeature("unknown")).toBeUndefined();
  });

  it("has translated group titles and compact summaries in every supported language", () => {
    for (const language of ["en", "de", "fr"] as const) {
      for (const group of BETTER_T3_SETTINGS_SUBGROUPS) {
        const title = translateInterfaceMessage(language, group.titleMessageId);
        expect(title.trim()).not.toBe("");
        expect(title).not.toBe(group.titleMessageId);
      }
      expect(translateInterfaceMessage(language, "settings.betterT3.summary.on")).not.toBe(
        "settings.betterT3.summary.on",
      );
      expect(translateInterfaceMessage(language, "settings.betterT3.summary.off")).not.toBe(
        "settings.betterT3.summary.off",
      );
    }
  });
});
