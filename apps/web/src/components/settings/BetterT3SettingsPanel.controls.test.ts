import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  DEFAULT_UNIFIED_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  buildAutoReasoningModelSelectionPatch,
  buildBetterT3ScalarControlPatch,
  buildBetterT3SubgroupSummaries,
  buildProjectIndexingDecisionModelSelectionPatch,
  resolveBetterT3ModelSelection,
  supportsAutoReasoningEvaluationProvider,
} from "./BetterT3SettingsPanel.controls";

import { buildBetterT3ControlStates } from "./BetterT3SettingsPanel.logic";

const codexId = ProviderInstanceId.make("codex");
const summaryTranslate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;
const summaryFeatures = buildBetterT3ControlStates({
  registry: BETTER_T3_FEATURE_REGISTRY,
  device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  surface: "web",
  capabilities: { contextCompactionVersion: 1, agentWorkflowVersion: 1 },
});
const summaryProvider: ServerProvider = {
  instanceId: codexId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [{ slug: "chosen", name: "Chosen model", isCustom: false, capabilities: {} }],
  slashCommands: [],
  skills: [],
};

it("summarizes the saved model and changes state without falling back to an unrelated model", () => {
  const settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    autoReasoningModelSelection: { instanceId: codexId, model: "chosen" },
  };
  const summarize = (providers: readonly ServerProvider[]) =>
    buildBetterT3SubgroupSummaries({
      settings,
      providers,
      features: summaryFeatures,
      translate: summaryTranslate,
    });
  expect(summarize([summaryProvider])["auto-reasoning"]).toBe("Chosen model");
  expect(summarize([{ ...summaryProvider, models: [] }])["auto-reasoning"]).toBe(
    "chosen · Unavailable",
  );
  expect(
    summarize([
      {
        ...summaryProvider,
        models: [{ slug: "other", name: "Other model", isCustom: false, capabilities: {} }],
      },
    ])["auto-reasoning"],
  ).toBe("chosen · Unavailable");
  expect(
    summarize([{ ...summaryProvider, auth: { status: "unauthenticated" } }])["auto-reasoning"],
  ).toBe("Chosen model · Unavailable");
  expect(summarize([])["auto-reasoning"]).toBe("chosen · Unavailable");
});

it("keeps automatic model selection and native compaction summaries faithful to the current settings", () => {
  const nativeFeatures = summaryFeatures.map((feature) =>
    feature.descriptor.id === "agent.contextCompaction" ? { ...feature, value: false } : feature,
  );
  const native = buildBetterT3SubgroupSummaries({
    settings: DEFAULT_UNIFIED_SETTINGS,
    providers: [],
    features: nativeFeatures,
    translate: summaryTranslate,
  });
  expect(native["auto-reasoning"]).toBe("Automatic");
  expect(native["context-compaction"]).toBe("Codex");
  const background = buildBetterT3SubgroupSummaries({
    settings: DEFAULT_UNIFIED_SETTINGS,
    providers: [],
    features: summaryFeatures,
    translate: summaryTranslate,
  });
  expect(background["context-compaction"]).toBe("Better T3 Code · Automatic");
});

function entry(
  models: ReadonlyArray<{
    slug: string;
    isDefault?: boolean;
    isSelectable?: boolean;
    selectionSupport?: {
      readonly agent: boolean;
      readonly textGeneration: boolean;
      readonly decision: "none" | "prompted" | "native";
    };
  }>,
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
      capabilities: model.selectionSupport ? { selectionSupport: model.selectionSupport } : null,
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

  it("resolves native models only for decision selectors", () => {
    const available = entry([
      {
        slug: "agent",
        isDefault: true,
        selectionSupport: { agent: true, textGeneration: true, decision: "prompted" },
      },
      {
        slug: "native",
        isSelectable: false,
        selectionSupport: { agent: false, textGeneration: false, decision: "native" },
      },
    ]);
    const nativeSelection = { instanceId: codexId, model: "native" };

    expect(resolveBetterT3ModelSelection([available], nativeSelection, "decision")).toEqual(
      nativeSelection,
    );
    expect(resolveBetterT3ModelSelection([available], nativeSelection, "agent")).toEqual({
      instanceId: codexId,
      model: "agent",
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
    expect(buildProjectIndexingDecisionModelSelectionPatch(selected)).toEqual({
      projectIndexingDecisionModelSelection: {
        instanceId: codexId,
        model: "gpt-5.6-luna",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    });
    expect(buildProjectIndexingDecisionModelSelectionPatch(null)).toEqual({
      projectIndexingDecisionModelSelection: null,
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
