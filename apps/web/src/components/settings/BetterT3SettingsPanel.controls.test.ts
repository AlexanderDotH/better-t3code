import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  buildAutoReasoningModelSelectionPatch,
  buildBetterT3ScalarControlPatch,
  resolveBetterT3ModelSelection,
  supportsAutoReasoningEvaluationProvider,
} from "./BetterT3SettingsPanel.controls";

const codexId = ProviderInstanceId.make("codex");

function entry(
  models: ReadonlyArray<{ slug: string; isDefault?: boolean; isSelectable?: boolean }>,
) {
  return {
    instanceId: codexId,
    driverKind: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot: {} as ServerProvider,
    models: models.map((model) => ({
      slug: model.slug,
      name: model.slug,
      isCustom: false,
      capabilities: null,
      ...(model.isDefault === undefined ? {} : { isDefault: model.isDefault }),
      ...(model.isSelectable === undefined ? {} : { isSelectable: model.isSelectable }),
    })),
  } satisfies ProviderInstanceEntry;
}

describe("resolveBetterT3ModelSelection", () => {
  it("reads an available stored model and falls back without exposing an unavailable model", () => {
    const available = entry([
      { slug: "current", isDefault: true },
      { slug: "retired", isSelectable: false },
    ]);

    expect(
      resolveBetterT3ModelSelection([available], { instanceId: codexId, model: "current" }),
    ).toEqual({ instanceId: codexId, model: "current" });
    expect(
      resolveBetterT3ModelSelection([available], { instanceId: codexId, model: "retired" }),
    ).toEqual({ instanceId: codexId, model: "current" });
  });

  it("never carries the thread-only Auto marker into a decision-model selector", () => {
    expect(
      resolveBetterT3ModelSelection([entry([{ slug: "current" }])], {
        instanceId: codexId,
        model: "current",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "t3AutoReasoning", value: true },
        ],
      }),
    ).toEqual({
      instanceId: codexId,
      model: "current",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
  });
});

describe("Auto Reasoning evaluation model settings", () => {
  it("keeps every supported evaluation provider available", () => {
    for (const driver of [
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "opencode",
      "gemini",
      "chatgpt",
      "openrouter",
      "openai",
    ]) {
      expect(
        supportsAutoReasoningEvaluationProvider({ driver: ProviderDriverKind.make(driver) }),
      ).toBe(true);
    }
    expect(
      supportsAutoReasoningEvaluationProvider({
        driver: ProviderDriverKind.make("unsupported-evaluator"),
      }),
    ).toBe(false);
  });

  it("persists a concrete evaluator without the chat Auto marker and resets to Automatic", () => {
    const selected = {
      instanceId: codexId,
      model: "gpt-5.6-luna",
      options: [
        { id: "reasoningEffort", value: "low" },
        { id: "t3AutoReasoning", value: true },
      ],
    };

    expect(buildAutoReasoningModelSelectionPatch(selected)).toEqual({
      autoReasoningModelSelection: {
        instanceId: codexId,
        model: "gpt-5.6-luna",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    });
    expect(buildAutoReasoningModelSelectionPatch(null)).toEqual({
      autoReasoningModelSelection: null,
    });
  });
});

describe("buildBetterT3ScalarControlPatch", () => {
  it("writes the exact compatibility field for scalar controls", () => {
    for (const value of ["native", "better-t3"] as const) {
      expect(buildBetterT3ScalarControlPatch({ id: "chat.contextWindowSelector", value })).toEqual({
        contextWindowSelector: value,
      });
    }
    expect(buildBetterT3ScalarControlPatch({ id: "agent.cavemanMode", value: "full" })).toEqual({
      agentEnhancement: { cavemanMode: "full" },
    });
    expect(
      buildBetterT3ScalarControlPatch({ id: "chat.sorting.projects", value: "manual" }),
    ).toEqual({ sidebarProjectSortOrder: "manual" });
    expect(
      buildBetterT3ScalarControlPatch({ id: "chat.sorting.threads", value: "created_at" }),
    ).toEqual({ sidebarThreadSortOrder: "created_at" });
    expect(buildBetterT3ScalarControlPatch({ id: "chat.settling.days", value: null })).toEqual({
      sidebarAutoSettleAfterDays: null,
    });
    expect(buildBetterT3ScalarControlPatch({ id: "chat.settling.onMerge", value: false })).toEqual({
      sidebarAutoSettleOnMerge: false,
    });
    expect(
      buildBetterT3ScalarControlPatch({ id: "voice.outputLanguage", value: "english" }),
    ).toEqual({ voiceInputOutputLanguage: "english" });
  });
});
