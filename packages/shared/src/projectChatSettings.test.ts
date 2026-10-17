import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ProjectChatSettings,
  type ProjectSettingsOverrides,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createModelSelection } from "./model.ts";
import { applyServerSettingsPatch } from "./serverSettings.ts";

const first = ProjectId.make("chat-first");
const second = ProjectId.make("chat-second");
const modelSelection = createModelSelection(ProviderInstanceId.make("codex-work"), "gpt-5.4", [
  { id: "reasoningEffort", value: "high" },
  { id: "fastMode", value: true },
]);
const remembered: ProjectChatSettings = {
  modelSelection,
  runtimeMode: "auto",
  composerMode: "deep-plan",
};

function configuredSettings(overrides: ProjectSettingsOverrides = {}) {
  return applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
    projectSettingsOverrides: { [first]: overrides },
    projectChatSettings: { [first]: remembered, [second]: remembered },
  });
}

describe("project chat settings patches", () => {
  it("replaces only the addressed project, including the complete model options", () => {
    const current = configuredSettings();
    const replacement = {
      ...remembered,
      modelSelection: createModelSelection(ProviderInstanceId.make("claude-work"), "claude-opus", [
        { id: "reasoningEffort", value: "low" },
      ]),
    };
    const replaced = applyServerSettingsPatch(current, {
      projectChatSettings: { [first]: replacement },
    });
    expect(replaced.projectChatSettings).toEqual({ [first]: replacement, [second]: remembered });
    expect(current.projectChatSettings[first]).toEqual(remembered);

    const withoutOptions = {
      ...replacement,
      modelSelection: createModelSelection(ProviderInstanceId.make("claude-work"), "claude-opus"),
    };
    const cleared = applyServerSettingsPatch(replaced, {
      projectChatSettings: { [first]: withoutOptions },
    });
    const later = applyServerSettingsPatch(cleared, { defaultAutoPull: true });
    expect(later.projectChatSettings[first]).toEqual(withoutOptions);
    expect(later.projectChatSettings[first]?.modelSelection?.options).toBeUndefined();
  });

  it("supports sparse defaults, a retained empty entry, and deletion independently", () => {
    const sparse = applyServerSettingsPatch(configuredSettings(), {
      projectChatSettings: { [first]: { composerMode: "plan" } },
    });
    expect(sparse.projectChatSettings[first]).toEqual({ composerMode: "plan" });
    const defaults = applyServerSettingsPatch(sparse, { projectChatSettings: { [first]: {} } });
    expect(Object.hasOwn(defaults.projectChatSettings, first)).toBe(true);
    expect(defaults.projectChatSettings[first]).toEqual({});
    const removed = applyServerSettingsPatch(defaults, { projectChatSettings: { [first]: null } });
    expect(Object.hasOwn(removed.projectChatSettings, first)).toBe(false);
    expect(removed.projectChatSettings[second]).toEqual(remembered);
  });

  it("clears the remembered model when the project model default changes", () => {
    const current = configuredSettings({ defaultModelSelection: modelSelection });
    const next = applyServerSettingsPatch(current, {
      projectSettingsOverrides: {
        [first]: {
          defaultModelSelection: createModelSelection(ProviderInstanceId.make("codex"), "new"),
        },
      },
    });
    expect(next.projectChatSettings[first]).toEqual({
      runtimeMode: "auto",
      composerMode: "deep-plan",
    });
    expect(next.projectChatSettings[second]).toEqual(remembered);
  });

  it("clears only remembered permissions when the project permission default changes", () => {
    const next = applyServerSettingsPatch(
      configuredSettings({ defaultRuntimeMode: "full-access" }),
      {
        projectSettingsOverrides: { [first]: { defaultRuntimeMode: "approval-required" } },
      },
    );
    expect(next.projectChatSettings[first]).toEqual({ modelSelection, composerMode: "deep-plan" });
    expect(next.projectChatSettings[second]).toEqual(remembered);
  });

  it("clears reset default fields and retains an empty record to prevent old-thread bootstrap", () => {
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      projectSettingsOverrides: { [first]: { defaultModelSelection: modelSelection } },
      projectChatSettings: { [first]: { modelSelection } },
    });
    for (const replacement of [{}, null]) {
      const reset = applyServerSettingsPatch(current, {
        projectSettingsOverrides: { [first]: replacement },
      });
      expect(Object.hasOwn(reset.projectChatSettings, first)).toBe(true);
      expect(reset.projectChatSettings[first]).toEqual({});
    }
    const resetPermissions = applyServerSettingsPatch(
      configuredSettings({ defaultRuntimeMode: "full-access", defaultAutoPull: true }),
      { projectSettingsOverrides: { [first]: { defaultAutoPull: true } } },
    );
    expect(resetPermissions.projectChatSettings[first]).toEqual({
      modelSelection,
      composerMode: "deep-plan",
    });
  });

  it("preserves newer remembered choices when a default update is retried", () => {
    const retriedModelUpdate = applyServerSettingsPatch(
      configuredSettings({ defaultModelSelection: modelSelection }),
      { projectSettingsOverrides: { [first]: { defaultModelSelection: modelSelection } } },
    );
    expect(retriedModelUpdate.projectChatSettings[first]).toEqual(remembered);
    const retriedRuntimeUpdate = applyServerSettingsPatch(
      configuredSettings({ defaultRuntimeMode: "full-access" }),
      { projectSettingsOverrides: { [first]: { defaultRuntimeMode: "full-access" } } },
    );
    expect(retriedRuntimeUpdate.projectChatSettings[first]).toEqual(remembered);
  });

  it("preserves remembered choices when environment or unrelated project defaults change", () => {
    const current = configuredSettings({
      defaultModelSelection: modelSelection,
      defaultRuntimeMode: "full-access",
      defaultAutoPull: false,
    });
    const next = applyServerSettingsPatch(current, {
      defaultModelSelection: null,
      defaultRuntimeMode: "approval-required",
      projectSettingsOverrides: {
        [first]: {
          defaultModelSelection: {
            ...modelSelection,
            options: [...(modelSelection.options ?? [])],
          },
          defaultRuntimeMode: "full-access",
          defaultAutoPull: true,
        },
      },
    });
    expect(next.projectChatSettings).toEqual(current.projectChatSettings);
  });

  it("gives an explicit remembered-settings replacement in the same patch precedence", () => {
    const current = configuredSettings({ defaultModelSelection: modelSelection });
    const next = applyServerSettingsPatch(current, {
      projectSettingsOverrides: { [first]: null },
      projectChatSettings: { [first]: remembered },
    });
    expect(next.projectChatSettings[first]).toEqual(remembered);
    const deleted = applyServerSettingsPatch(current, {
      projectSettingsOverrides: { [first]: null },
      projectChatSettings: { [first]: null },
    });
    expect(Object.hasOwn(deleted.projectChatSettings, first)).toBe(false);
  });
});
