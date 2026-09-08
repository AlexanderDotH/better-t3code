import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
  ProviderDriverKind,
  type BetterT3SwitchFeatureId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ADDITIONAL_BETTER_T3_PROVIDER_DRIVERS,
  buildBetterT3ControlStates,
  buildBetterT3SwitchSettingsPatch,
  buildBetterT3SwitchStates,
  partitionBetterT3ProviderRows,
  resolveSelectedBetterT3EnvironmentId,
  updateBetterT3FeatureFlag,
} from "./BetterT3SettingsPanel.logic";

describe("buildBetterT3SwitchStates", () => {
  it("keeps registry order while honoring clean and migrated defaults", () => {
    const clean = buildBetterT3SwitchStates({
      registry: BETTER_T3_FEATURE_REGISTRY,
      device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      surface: "web",
      capabilities: {},
    });
    const migrated = buildBetterT3SwitchStates({
      registry: BETTER_T3_FEATURE_REGISTRY,
      device: DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
      environment: DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
      surface: "web",
      capabilities: {},
    });

    expect(clean.map((entry) => entry.descriptor.id)).toEqual(
      BETTER_T3_FEATURE_REGISTRY.filter((entry) => entry.controlKind === "switch").map(
        (entry) => entry.id,
      ),
    );
    expect(clean.find((entry) => entry.descriptor.id === "chat.workspaceCardDeck")?.enabled).toBe(
      false,
    );
    expect(
      migrated.find((entry) => entry.descriptor.id === "chat.workspaceCardDeck")?.enabled,
    ).toBe(true);
  });

  it("blocks dependent switches without mutating their stored preference", () => {
    const states = buildBetterT3SwitchStates({
      registry: BETTER_T3_FEATURE_REGISTRY,
      device: {
        version: 1,
        initialization: "clean-install",
        flags: { "chat.cardMorphing": true, "chat.workspaceCardDeck": false },
      },
      environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      surface: "web",
      capabilities: {},
    });

    expect(states.find((entry) => entry.descriptor.id === "chat.cardMorphing")).toMatchObject({
      enabled: true,
      availability: "blocked",
    });
  });
});

describe("buildBetterT3ControlStates", () => {
  it("keeps non-switch controls visible while capability-gating their actions", () => {
    const legacy = buildBetterT3ControlStates({
      registry: BETTER_T3_FEATURE_REGISTRY,
      device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      surface: "web",
      capabilities: {},
    });
    const current = buildBetterT3ControlStates({
      registry: BETTER_T3_FEATURE_REGISTRY,
      device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      surface: "web",
      capabilities: { knowledgeGraphVersion: 1 },
    });

    expect(legacy).toHaveLength(BETTER_T3_FEATURE_REGISTRY.length);
    expect(legacy.find((entry) => entry.descriptor.id === "knowledge.rebuild")).toMatchObject({
      availability: { state: "unsupported" },
      value: null,
    });
    expect(current.find((entry) => entry.descriptor.id === "knowledge.progress")).toMatchObject({
      availability: { state: "available" },
      value: null,
    });
    expect(current.find((entry) => entry.descriptor.id === "knowledge.rebuild")).toMatchObject({
      availability: { state: "blocked" },
      value: null,
    });
  });

  it("marks desktop-only controls unsupported on phone without hiding them", () => {
    const controls = buildBetterT3ControlStates({
      registry: BETTER_T3_FEATURE_REGISTRY,
      device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      surface: "phone",
      capabilities: {},
    });

    expect(controls.find((entry) => entry.descriptor.id === "chat.sidebarPosition")).toMatchObject({
      availability: { state: "unsupported" },
    });
  });

  it("keeps device controls usable while an environment-scoped control is unavailable offline", () => {
    const controls = buildBetterT3ControlStates({
      registry: BETTER_T3_FEATURE_REGISTRY,
      device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environment: DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
      surface: "web",
      capabilities: {},
      environmentAvailable: false,
    });

    expect(controls.find((entry) => entry.descriptor.id === "agent.planMode")).toMatchObject({
      availability: { state: "available" },
    });
    expect(controls.find((entry) => entry.descriptor.id === "agent.deepThinking")).toMatchObject({
      availability: { state: "unavailable" },
    });
  });

  it("blocks an enabled dependency when its parent is unavailable on the current surface", () => {
    const classicSidebar = BETTER_T3_FEATURE_REGISTRY.find(
      ({ id }) => id === "chat.classicSidebar",
    )!;
    const shiftClickShowLess = BETTER_T3_FEATURE_REGISTRY.find(
      ({ id }) => id === "chat.shiftClickShowLess",
    )!;
    const controls = buildBetterT3ControlStates({
      registry: [
        {
          ...classicSidebar,
          availability: { ...classicSidebar.availability, surfaces: ["desktop"] },
        },
        {
          ...shiftClickShowLess,
          availability: { ...shiftClickShowLess.availability, surfaces: ["web"] },
        },
      ],
      device: {
        ...DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
        flags: {
          "chat.classicSidebar": true,
          "chat.shiftClickShowLess": true,
        },
      },
      environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      surface: "web",
      capabilities: {},
    });

    expect(controls.find((entry) => entry.descriptor.id === "chat.classicSidebar")).toMatchObject({
      availability: { state: "unsupported" },
    });
    expect(
      controls.find((entry) => entry.descriptor.id === "chat.shiftClickShowLess"),
    ).toMatchObject({ availability: { state: "blocked" }, value: true });
  });
});

describe("resolveSelectedBetterT3EnvironmentId", () => {
  it("uses the requested connected environment and falls back to the primary environment", () => {
    const options = [{ environmentId: "primary" }, { environmentId: "remote" }];

    expect(resolveSelectedBetterT3EnvironmentId(options, "remote", "primary")).toBe("remote");
    expect(resolveSelectedBetterT3EnvironmentId(options, "missing", "primary")).toBe("primary");
  });

  it("falls back to the first environment and returns null when none exist", () => {
    expect(resolveSelectedBetterT3EnvironmentId([{ environmentId: "remote" }], null, null)).toBe(
      "remote",
    );
    expect(resolveSelectedBetterT3EnvironmentId([], "missing", "primary")).toBeNull();
  });
});

describe("updateBetterT3FeatureFlag", () => {
  it("preserves initialization and unrelated preferences while changing one feature", () => {
    const original = {
      version: 1 as const,
      initialization: "existing-install-migration" as const,
      flags: {
        "chat.workspaceCardDeck": true,
        "chat.cardMorphing": true,
      },
    };

    expect(updateBetterT3FeatureFlag(original, "chat.workspaceCardDeck", false)).toEqual({
      ...original,
      flags: {
        "chat.workspaceCardDeck": false,
        "chat.cardMorphing": true,
      },
    });
  });
});

describe("buildBetterT3SwitchSettingsPatch", () => {
  it("writes device registry flags and the existing Plan mode compatibility mirror together", () => {
    expect(buildBetterT3SwitchSettingsPatch("agent.planMode", true, "device")).toEqual({
      betterT3Device: { version: 1, flags: { "agent.planMode": true } },
      planModeEnabled: true,
    });
  });

  it("keeps environment-only invariants out of client settings", () => {
    expect(
      buildBetterT3SwitchSettingsPatch("resource.processSuspension", false, "environment"),
    ).toEqual({
      betterT3Environment: {
        version: 1,
        flags: { "resource.processSuspension": false },
      },
    });
  });

  it("persists both reverse states for every registered switch", () => {
    for (const descriptor of BETTER_T3_FEATURE_REGISTRY) {
      if (descriptor.controlKind !== "switch") continue;
      const featureId = descriptor.id as BetterT3SwitchFeatureId;
      for (const enabled of [true, false]) {
        const patch = buildBetterT3SwitchSettingsPatch(featureId, enabled, descriptor.scope);
        const registrySettings =
          descriptor.scope === "device" ? patch.betterT3Device : patch.betterT3Environment;
        expect(registrySettings?.flags?.[featureId], featureId).toBe(enabled);
      }
    }
  });
});

describe("partitionBetterT3ProviderRows", () => {
  it("preserves order and groups the four additional Better T3 drivers", () => {
    const rows = ["codex", "chatgpt", "gemini", "claudeAgent", "openrouter", "openai"].map(
      (driver, index) => ({ id: index, driver: ProviderDriverKind.make(driver) }),
    );

    expect(ADDITIONAL_BETTER_T3_PROVIDER_DRIVERS).toEqual([
      ProviderDriverKind.make("chatgpt"),
      ProviderDriverKind.make("gemini"),
      ProviderDriverKind.make("openrouter"),
      ProviderDriverKind.make("openai"),
    ]);
    expect(partitionBetterT3ProviderRows(rows)).toEqual({
      core: [rows[0], rows[3]],
      additional: [rows[1], rows[2], rows[4], rows[5]],
    });
  });
});
