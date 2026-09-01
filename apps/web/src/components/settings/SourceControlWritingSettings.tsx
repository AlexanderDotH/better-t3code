import { useAtomValue } from "@effect/atom-react";
import { useRef } from "react";
import type { SourceControlWritingStyleMode } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveSourceControlWriterModelSelection } from "@t3tools/shared/serverSettings";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { primaryServerProvidersAtom } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const MODE_OPTIONS: Record<
  SourceControlWritingStyleMode,
  { label: InterfaceMessageKey; description: InterfaceMessageKey }
> = {
  repo_conventions: {
    label: "settings.sourceControlWriting.repoConventions",
    description: "settings.sourceControlWriting.repoConventionsDescription",
  },
  conventional_commits: {
    label: "settings.sourceControlWriting.conventionalCommits",
    description: "settings.sourceControlWriting.conventionalCommitsDescription",
  },
  custom: {
    label: "settings.sourceControlWriting.custom",
    description: "settings.sourceControlWriting.customDescription",
  },
};

export function SourceControlWritingSettingsSection() {
  const translator = useInterfaceTranslator();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const customInstructionsRef = useRef<HTMLTextAreaElement>(null);
  const style = settings.sourceControlWritingStyle;
  const defaults = DEFAULT_UNIFIED_SETTINGS.sourceControlWritingStyle;
  const isSourceControlWritingStyleDirty =
    style.mode !== defaults.mode || style.customInstructions !== defaults.customInstructions;

  const defaultModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const usesDedicatedModel = settings.sourceControlWriterModelSelection !== null;
  const resolvedSourceControlWriterSelection = resolveSourceControlWriterModelSelection(
    settings,
    serverProviders,
  );
  const activeSelection =
    resolvedSourceControlWriterSelection === settings.textGenerationModelSelection
      ? defaultModelSelection
      : resolvedSourceControlWriterSelection;
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    activeSelection.instanceId,
    activeSelection.model,
  );

  return (
    <SettingsSection title={translator.message("settings.sourceControlWriting.section")}>
      <SettingsRow
        title={translator.message("settings.sourceControlWriting.style")}
        description={translator.message(MODE_OPTIONS[style.mode].description)}
        resetAction={
          isSourceControlWritingStyleDirty ? (
            <SettingResetButton
              label={translator.message("settings.sourceControlWriting.style")}
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    mode: defaults.mode,
                    customInstructions: defaults.customInstructions,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={style.mode}
            onValueChange={(value) => {
              const customInstructions = customInstructionsRef.current?.value.trim();
              updateSettings({
                sourceControlWritingStyle: {
                  mode: value as SourceControlWritingStyleMode,
                  ...(customInstructions !== undefined ? { customInstructions } : {}),
                },
              });
            }}
          >
            <SelectTrigger
              className="w-full sm:w-56"
              aria-label={translator.message("settings.sourceControlWriting.style")}
            >
              <SelectValue>{translator.message(MODE_OPTIONS[style.mode].label)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(MODE_OPTIONS) as SourceControlWritingStyleMode[]).map((mode) => (
                <SelectItem key={mode} hideIndicator value={mode}>
                  {translator.message(MODE_OPTIONS[mode].label)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        {style.mode === "custom" ? (
          <div className="mt-3 max-w-2xl pb-3.5">
            <Textarea
              key={style.customInstructions}
              ref={customInstructionsRef}
              defaultValue={style.customInstructions}
              onBlur={(event) => {
                const customInstructions = event.target.value.trim();
                if (customInstructions !== style.customInstructions) {
                  updateSettings({ sourceControlWritingStyle: { customInstructions } });
                }
              }}
              rows={4}
              placeholder={translator.message("settings.sourceControlWriting.customPlaceholder")}
              aria-label={translator.message("settings.sourceControlWriting.customAria")}
            />
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title={translator.message("settings.sourceControlWriting.followTemplates")}
        description={translator.message("settings.sourceControlWriting.followTemplatesDescription")}
        resetAction={
          style.followChangeRequestTemplates !== defaults.followChangeRequestTemplates ? (
            <SettingResetButton
              label={translator.message("settings.sourceControlWriting.followTemplates")}
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    followChangeRequestTemplates: defaults.followChangeRequestTemplates,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={style.followChangeRequestTemplates}
            onCheckedChange={(checked) =>
              updateSettings({
                sourceControlWritingStyle: {
                  followChangeRequestTemplates: Boolean(checked),
                },
              })
            }
            aria-label={translator.message("settings.sourceControlWriting.followTemplates")}
          />
        }
      />

      <SettingsRow
        title={translator.message("settings.sourceControlWriting.writerModel")}
        description={translator.message("settings.sourceControlWriting.writerModelDescription")}
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {usesDedicatedModel ? (
              <ProviderModelPicker
                activeInstanceId={activeSelection.instanceId}
                model={activeSelection.model}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                triggerAriaLabel={translator.message("settings.sourceControlWriting.writerModel")}
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    sourceControlWriterModelSelection: createModelSelection(instanceId, model),
                  });
                }}
              />
            ) : null}
            <Switch
              checked={usesDedicatedModel}
              onCheckedChange={(checked) =>
                updateSettings({
                  sourceControlWriterModelSelection: checked
                    ? createModelSelection(
                        defaultModelSelection.instanceId,
                        defaultModelSelection.model,
                        defaultModelSelection.options,
                      )
                    : null,
                })
              }
              aria-label={translator.message("settings.sourceControlWriting.separateWriterModel")}
            />
          </div>
        }
      />
    </SettingsSection>
  );
}
