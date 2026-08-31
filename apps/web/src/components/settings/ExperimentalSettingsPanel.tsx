import { useAtomValue } from "@effect/atom-react";
import {
  CODEX_DRIVER_KIND,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_PARALLEL_PLAN_REVIEW_MODEL_SELECTION,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import {
  isFetchCapableProvider,
  resolveFetchModelSelection,
  type FetchModelSelectionResolution,
} from "@t3tools/shared/fetchMode";
import { createModelSelection } from "@t3tools/shared/model";
import {
  translateInterfaceMessage,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";
import * as Equal from "effect/Equal";
import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

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

const translateEnglish: InterfaceTranslator["message"] = (key, values) =>
  translateInterfaceMessage("en", key, values);

export function fetchModelWarning(
  resolution: FetchModelSelectionResolution,
  fetchEnabled: boolean,
  translate: InterfaceTranslator["message"] = translateEnglish,
): string | null {
  if (resolution.status === "resolved") return null;
  if (resolution.source === "manual") {
    return resolution.reason === "model-unavailable"
      ? translate("settings.application.experimental.fetchWarning.model")
      : translate("settings.application.experimental.fetchWarning.provider");
  }
  return fetchEnabled ? translate("settings.application.experimental.fetchWarning.none") : null;
}

export interface ExperimentalSettingsPanelViewProps {
  readonly translate?: InterfaceTranslator["message"];
  readonly fetchEnabled: boolean;
  readonly fetchModelAutomatic: boolean;
  readonly fetchModelControl: ReactNode;
  readonly fetchModelDirty: boolean;
  readonly fetchModelWarning: ReactNode;
  readonly parallelPlanImplementationEnabled: boolean;
  readonly planReviewModelControl: ReactNode;
  readonly planReviewModelDirty: boolean;
  readonly onFetchChange: (enabled: boolean) => void;
  readonly onResetFetchModel: () => void;
  readonly onParallelPlanImplementationChange: (enabled: boolean) => void;
  readonly onResetFetch: () => void;
  readonly onResetParallelPlanImplementation: () => void;
  readonly onResetPlanReviewModel: () => void;
}

export function ExperimentalSettingsPanelView({
  translate = translateEnglish,
  fetchEnabled,
  fetchModelAutomatic,
  fetchModelControl,
  fetchModelDirty,
  fetchModelWarning,
  parallelPlanImplementationEnabled,
  planReviewModelControl,
  planReviewModelDirty,
  onFetchChange,
  onResetFetchModel,
  onParallelPlanImplementationChange,
  onResetFetch,
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
        <p>{translate("settings.application.experimental.notice")}</p>
      </div>

      <SettingsSection title={translate("settings.application.section.experimental")}>
        <SettingsRow
          title={translate("settings.application.experimental.fetch.title")}
          description={translate("settings.application.experimental.fetch.description")}
          resetAction={
            fetchEnabled !== DEFAULT_CLIENT_SETTINGS.experimentalFetch ? (
              <SettingResetButton
                label={translate("settings.application.experimental.fetch.title")}
                onClick={onResetFetch}
              />
            ) : null
          }
          control={
            <Switch
              checked={fetchEnabled}
              onCheckedChange={(checked) => onFetchChange(Boolean(checked))}
              aria-label={translate("settings.application.experimental.fetch.enableAria")}
            />
          }
        />

        <SettingsRow
          title={translate("settings.application.experimental.fetchModel.title")}
          description={translate("settings.application.experimental.fetchModel.description")}
          status={
            fetchModelWarning ? (
              <span role="alert" className="text-warning">
                {fetchModelWarning}
              </span>
            ) : null
          }
          resetAction={
            fetchModelDirty ? (
              <SettingResetButton
                label={translate("settings.application.experimental.fetchModel.title")}
                onClick={onResetFetchModel}
              />
            ) : null
          }
          control={
            <fieldset
              disabled={!fetchEnabled}
              aria-disabled={!fetchEnabled}
              className="m-0 flex min-w-0 flex-wrap items-center justify-end gap-1.5 border-0 p-0 disabled:opacity-64"
            >
              {fetchModelAutomatic ? (
                <span className="rounded-md border border-border/70 bg-muted/50 px-2 py-1 font-medium text-muted-foreground text-xs">
                  {translate("settings.application.experimental.fetchModel.auto")}
                </span>
              ) : null}
              {fetchModelControl}
            </fieldset>
          }
        />

        <SettingsRow
          title={translate("settings.application.experimental.parallel.title")}
          description={translate("settings.application.experimental.parallel.description")}
          resetAction={
            parallelPlanImplementationEnabled !==
            DEFAULT_CLIENT_SETTINGS.experimentalParallelPlanImplementation ? (
              <SettingResetButton
                label={translate("settings.application.experimental.parallel.title")}
                onClick={onResetParallelPlanImplementation}
              />
            ) : null
          }
          control={
            <Switch
              checked={parallelPlanImplementationEnabled}
              onCheckedChange={(checked) => onParallelPlanImplementationChange(Boolean(checked))}
              aria-label={translate("settings.application.experimental.parallel.enableAria")}
            />
          }
        />

        <SettingsRow
          title={translate("settings.application.experimental.reviewModel.title")}
          description={translate("settings.application.experimental.reviewModel.description")}
          resetAction={
            planReviewModelDirty ? (
              <SettingResetButton
                label={translate("settings.application.experimental.reviewModel.title")}
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
  const translate = useInterfaceTranslator().message;
  const fetchEnabled = useClientSettings((settings) => settings.experimentalFetch);
  const parallelPlanImplementationEnabled = useClientSettings(
    (settings) => settings.experimentalParallelPlanImplementation,
  );
  const updateClientSettings = useUpdateClientSettings();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const providerEntriesWithSettings = applyProviderInstanceSettings(
    deriveProviderInstanceEntries(serverProviders),
    settings,
  );
  const effectiveProviders = providerEntriesWithSettings.map((entry) =>
    entry.enabled === entry.snapshot.enabled
      ? entry.snapshot
      : { ...entry.snapshot, enabled: entry.enabled },
  );
  const fetchResolution = resolveFetchModelSelection({
    providers: effectiveProviders,
    fetchModelSelection: settings.fetchModelSelection,
    textGenerationModelSelection: settings.textGenerationModelSelection,
  });
  const fetchSelection =
    fetchResolution.status === "resolved"
      ? fetchResolution.selection
      : fetchResolution.requestedSelection;
  const fetchProviders = effectiveProviders.filter(
    (provider) => isFetchCapableProvider(provider) && provider.models.length > 0,
  );
  const fetchInstanceEntries = sortProviderInstanceEntries(
    deriveProviderInstanceEntries(fetchProviders),
  );
  const fetchInstanceEntry = fetchSelection
    ? providerEntriesWithSettings.find((entry) => entry.instanceId === fetchSelection.instanceId)
    : undefined;
  const fetchProvider: ProviderDriverKind = fetchInstanceEntry?.driverKind ?? CODEX_DRIVER_KIND;
  const fetchModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    fetchProviders,
    fetchSelection?.instanceId,
    fetchSelection?.model,
  );
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
      translate={translate}
      fetchEnabled={fetchEnabled}
      fetchModelAutomatic={settings.fetchModelSelection === null}
      fetchModelDirty={settings.fetchModelSelection !== null}
      fetchModelWarning={fetchModelWarning(fetchResolution, fetchEnabled, translate)}
      fetchModelControl={
        fetchSelection ? (
          <>
            <ProviderModelPicker
              activeInstanceId={fetchSelection.instanceId}
              model={fetchSelection.model}
              lockedProvider={null}
              instanceEntries={fetchInstanceEntries}
              modelOptionsByInstance={fetchModelOptionsByInstance}
              disabled={!fetchEnabled}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              triggerAriaLabel={translate("settings.application.experimental.fetchModel.title")}
              onInstanceModelChange={(instanceId, model) => {
                updateSettings({
                  fetchModelSelection: createModelSelection(instanceId, model),
                });
              }}
            />
            <TraitsPicker
              provider={fetchProvider}
              instanceId={fetchSelection.instanceId}
              models={fetchInstanceEntry?.models ?? []}
              model={fetchSelection.model}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={fetchSelection.options}
              planModeEnabled={settings.planModeEnabled}
              allowPromptInjectedEffort={false}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onModelOptionsChange={(nextOptions) => {
                updateSettings({
                  fetchModelSelection: createModelSelection(
                    fetchSelection.instanceId,
                    fetchSelection.model,
                    nextOptions,
                  ),
                });
              }}
            />
          </>
        ) : (
          <span className="text-muted-foreground text-xs">
            {translate("settings.common.unavailable")}
          </span>
        )
      }
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
            triggerAriaLabel={translate(
              "settings.application.experimental.reviewModel.triggerAria",
            )}
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
            planModeEnabled={settings.planModeEnabled}
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
      onFetchChange={(enabled) => updateClientSettings({ experimentalFetch: enabled })}
      onResetFetchModel={() => updateSettings({ fetchModelSelection: null })}
      onParallelPlanImplementationChange={(enabled) =>
        updateClientSettings({ experimentalParallelPlanImplementation: enabled })
      }
      onResetFetch={() =>
        updateClientSettings({ experimentalFetch: DEFAULT_CLIENT_SETTINGS.experimentalFetch })
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
