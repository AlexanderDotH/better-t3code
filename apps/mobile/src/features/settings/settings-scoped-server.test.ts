import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ProjectId,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SettingsTarget } from "./settings-environment-filter";
import {
  planMobileScopedSettingsClear,
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
} from "./settings-scoped-server";

const firstId = "first" as EnvironmentId;
const secondId = "second" as EnvironmentId;
const firstProject = "first-project" as ProjectId;
const secondProject = "second-project" as ProjectId;

function environment(
  environmentId: EnvironmentId,
  settings: ServerSettings,
  responseStreamingModes = true,
): SettingsTarget {
  return {
    environmentId,
    serverConfig: {
      settings,
      environment: {
        capabilities: {
          projectSettingsOverrides: true,
          responseStreamingModes,
        },
      },
    },
  } as SettingsTarget;
}

describe("mobile project settings scope", () => {
  it("edits each checkout's own override without changing either environment default", () => {
    const firstSettings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      responseStreamingMode: "paragraph",
      projectSettingsOverrides: { [firstProject]: { defaultAutoPull: true } },
    };
    const secondSettings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      responseStreamingMode: "token",
      projectSettingsOverrides: {},
    };
    const targets = resolveMobileSettingsTargets(
      [environment(firstId, firstSettings), environment(secondId, secondSettings)],
      [
        { environmentId: firstId, id: firstProject },
        { environmentId: secondId, id: secondProject },
      ],
    );

    const writes = planMobileScopedSettingsPatch(targets, true, {
      responseStreamingMode: "turn",
    });
    expect(writes).toEqual([
      {
        environmentId: firstId,
        patch: {
          projectSettingsOverrides: {
            [firstProject]: { defaultAutoPull: true, responseStreamingMode: "turn" },
          },
        },
      },
      {
        environmentId: secondId,
        patch: { projectSettingsOverrides: { [secondProject]: { responseStreamingMode: "turn" } } },
      },
    ]);
    expect(firstSettings.responseStreamingMode).toBe("paragraph");
    expect(secondSettings.responseStreamingMode).toBe("token");
  });

  it("removes a project override when a picker sends null for a key that cannot store it", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [firstProject]: { defaultThreadEnvMode: "worktree", defaultAutoPull: true },
      },
    };
    const targets = resolveMobileSettingsTargets(
      [environment(firstId, settings)],
      [{ environmentId: firstId, id: firstProject }],
    );
    expect(planMobileScopedSettingsPatch(targets, true, { defaultThreadEnvMode: null })).toEqual([
      {
        environmentId: firstId,
        patch: { projectSettingsOverrides: { [firstProject]: { defaultAutoPull: true } } },
      },
    ]);
    expect(planMobileScopedSettingsPatch(targets, true, { defaultModelSelection: null })).toEqual([
      {
        environmentId: firstId,
        patch: {
          projectSettingsOverrides: {
            [firstProject]: {
              defaultThreadEnvMode: "worktree",
              defaultAutoPull: true,
              defaultModelSelection: null,
            },
          },
        },
      },
    ]);
  });

  it("resets only the selected page's override and rejects environment-wide writes", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [firstProject]: { defaultAutoPull: true, responseStreamingMode: "turn" },
      },
    };
    const targets = resolveMobileSettingsTargets(
      [environment(firstId, settings)],
      [{ environmentId: firstId, id: firstProject }],
    );

    expect(planMobileScopedSettingsClear(targets, ["responseStreamingMode"])).toEqual([
      {
        environmentId: firstId,
        patch: { projectSettingsOverrides: { [firstProject]: { defaultAutoPull: true } } },
      },
    ]);
    expect(
      planMobileScopedSettingsPatch(targets, true, { enableProviderUpdateChecks: false }),
    ).toEqual([]);
  });

  it.each(["turn", "token"] as const)(
    "writes %s using each selected environment's streaming contract",
    (responseStreamingMode) => {
      const targets = resolveMobileSettingsTargets(
        [
          environment(firstId, DEFAULT_SERVER_SETTINGS, false),
          environment(secondId, DEFAULT_SERVER_SETTINGS),
        ],
        null,
      );
      expect(
        planMobileScopedSettingsPatch(targets, false, {
          responseStreamingMode,
          enableAgentBrowserAccess: true,
        }),
      ).toEqual([
        {
          environmentId: firstId,
          patch: {
            enableAgentBrowserAccess: true,
            enableLegacyTokenStreaming: responseStreamingMode === "token",
          },
        },
        {
          environmentId: secondId,
          patch: { responseStreamingMode, enableAgentBrowserAccess: true },
        },
      ]);
    },
  );

  it("does not send paragraph streaming to an older environment", () => {
    const targets = resolveMobileSettingsTargets(
      [environment(firstId, DEFAULT_SERVER_SETTINGS, false)],
      null,
    );
    expect(
      planMobileScopedSettingsPatch(targets, false, {
        responseStreamingMode: "paragraph",
      }),
    ).toEqual([]);
    expect(
      planMobileScopedSettingsPatch(targets, false, {
        responseStreamingMode: "paragraph",
        enableAgentBrowserAccess: true,
      }),
    ).toEqual([{ environmentId: firstId, patch: { enableAgentBrowserAccess: true } }]);
  });

  it("leaves older environment streaming unchanged when editing a project's other settings", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableLegacyTokenStreaming: true,
      projectSettingsOverrides: { [firstProject]: { defaultAutoPull: true } },
    };
    const targets = resolveMobileSettingsTargets(
      [environment(firstId, settings, false)],
      [{ environmentId: firstId, id: firstProject }],
    );
    expect(
      planMobileScopedSettingsPatch(targets, true, {
        responseStreamingMode: "turn",
      }),
    ).toEqual([]);
    expect(
      planMobileScopedSettingsPatch(targets, true, {
        responseStreamingMode: "turn",
        enableAgentBrowserAccess: true,
      }),
    ).toEqual([
      {
        environmentId: firstId,
        patch: {
          projectSettingsOverrides: {
            [firstProject]: { defaultAutoPull: true, enableAgentBrowserAccess: true },
          },
        },
      },
    ]);
    expect(settings.enableLegacyTokenStreaming).toBe(true);
  });
});
