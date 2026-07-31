import { useAtomValue } from "@effect/atom-react";
import {
  CODEX_DRIVER_KIND,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_PARALLEL_PLAN_REVIEW_MODEL_SELECTION,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Equal from "effect/Equal";
import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  useClientSettings,
  usePrimarySettings,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import {
  filterPlanParallelismReviewProviders,
  getCustomModelOptionsByInstance,
  resolveParallelPlanReviewModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

export interface ExperimentalSettingsPanelViewProps {
  readonly parallelPlanImplementationEnabled: boolean;
  readonly planReviewModelControl: ReactNode;
  readonly planReviewModelDirty: boolean;
  readonly onParallelPlanImplementationChange: (enabled: boolean) => void;
  readonly onResetParallelPlanImplementation: () => void;
  readonly onResetPlanReviewModel: () => void;
}

export function ExperimentalSettingsPanelView({
  parallelPlanImplementationEnabled,
  planReviewModelControl,
  planReviewModelDirty,
  onParallelPlanImplementationChange,
  onResetParallelPlanImplementation,
  onResetPlanReviewModel,
}: ExperimentalSettingsPanelViewProps) {
  return (
    <SettingsPageContainer>
      <div
        role="note"
        className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-xs text-muted-foreground"
      >
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
        <p>
          Experimental features may change, break, or be removed without notice. Enable them only
          when you are comfortable testing unfinished workflows.
        </p>
      </div>

      <SettingsSection title="Experimental">
        <SettingsRow
          title="Parallel plan implementation"
          description="Suggest a provider-native subagent strategy when implementing a completed plan."
          resetAction={
            parallelPlanImplementationEnabled !==
            DEFAULT_CLIENT_SETTINGS.experimentalParallelPlanImplementation ? (
              <SettingResetButton
                label="parallel plan implementation"
                onClick={onResetParallelPlanImplementation}
              />
            ) : null
          }
          control={
            <Switch
              checked={parallelPlanImplementationEnabled}
              onCheckedChange={(checked) => onParallelPlanImplementationChange(Boolean(checked))}
              aria-label="Use subagents when implementing plans"
            />
          }
        />

        <SettingsRow
          title="Agent count review model"
          description="Fast model used to estimate how many provider-native subagents can implement a completed plan in parallel."
          resetAction={
            planReviewModelDirty ? (
              <SettingResetButton
                label="agent count review model"
                onClick={onResetPlanReviewModel}
              />
            ) : null
          }
          control={
            <fieldset
              disabled={!parallelPlanImplementationEnabled}
              aria-disabled={!parallelPlanImplementationEnabled}
              className="m-0 flex min-w-0 flex-wrap items-center justify-end gap-1.5 border-0 p-0 disabled:opacity-64"
            >
              {planReviewModelControl}
            </fieldset>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ExperimentalSettingsPanel() {
  const parallelPlanImplementationEnabled = useClientSettings(
    (settings) => settings.experimentalParallelPlanImplementation,
  );
  const updateClientSettings = useUpdateClientSettings();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const reviewProviders = filterPlanParallelismReviewProviders(serverProviders);
  const reviewSelection = resolveParallelPlanReviewModelSelectionState(settings, serverProviders);
  const reviewInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(reviewProviders), settings),
  );
  const reviewInstanceEntry = reviewInstanceEntries.find(
    (entry) => entry.instanceId === reviewSelection.instanceId,
  );
  const reviewProvider: ProviderDriverKind = reviewInstanceEntry?.driverKind ?? CODEX_DRIVER_KIND;
  const reviewModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    reviewProviders,
    reviewSelection.instanceId,
    reviewSelection.model,
  );
  const planReviewModelDirty = !Equal.equals(
    settings.parallelPlanReviewModelSelection,
    DEFAULT_PARALLEL_PLAN_REVIEW_MODEL_SELECTION,
  );

  const resolveReviewSelection = (
    instanceId: typeof reviewSelection.instanceId,
    model: string,
    options: typeof reviewSelection.options,
  ) =>
    resolveParallelPlanReviewModelSelectionState(
      {
        ...settings,
        parallelPlanReviewModelSelection: createModelSelection(instanceId, model, options),
      },
      serverProviders,
    );

  return (
    <ExperimentalSettingsPanelView
      parallelPlanImplementationEnabled={parallelPlanImplementationEnabled}
      planReviewModelDirty={planReviewModelDirty}
      planReviewModelControl={
        <>
          <ProviderModelPicker
            activeInstanceId={reviewSelection.instanceId}
            model={reviewSelection.model}
            lockedProvider={null}
            instanceEntries={reviewInstanceEntries}
            modelOptionsByInstance={reviewModelOptionsByInstance}
            disabled={!parallelPlanImplementationEnabled}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            triggerAriaLabel="Agent count review model"
            onInstanceModelChange={(instanceId, model) => {
              updateSettings({
                parallelPlanReviewModelSelection: resolveReviewSelection(
                  instanceId,
                  model,
                  undefined,
                ),
              });
            }}
          />
          <TraitsPicker
            provider={reviewProvider}
            instanceId={reviewSelection.instanceId}
            models={reviewInstanceEntry?.models ?? []}
            model={reviewSelection.model}
            prompt=""
            onPromptChange={() => {}}
            modelOptions={reviewSelection.options}
            allowPromptInjectedEffort={false}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            onModelOptionsChange={(nextOptions) => {
              updateSettings({
                parallelPlanReviewModelSelection: resolveReviewSelection(
                  reviewSelection.instanceId,
                  reviewSelection.model,
                  nextOptions,
                ),
              });
            }}
          />
        </>
      }
      onParallelPlanImplementationChange={(enabled) =>
        updateClientSettings({ experimentalParallelPlanImplementation: enabled })
      }
      onResetParallelPlanImplementation={() =>
        updateClientSettings({
          experimentalParallelPlanImplementation:
            DEFAULT_CLIENT_SETTINGS.experimentalParallelPlanImplementation,
        })
      }
      onResetPlanReviewModel={() =>
        updateSettings({
          parallelPlanReviewModelSelection: DEFAULT_PARALLEL_PLAN_REVIEW_MODEL_SELECTION,
        })
      }
    />
  );
}
