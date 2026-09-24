import type {
  ProjectIndexModelSelection,
  ServerProvider,
  UnifiedSettings,
} from "@t3tools/contracts";
import { useMemo } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  NO_PROVIDER_MODEL_SELECTION,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { projectIndexModelLabel } from "./projectIndexModelLabel";

export function ProjectIndexModelPicker({
  selection,
  settings,
  providers,
  disabled,
  onChange,
  label,
}: {
  readonly selection: ProjectIndexModelSelection | null;
  readonly settings: UnifiedSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly disabled: boolean;
  readonly onChange: (selection: ProjectIndexModelSelection) => void;
  readonly label?: string;
}) {
  const { message } = useInterfaceTranslator();
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const models = useMemo(
    () =>
      getCustomModelOptionsByInstance(settings, providers, selection?.instanceId, selection?.model),
    [settings, providers, selection],
  );
  const selectedEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const selectedEntryAvailable = selectedEntry && isProviderInstancePickerReady(selectedEntry);
  const activeInstanceId =
    (selectedEntryAvailable ? selectedEntry.instanceId : undefined) ??
    entries.find((entry) => isProviderInstancePickerReady(entry))?.instanceId ??
    entries[0]?.instanceId ??
    NO_PROVIDER_MODEL_SELECTION.instanceId;
  const hasModels = entries.some(
    (entry) =>
      isProviderInstancePickerReady(entry) &&
      (models.get(entry.instanceId) ?? []).some((model) => !model.isUnavailable),
  );

  return (
    <ProviderModelPicker
      activeInstanceId={activeInstanceId}
      model={selectedEntryAvailable ? (selection?.model ?? "") : ""}
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={models}
      disabled={disabled || !hasModels}
      triggerVariant="outline"
      triggerClassName="w-full max-w-none sm:w-64 sm:max-w-64"
      triggerAriaLabel={label ?? message("projectIndexing.model")}
      fallbackToFirstModel={false}
      {...(!selectedEntryAvailable
        ? {
            placeholder:
              selection === null
                ? message("projectIndexing.chooseModel")
                : `${projectIndexModelLabel(selection, providers)} · ${message("projectIndexing.modelUnavailable")}`,
          }
        : {})}
      onInstanceModelChange={(instanceId, model) => onChange({ instanceId, model })}
    />
  );
}
