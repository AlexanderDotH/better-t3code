import {
  AssemblyAiVoiceSettings,
  type ModelSelection,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { createModelSelection } from "@t3tools/shared/model";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import type { ModelEsque } from "../chat/providerIconUtils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingsRow } from "./settingsLayout";

type ModelOption = { readonly id: string; readonly name: string };
const isValidVoiceSettings = Schema.is(AssemblyAiVoiceSettings);

export function AssemblyAiVoiceSettingsForm({
  value,
  models,
  t3Models,
  disabled,
  onSave,
}: {
  readonly value: AssemblyAiVoiceSettings;
  readonly models: readonly ModelOption[];
  readonly t3Models: {
    readonly fallbackSelection: ModelSelection;
    readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
    readonly optionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  };
  readonly disabled: boolean;
  readonly onSave: (settings: AssemblyAiVoiceSettings) => Promise<boolean>;
}) {
  const translate = useInterfaceTranslator().message;
  const [draft, setDraft] = useState(value);
  const [languages, setLanguages] = useState(value.languageCodes.join(", "));
  const [terms, setTerms] = useState(value.customKeyterms.join("\n"));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"saved" | "saveFailed" | "validation" | null>(null);
  const pro = draft.speechModel === "universal-3-5-pro";
  const cleanupEnabled = draft.cleanupMode !== "off";
  const controlsDisabled = disabled || busy;
  const modelOptions = models.some((model) => model.id === draft.cleanupModel)
    ? models
    : [{ id: draft.cleanupModel, name: draft.cleanupModel }, ...models];

  function update<K extends keyof AssemblyAiVoiceSettings>(
    key: K,
    next: AssemblyAiVoiceSettings[K],
  ) {
    setMessage(null);
    setDraft((current) => ({ ...current, [key]: next }));
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
            value={draft[key]}
            onChange={(event) => update(key, Number(event.target.value))}
          />
        }
      />
    );
  }

  async function save() {
    const languageCodes = [
      ...new Set(
        languages
          .split(",")
          .map((language) => language.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    const customKeyterms = [
      ...new Set(
        terms
          .split("\n")
          .map((term) => term.trim())
          .filter(Boolean),
      ),
    ];
    const next = { ...draft, languageCodes, customKeyterms };
    if (
      !isValidVoiceSettings(next) ||
      languageCodes.some((language) => !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/u.test(language))
    ) {
      setMessage("validation");
      return;
    }
    setBusy(true);
    try {
      setMessage((await onSave(next)) ? "saved" : "saveFailed");
    } catch {
      setMessage("saveFailed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {select("speechModel", "settings.voice.options.speechModel", [
        { value: "universal-3-5-pro", label: "Universal 3.5 Pro" },
        { value: "universal-streaming-multilingual", label: "Universal Streaming Multilingual" },
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
            onChange={(event) => {
              setLanguages(event.target.value);
              setMessage(null);
            }}
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
          onChange={(event) => {
            setTerms(event.target.value);
            setMessage(null);
          }}
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
            onChange={(event) => update("contextPrompt", event.target.value)}
          />
        </SettingsRow>
      ) : null}
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
      <SettingsRow
        title={translate("settings.voice.options.cleanupModel")}
        control={
          <ProviderModelPicker
            activeInstanceId={
              draft.cleanupModelSelection?.instanceId ?? t3Models.fallbackSelection.instanceId
            }
            model={draft.cleanupModelSelection?.model ?? t3Models.fallbackSelection.model}
            lockedProvider={null}
            instanceEntries={t3Models.instanceEntries}
            modelOptionsByInstance={t3Models.optionsByInstance}
            auxiliaryModels={modelOptions}
            selectedAuxiliaryModel={draft.cleanupModelSelection ? null : draft.cleanupModel}
            fallbackToFirstModel={false}
            disabled={controlsDisabled || !cleanupEnabled}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            triggerAriaLabel={translate("settings.voice.options.cleanupModel")}
            onInstanceModelChange={(instanceId, model) => {
              update("cleanupModelSelection", createModelSelection(instanceId, model));
            }}
            onAuxiliaryModelChange={(model) => {
              setMessage(null);
              setDraft((current) => ({
                ...current,
                cleanupModel: model,
                cleanupModelSelection: null,
              }));
            }}
          />
        }
      />
      {draft.cleanupMode === "custom" ? (
        <SettingsRow title={translate("settings.voice.options.instructions")}>
          <Textarea
            value={draft.cleanupInstructions}
            maxLength={4000}
            disabled={controlsDisabled}
            rows={3}
            aria-label={translate("settings.voice.options.instructions")}
            onChange={(event) => update("cleanupInstructions", event.target.value)}
          />
        </SettingsRow>
      ) : null}
      {toggle(
        "automaticFileReferences",
        "settings.voice.options.files",
        "settings.voice.options.filesHint",
      )}
      <div className="space-y-3 px-3 py-4 sm:px-4">
        <p className="text-xs text-muted-foreground">
          {translate("settings.voice.options.cloudHint")}
        </p>
        {message ? (
          <p
            role={message === "saved" ? "status" : "alert"}
            className={
              message === "saved" ? "text-xs text-muted-foreground" : "text-xs text-destructive"
            }
          >
            {translate(`settings.voice.options.${message}`)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" type="submit" disabled={controlsDisabled}>
            {translate(busy ? "settings.voice.options.saving" : "settings.voice.options.save")}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="outline"
            disabled={controlsDisabled}
            onClick={() => {
              setDraft(value);
              setLanguages(value.languageCodes.join(", "));
              setTerms(value.customKeyterms.join("\n"));
              setMessage(null);
            }}
          >
            {translate("settings.voice.options.cancel")}
          </Button>
        </div>
      </div>
    </form>
  );
}
