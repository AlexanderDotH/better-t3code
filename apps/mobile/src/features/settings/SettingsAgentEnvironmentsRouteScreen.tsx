import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { type EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  ProviderInstanceId,
  isManagedDriverAllowed,
  AuthSettingsWriteScope,
  AuthProvidersManageScope,
  type ProviderDriverKind,
  type EnvironmentId,
  type ServerConfig,
  type ServerProvider,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";

import { ProviderIcon } from "../../components/ProviderIcon";
import { uuidv4 } from "../../lib/uuid";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { environmentSession, readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceState } from "../../state/workspace";
import {
  mobileProviderAuthEventPresentation,
  providerAuthenticationPresentation,
  providerAuthMutationAccess,
  providerRateLimitLabel,
  providerStatusLabel,
  supportsEnvironmentAgentSettings,
} from "./environment-agent-settings";
import { providerClients } from "@t3tools/client-runtime/provider-clients";
import { AgentSettingsSheet } from "./AgentSettingsSheet";
import { AgentSettingsButton } from "./AgentSettingsFields";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { MobileProviderInstanceEditor } from "./MobileProviderInstanceEditor";
import { MobileProviderModelsEditor } from "./MobileProviderModelsEditor";
import { mobileProviderInstanceFor } from "./mobile-provider-instance-settings";
import { MobileAssemblyAiVoiceSettings } from "./MobileAssemblyAiVoiceSettings";
import { MobileAgentModelSettings } from "./MobileAgentModelSettings";
import { MobileProviderAdvancedSettings } from "./MobileProviderAdvancedSettings";
export { ModelSelectionModal, modelSelectionLabel } from "./ModelSelectionModal";
import { MobileAiEndpointSetup } from "./MobileAiEndpointSetup";
import {
  isMobileAiEndpointKind,
  mobileAiEndpointDraft,
  type MobileAiEndpointKind,
} from "./mobile-ai-endpoint-settings";
import { McpSettingsEntry as McpSettings } from "./mcp/McpManagementScreen";
import { SkillsSettingsEntry as SkillSettings } from "./skills/SkillsManagementScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import {
  EnvironmentChatImportSettings,
  EnvironmentSpeechProfileSettings,
} from "./SettingsEnvironmentDataSections";
import {
  mobileResponseStreamingMode,
  mobileResponseStreamingSettingsPatch,
} from "./response-streaming-settings";

function failureMessage(
  result: Parameters<typeof squashAtomCommandFailure>[0],
  fallback: string,
): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : fallback;
}

function InlineSettingsSwitch(props: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}) {
  return (
    <ThemedSwitch
      accessibilityLabel={props.label}
      disabled={props.disabled}

      onValueChange={props.onValueChange}

      value={props.value}
    />
  );
}

export function MobileProviderSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly config: ServerConfig;
  readonly readOnly: boolean;
  readonly hideAuthentication?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, { reportFailure: false });
  const mutateInstance = useAtomCommand(serverEnvironment.mutateProviderInstance, {
    reportFailure: true,
    label: "provider settings",
  });
  const [adding, setAdding] = useState(false);
  const [instanceSetup, setInstanceSetup] = useState<{
    readonly driver: ProviderDriverKind;
    readonly instanceId: ProviderInstanceId;
  } | null>(null);
  const [modelsInstanceId, setModelsInstanceId] = useState<ProviderInstanceId | null>(null);
  const canWritePreferences = readEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<ReadonlySet<string>>(() => new Set());
  const [endpointSetup, setEndpointSetup] = useState<{
    readonly driver: MobileAiEndpointKind;
    readonly instanceId: ProviderInstanceId;
  } | null>(null);

  const setupProvider = props.config.providers.find(
    (provider) => provider.instanceId === instanceSetup?.instanceId,
  );
  const setupInstance = setupProvider
    ? mobileProviderInstanceFor(props.config.settings, setupProvider)
    : instanceSetup
      ? props.config.settings.providerInstances[instanceSetup.instanceId]
      : undefined;
  const modelsProvider = props.config.providers.find(
    (provider) => provider.instanceId === modelsInstanceId,
  );

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const result = await refreshProviders({ environmentId: props.environmentId, input: {} });
    setRefreshing(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      Alert.alert(
        translator.message("mobile.ui.couldNotRefreshProviders"),
        failureMessage(result, translator.message("mobile.ui.providerRefreshFailed")),
      );
    }
  }, [props.environmentId, refreshProviders, refreshing, translator]);

  const runUpdate = useCallback(
    async (provider: ServerProvider) => {
      if (updating.has(provider.instanceId)) return;
      setUpdating((current) => new Set(current).add(provider.instanceId));
      const result = await updateProvider({
        environmentId: props.environmentId,
        input: { provider: provider.driver, instanceId: provider.instanceId },
      });
      setUpdating((current) => {
        const next = new Set(current);
        next.delete(provider.instanceId);
        return next;
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        Alert.alert(
          translator.message("mobile.ui.couldNotUpdateProvider"),
          failureMessage(result, translator.message("providerUpdate.failureFallback")),
        );
      }
    },
    [props.environmentId, updateProvider, updating, translator],
  );

  return (
    <SettingsSection title={translator.message("mobile.settings.agents.providers")}>
      {props.config.providers.map((provider, index) => {
        const title = provider.displayName ?? String(provider.instanceId);
        const configuredInstance = mobileProviderInstanceFor(props.config.settings, provider);
        const endpointDriver = isMobileAiEndpointKind(provider.driver) ? provider.driver : null;
        const authPresentation = providerAuthenticationPresentation(provider);
        const updateAvailable = provider.versionAdvisory?.canUpdate === true;
        return (
          <View
            key={provider.instanceId}
            className={index === 0 ? "gap-1 p-4" : "gap-1 border-t border-border-subtle p-4"}
          >
            <View className="flex-row items-center gap-3">
              {endpointDriver ? <ProviderIcon provider={endpointDriver} size={24} /> : null}
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-lg text-foreground">{title}</Text>
                <Text className="text-sm text-foreground-muted">
                  {providerStatusLabel(provider)}
                </Text>
              </View>
              <InlineSettingsSwitch
                disabled={
                  props.readOnly ||
                  !isManagedDriverAllowed(props.config.managedPolicy, provider.driver)
                }
                label={`${title} enabled`}
                value={provider.enabled}
                onValueChange={(enabled) => {
                  void mutateInstance({
                    environmentId: props.environmentId,
                    input: {
                      patch: {},
                      providerInstanceMutation: {
                        operation: "upsert",
                        instanceId: provider.instanceId,
                        instance: { ...configuredInstance, enabled },
                      },
                    },
                  });
                }}
              />
            </View>
            {provider.message ? (
              <Text className="text-sm leading-normal text-foreground-muted">
                {provider.message}
              </Text>
            ) : null}
            {authPresentation && !props.hideAuthentication ? (
              <MobileProviderAuthentication
                key={
                  endpointDriver
                    ? mobileAiEndpointDraft(endpointDriver, configuredInstance).baseUrl
                    : provider.instanceId
                }
                environmentId={props.environmentId}
                provider={provider}
                readOnly={props.readOnly}
              />
            ) : null}
            <View className="gap-2 pt-2">
              <AgentSettingsButton
                label={translator.message("mobile.agents.editProvider")}
                disabled={props.readOnly}
                onPress={() =>
                  setInstanceSetup({ driver: provider.driver, instanceId: provider.instanceId })
                }
              />
              {endpointDriver ? (
                <AgentSettingsButton
                  label={translator.message("mobile.settings.provider.configuration")}
                  disabled={props.readOnly}
                  onPress={() =>
                    setEndpointSetup({ driver: endpointDriver, instanceId: provider.instanceId })
                  }
                />
              ) : null}
              <AgentSettingsButton
                label={translator.message("mobile.agents.providerModels")}
                onPress={() => setModelsInstanceId(provider.instanceId)}
              />
              <AgentSettingsButton
                label={translator.message("mobile.settings.agents.remove")}
                destructive
                disabled={props.readOnly}
                onPress={() =>
                  Alert.alert(
                    translator.message("mobile.settings.endpoint.removeTitle", {
                      provider: title,
                    }),
                    translator.message("mobile.settings.endpoint.removeDescription"),
                    [
                      { text: translator.message("common.cancel"), style: "cancel" },
                      {
                        text: translator.message("mobile.settings.agents.remove"),
                        style: "destructive",
                        onPress: () =>
                          void mutateInstance({
                            environmentId: props.environmentId,
                            input: {
                              patch: {},
                              providerInstanceMutation: {
                                operation: "remove",
                                instanceId: provider.instanceId,
                              },
                            },
                          }),
                      },
                    ],
                  )
                }
              />
            </View>
            {updateAvailable ? (
              <Pressable
                accessibilityRole="button"
                disabled={props.readOnly || updating.has(provider.instanceId)}
                onPress={() => void runUpdate(provider)}
                className="self-start py-1"
              >
                <Text className="font-t3-medium text-foreground">
                  {updating.has(provider.instanceId)
                    ? translator.message("settings.theme.search.updating")
                    : `Update to ${provider.versionAdvisory?.latestVersion ?? "latest"}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <View className="gap-3 border-t border-border-subtle p-4">
        <AgentSettingsButton
          label={translator.message("mobile.agents.addProvider")}
          disabled={
            props.readOnly ||
            props.config.managedPolicy?.limits?.providers?.allowedDrivers?.length === 0
          }
          onPress={() => setAdding(true)}
        />
      </View>
      {adding ? (
        <AgentSettingsSheet
          title={translator.message("mobile.agents.addProvider")}
          onClose={() => setAdding(false)}
        >
          {providerClients.definitions
            .filter((definition) =>
              isManagedDriverAllowed(props.config.managedPolicy, definition.driverKind),
            )
            .map((definition) => (
              <ListChoiceRow
                key={definition.driverKind}
                label={definition.label}
                selected={false}
                onPress={() => {
                  const instanceId = ProviderInstanceId.make(
                    `${definition.driverKind}_${uuidv4()}`,
                  );
                  if (isMobileAiEndpointKind(definition.driverKind))
                    setEndpointSetup({ driver: definition.driverKind, instanceId });
                  else setInstanceSetup({ driver: definition.driverKind, instanceId });
                  setAdding(false);
                }}
              />
            ))}
        </AgentSettingsSheet>
      ) : null}
      {instanceSetup ? (
        <MobileProviderInstanceEditor
          key={instanceSetup.instanceId}
          environmentId={props.environmentId}
          serverConfig={props.config}
          instanceId={instanceSetup.instanceId}
          driver={instanceSetup.driver}
          instance={setupInstance}
          provider={setupProvider}
          disabled={props.readOnly}
          onClose={() => setInstanceSetup(null)}
        />
      ) : null}
      {modelsProvider ? (
        <MobileProviderModelsEditor
          key={modelsProvider.instanceId}
          environmentId={props.environmentId}
          config={props.config}
          instanceId={modelsProvider.instanceId}
          instance={mobileProviderInstanceFor(props.config.settings, modelsProvider)}
          provider={modelsProvider}
          canManage={!props.readOnly}
          canWritePreferences={canWritePreferences}
          onClose={() => setModelsInstanceId(null)}
        />
      ) : null}
      {endpointSetup ? (
        <MobileAiEndpointSetup
          key={`${props.environmentId}:${endpointSetup.instanceId}`}
          environmentId={props.environmentId}
          config={props.config}
          driver={endpointSetup.driver}
          instanceId={endpointSetup.instanceId}
          instance={props.config.settings.providerInstances[endpointSetup.instanceId]}
          provider={props.config.providers.find(
            (provider) => provider.instanceId === endpointSetup.instanceId,
          )}
          readOnly={props.readOnly}
          onClose={() => setEndpointSetup(null)}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={refreshing}
        onPress={() => void refresh()}
        className="border-t border-border-subtle p-4"
      >
        <Text className="text-center font-t3-medium text-foreground">
          {refreshing
            ? translator.message("mobile.settings.agents.refreshing")
            : translator.message("mobile.settings.agents.refreshStatus")}
        </Text>
      </Pressable>
    </SettingsSection>
  );
}

function MobileProviderAuthentication(props: {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider;
  readonly readOnly: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const presentation = providerAuthenticationPresentation(props.provider)!;
  const event = useAtomValue(
    serverEnvironment.providerAuthConnectEventAtom({
      environmentId: props.environmentId,
      instanceId: props.provider.instanceId,
    }),
  );
  const connectProviderAuth = useAtomCommand(serverEnvironment.connectProviderAuth, {
    reportFailure: false,
  });
  const disconnectProviderAuth = useAtomCommand(serverEnvironment.disconnectProviderAuth, {
    reportFailure: false,
  });
  const setProviderAuthCredential = useAtomCommand(serverEnvironment.setProviderAuthCredential, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [dialogVisible, setDialogVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [credentialDraft, setCredentialDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const eventPresentation = event
    ? mobileProviderAuthEventPresentation(event, presentation.providerLabel)
    : null;
  const rateLimit = providerRateLimitLabel(props.provider.rateLimit);

  const refresh = useCallback(async () => {
    await refreshProviders({ environmentId: props.environmentId, input: {} });
  }, [props.environmentId, refreshProviders]);

  const connect = async () => {
    if (presentation.method === "api-key") return;
    setBusy(true);
    setLocalError(null);
    setDialogVisible(true);
    const result = await connectProviderAuth({
      environmentId: props.environmentId,
      input: { instanceId: props.provider.instanceId, flow: presentation.method },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setLocalError(failureMessage(result, `${presentation.providerLabel} sign-in failed.`));
      return;
    }
    await refresh();
  };

  const saveCredential = async () => {
    const credential = credentialDraft.trim();
    if (!credential) return;
    setCredentialDraft("");
    setBusy(true);
    const result = await setProviderAuthCredential({
      environmentId: props.environmentId,
      input: { instanceId: props.provider.instanceId, credential },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      Alert.alert(
        `Could not save ${presentation.credentialLabel ?? "credential"}`,
        failureMessage(result, `${presentation.providerLabel} rejected the credential.`),
      );
      return;
    }
    await refresh();
  };

  const disconnect = async () => {
    setBusy(true);
    const result = await disconnectProviderAuth({
      environmentId: props.environmentId,
      input: { instanceId: props.provider.instanceId },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      Alert.alert(
        `Could not disconnect ${presentation.providerLabel}`,
        failureMessage(result, `${presentation.providerLabel} disconnect failed.`),
      );
      return;
    }
    await refresh();
  };

  if (props.readOnly) {
    return (
      <Text className="text-sm leading-normal text-foreground-muted">
        {presentation.detail} · {translator.message("mobile.settings.agents.authEditRequired")}
      </Text>
    );
  }

  return (
    <View className="gap-2 pt-1">
      <Text className="text-sm leading-normal text-foreground-muted">
        {[presentation.detail, rateLimit].filter(Boolean).join(" · ")}
      </Text>
      {presentation.method === "api-key" ? (
        <View className="gap-2">
          <TextInput
            accessibilityLabel={
              presentation.credentialLabel ?? translator.message("mobile.settings.agents.apiKey")
            }
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCredentialDraft}
            placeholder={
              presentation.credentialPlaceholder ??
              translator.message("mobile.settings.agents.apiKey")
            }

            secureTextEntry
            value={credentialDraft}
            className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || credentialDraft.trim().length === 0}
            onPress={() => void saveCredential()}
            className="self-start rounded-xl bg-foreground px-4 py-2 disabled:opacity-40"
          >
            <Text className="font-t3-medium text-screen">
              {busy
                ? translator.message("mobile.settings.agents.saving")
                : (presentation.credentialActionLabel ?? presentation.actionLabel)}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {presentation.action === "disconnect" ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() =>
            Alert.alert(
              props.provider.auth.type === "api-key-optional"
                ? presentation.actionLabel
                : translator.message("mobile.settings.agents.disconnectTitle", {
                    provider: presentation.providerLabel,
                  }),
              translator.message(
                props.provider.auth.type === "api-key-optional"
                  ? "mobile.settings.endpoint.optionalKeyRemovalDescription"
                  : "mobile.settings.agents.disconnectDescription",
              ),
              [
                { text: translator.message("common.cancel"), style: "cancel" },
                {
                  text: presentation.actionLabel,
                  style: "destructive",
                  onPress: () => void disconnect(),
                },
              ],
            )
          }
          className="self-start rounded-xl bg-subtle px-4 py-2 disabled:opacity-40"
        >
          <Text className="font-t3-medium text-foreground">
            {busy
              ? translator.message("mobile.settings.agents.disconnecting")
              : presentation.actionLabel}
          </Text>
        </Pressable>
      ) : presentation.method !== "api-key" &&
        (presentation.action === "connect" || presentation.action === "reconnect") ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void connect()}
          className="self-start rounded-xl bg-foreground px-4 py-2 disabled:opacity-40"
        >
          <Text className="font-t3-medium text-screen">
            {busy
              ? translator.message("mobile.settings.agents.connecting")
              : presentation.actionLabel}
          </Text>
        </Pressable>
      ) : null}

      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={dialogVisible}
        onRequestClose={() => setDialogVisible(false)}
      >
        <View className="flex-1 justify-center gap-5 bg-sheet px-6">
          <Text className="text-2xl font-t3-semibold text-foreground">
            {translator.message("mobile.settings.agents.connectProvider", {
              provider: presentation.providerLabel,
            })}
          </Text>
          <Text className="text-base leading-normal text-foreground-muted">
            {localError ??
              eventPresentation?.message ??
              translator.message("mobile.settings.agents.preparingSignIn", {
                provider: presentation.providerLabel,
              })}
          </Text>
          {eventPresentation?.kind === "browser" ? (
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                void Linking.openURL(eventPresentation.authorizationUrl).catch(() =>
                  Alert.alert(
                    translator.message("mobile.settings.agents.openAuthorizationFailed"),
                    eventPresentation.authorizationUrl,
                  ),
                )
              }
              className="self-start rounded-xl bg-foreground px-4 py-3"
            >
              <Text className="font-t3-medium text-screen">
                {translator.message("mobile.settings.agents.openAuthorization")}
              </Text>
            </Pressable>
          ) : null}
          {eventPresentation?.kind === "device-code" ? (
            <>
              <Text className="self-start rounded-2xl bg-card px-5 py-3 text-xl font-t3-semibold tracking-widest text-foreground">
                {eventPresentation.userCode}
              </Text>
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL(eventPresentation.verificationUrl).catch(() =>
                    Alert.alert(
                      translator.message("mobile.settings.agents.openVerificationFailed"),
                      eventPresentation.verificationUrl,
                    ),
                  )
                }
                className="self-start rounded-xl bg-foreground px-4 py-3"
              >
                <Text className="font-t3-medium text-screen">
                  {translator.message("mobile.settings.agents.openVerification")}
                </Text>
              </Pressable>
            </>
          ) : null}
          {(localError || eventPresentation?.kind === "error") && !busy ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void connect()}
              className="self-start rounded-xl bg-foreground px-4 py-3"
            >
              <Text className="font-t3-medium text-screen">
                {translator.message("common.retry")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => setDialogVisible(false)}
            className="self-start py-2"
          >
            <Text className="font-t3-medium text-foreground">
              {translator.message("common.close")}
            </Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

function EnvironmentAgentSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}) {
  const translator = useMobileInterfaceTranslator();
  const config = useEnvironmentServerConfig(props.environmentId);
  const updateServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const authSession = useAtomValue(environmentSession.sessionStateValueAtom(props.environmentId));
  const [assemblyAiKey, setAssemblyAiKey] = useState("");

  const updateSettings = useCallback(
    async (patch: ServerSettingsPatch, label: string): Promise<boolean> => {
      const result = await updateServerSettings({
        environmentId: props.environmentId,
        input: { patch },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          Alert.alert(
            `Could not update ${label}`,
            failureMessage(result, translator.message("mobile.ui.settingUpdateFailed")),
          );
        }
        return false;
      }
      return true;
    },
    [props.environmentId, updateServerSettings, translator],
  );

  if (config === null) {
    return (
      <SettingsSection title={props.environmentLabel}>
        <Text className="p-4 text-sm text-foreground-muted">
          {translator.message("mobile.settings.agents.connectEnvironment")}
        </Text>
      </SettingsSection>
    );
  }
  if (!supportsEnvironmentAgentSettings(config.environment.capabilities)) {
    return (
      <SettingsSection title={props.environmentLabel}>
        <Text className="p-4 text-sm leading-normal text-foreground-muted">
          {translator.message("mobile.settings.agents.adminUnsupported")}
        </Text>
      </SettingsSection>
    );
  }

  const settings = config.settings;
  const keyConfigured = settings.speechTranscription.assemblyAi.apiKey.valueRedacted === true;

  return (
    <View className="gap-6">
      <View className="gap-1 px-2">
        <Text className="text-xl font-t3-semibold text-foreground">{props.environmentLabel}</Text>
        <Text className="text-sm text-foreground-muted">
          t3 {config.environment.serverVersion} · {config.cwd}
        </Text>
      </View>

      <MobileProviderSettings
        environmentId={props.environmentId}
        config={config}
        readOnly={!readEnvironmentScope(props.environmentId, AuthProvidersManageScope)}
      />

      <MobileProviderAdvancedSettings
        config={config}
        disabled={!readEnvironmentScope(props.environmentId, AuthSettingsWriteScope)}
        updateSettings={updateSettings}
      />

      <SettingsSection title={translator.message("mobile.settings.agents.serverBehavior")}>
        <SettingsSwitchRow
          icon="arrow.triangle.2.circlepath"
          label={translator.message("mobile.settings.agents.providerUpdates")}
          value={settings.enableProviderUpdateChecks}
          onValueChange={(value) =>
            void updateSettings({ enableProviderUpdateChecks: value }, "provider update checks")
          }
        />
        <SettingsSwitchRow
          icon="text.bubble"
          label={translator.message("mobile.settings.agents.legacyStreaming")}
          value={mobileResponseStreamingMode(settings, config.environment.capabilities) === "token"}
          onValueChange={(value) => {
            const patch = mobileResponseStreamingSettingsPatch(
              value ? "token" : "turn",
              config.environment.capabilities,
            );
            if (patch !== null) void updateSettings(patch, "token streaming");
          }}
        />
        <SettingsSwitchRow
          icon="arrow.triangle.branch"
          label={translator.message("mobile.settings.agents.worktreesOrigin")}
          value={settings.newWorktreesStartFromOrigin}
          onValueChange={(value) =>
            void updateSettings({ newWorktreesStartFromOrigin: value }, "worktree defaults")
          }
        />
      </SettingsSection>

      <SettingsSection title={translator.message("mobile.settings.agents.models")}>
        <MobileAgentModelSettings
          config={config}
          projects={props.projects}
          disabled={!readEnvironmentScope(props.environmentId, AuthSettingsWriteScope)}
          updateSettings={updateSettings}
        />
      </SettingsSection>

      <SettingsSection title={translator.message("mobile.settings.agents.voiceTranscription")}>
        <View className="gap-3 p-4">
          <View className="gap-1">
            <Text className="text-lg text-foreground">
              {translator.message("mobile.settings.agents.assemblyKey")}
            </Text>
            <Text className="text-sm leading-normal text-foreground-muted">
              {keyConfigured
                ? translator.message("mobile.settings.agents.keyStored")
                : translator.message("mobile.settings.agents.keyExchange")}
            </Text>
          </View>
          <TextInput
            accessibilityLabel={translator.message("mobile.settings.agents.assemblyKey")}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setAssemblyAiKey}
            placeholder={
              keyConfigured ? translator.message("mobile.settings.agents.savedApiKey") : "aai_..."
            }

            secureTextEntry
            value={assemblyAiKey}
            className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
          />
          <View className="flex-row gap-3">
            <Pressable
              accessibilityRole="button"
              disabled={assemblyAiKey.trim().length === 0}
              onPress={() => {
                const value = assemblyAiKey.trim();
                if (!value) return;
                void updateSettings(
                  {
                    speechTranscription: {
                      assemblyAi: { apiKey: { value, valueRedacted: false } },
                    },
                  },
                  "AssemblyAI key",
                ).then((saved) => {
                  if (saved) setAssemblyAiKey("");
                });
              }}
              className="rounded-xl bg-foreground px-4 py-2 disabled:opacity-40"
            >
              <Text className="font-t3-medium text-screen">
                {translator.message("mobile.settings.agents.saveKey")}
              </Text>
            </Pressable>
            {keyConfigured ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void updateSettings(
                    {
                      speechTranscription: {
                        assemblyAi: { apiKey: { value: "", valueRedacted: false } },
                      },
                    },
                    "AssemblyAI key",
                  )
                }
                className="rounded-xl bg-subtle px-4 py-2"
              >
                <Text className="font-t3-medium text-foreground">
                  {translator.message("mobile.settings.agents.remove")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SettingsSection>

      <MobileAssemblyAiVoiceSettings
        environmentId={props.environmentId}
        config={config}
        projects={props.projects}
        disabled={providerAuthMutationAccess(authSession) === "read-only"}
        updateSettings={updateSettings}
      />
      <EnvironmentSpeechProfileSettings
        environmentId={props.environmentId}
        projects={props.projects}
      />
      <EnvironmentChatImportSettings environmentId={props.environmentId} />

      <SkillSettings environmentId={props.environmentId} />
      <McpSettings environmentId={props.environmentId} />
    </View>
  );
}

function DeviceWorkflowSettings() {
  const translator = useMobileInterfaceTranslator();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const ready = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {};
  return (
    <SettingsSection title={translator.message("mobile.settings.agents.thisDevice")}>
      <SettingsSwitchRow
        disabled={!ready}
        icon="sparkles"
        label={translator.message("mobile.settings.agents.fetchMode")}
        value={preferences.experimentalFetch === true}
        onValueChange={(value) => savePreferences({ experimentalFetch: value })}
      />
      <SettingsSwitchRow
        disabled={!ready}
        icon="wand.and.stars"
        label={translator.message("mobile.settings.agents.improvePrompts")}
        value={preferences.improvePromptBeforeSend === true}
        onValueChange={(value) => savePreferences({ improvePromptBeforeSend: value })}
      />
      <SettingsSwitchRow
        disabled={!ready}
        icon="arrow.triangle.branch"
        label={translator.message("mobile.settings.agents.parallelImplementation")}
        value={preferences.experimentalParallelPlanImplementation === true}
        onValueChange={(value) =>
          savePreferences({ experimentalParallelPlanImplementation: value })
        }
      />
      <SettingsSwitchRow
        disabled={!ready}
        icon="mic"
        label={translator.message("mobile.settings.agents.translateVoice")}
        value={preferences.voiceInputOutputLanguage === "english"}
        onValueChange={(value) =>
          savePreferences({ voiceInputOutputLanguage: value ? "english" : "native" })
        }
      />
    </SettingsSection>
  );
}

export function SettingsAgentEnvironmentsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useWorkspaceState();
  const projects = useProjects();

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader
            title={translator.message("mobile.settings.agentsServers")}
            onBack={() => navigation.goBack()}
          />
        </>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-8 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <DeviceWorkflowSettings />
        {environments.length === 0 ? (
          <SettingsSection title={translator.message("mobile.settings.environments")}>
            <Text className="p-4 text-sm text-foreground-muted">
              {translator.message("mobile.settings.agents.addEnvironmentDescription")}
            </Text>
          </SettingsSection>
        ) : (
          environments.map((environment) => (
            <EnvironmentAgentSettings
              key={environment.environmentId}
              environmentId={environment.environmentId}
              environmentLabel={environment.environmentLabel}
              projects={projects.filter(
                (project) => project.environmentId === environment.environmentId,
              )}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
