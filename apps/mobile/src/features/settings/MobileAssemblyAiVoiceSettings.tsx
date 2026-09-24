import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  resolveAssemblyAiVoiceSettings,
  AssemblyAiVoiceSettings,
  type EnvironmentId,
  type ProjectId,
  type ServerConfig,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { ModelSelectionModal, modelSelectionLabel } from "./ModelSelectionModal";

type ModelOption = { readonly id: string; readonly name: string };
type Choice<T extends string = string> = { readonly value: T; readonly label: string };
const isValidVoiceSettings = Schema.is(AssemblyAiVoiceSettings);

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
  disabled,
  multiline = false,
  numeric = false,
  maxLength,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
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
  const translate = useMobileInterfaceTranslator().message;
  const [draft, setDraft] = useState(value);
  const [languages, setLanguages] = useState(value.languageCodes.join(", "));
  const [terms, setTerms] = useState(value.customKeyterms.join("\n"));
  const [numbers, setNumbers] = useState({
    minTurnSilence: String(value.minTurnSilence),
    maxTurnSilence: String(value.maxTurnSilence),
    vadThreshold: String(value.vadThreshold),
    interruptionDelay: String(value.interruptionDelay),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"saved" | "saveFailed" | "validation" | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const controlsDisabled = disabled || busy;
  const pro = draft.speechModel === "universal-3-5-pro";
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
        onChange={(next) => {
          setNumbers((current) => ({ ...current, [key]: next }));
          setMessage(null);
        }}
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
    const minTurnSilence = Number(numbers.minTurnSilence);
    const maxTurnSilence = Number(numbers.maxTurnSilence);
    const vadThreshold = Number(numbers.vadThreshold.replace(",", "."));
    const interruptionDelay = Number(numbers.interruptionDelay);
    const next = {
      ...draft,
      languageCodes,
      customKeyterms,
      minTurnSilence,
      maxTurnSilence,
      vadThreshold,
      interruptionDelay,
    };
    if (
      Object.values(numbers).some((value) => value.trim().length === 0) ||
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
    <View>
      <VoiceSelect
        label={translate("settings.voice.options.speechModel")}
        value={draft.speechModel}
        disabled={controlsDisabled}
        onChange={(next) => update("speechModel", next)}
        choices={[
          { value: "universal-3-5-pro", label: "Universal 3.5 Pro" },
          { value: "universal-streaming-multilingual", label: "Universal Streaming Multilingual" },
          { value: "universal-streaming-english", label: "Universal Streaming English" },
        ]}
      />
      {pro ? (
        <>
          <VoiceTextField
            label={translate("settings.voice.options.languages")}
            hint={translate("settings.voice.options.languagesHint")}
            value={languages}
            disabled={controlsDisabled}
            onChange={(next) => {
              setLanguages(next);
              setMessage(null);
            }}
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
        onChange={(next) => {
          setTerms(next);
          setMessage(null);
        }}
      />
      {pro ? (
        <VoiceTextField
          label={translate("settings.voice.options.context")}
          hint={translate("settings.voice.options.contextHint")}
          value={draft.contextPrompt}
          multiline
          maxLength={1750}
          disabled={controlsDisabled}
          onChange={(next) => update("contextPrompt", next)}
        />
      ) : null}
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
      <View className="gap-2 p-4">
        <Text className="text-base font-t3-medium text-foreground">
          {translate("settings.voice.options.cleanupModel")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate("settings.voice.options.cleanupModel")}
          disabled={controlsDisabled || draft.cleanupMode === "off"}
          onPress={() => setModelPickerOpen(true)}
          className="rounded-2xl bg-subtle px-4 py-3 disabled:opacity-40"
        >
          <Text className="text-base text-foreground">
            {draft.cleanupModelSelection
              ? modelSelectionLabel(config, draft.cleanupModelSelection)
              : (modelOptions.find((model) => model.id === draft.cleanupModel)?.name ??
                draft.cleanupModel)}
          </Text>
        </Pressable>
        <ModelSelectionModal
          config={config}
          current={draft.cleanupModelSelection}
          allowDefault={false}
          auxiliaryModels={modelOptions}
          selectedAuxiliaryModel={draft.cleanupModelSelection ? null : draft.cleanupModel}
          onSelectAuxiliaryModel={(model) => {
            setMessage(null);
            setDraft((current) => ({
              ...current,
              cleanupModel: model,
              cleanupModelSelection: null,
            }));
          }}
          onSelect={(selection) => {
            if (selection) update("cleanupModelSelection", selection);
          }}
          visible={modelPickerOpen}
          onClose={() => setModelPickerOpen(false)}
        />
      </View>
      {draft.cleanupMode === "custom" ? (
        <VoiceTextField
          label={translate("settings.voice.options.instructions")}
          value={draft.cleanupInstructions}
          multiline
          maxLength={4000}
          disabled={controlsDisabled}
          onChange={(next) => update("cleanupInstructions", next)}
        />
      ) : null}
      {toggle(
        "automaticFileReferences",
        "settings.voice.options.files",
        "settings.voice.options.filesHint",
      )}
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          {translate("settings.voice.options.cloudHint")}
        </Text>
        {message ? (
          <Text
            accessibilityRole={message === "saved" ? "text" : "alert"}
            className="text-sm text-foreground"
          >
            {translate(`settings.voice.options.${message}`)}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={controlsDisabled}
          onPress={() => void save()}
          className="rounded-xl bg-foreground px-4 py-3 disabled:opacity-40"
        >
          <Text className="text-center font-t3-medium text-background">
            {translate(busy ? "settings.voice.options.saving" : "settings.voice.options.save")}
          </Text>
        </Pressable>
      </View>
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
                key={JSON.stringify(value)}
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
  updateSettings,
}: {
  readonly environmentId: EnvironmentId;
  readonly config: ServerConfig;
  readonly projects: readonly EnvironmentProject[];
  readonly disabled: boolean;
  readonly updateSettings: (patch: ServerSettingsPatch, label: string) => Promise<boolean>;
}) {
  const translate = useMobileInterfaceTranslator().message;
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

  const save = (voice: AssemblyAiVoiceSettings | null, projectId?: ProjectId) =>
    updateSettings(
      {
        speechTranscription: {
          assemblyAi: projectId
            ? { projectOverrides: { [projectId]: voice } }
            : { voice: voice ?? assemblyAi.voice },
        },
      },
      translate("settings.voice.options.title"),
    );
  const changeOverride = async (projectId: ProjectId, voice: AssemblyAiVoiceSettings | null) => {
    setProjectBusy(projectId);
    setProjectError(null);
    try {
      if (!(await save(voice, projectId))) setProjectError(projectId);
    } catch {
      setProjectError(projectId);
    } finally {
      setProjectBusy(null);
    }
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
