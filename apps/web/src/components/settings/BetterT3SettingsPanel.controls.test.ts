import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  buildAutoReasoningModelSelectionPatch,
  buildKnowledgeGraphOwnerThreadOptions,
  buildBetterT3ScalarControlPatch,
  knowledgeGraphOwnerThreadKey,
  openKnowledgeGraphOwnerThread,
  resolveBetterT3ModelSelection,
  resolveKnowledgeGraphPauseAction,
  resolveSelectedKnowledgeGraphOwnerThread,
  resolveSelectedKnowledgeGraphProjectId,
  supportsAutoReasoningEvaluationProvider,
  supportsKnowledgeGraphEnrichment,
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

describe("supportsKnowledgeGraphEnrichment", () => {
  it("offers only the provider with positive semantic-enrichment conformance", () => {
    expect(supportsKnowledgeGraphEnrichment({ driver: ProviderDriverKind.make("openai") })).toBe(
      true,
    );
    for (const driver of ["codex", "claudeAgent", "chatgpt", "openrouter", "gemini"]) {
      expect(supportsKnowledgeGraphEnrichment({ driver: ProviderDriverKind.make(driver) })).toBe(
        false,
      );
    }
  });
});

describe("resolveSelectedKnowledgeGraphProjectId", () => {
  const first = ProjectId.make("project-1");
  const second = ProjectId.make("project-2");
  const projects = [
    { projectId: first, label: "First" },
    { projectId: second, label: "Second" },
  ];

  it("preserves a selected project and falls back when it disappears", () => {
    expect(resolveSelectedKnowledgeGraphProjectId(projects, second)).toBe(second);
    expect(resolveSelectedKnowledgeGraphProjectId(projects, ProjectId.make("missing"))).toBe(first);
    expect(resolveSelectedKnowledgeGraphProjectId([], first)).toBeNull();
  });
});

describe("resolveKnowledgeGraphPauseAction", () => {
  it("provides the reverse action for a paused graph", () => {
    expect(resolveKnowledgeGraphPauseAction("paused")).toEqual({
      paused: false,
      messageId: "knowledgeGraph.resume",
    });
    expect(resolveKnowledgeGraphPauseAction("indexing")).toEqual({
      paused: true,
      messageId: "knowledgeGraph.pause",
    });
  });
});

describe("Knowledge Graph owner routing", () => {
  const localEnvironmentId = EnvironmentId.make("environment-local");
  const remoteEnvironmentId = EnvironmentId.make("environment-remote");
  const localThread = {
    environmentId: localEnvironmentId,
    id: ThreadId.make("thread-local"),
    title: "Local thread",
    updatedAt: "2026-08-30T02:00:00.000Z",
    archivedAt: null,
  };
  const remoteThread = {
    environmentId: remoteEnvironmentId,
    id: ThreadId.make("thread-remote"),
    title: "Remote thread",
    updatedAt: "2026-08-30T03:00:00.000Z",
    archivedAt: null,
  };

  it("requires an explicit live thread in the selected environment", () => {
    const options = buildKnowledgeGraphOwnerThreadOptions(
      [
        localThread,
        remoteThread,
        {
          ...remoteThread,
          id: ThreadId.make("thread-archived"),
          title: "Archived",
          archivedAt: "2026-08-30T04:00:00.000Z",
        },
      ],
      remoteEnvironmentId,
    );

    expect(options).toEqual([remoteThread]);
    expect(resolveSelectedKnowledgeGraphOwnerThread(options, null)).toBeNull();
    expect(
      resolveSelectedKnowledgeGraphOwnerThread(options, knowledgeGraphOwnerThreadKey(remoteThread)),
    ).toEqual(remoteThread);
  });

  it("opens only the selected thread's real Knowledge Graph surface and route", () => {
    const opened: unknown[] = [];

    expect(
      openKnowledgeGraphOwnerThread(remoteThread, (threadRef, kind) => {
        opened.push({ threadRef, kind });
      }),
    ).toEqual({ environmentId: remoteEnvironmentId, threadId: remoteThread.id });
    expect(opened).toEqual([
      {
        threadRef: { environmentId: remoteEnvironmentId, threadId: remoteThread.id },
        kind: "knowledge-graph",
      },
    ]);
  });
});

describe("buildBetterT3ScalarControlPatch", () => {
  it("writes the exact compatibility field for scalar controls", () => {
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
