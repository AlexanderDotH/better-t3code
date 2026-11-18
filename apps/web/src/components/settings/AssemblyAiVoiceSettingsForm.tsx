import {
  type AssemblyAiVoiceSettings,
  type ModelSelection,
  type EnvironmentId,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { createModelSelection } from "@t3tools/shared/model";
import { createVoiceSettingsAutosave } from "@t3tools/client-runtime/voice-settings";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { BetterT3SettingsSubgroupId } from "@t3tools/client-runtime/better-t3-settings-layout";

import { useStableCallback } from "../../hooks/useStableCallback";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { isProviderInstancePickerReady, type ProviderInstanceEntry } from "../../providerInstances";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import type { ModelEsque } from "../chat/providerIconUtils";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingsRow } from "./settingsLayout";
import { BetterT3SettingsSubgroup } from "./BetterT3SettingsSubgroup";

type ModelOption = { readonly id: string; readonly name: string };

export function AssemblyAiVoiceSettingsForm({
  environmentId = null,
  value,
  models,
  t3Models,
  disabled,
  onSave,
  grouped = true,
  modelsState = "ready",
  advancedSupported = true,
}: {
  readonly environmentId?: EnvironmentId | null;
  readonly value: AssemblyAiVoiceSettings;
  readonly models: readonly ModelOption[];
  readonly t3Models: {
    readonly fallbackSelection: ModelSelection;
    readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
    readonly optionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  };
  readonly disabled: boolean;
  readonly grouped?: boolean;
  readonly modelsState?: "loading" | "ready" | "error";
  readonly advancedSupported?: boolean;
  readonly onSave: (settings: AssemblyAiVoiceSettings) => Promise<boolean>;
}) {
  const translate = useInterfaceTranslator().message;
  const save = useStableCallback(onSave);
  const [autosave] = useState(() => createVoiceSettingsAutosave(value, save));
  const { draft, languages, terms, numbers, message } = useSyncExternalStore(
    autosave.subscribe,
    autosave.getSnapshot,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Flush pending settings to the environment when this editor unmounts.
  useEffect(() => () => autosave.flush(), [autosave]);
  const pro = draft.speechModel === "universal-3-5-pro";
  const cleanupEnabled = draft.cleanupMode !== "off";
  const controlsDisabled = disabled;

  function group(groupId: BetterT3SettingsSubgroupId, children: ReactNode) {
    return grouped ? (
      <BetterT3SettingsSubgroup groupId={groupId}>{children}</BetterT3SettingsSubgroup>
    ) : (
      children
    );
  }

  function update<K extends keyof AssemblyAiVoiceSettings>(
    key: K,
    next: AssemblyAiVoiceSettings[K],
  ) {
    autosave.update({ [key]: next });
  }

  function select<K extends "speechModel" | "streamingMode" | "voiceFocus" | "cleanupMode">(
    key: K,
    label: InterfaceMessageKey,
    options: readonly { readonly value: AssemblyAiVoiceSettings[K]; readonly label: string }[],
    unavailable = false,
    hint?: InterfaceMessageKey,
  ) {
    return (
      <SettingsRow
        id={grouped && key === "cleanupMode" ? "voice-cleanup-mode" : undefined}
        title={translate(label)}
        description={hint ? translate(hint) : undefined}
        control={
          <Select
            value={draft[key]}
            disabled={controlsDisabled || unavailable}
            onValueChange={(next) => {
              const selected = options.find((option) => option.value === next);
              if (selected) update(key, selected.value);
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-72" aria-label={translate(label)}>
              <SelectValue>
                {options.find((option) => option.value === draft[key])?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    );
  }

  function toggle(
    key:
      | "advancedMode"
      | "includePartialTurns"
      | "continuousPartials"
      | "projectVocabulary"
      | "automaticFileReferences",
    label: InterfaceMessageKey,
    hint?: InterfaceMessageKey,
    unavailable = false,
  ) {
    return (
      <SettingsRow
        title={translate(label)}
        description={hint ? translate(hint) : undefined}
        control={
          <Switch
            checked={draft[key]}
            disabled={controlsDisabled || unavailable}
            aria-label={translate(label)}
            onCheckedChange={(next) => update(key, next)}
          />
        }
      />
    );
  }

  function modelPicker(purpose: "cleanup" | "interpretation", enabled: boolean) {
    const selectionKey = `${purpose}ModelSelection` as const;
    const modelKey = `${purpose}Model` as const;
    const selection = draft[selectionKey];
    const modelId = draft[modelKey];
    const modelOptions = models.some((model) => model.id === modelId)
      ? models
      : [{ id: modelId, name: modelId }, ...models];
    const selectedModel = selection
      ? t3Models.optionsByInstance
          .get(selection.instanceId)
          ?.find((model) => model.slug === selection.model)
      : undefined;
    const selectedProvider = t3Models.instanceEntries.find(
      (entry) => entry.instanceId === selection?.instanceId,
    );
    const unavailable = selection
      ? !selectedModel ||
        selectedModel.isUnavailable ||
        !selectedProvider ||
        !isProviderInstancePickerReady(selectedProvider)
      : modelsState !== "loading" && !models.some((model) => model.id === modelId);
    return (
      <SettingsRow
        id={grouped && purpose === "cleanup" ? "voice-cleanup-model" : undefined}
        title={translate(`settings.voice.options.${modelKey}`)}
        status={
          enabled && unavailable ? translate("settings.betterT3.value.unavailable") : undefined
        }
        control={
          <ProviderModelPicker
            environmentId={environmentId}
            activeInstanceId={selection?.instanceId ?? t3Models.fallbackSelection.instanceId}
            model={selection?.model ?? t3Models.fallbackSelection.model}
            lockedProvider={null}
            instanceEntries={t3Models.instanceEntries}
            modelOptionsByInstance={t3Models.optionsByInstance}
            modelSelectionPurpose="text-generation"
            auxiliaryModels={modelOptions}
            selectedAuxiliaryModel={selection ? null : modelId}
            fallbackToFirstModel={false}
            disabled={controlsDisabled || !enabled}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            triggerAriaLabel={translate(`settings.voice.options.${modelKey}`)}
            onInstanceModelChange={(instanceId, model) =>
              update(selectionKey, createModelSelection(instanceId, model))
            }
            onAuxiliaryModelChange={(model) => {
              autosave.update({ [modelKey]: model, [selectionKey]: null });
            }}
          />
        }
      />
    );
  }

  function number(
    key: "minTurnSilence" | "maxTurnSilence" | "vadThreshold" | "interruptionDelay",
    label: InterfaceMessageKey,
    min: number,
    max: number,
    step = 1,
    unavailable = false,
  ) {
    return (
      <SettingsRow
        title={translate(label)}
        description={
          key === "vadThreshold" ? translate("settings.voice.options.vadHint") : undefined
        }
        control={
          <Input
            nativeInput
            type="number"
            size="sm"
            className="w-full sm:w-28"
            min={min}
            max={max}
            step={step}
            required
            aria-label={translate(label)}
            disabled={controlsDisabled || unavailable}
            value={numbers[key]}
            onChange={(event) => autosave.edit(key, event.target.value)}
            onBlur={autosave.flush}
          />
        }
      />
    );
  }

  return (
    <form
      className={grouped ? "space-y-6" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        autosave.flush();
      }}
    >
      {group(
        "voice-recording",
        <>
          {select("speechModel", "settings.voice.options.speechModel", [
            { value: "universal-3-5-pro", label: "Universal 3.5 Pro" },
            {
              value: "universal-streaming-multilingual",
              label: "Universal Streaming Multilingual",
            },
            { value: "universal-streaming-english", label: "Universal Streaming English" },
          ])}
          <SettingsRow
            title={translate("settings.voice.options.languages")}
            description={translate(
              pro
                ? "settings.voice.options.languagesHint"
                : draft.speechModel === "universal-streaming-english"
                  ? "settings.voice.options.englishOnly"
                  : "settings.voice.options.proOnly",
            )}
            control={
              <Input
                nativeInput
                size="sm"
                className="w-full sm:w-72"
                value={languages}
                disabled={controlsDisabled || !pro}
                aria-label={translate("settings.voice.options.languages")}
                placeholder="de, en"
                onChange={(event) => autosave.edit("languages", event.target.value)}
                onBlur={autosave.flush}
              />
            }
          />
          {select(
            "streamingMode",
            "settings.voice.options.mode",
            [
              { value: "balanced", label: translate("settings.voice.options.balanced") },
              { value: "max_accuracy", label: translate("settings.voice.options.accuracy") },
              { value: "min_latency", label: translate("settings.voice.options.latency") },
            ],
            !pro,
            !pro ? "settings.voice.options.proOnly" : undefined,
          )}
          {number("minTurnSilence", "settings.voice.options.minSilence", 50, 10000)}
          {number("maxTurnSilence", "settings.voice.options.maxSilence", 50, 10000)}
          {number("vadThreshold", "settings.voice.options.vad", 0, 1, 0.01)}
          {toggle("includePartialTurns", "settings.voice.options.partials")}
          {pro ? (
            <>
              {toggle(
                "continuousPartials",
                "settings.voice.options.continuous",
                undefined,
                !draft.includePartialTurns,
              )}
              {number(
                "interruptionDelay",
                "settings.voice.options.delay",
                0,
                1000,
                1,
                !draft.includePartialTurns,
              )}
            </>
          ) : null}
          {select("voiceFocus", "settings.voice.options.focus", [
            { value: "near-field", label: translate("settings.voice.options.near") },
            { value: "far-field", label: translate("settings.voice.options.far") },
          ])}
          {toggle(
            "projectVocabulary",
            "settings.voice.options.vocabulary",
            "settings.voice.options.vocabularyHint",
          )}
          <SettingsRow
            title={translate("settings.voice.options.terms")}
            description={translate("settings.voice.options.termsHint")}
          >
            <Textarea
              value={terms}
              disabled={controlsDisabled}
              rows={3}
              aria-label={translate("settings.voice.options.terms")}
              onChange={(event) => autosave.edit("terms", event.target.value)}
              onBlur={autosave.flush}
            />
          </SettingsRow>
          {pro ? (
            <SettingsRow
              title={translate("settings.voice.options.context")}
              description={translate("settings.voice.options.contextHint")}
            >
              <Textarea
                value={draft.contextPrompt}
                maxLength={1750}
                disabled={controlsDisabled}
                rows={3}
                aria-label={translate("settings.voice.options.context")}
                onChange={(event) => autosave.edit("contextPrompt", event.target.value)}
                onBlur={autosave.flush}
              />
            </SettingsRow>
          ) : null}
          {toggle(
            "automaticFileReferences",
            "settings.voice.options.files",
            "settings.voice.options.filesHint",
          )}
        </>,
      )}
      {group(
        "voice-cleanup",
        <>
          {toggle(
            "advancedMode",
            "settings.voice.options.advancedMode",
            advancedSupported
              ? "settings.voice.options.advancedModeHint"
              : "settings.voice.options.advancedUnsupported",
            !advancedSupported,
          )}
          {draft.advancedMode ? modelPicker("interpretation", advancedSupported) : null}
          {select(
            "cleanupMode",
            "settings.voice.options.cleanup",
            [
              { value: "off", label: translate("settings.voice.options.off") },
              { value: "conservative", label: translate("settings.voice.options.conservative") },
              { value: "compact", label: translate("settings.voice.options.compact") },
              { value: "custom", label: translate("settings.voice.options.custom") },
            ],
            false,
            "settings.voice.options.cleanupHint",
          )}
          {modelPicker("cleanup", cleanupEnabled)}
          {draft.cleanupMode === "custom" ? (
            <SettingsRow
              id={grouped ? "voice-cleanup-instructions" : undefined}
              title={translate("settings.voice.options.instructions")}
            >
              <Textarea
                value={draft.cleanupInstructions}
                maxLength={4000}
                disabled={controlsDisabled}
                rows={3}
                aria-label={translate("settings.voice.options.instructions")}
                onChange={(event) => autosave.edit("cleanupInstructions", event.target.value)}
                onBlur={autosave.flush}
              />
            </SettingsRow>
          ) : null}
        </>,
      )}
      {message ? (
        <p role="alert" className="px-3 py-4 text-xs text-destructive sm:px-4">
          {translate(`settings.voice.options.${message}`)}
        </p>
      ) : null}
    </form>
  );
}
