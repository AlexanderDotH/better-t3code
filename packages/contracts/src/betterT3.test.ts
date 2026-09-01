import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  BETTER_T3_FEATURE_REGISTRY,
  BetterT3SettingsBootstrapInputV1,
  BetterT3SettingsV1,
  type BetterT3SwitchFeatureId,
  bootstrapBetterT3SettingsV1,
  makeBetterT3SettingsV1,
  resolveBetterT3FeatureFlag,
} from "./betterT3.ts";

const decodeSettings = Schema.decodeUnknownSync(BetterT3SettingsV1);
const decodeBootstrapInput = Schema.decodeUnknownSync(BetterT3SettingsBootstrapInputV1);
const encodeSettings = Schema.encodeSync(BetterT3SettingsV1);

describe("Better T3 feature registry", () => {
  it("gives every feature one localized descriptor and valid dependencies", () => {
    const ids = BETTER_T3_FEATURE_REGISTRY.map(({ id }) => id);
    const knownIds = new Set(ids);

    expect(new Set(ids).size).toBe(ids.length);
    for (const descriptor of BETTER_T3_FEATURE_REGISTRY) {
      expect(descriptor.labelMessageId).toMatch(/^betterT3\./);
      expect(descriptor.descriptionMessageId).toMatch(/^betterT3\./);
      for (const dependency of descriptor.dependencies) {
        expect(knownIds.has(dependency.featureId)).toBe(true);
        expect(dependency.featureId).not.toBe(descriptor.id);
      }
    }
  });

  it("keeps the two resource policies independent", () => {
    const admission = BETTER_T3_FEATURE_REGISTRY.find(
      ({ id }) => id === "resource.adaptiveAdmission",
    );
    const suspension = BETTER_T3_FEATURE_REGISTRY.find(
      ({ id }) => id === "resource.processSuspension",
    );

    expect(admission?.dependencies).toEqual([]);
    expect(suspension?.dependencies).toEqual([]);
  });

  it("does not advertise web-only controls on mobile while keeping real server mirrors", () => {
    for (const featureId of [
      "agent.expandedComposerControls",
      "agent.reasoningVisibility",
      "chat.workspaceCardDeck",
      "chat.cardMorphing",
      "chat.characterStreamingMotion",
      "chat.classicBubbleOnly",
      "chat.shiftClickShowLess",
      "chat.draftIndicators",
    ] as const) {
      expect(
        BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === featureId)?.availability.surfaces,
      ).toEqual(["web", "desktop"]);
    }
    expect(
      BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "agent.deepThinking")?.availability
        .surfaces,
    ).toEqual(["web", "desktop", "phone", "tablet"]);
  });

  it("advertises the real Git workbench on every client surface", () => {
    const workbench = BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "workspace.gitWorkbench");

    expect(workbench?.availability).toEqual({
      surfaces: ["web", "desktop", "phone", "tablet"],
      capabilities: [{ name: "gitWorkbenchVersion", minimumVersion: 1 }],
    });
    expect(workbench?.defaults).toEqual({ clean: false, existing: true });
  });

  it("gates resource diagnostics on every surface through its versioned capability", () => {
    const diagnostics = BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "resource.diagnostics");

    expect(diagnostics?.availability).toEqual({
      surfaces: ["web", "desktop", "phone", "tablet"],
      capabilities: [{ name: "resourceDiagnosticsVersion", minimumVersion: 1 }],
    });
  });

  it("declares Shift-click Show Less unavailable until Classic sidebar is enabled", () => {
    expect(
      BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "chat.shiftClickShowLess")?.dependencies,
    ).toEqual([{ featureId: "chat.classicSidebar", condition: "enabled" }]);
  });

  it("gates transcript portability on the agent workflow capability", () => {
    expect(
      BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "voice.transcriptPortability")
        ?.availability.capabilities,
    ).toEqual([{ name: "agentWorkflowVersion", minimumVersion: 1 }]);
  });

  it("declares the Mobile Classic preference as a read-write compatibility alias", () => {
    expect(
      BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "chat.classicSidebar")
        ?.compatibilityMirrors,
    ).toEqual([
      { store: "client-settings", path: "legacySidebarEnabled", access: "read-write" },
      {
        store: "mobile-preferences",
        path: "legacyThreadListEnabled",
        access: "read-write",
      },
    ]);
  });

  it("keeps AssemblyAI credential presence migration-only instead of a boolean write mirror", () => {
    expect(
      BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "voice.assemblyAi")?.compatibilityMirrors,
    ).toEqual([]);
  });

  it("keeps the parallel reviewer in its environment-owned selector", () => {
    expect(
      BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "agent.parallelPlanReviewer")
        ?.compatibilityMirrors,
    ).toEqual([
      {
        store: "server-settings",
        path: "parallelPlanReviewModelSelection",
        access: "read-write",
      },
    ]);
  });

  it("keeps the Auto Reasoning model in its environment-owned selector", () => {
    expect(
      BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === "agent.autoReasoningModel"),
    ).toMatchObject({
      section: "agent-workflows",
      scope: "environment",
      controlKind: "selector",
      compatibilityMirrors: [
        {
          store: "server-settings",
          path: "autoReasoningModelSelection",
          access: "read-write",
        },
      ],
    });
  });

  it.each([
    ["agent.fetch", "agentWorkflowVersion"],
    ["agent.fetchModel", "agentWorkflowVersion"],
    ["agent.parallelPlanImplementation", "agentWorkflowVersion"],
    ["agent.parallelPlanReviewer", "agentWorkflowVersion"],
    ["agent.autoReasoningModel", "agentWorkflowVersion"],
    ["agent.promptImprovement", "agentWorkflowVersion"],
    ["agent.deepThinking", "environmentSettingsVersion"],
    ["agent.cavemanMode", "environmentSettingsVersion"],
    ["voice.assemblyAi", "environmentSettingsVersion"],
    ["voice.credentials", "environmentSettingsVersion"],
    ["integration.skills", "environmentSettingsVersion"],
    ["workspace.checkpoints", "projectSettingsVersion"],
    ["resource.adaptiveAdmission", "resourceProtectionVersion"],
    ["resource.processSuspension", "resourceProtectionVersion"],
  ] as const)("gates %s on %s version 1", (featureId, capabilityName) => {
    expect(
      BETTER_T3_FEATURE_REGISTRY.find(({ id }) => id === featureId)?.availability.capabilities,
    ).toEqual([{ name: capabilityName, minimumVersion: 1 }]);
  });
});

describe("BetterT3SettingsV1", () => {
  it("disables every switch on clean installs and preserves only formerly implicit switches", () => {
    const switchFeatureIds = BETTER_T3_FEATURE_REGISTRY.filter(
      ({ controlKind }) => controlKind === "switch",
    ).map(({ id }) => id as BetterT3SwitchFeatureId);
    const clean = makeBetterT3SettingsV1("clean-install");
    const existing = makeBetterT3SettingsV1("existing-install-migration");

    expect(
      switchFeatureIds.filter((featureId) => resolveBetterT3FeatureFlag(clean, featureId)),
    ).toEqual([]);
    expect(
      switchFeatureIds.filter((featureId) => resolveBetterT3FeatureFlag(existing, featureId)),
    ).toEqual([
      "agent.generalSubagents",
      "agent.projectCoordination",
      "chat.workspaceCardDeck",
      "chat.cardMorphing",
      "chat.characterStreamingMotion",
      "chat.classicBubbleOnly",
      "chat.shiftClickShowLess",
      "chat.draftIndicators",
      "workspace.gitWorkbench",
      "voice.assemblyAi",
      "resource.adaptiveAdmission",
      "resource.processSuspension",
    ]);
  });

  it("keeps clean installs simple while preserving implicit features on migrated installs", () => {
    const clean = makeBetterT3SettingsV1("clean-install");
    const existing = makeBetterT3SettingsV1("existing-install-migration");

    expect(resolveBetterT3FeatureFlag(clean, "chat.workspaceCardDeck")).toBe(false);
    expect(resolveBetterT3FeatureFlag(clean, "chat.characterStreamingMotion")).toBe(false);
    expect(resolveBetterT3FeatureFlag(clean, "knowledge.graph")).toBe(false);
    expect(resolveBetterT3FeatureFlag(existing, "chat.workspaceCardDeck")).toBe(true);
    expect(resolveBetterT3FeatureFlag(existing, "agent.generalSubagents")).toBe(true);
    expect(resolveBetterT3FeatureFlag(existing, "voice.assemblyAi")).toBe(true);
    expect(resolveBetterT3FeatureFlag(existing, "knowledge.graph")).toBe(false);
  });

  it("preserves explicit legacy and new choices across decoding", () => {
    const settings = makeBetterT3SettingsV1("existing-install-migration", {
      "chat.workspaceCardDeck": false,
      "resource.processSuspension": false,
    });
    const decoded = decodeSettings(settings);

    expect(resolveBetterT3FeatureFlag(decoded, "chat.workspaceCardDeck")).toBe(false);
    expect(resolveBetterT3FeatureFlag(decoded, "resource.processSuspension")).toBe(false);
  });

  it("round-trips unknown V1 flags so a mixed-version client does not erase them", () => {
    const decoded = decodeSettings({
      version: 1,
      initialization: "clean-install",
      flags: { "future.feature": true },
    });

    expect(encodeSettings(decoded)).toEqual({
      version: 1,
      initialization: "clean-install",
      flags: { "future.feature": true },
    });
  });
});

describe("BetterT3SettingsBootstrapInputV1", () => {
  it("seeds only missing flags from persisted compatibility mirrors", () => {
    const input = decodeBootstrapInput({
      version: 1,
      initialization: "existing-install-migration",
      persistedSettings: {
        version: 1,
        initialization: "existing-install-migration",
        flags: { "chat.classicSidebar": false },
      },
      compatibilityFlags: [
        { featureId: "chat.classicSidebar", enabled: true },
        { featureId: "agent.fetch", enabled: true },
        { featureId: "agent.deepThinking", enabled: false },
      ],
    });

    expect(bootstrapBetterT3SettingsV1(input)).toEqual({
      version: 1,
      initialization: "existing-install-migration",
      flags: {
        "chat.classicSidebar": false,
        "agent.fetch": true,
        "agent.deepThinking": false,
      },
    });
  });

  it("distinguishes a clean bootstrap from an existing persisted installation", () => {
    const clean = bootstrapBetterT3SettingsV1({
      version: 1,
      initialization: "clean-install",
      persistedSettings: null,
      compatibilityFlags: [],
    });
    const existing = bootstrapBetterT3SettingsV1({
      version: 1,
      initialization: "existing-install-migration",
      persistedSettings: null,
      compatibilityFlags: [],
    });

    expect(resolveBetterT3FeatureFlag(clean, "voice.assemblyAi")).toBe(false);
    expect(resolveBetterT3FeatureFlag(existing, "voice.assemblyAi")).toBe(true);
    expect(resolveBetterT3FeatureFlag(clean, "chat.workspaceCardDeck")).toBe(false);
    expect(resolveBetterT3FeatureFlag(existing, "chat.workspaceCardDeck")).toBe(true);
  });

  it("rejects unknown compatibility feature ids at the versioned boundary", () => {
    expect(() =>
      decodeBootstrapInput({
        version: 1,
        initialization: "existing-install-migration",
        persistedSettings: null,
        compatibilityFlags: [{ featureId: "future.unknown", enabled: true }],
      }),
    ).toThrow();
  });
});
