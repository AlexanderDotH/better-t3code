import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type {
  AiEndpointCandidate,
  AiEndpointDiscoveryEvent,
  EnvironmentId,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerConfig,
  ServerProvider,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useContext, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  adoptMobileAiEndpointDraft,
  isMobileAiEndpointConfigured,
  MOBILE_AI_ENDPOINT_LABELS,
  mobileAiEndpointDraft,
  mobileAiEndpointDraftWithBaseUrl,
  mobileAiEndpointSettingsPatch,
  supportsMobileAiEndpointDiscovery,
  type MobileAiEndpointKind,
} from "./mobile-ai-endpoint-settings";

function MobileAiEndpointDiscovery(props: {
  readonly environmentId: EnvironmentId;
  readonly config: ServerConfig;
  readonly disabled: boolean;
  readonly onAdopt: (candidate: AiEndpointCandidate) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const registry = useContext(RegistryContext);
  const result = useAtomValue(serverEnvironment.aiEndpointDiscovery(props.environmentId));
  const [cancelled, setCancelled] = useState(false);
  const [lastEvent, setLastEvent] = useState<AiEndpointDiscoveryEvent | null>(null);
  const currentEvent = AsyncResult.isSuccess(result) ? result.value : null;
  const event = currentEvent ?? lastEvent;
  const scanning =
    !cancelled &&
    (currentEvent?.status === "scanning" || (currentEvent === null && result.waiting));
  const error = AsyncResult.isFailure(result) ? Cause.squash(result.cause) : null;

  useEffect(() => {
    serverEnvironment.startAiEndpointDiscovery(registry, {
      environmentId: props.environmentId,
      input: {},
    });
    return () => serverEnvironment.cancelAiEndpointDiscovery(registry, props.environmentId);
  }, [props.environmentId, registry]);

  useEffect(() => {
    if (currentEvent !== null) setLastEvent(currentEvent);
  }, [currentEvent]);

  return (
    <View className="gap-3 rounded-2xl bg-subtle p-4">
      <Text className="text-base font-t3-semibold text-foreground">
        {translator.message("settings.providers.endpoint.discoveryTitle")}
      </Text>
      <Text className="text-sm text-foreground-muted">
        {translator.message("settings.providers.endpoint.discoveryEnvironment", {
          environment: props.config.environment.label,
        })}
      </Text>
      {scanning ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          {translator.message("settings.providers.endpoint.discoveryScanning", {
            scanned: currentEvent?.scanned ?? 0,
            total: currentEvent?.total ?? 0,
          })}
        </Text>
      ) : null}
      {cancelled ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          {translator.message("settings.providers.endpoint.discoveryCancelled")}
        </Text>
      ) : null}
      {event?.message || error ? (
        <Text className="text-sm text-foreground-muted">
          {error instanceof Error ? error.message : event?.message}
        </Text>
      ) : null}
      {event?.limited ? (
        <Text className="text-sm text-foreground-muted">
          {translator.message("settings.providers.endpoint.discoveryLimited")}
        </Text>
      ) : null}
      {!scanning && event?.endpoints.length === 0 ? (
        <Text className="text-sm text-foreground-muted">
          {translator.message("settings.providers.endpoint.discoveryEmpty")}
        </Text>
      ) : null}
      {event?.endpoints.map((candidate) => (
        <View key={candidate.baseUrl} className="gap-1 border-t border-border-subtle pt-3">
          <View className="flex-row items-center gap-2">
            <ProviderIcon provider={candidate.kind} />
            <Text className="font-t3-medium text-foreground">
              {MOBILE_AI_ENDPOINT_LABELS[candidate.kind]}
            </Text>
          </View>
          <Text selectable className="text-sm text-foreground">
            {candidate.baseUrl}
          </Text>
          <Text className="text-xs text-foreground-muted">
            {translator.message(
              candidate.verified
                ? "mobile.settings.endpoint.verified"
                : "settings.providers.endpoint.discoveryUnverified",
            )}
            {candidate.requiresApiKey
              ? ` · ${translator.message("settings.providers.endpoint.discoveryRequiresKey")}`
              : ""}
          </Text>
          {candidate.models.length > 0 ? (
            <Text className="text-sm text-foreground-muted" numberOfLines={3}>
              {candidate.models.map((model) => model.name || model.id).join(", ")}
            </Text>
          ) : null}
          {isMobileAiEndpointConfigured(props.config.settings, candidate) ? (
            <Text className="text-xs text-foreground-muted">
              {translator.message("settings.providers.endpoint.discoveryExisting")}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${translator.message("settings.providers.endpoint.discoveryUse")} ${candidate.baseUrl}`}
            disabled={props.disabled}
            onPress={() => props.onAdopt(candidate)}
            className="self-start py-2 disabled:opacity-40"
          >
            <Text className="font-t3-medium text-foreground">
              {translator.message("settings.providers.endpoint.discoveryUse")}
            </Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (scanning) {
            setCancelled(true);
            serverEnvironment.cancelAiEndpointDiscovery(registry, props.environmentId);
          } else {
            setCancelled(false);
            serverEnvironment.startAiEndpointDiscovery(registry, {
              environmentId: props.environmentId,
              input: { refresh: true },
            });
          }
        }}
        className="self-start rounded-xl bg-card px-4 py-2"
      >
        <Text className="font-t3-medium text-foreground">
          {translator.message(
            scanning ? "common.cancel" : "settings.providers.endpoint.discoveryRescan",
          )}
        </Text>
      </Pressable>
    </View>
  );
}

export function MobileAiEndpointSetup(props: {
  readonly environmentId: EnvironmentId;
  readonly config: ServerConfig;
  readonly driver: MobileAiEndpointKind;
  readonly instanceId: ProviderInstanceId;
  readonly instance?: ProviderInstanceConfig;
  readonly provider?: ServerProvider;
  readonly readOnly: boolean;
  readonly onClose: () => void;
  readonly updateSettings: (patch: ServerSettingsPatch, label: string) => Promise<boolean>;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const setProviderAuthCredential = useAtomCommand(serverEnvironment.setProviderAuthCredential, {
    reportFailure: false,
  });
  const [draft, setDraft] = useState(() => mobileAiEndpointDraft(props.driver, props.instance));
  const [modelCatalog, setModelCatalog] = useState<{
    readonly baseUrl: string;
    readonly models: AiEndpointCandidate["models"];
  } | null>(null);
  const [hasSaved, setHasSaved] = useState(props.instance !== undefined);
  const [choosingModel, setChoosingModel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = MOBILE_AI_ENDPOINT_LABELS[draft.driver];
  const initialBaseUrl = mobileAiEndpointDraft(props.driver, props.instance).baseUrl;
  const models =
    modelCatalog?.baseUrl === draft.baseUrl
      ? modelCatalog.models
      : draft.baseUrl === initialBaseUrl
        ? (props.provider?.models
            .filter((model) => model.isSelectable !== false)
            .map((model) => ({
              id: model.slug,
              name: model.name,
            })) ?? [])
        : [];

  const save = async (fetchModels: boolean) => {
    if (props.readOnly || saving) return;
    setError(null);
    let patch: ServerSettingsPatch;
    try {
      patch = mobileAiEndpointSettingsPatch({
        settings: props.config.settings,
        instanceId: props.instanceId,
        draft,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save endpoint.");
      return;
    }
    setSaving(true);
    try {
      if (!(await props.updateSettings(patch, label))) return;
      setHasSaved(true);
      const savedDraft = mobileAiEndpointDraft(
        draft.driver,
        patch.providerInstances?.[props.instanceId],
      );
      setDraft((current) => ({ ...current, baseUrl: savedDraft.baseUrl }));
      const credential = draft.apiKey.trim();
      if (credential) {
        const result = await setProviderAuthCredential({
          environmentId: props.environmentId,
          input: { instanceId: props.instanceId, credential },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) throw squashAtomCommandFailure(result);
          return;
        }
        setDraft((current) => ({ ...current, apiKey: "" }));
      }
      if (!fetchModels) {
        props.onClose();
        return;
      }
      const result = await refreshProviders({
        environmentId: props.environmentId,
        input: { instanceId: props.instanceId, refreshModels: true },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) throw squashAtomCommandFailure(result);
        return;
      }
      const provider = result.value.providers.find(
        (provider) => provider.instanceId === props.instanceId,
      );
      const models =
        provider?.models
          .filter((model) => model.isSelectable !== false)
          .map((model) => ({ id: model.slug, name: model.name })) ?? [];
      setModelCatalog({ baseUrl: savedDraft.baseUrl, models });
      setChoosingModel(models.length > 0);
      if (provider?.message) setError(provider.message);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save endpoint.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible
      onRequestClose={() => {
        if (!saving) props.onClose();
      }}
    >
      <View className="flex-1 bg-sheet">
        <View className="flex-row items-center gap-3 border-b border-border px-5 py-4">
          <ProviderIcon provider={draft.driver} size={24} />
          <Text className="flex-1 text-xl font-t3-semibold text-foreground">{label}</Text>
          <Pressable accessibilityRole="button" disabled={saving} onPress={props.onClose}>
            <Text className="font-t3-medium text-foreground">
              {translator.message("common.cancel")}
            </Text>
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-5 p-5"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          {supportsMobileAiEndpointDiscovery(
            props.config.environment.capabilities,
            props.readOnly,
          ) ? (
            <MobileAiEndpointDiscovery
              environmentId={props.environmentId}
              config={props.config}
              disabled={saving}
              onAdopt={(candidate) => {
                setModelCatalog(candidate);
                setDraft((current) => adoptMobileAiEndpointDraft(current, candidate, hasSaved));
              }}
            />
          ) : null}
          <View className="gap-2">
            <Text className="text-sm font-t3-medium text-foreground">
              {translator.message("settings.providers.instance.displayName")}
            </Text>
            <TextInput
              accessibilityLabel={translator.message("settings.providers.instance.displayName")}
              editable={!props.readOnly && !saving}
              onChangeText={(displayName) => setDraft((current) => ({ ...current, displayName }))}
              placeholder={label}
              value={draft.displayName}
              className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
            />
          </View>
          <View className="gap-2">
            <Text className="text-sm font-t3-medium text-foreground">
              {translator.message("mobile.settings.endpoint.baseUrl")}
            </Text>
            <TextInput
              accessibilityLabel={translator.message("mobile.settings.endpoint.baseUrl")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!props.readOnly && !saving}
              keyboardType="url"
              onChangeText={(baseUrl) =>
                setDraft((current) => mobileAiEndpointDraftWithBaseUrl(current, baseUrl))
              }
              placeholder="http://127.0.0.1:1234/v1"
              value={draft.baseUrl}
              className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
            />
            <Text className="text-sm text-foreground-muted">
              {translator.message("mobile.settings.endpoint.serverAddressHint")}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {translator.message("mobile.settings.endpoint.urlChangeClearsKey")}
            </Text>
          </View>
          <View className="gap-2">
            <Text className="text-sm font-t3-medium text-foreground">
              {translator.message("mobile.settings.endpoint.apiKeyOptional")}
            </Text>
            <TextInput
              accessibilityLabel={translator.message("mobile.settings.endpoint.apiKeyOptional")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!props.readOnly && !saving}
              onChangeText={(apiKey) => setDraft((current) => ({ ...current, apiKey }))}
              placeholder={
                draft.baseUrl === initialBaseUrl && props.provider?.auth.capabilities?.canDisconnect
                  ? translator.message("mobile.settings.agents.savedApiKey")
                  : ""
              }
              secureTextEntry
              value={draft.apiKey}
              className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
            />
          </View>
          <View className="gap-2">
            <Text className="text-sm font-t3-medium text-foreground">
              {translator.message("mobile.settings.projects.settings.defaultModel")}
            </Text>
            <TextInput
              accessibilityLabel={translator.message(
                "mobile.settings.projects.settings.defaultModel",
              )}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!props.readOnly && !saving}
              onChangeText={(defaultModel) => setDraft((current) => ({ ...current, defaultModel }))}
              value={draft.defaultModel}
              className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
            />
            <Text className="text-sm text-foreground-muted">
              {translator.message("mobile.settings.endpoint.manualModelHint")}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={props.readOnly || saving || props.instance?.enabled === false}
              onPress={() => void save(true)}
              className="self-start py-2 disabled:opacity-40"
            >
              <Text className="font-t3-medium text-foreground">
                {translator.message("mobile.settings.endpoint.saveAndFetchModels")}
              </Text>
            </Pressable>
            {models.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: choosingModel }}
                disabled={props.readOnly || saving}
                onPress={() => setChoosingModel((current) => !current)}
                className="self-start py-2"
              >
                <Text className="font-t3-medium text-foreground">
                  {translator.message("mobile.settings.agents.chooseModel")}
                </Text>
              </Pressable>
            ) : null}
            {choosingModel ? (
              <ScrollView nestedScrollEnabled className="max-h-64 rounded-2xl bg-subtle">
                {models.map((model) => (
                  <Pressable
                    key={model.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: draft.defaultModel === model.id }}
                    disabled={props.readOnly || saving}
                    onPress={() => {
                      setDraft((current) => ({ ...current, defaultModel: model.id }));
                      setChoosingModel(false);
                    }}
                    className="gap-1 border-b border-border-subtle px-4 py-3"
                  >
                    <Text className="text-base text-foreground">{model.name || model.id}</Text>
                    {model.name && model.name !== model.id ? (
                      <Text className="text-sm text-foreground-muted">{model.id}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
          <View className="gap-2">
            <Text className="text-sm font-t3-medium text-foreground">
              {translator.message("mobile.settings.endpoint.customModels")}
            </Text>
            <TextInput
              accessibilityLabel={translator.message("mobile.settings.endpoint.customModels")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!props.readOnly && !saving}
              multiline
              onChangeText={(customModels) =>
                setDraft((current) => ({ ...current, customModels: customModels.split(/\r?\n/) }))
              }
              value={draft.customModels.join("\n")}
              className="min-h-24 rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
            />
            <Text className="text-sm text-foreground-muted">
              {translator.message("mobile.settings.provider.onePerLine")}
            </Text>
          </View>
          {error ? (
            <Text accessibilityRole="alert" className="text-sm text-destructive">
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={props.readOnly || saving}
            onPress={() => void save(false)}
            className="items-center rounded-2xl bg-foreground px-4 py-3 disabled:opacity-40"
          >
            <Text className="font-t3-medium text-background">
              {translator.message(
                saving
                  ? "mobile.settings.agents.saving"
                  : "settings.providers.endpoint.saveChanges",
              )}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
