import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  resolveAssemblyAiVoiceSettings,
  type AssemblyAiVoiceSettings,
  type EnvironmentId,
  type ProjectId,
  type ServerConfig,
} from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { createVoiceSettingsAutosave } from "@t3tools/client-runtime/voice-settings";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { ModelSelectionModal, modelSelectionLabel } from "./ModelSelectionModal";

type ModelOption = { readonly id: string; readonly name: string };
type Choice<T extends string = string> = { readonly value: T; readonly label: string };

function VoiceSelect<T extends string>({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly choices: readonly Choice<T>[];
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
}) {
  const translate = useMobileInterfaceTranslator().message;
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <View className="gap-2 p-4">
      <Text className="text-base font-t3-medium text-foreground">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className="rounded-2xl bg-subtle px-4 py-3 disabled:opacity-40"
      >
        <Text className="text-base text-foreground">
          {choices.find((choice) => choice.value === value)?.label ?? value}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 bg-sheet">
          <View className="flex-row items-center gap-4 border-b border-border px-5 py-4">
            <Text className="flex-1 text-lg font-t3-semibold text-foreground">{label}</Text>
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
              <Text className="text-base text-foreground">{translate("common.close")}</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerClassName="p-5"
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          >
            {choices.map((choice) => (
              <Pressable
                key={choice.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: choice.value === value }}
                className="border-b border-border-subtle px-4 py-4"
                onPress={() => {
                  onChange(choice.value);
                  setOpen(false);
                }}
              >
                <Text
                  className={
                    choice.value === value
                      ? "text-base font-t3-semibold text-foreground"
                      : "text-base text-foreground-muted"
                  }
                >
                  {choice.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function VoiceTextField({
  label,
  hint,
  value,
  onChange,
  onBlur,
  disabled,
  multiline = false,
  numeric = false,
  maxLength,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
  readonly disabled: boolean;
  readonly multiline?: boolean;
  readonly numeric?: boolean;
  readonly maxLength?: number;
}) {
  return (
    <View className="gap-2 p-4">
      <Text className="text-base font-t3-medium text-foreground">{label}</Text>
      {hint ? <Text className="text-sm text-foreground-muted">{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        keyboardType={numeric ? "decimal-pad" : "default"}
        value={value}
        maxLength={maxLength}
        onChangeText={onChange}
        onBlur={onBlur}
        onEndEditing={onBlur}
        className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
      />
    </View>
  );
}

function MobileVoiceSettingsForm({
  value,
  models,
  config,
  disabled,
  onSave,
}: {
  readonly value: AssemblyAiVoiceSettings;
  readonly models: readonly ModelOption[];
  readonly config: ServerConfig;
  readonly disabled: boolean;
  readonly onSave: (settings: AssemblyAiVoiceSettings) => Promise<boolean>;
}) {
  const translator = useMobileInterfaceTranslator();
  const translate = useMobileInterfaceTranslator().message;
  const [autosave] = useState(() => createVoiceSettingsAutosave(value, onSave));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep queued settings writes bound to the current environment save callback.
  useLayoutEffect(() => {
    autosave.setOnSave(onSave);
  }, [autosave, onSave]);
  const { draft, languages, terms, numbers, message } = useSyncExternalStore(
    autosave.subscribe,
    autosave.getSnapshot,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Flush pending settings to the environment when the modal closes.
  useEffect(() => () => autosave.flush(), [autosave]);
  const [modelPickerOpen, setModelPickerOpen] = useState<"cleanup" | "interpretation" | null>(null);
  const controlsDisabled = disabled;
  const pro = draft.speechModel === "universal-3-5-pro";
  const advancedSupported = config.environment.capabilities.supportsAdvancedVoiceDictation === true;

  function update<K extends keyof AssemblyAiVoiceSettings>(
    key: K,
    next: AssemblyAiVoiceSettings[K],
  ) {
    autosave.update({ [key]: next });
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
      <SettingsSwitchRow
        icon="mic"
        label={translate(label)}
        {...(hint ? { subtitle: translate(hint) } : {})}
        value={draft[key]}
        disabled={controlsDisabled || unavailable}
        onValueChange={(next) => update(key, next)}
      />
    );
  }

  function number(
    key: keyof typeof numbers,
    label: InterfaceMessageKey,
    hint?: InterfaceMessageKey,
    unavailable = false,
  ) {
    return (
      <VoiceTextField
        label={translate(label)}
        {...(hint ? { hint: translate(hint) } : {})}
        value={numbers[key]}
        numeric
        disabled={controlsDisabled || unavailable}
        onChange={(next) => autosave.edit(key, next)}
        onBlur={autosave.flush}
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
    return (
      <View className="gap-2 p-4">
        <Text className="text-base font-t3-medium text-foreground">
          {translate(`settings.voice.options.${modelKey}`)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate(`settings.voice.options.${modelKey}`)}
          disabled={controlsDisabled || !enabled}
          onPress={() => setModelPickerOpen(purpose)}
          className="rounded-2xl bg-subtle px-4 py-3 disabled:opacity-40"
        >
          <Text className="text-base text-foreground">
            {selection
              ? modelSelectionLabel(config, selection)
              : (modelOptions.find((model) => model.id === modelId)?.name ?? modelId)}
          </Text>
        </Pressable>
        <ModelSelectionModal
          config={config}
          current={selection}
          allowDefault={false}
          purpose="text-generation"
          auxiliaryModels={modelOptions}
          selectedAuxiliaryModel={selection ? null : modelId}
          onSelectAuxiliaryModel={(model) => {
            autosave.update({ [modelKey]: model, [selectionKey]: null });
          }}
          onSelect={(selection) => {
            if (selection) update(selectionKey, selection);
          }}
          visible={modelPickerOpen === purpose}
          onClose={() => setModelPickerOpen(null)}
        />
      </View>
    );
  }

  return (
    <View>
      <VoiceSelect
        label={translate("settings.voice.options.speechModel")}
        value={draft.speechModel}
        disabled={controlsDisabled}
        onChange={(next) => update("speechModel", next)}
        choices={[
          { value: "universal-3-5-pro", label: translator.message("mobile.ui.universal35Pro") },
          {
            value: "universal-streaming-multilingual",
            label: translator.message("mobile.ui.universalStreamingMultilingual"),
          },
          {
            value: "universal-streaming-english",
            label: translator.message("mobile.ui.universalStreamingEnglish"),
          },
        ]}
      />
      {pro ? (
        <>
          <VoiceTextField
            label={translate("settings.voice.options.languages")}
            hint={translate("settings.voice.options.languagesHint")}
            value={languages}
            disabled={controlsDisabled}
            onChange={(next) => autosave.edit("languages", next)}
            onBlur={autosave.flush}
          />
          <VoiceSelect
            label={translate("settings.voice.options.mode")}
            value={draft.streamingMode}
            disabled={controlsDisabled}
            onChange={(next) => update("streamingMode", next)}
            choices={[
              { value: "balanced", label: translate("settings.voice.options.balanced") },
              { value: "max_accuracy", label: translate("settings.voice.options.accuracy") },
              { value: "min_latency", label: translate("settings.voice.options.latency") },
            ]}
          />
        </>
      ) : (
        <Text className="px-4 text-sm text-foreground-muted">
          {translate(
            draft.speechModel === "universal-streaming-english"
              ? "settings.voice.options.englishOnly"
              : "settings.voice.options.proOnly",
          )}
        </Text>
      )}
      {number("minTurnSilence", "settings.voice.options.minSilence")}
      {number("maxTurnSilence", "settings.voice.options.maxSilence")}
      {number("vadThreshold", "settings.voice.options.vad", "settings.voice.options.vadHint")}
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
            undefined,
            !draft.includePartialTurns,
          )}
        </>
      ) : null}
      <VoiceSelect
        label={translate("settings.voice.options.focus")}
        value={draft.voiceFocus}
        disabled={controlsDisabled}
        onChange={(next) => update("voiceFocus", next)}
        choices={[
          { value: "near-field", label: translate("settings.voice.options.near") },
          { value: "far-field", label: translate("settings.voice.options.far") },
        ]}
      />
      {toggle(
        "projectVocabulary",
        "settings.voice.options.vocabulary",
        "settings.voice.options.vocabularyHint",
      )}
      <VoiceTextField
        label={translate("settings.voice.options.terms")}
        hint={translate("settings.voice.options.termsHint")}
        value={terms}
        multiline
        disabled={controlsDisabled}
        onChange={(next) => autosave.edit("terms", next)}
        onBlur={autosave.flush}
      />
      {pro ? (
        <VoiceTextField
          label={translate("settings.voice.options.context")}
          hint={translate("settings.voice.options.contextHint")}
          value={draft.contextPrompt}
          multiline
          maxLength={1750}
          disabled={controlsDisabled}
          onChange={(next) => autosave.edit("contextPrompt", next)}
          onBlur={autosave.flush}
        />
      ) : null}
      {toggle(
        "advancedMode",
        "settings.voice.options.advancedMode",
        advancedSupported
          ? "settings.voice.options.advancedModeHint"
          : "settings.voice.options.advancedUnsupported",
        !advancedSupported,
      )}
      {draft.advancedMode ? modelPicker("interpretation", advancedSupported) : null}
      <VoiceSelect
        label={translate("settings.voice.options.cleanup")}
        value={draft.cleanupMode}
        disabled={controlsDisabled}
        onChange={(next) => update("cleanupMode", next)}
        choices={[
          { value: "off", label: translate("settings.voice.options.off") },
          { value: "conservative", label: translate("settings.voice.options.conservative") },
          { value: "compact", label: translate("settings.voice.options.compact") },
          { value: "custom", label: translate("settings.voice.options.custom") },
        ]}
      />
      <Text className="px-4 text-sm text-foreground-muted">
        {translate("settings.voice.options.cleanupHint")}
      </Text>
      {modelPicker("cleanup", draft.cleanupMode !== "off")}
      {draft.cleanupMode === "custom" ? (
        <VoiceTextField
          label={translate("settings.voice.options.instructions")}
          value={draft.cleanupInstructions}
          multiline
          maxLength={4000}
          disabled={controlsDisabled}
          onChange={(next) => autosave.edit("cleanupInstructions", next)}
          onBlur={autosave.flush}
        />
      ) : null}
      {toggle(
        "automaticFileReferences",
        "settings.voice.options.files",
        "settings.voice.options.filesHint",
      )}
      {message ? (
        <Text accessibilityRole="alert" className="p-4 text-sm text-danger">
          {translate(`settings.voice.options.${message}`)}
        </Text>
      ) : null}
    </View>
  );
}

function VoiceSettingsEditor({
  title,
  value,
  models,
  config,
  disabled,
  onSave,
}: {
  readonly title: string;
  readonly value: AssemblyAiVoiceSettings;
  readonly models: readonly ModelOption[];
  readonly config: ServerConfig;
  readonly disabled: boolean;
  readonly onSave: (settings: AssemblyAiVoiceSettings) => Promise<boolean>;
}) {
  const translate = useMobileInterfaceTranslator().message;
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setOpen(true)}
        className="gap-1 p-4 disabled:opacity-40"
      >
        <Text className="text-base font-t3-medium text-foreground">{title}</Text>
        <Text className="text-sm text-foreground-muted">
          {value.speechModel} · {translate(`settings.voice.options.${value.cleanupMode}`)}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 bg-sheet">
          <View className="flex-row items-center gap-4 border-b border-border px-5 py-4">
            <Text className="flex-1 text-lg font-t3-semibold text-foreground">{title}</Text>
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
              <Text className="text-base text-foreground">{translate("common.close")}</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          >
            {open ? (
              <MobileVoiceSettingsForm
                value={value}
                models={models}
                config={config}
                disabled={disabled}
                onSave={onSave}
              />
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

export function MobileAssemblyAiVoiceSettings({
  environmentId,
  config,
  projects,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly config: ServerConfig;
  readonly projects: readonly EnvironmentProject[];
  readonly disabled: boolean;
}) {
  const translate = useMobileInterfaceTranslator().message;
  const saveSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const listModels = useAtomCommand(serverEnvironment.listAssemblyAiModels, {
    reportFailure: false,
  });
  const supported = config.environment.capabilities.supportsSpeechDictationProcessing === true;
  const assemblyAi = config.settings.speechTranscription.assemblyAi;
  const [refresh, setRefresh] = useState(0);
  const [modelCatalog, setModelCatalog] = useState<{
    readonly environmentId: EnvironmentId;
    readonly request: number;
    readonly models: readonly ModelOption[];
    readonly status: "ready" | "error";
  } | null>(null);
  const currentCatalog =
    modelCatalog?.environmentId === environmentId && modelCatalog.request === refresh
      ? modelCatalog
      : null;
  const models = currentCatalog?.models ?? [];
  const modelsState = currentCatalog?.status ?? "loading";
  const [projectBusy, setProjectBusy] = useState<ProjectId | null>(null);
  const [projectError, setProjectError] = useState<ProjectId | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load the remote speech model catalog for this environment and ignore replaced requests.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void listModels({ environmentId, input: {} })
      .then((result) => {
        if (cancelled) return;
        setModelCatalog({
          environmentId,
          request: refresh,
          models: result._tag === "Success" ? result.value.models : [],
          status: result._tag === "Success" ? "ready" : "error",
        });
      })
      .catch(() => {
        if (!cancelled)
          setModelCatalog({ environmentId, request: refresh, models: [], status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [environmentId, listModels, refresh, supported]);

  const save = async (voice: AssemblyAiVoiceSettings | null, projectId?: ProjectId) => {
    if (disabled || !supported) return false;
    const result = await saveSettings({
      environmentId,
      input: {
        patch: {
          speechTranscription: {
            assemblyAi: projectId
              ? { projectOverrides: { [projectId]: voice } }
              : { voice: voice ?? assemblyAi.voice },
          },
        },
      },
    });
    return result._tag === "Success";
  };
  const changeOverride = async (projectId: ProjectId, voice: AssemblyAiVoiceSettings | null) => {
    setProjectBusy(projectId);
    setProjectError(null);
    return (async () => {
      if (!(await save(voice, projectId))) setProjectError(projectId);
    })()
      .catch(() => {
        setProjectError(projectId);
      })
      .finally(() => {
        setProjectBusy(null);
      });
  };

  return (
    <SettingsSection title={translate("settings.voice.options.title")}>
      {!supported ? (
        <Text className="p-4 text-sm text-foreground-muted">
          {translate("settings.voice.options.unsupported")}
        </Text>
      ) : (
        <>
          <VoiceSettingsEditor
            key={environmentId}
            title={translate("settings.voice.options.defaults")}
            value={assemblyAi.voice}
            models={models}
            config={config}
            disabled={disabled}
            onSave={(voice) => save(voice)}
          />
          {modelsState !== "ready" ? (
            <View className="gap-2 px-4 pb-4">
              <Text className="text-sm text-foreground-muted">
                {translate(
                  modelsState === "loading"
                    ? "settings.voice.options.modelsLoading"
                    : "settings.voice.options.modelsFailed",
                )}
              </Text>
              {modelsState === "error" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRefresh((current) => current + 1)}
                >
                  <Text className="text-sm text-foreground">
                    {translate("settings.voice.options.modelsRetry")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {projects.map((project) => (
            <View key={project.id} className="border-t border-border-subtle">
              {assemblyAi.projectOverrides[project.id] ? (
                <>
                  <VoiceSettingsEditor
                    key={`${environmentId}:${project.id}`}
                    title={project.title}
                    value={resolveAssemblyAiVoiceSettings(assemblyAi, project.id)}
                    models={models}
                    config={config}
                    disabled={disabled || projectBusy !== null}
                    onSave={(voice) => save(voice, project.id)}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={disabled || projectBusy !== null}
                    onPress={() => void changeOverride(project.id, null)}
                    className="px-4 pb-4 disabled:opacity-40"
                  >
                    <Text className="text-sm text-foreground">
                      {translate("settings.voice.options.inherit")}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <View className="gap-2 p-4">
                  <Text className="text-base font-t3-medium text-foreground">{project.title}</Text>
                  <Text className="text-sm text-foreground-muted">
                    {translate("settings.voice.options.inherited")}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={disabled || projectBusy !== null}
                    onPress={() => void changeOverride(project.id, assemblyAi.voice)}
                    className="disabled:opacity-40"
                  >
                    <Text className="text-sm text-foreground">
                      {translate("settings.voice.options.override")}
                    </Text>
                  </Pressable>
                </View>
              )}
              {projectError === project.id ? (
                <Text accessibilityRole="alert" className="px-4 pb-4 text-sm text-foreground">
                  {translate("settings.voice.options.saveFailed")}
                </Text>
              ) : null}
            </View>
          ))}
        </>
      )}
    </SettingsSection>
  );
}
