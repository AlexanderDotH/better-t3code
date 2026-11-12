import {
  DEFAULT_SERVER_SETTINGS,
  ServerSettingsPatch,
  EnvironmentId,
  ProjectId,
  type ServerSettings,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildBackgroundActivityProfilePatch,
  buildWritingStylePatch,
  uniformBackgroundActivityProfile,
  uniformWritingStyleField,
  buildBackgroundActivityOverridePatch,
  buildWorktreeCleanupPatch,
  parseSettingsInteger,
  planMobileScopedSettingsTransform,
} from "./server-controls-settings";
import { resolveMobileSettingsTargets } from "./settings-scoped-server";
import type { SettingsTarget } from "./settings-environment-filter";

const encodeSettingsPatch = Schema.encodeSync(ServerSettingsPatch);

const style = (mode: "repo_conventions" | "custom", customInstructions = ""): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  sourceControlWritingStyle: {
    mode,
    customInstructions,
    followChangeRequestTemplates: true,
  },
});

describe("mobile source control writing style", () => {
  it("sends only the changed field to an environment and the whole style to a project", () => {
    const targets = [{ settings: style("custom", "Be brief.") }];
    expect(buildWritingStylePatch(targets, false, { mode: "repo_conventions" })).toEqual({
      sourceControlWritingStyle: { mode: "repo_conventions" },
    });
    expect(buildWritingStylePatch(targets, true, { mode: "repo_conventions" })).toEqual({
      sourceControlWritingStyle: {
        mode: "repo_conventions",
        customInstructions: "Be brief.",
        followChangeRequestTemplates: true,
      },
    });
  });

  it("reads a field as mixed when targets disagree", () => {
    const targets = [{ settings: style("custom") }, { settings: style("repo_conventions") }];
    expect(uniformWritingStyleField(targets, "mode")).toBeNull();
    expect(uniformWritingStyleField(targets, "followChangeRequestTemplates")).toBe(true);
    expect(uniformWritingStyleField([], "mode")).toBeNull();
  });
});

describe("mobile background activity policy", () => {
  it("changes the shared policy and keeps existing interval overrides", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      backgroundActivity: {
        schemaVersion: 1,
        profile: "custom",
        baseProfile: "balanced",
        overrides: { automaticGitFetchInterval: Duration.seconds(90) },
      },
    };
    const patch = buildBackgroundActivityProfilePatch(settings, "battery-saver");
    const resolved = resolveServerBackgroundActivitySettings({ ...settings, ...patch });
    expect(resolved.profile).toBe("battery-saver");
    expect(Duration.toSeconds(resolved.automaticGitFetchInterval)).toBe(90);
    expect(uniformBackgroundActivityProfile([{ settings }])).toBe("balanced");
    expect(
      uniformBackgroundActivityProfile([{ settings }, { settings: { ...settings, ...patch } }]),
    ).toBeNull();
    const second: ServerSettings = {
      ...settings,
      backgroundActivity: {
        ...settings.backgroundActivity,
        overrides: { automaticGitFetchInterval: Duration.seconds(300), pauseWhenOnBattery: true },
      },
    };
    const targets = [settings, second].map(
      (value, index) =>
        ({
          environmentId: EnvironmentId.make(`environment-${index}`),
          serverConfig: { settings: value, environment: { capabilities: {} } },
        }) as SettingsTarget,
    );
    const writes = planMobileScopedSettingsTransform(
      resolveMobileSettingsTargets(targets, null),
      false,
      (value) => buildBackgroundActivityProfilePatch(value, "performance"),
    );
    expect(
      writes.map(({ patch }) => encodeSettingsPatch(patch).backgroundActivity?.overrides),
    ).toEqual([
      { automaticGitFetchInterval: 90_000 },
      { automaticGitFetchInterval: 300_000, pauseWhenOnBattery: true },
    ]);
    const override = buildBackgroundActivityOverridePatch(second, { pauseWhenHostLocked: false });
    expect(encodeSettingsPatch(override).backgroundActivity).toMatchObject({
      profile: "custom",
      baseProfile: "balanced",
      overrides: {
        automaticGitFetchInterval: 300_000,
        pauseWhenOnBattery: true,
        pauseWhenHostLocked: false,
      },
    });
  });
});

describe("mobile worktree cleanup patches", () => {
  it("writes legacy environment rules and keeps each project's other rules and overrides", () => {
    const projectId = ProjectId.make("project");
    const first = {
      ...DEFAULT_SERVER_SETTINGS,
      storageCleanup: { ...DEFAULT_SERVER_SETTINGS.storageCleanup, worktreeAfterDays: 14 },
      projectSettingsOverrides: { [projectId]: { defaultAutoPull: true } },
    };
    expect(buildWorktreeCleanupPatch(first, false, { worktreeOnMerge: true })).toEqual({
      storageCleanup: { worktreeOnMerge: true },
    });
    const custom = buildWorktreeCleanupPatch(first, true, { worktreeOnMerge: true });
    expect(custom.worktreeCleanup).toMatchObject({
      mode: "custom",
      rules: { worktreeAfterDays: 14, worktreeOnMerge: true },
    });
    const environment = {
      environmentId: EnvironmentId.make("environment"),
      serverConfig: { settings: first, environment: { capabilities: {} } },
    } as SettingsTarget;
    const targets = resolveMobileSettingsTargets(
      [environment],
      [{ environmentId: environment.environmentId, id: projectId }],
    );
    expect(
      planMobileScopedSettingsTransform(targets, true, (settings) =>
        buildWorktreeCleanupPatch(settings, true, { worktreeAfterDays: null }),
      )[0]?.patch.projectSettingsOverrides?.[projectId],
    ).toMatchObject({
      defaultAutoPull: true,
      worktreeCleanup: { mode: "custom", rules: { worktreeAfterDays: null } },
    });
    const configured: ServerSettings = {
      ...first,
      worktreeCleanup: {
        mode: "custom",
        rules: { ...first.storageCleanup, worktreeAfterDays: 45 },
      },
    };
    expect(buildWorktreeCleanupPatch(configured, false, { worktreeOnDelete: false })).toMatchObject(
      {
        worktreeCleanup: {
          mode: "custom",
          rules: { worktreeAfterDays: 45, worktreeOnDelete: false },
        },
      },
    );
  });

  it.each(["3.5", "3days", "-1", "1e2", "Infinity", "3651"])(
    "rejects invalid retention %s",
    (value) => {
      expect(parseSettingsInteger(value, 0, 3650, true)).toBeUndefined();
    },
  );

  it("keeps zero distinct from disabled retention", () => {
    expect(parseSettingsInteger("0", 0, 3650, true)).toBe(0);
    expect(parseSettingsInteger("", 0, 3650, true)).toBeNull();
    expect(parseSettingsInteger("0", 1, 3650, true)).toBeUndefined();
    expect(parseSettingsInteger(" 3650 ", 1, 3650)).toBe(3650);
  });
});
