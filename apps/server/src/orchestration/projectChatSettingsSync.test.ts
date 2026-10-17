import { assert, it } from "@effect/vitest";
import { CommandId, ProjectId, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ServerSettingsService } from "../serverSettings.ts";
import { syncProjectChatSettingsForCommand } from "./projectChatSettingsSync.ts";

const projectId = ProjectId.make("project-a");
const otherProjectId = ProjectId.make("project-b");
const remembered: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "remembered-model",
  options: [{ id: "reasoning_effort", value: "high" }],
};
const configured: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "configured-model",
};
const chatSettings = {
  modelSelection: remembered,
  runtimeMode: "approval-required" as const,
  composerMode: "plan" as const,
};

it.effect("legacy project defaults reset the remembered model without changing other choices", () =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    yield* syncProjectChatSettingsForCommand(settings, {
      type: "project.meta.update",
      commandId: CommandId.make("set-default"),
      projectId,
      defaultModelSelection: configured,
    });
    const saved = yield* settings.getSettings;
    assert.deepEqual(saved.projectSettingsOverrides[projectId], {
      defaultModelSelection: configured,
    });
    assert.deepEqual(saved.projectChatSettings[projectId], {
      runtimeMode: "approval-required",
      composerMode: "plan",
    });
    assert.deepEqual(saved.projectChatSettings[otherProjectId], chatSettings);

    yield* settings.updateSettings({
      projectChatSettings: { [projectId]: chatSettings },
    });
    yield* syncProjectChatSettingsForCommand(settings, {
      type: "project.meta.update",
      commandId: CommandId.make("set-default"),
      projectId,
      defaultModelSelection: configured,
    });
    assert.deepEqual((yield* settings.getSettings).projectChatSettings[projectId], chatSettings);
  }).pipe(
    Effect.provide(
      ServerSettingsService.layerTest({
        projectChatSettings: { [projectId]: chatSettings, [otherProjectId]: chatSettings },
      }),
    ),
  ),
);

it.effect(
  "clearing a legacy project model restores inheritance and retains other project overrides",
  () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettingsService;
      yield* syncProjectChatSettingsForCommand(settings, {
        type: "project.meta.update",
        commandId: CommandId.make("clear-default"),
        projectId,
        defaultModelSelection: null,
      });
      const saved = yield* settings.getSettings;
      assert.deepEqual(saved.projectSettingsOverrides[projectId], { defaultAutoPull: true });
      assert.deepEqual(saved.projectChatSettings[projectId], {
        runtimeMode: "approval-required",
        composerMode: "plan",
      });
    }).pipe(
      Effect.provide(
        ServerSettingsService.layerTest({
          projectSettingsOverrides: {
            [projectId]: { defaultModelSelection: configured, defaultAutoPull: true },
          },
          projectChatSettings: { [projectId]: chatSettings },
        }),
      ),
    ),
);

it.effect("project deletion removes only its remembered configuration", () =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    yield* syncProjectChatSettingsForCommand(settings, {
      type: "project.delete",
      commandId: CommandId.make("delete-project"),
      projectId,
    });
    assert.deepEqual((yield* settings.getSettings).projectChatSettings, {
      [otherProjectId]: chatSettings,
    });
  }).pipe(
    Effect.provide(
      ServerSettingsService.layerTest({
        projectChatSettings: { [projectId]: chatSettings, [otherProjectId]: chatSettings },
      }),
    ),
  ),
);

it.effect("renaming a project leaves remembered settings intact", () =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    yield* syncProjectChatSettingsForCommand(settings, {
      type: "project.meta.update",
      commandId: CommandId.make("rename-project"),
      projectId,
      title: "Renamed",
    });
    assert.deepEqual((yield* settings.getSettings).projectChatSettings[projectId], chatSettings);
  }).pipe(
    Effect.provide(
      ServerSettingsService.layerTest({ projectChatSettings: { [projectId]: chatSettings } }),
    ),
  ),
);
