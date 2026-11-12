import type {
  ModelCapabilities,
  ModelSelection,
  ProjectId,
  ProviderOptionSelection,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { replaceDescriptorCurrentValue } from "@t3tools/client-runtime/model-traits";
import {
  buildProviderOptionSelectionsFromDescriptors,
  createModelSelection,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";

export function updateSettingsModelOption(
  selection: ModelSelection,
  capabilities: ModelCapabilities,
  change: ProviderOptionSelection,
): ModelSelection | null {
  const descriptors = getProviderOptionDescriptors({
    caps: capabilities,
    selections: selection.options,
  });
  const descriptor = descriptors.find((candidate) => candidate.id === change.id);
  if (
    !descriptor ||
    (descriptor.type === "boolean"
      ? typeof change.value !== "boolean"
      : typeof change.value !== "string" ||
        !descriptor.options.some((option) => option.id === change.value))
  )
    return null;
  return createModelSelection(
    selection.instanceId,
    selection.model,
    buildProviderOptionSelectionsFromDescriptors(
      replaceDescriptorCurrentValue(descriptors, change.id, change.value),
      selection.options,
    ),
  );
}

export function textGenerationModelSettingsPatch(
  settings: ServerSettings,
  projectId: ProjectId | null,
  selection: ModelSelection | null,
): ServerSettingsPatch {
  if (projectId === null) return selection ? { textGenerationModelSelection: selection } : {};
  const override = { ...settings.projectSettingsOverrides[projectId] };
  if (selection === null) delete override.textGenerationModelSelection;
  else override.textGenerationModelSelection = selection;
  return { projectSettingsOverrides: { [projectId]: override } };
}
