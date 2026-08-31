import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { type EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentId,
  type McpServerDefinition,
  type ModelSelection,
  type ServerConfig,
  type ServerProvider,
  type ServerSettingsPatch,
  type SkillDescriptor,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { cn } from "../../lib/cn";
import { buildModelOptions, type ModelOption } from "../../lib/modelOptions";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { agentSettingsEnvironment } from "../../state/agent-settings";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceState } from "../../state/workspace";
import {
  mobileProviderAuthEventPresentation,
  providerAuthenticationPresentation,
  providerAuthMutationAccess,
  providerConfigSettingsPatch,
  providerEnabledSettingsPatch,
  providerRateLimitLabel,
  providerStatusLabel,
  skillMutationTarget,
  supportsEnvironmentAgentSettings,
} from "./environment-agent-settings";
import { MobileProviderSettingsForm } from "./MobileProviderSettingsForm";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import {
  EnvironmentChatImportSettings,
  EnvironmentSpeechProfileSettings,
} from "./SettingsEnvironmentDataSections";

function failureMessage(result: { readonly _tag: string }, fallback: string): string {
  if (result._tag !== "Failure") return fallback;
  const error = squashAtomCommandFailure(result as never);
  return error instanceof Error ? error.message : fallback;
}

export function modelSelectionLabel(
  config: ServerConfig,
  selection: ModelSelection | null,
): string {
  if (selection === null) return "Default text model";
  const provider = config.providers.find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  const model = provider?.models.find((candidate) => candidate.slug === selection.model);
  return model?.name ?? selection.model;
}

export function ModelSelectionModal(props: {
  readonly config: ServerConfig;
  readonly current: ModelSelection | null;
  readonly defaultLabel?: string;
  readonly allowDefault?: boolean;
  readonly visible: boolean;
  readonly optionPredicate?: (option: ModelOption) => boolean;
  readonly onClose: () => void;
  readonly onSelect: (selection: ModelSelection | null) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const checkmarkColor = useUniwindTheme()["--color-icon"];
  const options = useMemo(() => {
    const available = buildModelOptions(props.config, props.current);
    return props.optionPredicate ? available.filter(props.optionPredicate) : available;
  }, [props.config, props.current, props.optionPredicate]);
  const selectedKey = props.current
    ? `${props.current.instanceId}:${props.current.model}`
    : "default";

  const renderOption = (option: ModelOption | null, index: number) => {
    const key = option?.key ?? "default";
    const selected = key === selectedKey;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        accessibilityHint={option?.unavailableReason ?? undefined}
        accessibilityState={{ checked: selected, disabled: option?.isSelectable === false }}
        className={cn(
          index === 0
            ? "flex-row items-center gap-3 px-4 py-3"
            : "flex-row items-center gap-3 border-t border-border-subtle px-4 py-3",
          option?.isSelectable === false && "opacity-50",
        )}
        onPress={() => {
          if (option?.isSelectable === false) return;
          props.onSelect(option?.selection ?? null);
          props.onClose();
        }}
      >
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base text-foreground">
            {option?.label ??
              props.defaultLabel ??
              translator.message("mobile.settings.agents.defaultTextModel")}
          </Text>
          {option ? (
            <Text className="text-sm text-foreground-muted">
              {option.unavailableReason ?? option.providerLabel}
            </Text>
          ) : null}
        </View>
        {selected ? (
          <SymbolView
            name="checkmark"
            size={17}
            tintColor={checkmarkColor}
            type="monochrome"
            weight="semibold"
          />
        ) : null}
      </Pressable>
    );
  };

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={props.visible}>
      <View className="flex-1 bg-sheet">
        <View className="flex-row items-center border-b border-border px-5 py-4">
          <Text className="flex-1 text-xl font-t3-semibold text-foreground">
            {translator.message("mobile.settings.agents.chooseModel")}
          </Text>
          <Pressable accessibilityRole="button" onPress={props.onClose} className="px-2 py-1">
            <Text className="text-base font-t3-medium text-foreground">
              {translator.message("common.done")}
            </Text>
          </Pressable>
        </View>
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          <View className="overflow-hidden rounded-[24px] bg-card">
            {(props.allowDefault === false ? options : [null, ...options]).map(renderOption)}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function ModelSelectionSetting(props: {
  readonly config: ServerConfig;
  readonly icon: "sparkles" | "arrow.triangle.branch" | "mic" | "text.bubble";
  readonly label: string;
  readonly selection: ModelSelection | null;
  readonly allowDefault?: boolean;
  readonly defaultLabel?: string;
  readonly onSelect: (selection: ModelSelection | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsRow
        icon={props.icon}
        label={props.label}
        value={
          props.selection === null
            ? (props.defaultLabel ?? "Default text model")
            : modelSelectionLabel(props.config, props.selection)
        }
        onPress={() => setOpen(true)}
      />
      <ModelSelectionModal
        config={props.config}
        current={props.selection}
        allowDefault={props.allowDefault}
        defaultLabel={props.defaultLabel}
        visible={open}
        onClose={() => setOpen(false)}
        onSelect={props.onSelect}
      />
    </>
  );
}

function InlineSettingsSwitch(props: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}) {
  const theme = useUniwindTheme();
  const activeTrack = theme["--color-switch-active"];
  const track = theme["--color-secondary-border"];
  return (
    <Switch
      accessibilityLabel={props.label}
      disabled={props.disabled}
      ios_backgroundColor={track}
      onValueChange={props.onValueChange}
      trackColor={{ false: track, true: activeTrack }}
      value={props.value}
    />
  );
}

function ProviderSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly config: ServerConfig;
  readonly readOnly: boolean;
  readonly updateSettings: (patch: ServerSettingsPatch, label: string) => Promise<boolean>;
}) {
  const translator = useMobileInterfaceTranslator();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, { reportFailure: false });
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<ReadonlySet<string>>(() => new Set());

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const result = await refreshProviders({ environmentId: props.environmentId, input: {} });
    setRefreshing(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      Alert.alert(
        "Could not refresh providers",
        failureMessage(result, "Provider refresh failed."),
      );
    }
  }, [props.environmentId, refreshProviders, refreshing]);

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
        Alert.alert("Could not update provider", failureMessage(result, "Provider update failed."));
      }
    },
    [props.environmentId, updateProvider, updating],
  );

  return (
    <SettingsSection title={translator.message("mobile.settings.agents.providers")}>
      {props.config.providers.map((provider, index) => {
        const enabledPatch = providerEnabledSettingsPatch({
          provider,
          settings: props.config.settings,
          enabled: !provider.enabled,
        });
        const title = provider.displayName ?? String(provider.instanceId);
        const configuredInstance = props.config.settings.providerInstances[provider.instanceId];
        const authPresentation = providerAuthenticationPresentation(provider);
        const updateAvailable = provider.versionAdvisory?.canUpdate === true;
        return (
          <View
            key={provider.instanceId}
            className={index === 0 ? "gap-1 p-4" : "gap-1 border-t border-border-subtle p-4"}
          >
            <View className="flex-row items-center gap-3">
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-lg text-foreground">{title}</Text>
                <Text className="text-sm text-foreground-muted">
                  {providerStatusLabel(provider)}
                </Text>
              </View>
              <InlineSettingsSwitch
                disabled={props.readOnly || enabledPatch === null}
                label={`${title} enabled`}
                value={provider.enabled}
                onValueChange={(enabled) => {
                  const patch = providerEnabledSettingsPatch({
                    provider,
                    settings: props.config.settings,
                    enabled,
                  });
                  if (patch) void props.updateSettings(patch, `${title} setting`);
                }}
              />
            </View>
            {provider.message ? (
              <Text className="text-sm leading-normal text-foreground-muted">
                {provider.message}
              </Text>
            ) : null}
            {authPresentation ? (
              <MobileProviderAuthentication
                environmentId={props.environmentId}
                provider={provider}
                readOnly={props.readOnly}
              />
            ) : null}
            {configuredInstance ? (
              <MobileProviderSettingsForm
                disabled={props.readOnly}
                provider={provider}
                value={configuredInstance.config}
                onChange={(config) => {
                  const patch = providerConfigSettingsPatch({
                    instanceId: provider.instanceId,
                    settings: props.config.settings,
                    config,
                  });
                  if (patch) void props.updateSettings(patch, `${title} settings`);
                }}
              />
            ) : null}
            {updateAvailable ? (
              <Pressable
                accessibilityRole="button"
                disabled={updating.has(provider.instanceId)}
                onPress={() => void runUpdate(provider)}
                className="self-start py-1"
              >
                <Text className="font-t3-medium text-foreground">
                  {updating.has(provider.instanceId)
                    ? "Updating…"
                    : `Update to ${provider.versionAdvisory?.latestVersion ?? "latest"}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
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
  const placeholderTextColor = useUniwindTheme()["--color-foreground-muted"];

  const refresh = useCallback(async () => {
    await refreshProviders({ environmentId: props.environmentId, input: {} });
  }, [props.environmentId, refreshProviders]);

  const connect = useCallback(async () => {
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
  }, [
    connectProviderAuth,
    presentation.method,
    presentation.providerLabel,
    props.environmentId,
    props.provider.instanceId,
    refresh,
  ]);

  const saveCredential = useCallback(async () => {
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
  }, [
    credentialDraft,
    presentation.credentialLabel,
    presentation.providerLabel,
    props.environmentId,
    props.provider.instanceId,
    refresh,
    setProviderAuthCredential,
  ]);

  const disconnect = useCallback(async () => {
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
  }, [
    disconnectProviderAuth,
    presentation.providerLabel,
    props.environmentId,
    props.provider.instanceId,
    refresh,
  ]);

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
            placeholderTextColor={placeholderTextColor}
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
            <Text className="font-t3-medium text-background">
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
              translator.message("mobile.settings.agents.disconnectTitle", {
                provider: presentation.providerLabel,
              }),
              translator.message("mobile.settings.agents.disconnectDescription"),
              [
                { text: translator.message("common.cancel"), style: "cancel" },
                {
                  text: translator.message("mobile.settings.agents.disconnect"),
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
              : translator.message("mobile.settings.agents.disconnect")}
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
          <Text className="font-t3-medium text-background">
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
              <Text className="font-t3-medium text-background">
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
                <Text className="font-t3-medium text-background">
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
              <Text className="font-t3-medium text-background">
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

function SkillSettings(props: { readonly environmentId: EnvironmentId }) {
  const translator = useMobileInterfaceTranslator();
  const listSkills = useAtomCommand(agentSettingsEnvironment.skills.list, { reportFailure: false });
  const setSkillEnabled = useAtomCommand(agentSettingsEnvironment.skills.setEnabled, {
    reportFailure: false,
  });
  const [skills, setSkills] = useState<ReadonlyArray<SkillDescriptor> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    const result = await listSkills({ environmentId: props.environmentId, input: {} });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        setError(failureMessage(result, "Could not load skills."));
      return;
    }
    setSkills(result.value.skills);
  }, [listSkills, props.environmentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <SettingsSection title={translator.message("mobile.settings.agents.skills")}>
      {skills === null ? (
        <Pressable onPress={() => void reload()} className="p-4">
          <Text className="text-sm text-foreground-muted">
            {error ?? translator.message("mobile.settings.agents.loadingSkills")}
          </Text>
        </Pressable>
      ) : skills.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">
          {translator.message("mobile.settings.agents.noSkills")}
        </Text>
      ) : (
        skills.map((skill, index) => (
          <View
            key={skill.id}
            className={
              index === 0
                ? "flex-row items-center gap-3 p-4"
                : "flex-row items-center gap-3 border-t border-border-subtle p-4"
            }
          >
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-base text-foreground">{skill.displayName || skill.name}</Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                {skill.shortDescription || skill.description || skill.scope}
              </Text>
            </View>
            <InlineSettingsSwitch
              disabled={skill.readOnly}
              label={`${skill.displayName || skill.name} enabled`}
              value={skill.enabled}
              onValueChange={(enabled) => {
                void (async () => {
                  const result = await setSkillEnabled({
                    environmentId: props.environmentId,
                    input: { target: skillMutationTarget(skill), enabled },
                  });
                  if (result._tag === "Failure") {
                    if (!isAtomCommandInterrupted(result)) {
                      Alert.alert(
                        "Could not update skill",
                        failureMessage(result, "Skill update failed."),
                      );
                    }
                    return;
                  }
                  setSkills(
                    (current) =>
                      current?.map((candidate) =>
                        candidate.id === skill.id ? { ...candidate, enabled } : candidate,
                      ) ?? null,
                  );
                })();
              }}
            />
          </View>
        ))
      )}
    </SettingsSection>
  );
}

function McpSettings(props: { readonly environmentId: EnvironmentId }) {
  const translator = useMobileInterfaceTranslator();
  const listMcp = useAtomCommand(agentSettingsEnvironment.mcp.list, { reportFailure: false });
  const setMcpEnabled = useAtomCommand(agentSettingsEnvironment.mcp.setEnabled, {
    reportFailure: false,
  });
  const [servers, setServers] = useState<ReadonlyArray<McpServerDefinition> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    const result = await listMcp({ environmentId: props.environmentId, input: {} });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        setError(failureMessage(result, "Could not load MCP servers."));
      return;
    }
    setServers(result.value.servers);
  }, [listMcp, props.environmentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <SettingsSection title={translator.message("mobile.settings.agents.mcpServers")}>
      {servers === null ? (
        <Pressable onPress={() => void reload()} className="p-4">
          <Text className="text-sm text-foreground-muted">
            {error ?? translator.message("mobile.settings.agents.loadingMcp")}
          </Text>
        </Pressable>
      ) : servers.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">
          {translator.message("mobile.settings.agents.noMcp")}
        </Text>
      ) : (
        servers.map((server, index) => (
          <View
            key={server.id}
            className={
              index === 0
                ? "flex-row items-center gap-3 p-4"
                : "flex-row items-center gap-3 border-t border-border-subtle p-4"
            }
          >
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-base text-foreground">{server.name}</Text>
              <Text className="text-sm text-foreground-muted">{server.transport}</Text>
            </View>
            <InlineSettingsSwitch
              label={`${server.name} enabled`}
              value={server.enabled}
              onValueChange={(enabled) => {
                void (async () => {
                  const result = await setMcpEnabled({
                    environmentId: props.environmentId,
                    input: { id: server.id, enabled },
                  });
                  if (result._tag === "Failure") {
                    if (!isAtomCommandInterrupted(result)) {
                      Alert.alert(
                        "Could not update MCP server",
                        failureMessage(result, "MCP update failed."),
                      );
                    }
                    return;
                  }
                  setServers(
                    (current) =>
                      current?.map((candidate) =>
                        candidate.id === server.id ? { ...candidate, enabled } : candidate,
                      ) ?? null,
                  );
                })();
              }}
            />
          </View>
        ))
      )}
    </SettingsSection>
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
  const placeholderTextColor = useUniwindTheme()["--color-foreground-muted"];

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
            failureMessage(result, "Setting update failed."),
          );
        }
        return false;
      }
      return true;
    },
    [props.environmentId, updateServerSettings],
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

      <ProviderSettings
        environmentId={props.environmentId}
        config={config}
        readOnly={providerAuthMutationAccess(authSession) === "read-only"}
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
          value={settings.enableLegacyTokenStreaming}
          onValueChange={(value) =>
            void updateSettings({ enableLegacyTokenStreaming: value }, "token streaming")
          }
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
        <ModelSelectionSetting
          allowDefault={false}
          config={config}
          icon="text.bubble"
          label={translator.message("mobile.settings.agents.textGeneration")}
          selection={settings.textGenerationModelSelection}
          onSelect={(selection) => {
            if (selection)
              void updateSettings({ textGenerationModelSelection: selection }, "text model");
          }}
        />
        <ModelSelectionSetting
          config={config}
          defaultLabel={translator.message("mobile.settings.agents.automatic")}
          icon="sparkles"
          label={translator.message("mobile.settings.agents.fetchWorkers")}
          selection={settings.fetchModelSelection}
          onSelect={(selection) =>
            void updateSettings({ fetchModelSelection: selection }, "Fetch model")
          }
        />
        <ModelSelectionSetting
          allowDefault={false}
          config={config}
          icon="arrow.triangle.branch"
          label={translator.message("mobile.settings.agents.parallelReview")}
          selection={settings.parallelPlanReviewModelSelection}
          onSelect={(selection) => {
            if (selection)
              void updateSettings(
                { parallelPlanReviewModelSelection: selection },
                "plan review model",
              );
          }}
        />
        <ModelSelectionSetting
          config={config}
          defaultLabel={translator.message("mobile.settings.agents.textGenerationModel")}
          icon="mic"
          label={translator.message("mobile.settings.agents.voiceTranslation")}
          selection={settings.voiceTranslationModelSelection}
          onSelect={(selection) =>
            void updateSettings({ voiceTranslationModelSelection: selection }, "voice model")
          }
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
            placeholderTextColor={placeholderTextColor}
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
              <Text className="font-t3-medium text-background">
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
