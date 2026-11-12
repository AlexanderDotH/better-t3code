import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ModelCapabilities,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  textGenerationModelSettingsPatch,
  updateSettingsModelOption,
} from "./mobile-model-settings";

describe("settings model options", () => {
  it("keeps unrelated project overrides and clears inheritance without writing null to a required selection", () => {
    const projectId = ProjectId.make("project");
    const selection: ModelSelection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    };
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [projectId]: {
          threadTitleInstructions: "Keep it short",
          textGenerationModelSelection: selection,
        },
      },
    };
    expect(textGenerationModelSettingsPatch(settings, projectId, null)).toEqual({
      projectSettingsOverrides: { [projectId]: { threadTitleInstructions: "Keep it short" } },
    });
    expect(textGenerationModelSettingsPatch(settings, projectId, selection)).toEqual({
      projectSettingsOverrides: { [projectId]: settings.projectSettingsOverrides[projectId] },
    });
    expect(textGenerationModelSettingsPatch(settings, null, selection)).toEqual({
      textGenerationModelSelection: selection,
    });
  });

  it("serializes select and boolean traits without losing the selected model or automatic reasoning", () => {
    const capabilities: ModelCapabilities = {
      optionDescriptors: [
        {
          id: "effort",
          label: "Effort",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
        },
        { id: "fast", label: "Fast", type: "boolean" },
      ],
    };
    const selection: ModelSelection = {
      instanceId: ProviderInstanceId.make("claudeAgent_work"),
      model: "sonnet",
      options: [
        { id: "effort", value: "low" },
        { id: "t3AutoReasoning", value: true },
      ],
    };
    const fast = updateSettingsModelOption(selection, capabilities, { id: "fast", value: true });
    expect(fast).toEqual({
      ...selection,
      options: [
        { id: "effort", value: "low" },
        { id: "fast", value: true },
        { id: "t3AutoReasoning", value: true },
      ],
    });
    expect(
      updateSettingsModelOption(fast!, capabilities, { id: "effort", value: "high" })?.options,
    ).toEqual([
      { id: "effort", value: "high" },
      { id: "fast", value: true },
      { id: "t3AutoReasoning", value: true },
    ]);
    expect(
      updateSettingsModelOption(selection, capabilities, { id: "effort", value: "missing" }),
    ).toBeNull();
    expect(
      updateSettingsModelOption(selection, capabilities, { id: "fast", value: "yes" }),
    ).toBeNull();
  });
});
