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
import { buildModelOptions, type ModelOption } from "../../lib/modelOptions";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { agentSettingsEnvironment } from "../../state/agent-settings";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceState } from "../../state/workspace";
import {
  providerEnabledSettingsPatch,
  providerStatusLabel,
  skillMutationTarget,
  supportsEnvironmentAgentSettings,
} from "./environment-agent-settings";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
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
  readonly onClose: () => void;
  readonly onSelect: (selection: ModelSelection | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const checkmarkColor = useThemeColor("--color-icon");
  const options = useMemo(
    () => buildModelOptions(props.config, props.current),
    [props.config, props.current],
  );
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
        accessibilityState={{ checked: selected }}
        className={
          index === 0
            ? "flex-row items-center gap-3 px-4 py-3"
            : "flex-row items-center gap-3 border-t border-border-subtle px-4 py-3"
        }
        onPress={() => {
          props.onSelect(option?.selection ?? null);
          props.onClose();
        }}
      >
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base text-foreground">
            {option?.label ?? props.defaultLabel ?? "Default text model"}
          </Text>
          {option ? (
            <Text className="text-sm text-foreground-muted">{option.providerLabel}</Text>
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
          <Text className="flex-1 text-xl font-t3-semibold text-foreground">Choose model</Text>
          <Pressable accessibilityRole="button" onPress={props.onClose} className="px-2 py-1">
            <Text className="text-base font-t3-medium text-foreground">Done</Text>
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
  const activeTrack = String(useThemeColor("--color-switch-active"));
  const track = String(useThemeColor("--color-secondary-border"));
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
  readonly updateSettings: (patch: ServerSettingsPatch, label: string) => Promise<boolean>;
}) {
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
    <SettingsSection title="Providers">
      {props.config.providers.map((provider, index) => {
        const enabledPatch = providerEnabledSettingsPatch({
          provider,
          settings: props.config.settings,
          enabled: !provider.enabled,
        });
        const title = provider.displayName ?? String(provider.instanceId);
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
                disabled={enabledPatch === null}
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
          {refreshing ? "Refreshing…" : "Refresh provider status"}
        </Text>
      </Pressable>
    </SettingsSection>
  );
}

function SkillSettings(props: { readonly environmentId: EnvironmentId }) {
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
    <SettingsSection title="Skills">
      {skills === null ? (
        <Pressable onPress={() => void reload()} className="p-4">
          <Text className="text-sm text-foreground-muted">{error ?? "Loading skills…"}</Text>
        </Pressable>
      ) : skills.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">No skills discovered.</Text>
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
    <SettingsSection title="MCP servers">
      {servers === null ? (
        <Pressable onPress={() => void reload()} className="p-4">
          <Text className="text-sm text-foreground-muted">{error ?? "Loading MCP servers…"}</Text>
        </Pressable>
      ) : servers.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">No MCP servers configured.</Text>
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
  const config = useEnvironmentServerConfig(props.environmentId);
  const updateServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const [assemblyAiKey, setAssemblyAiKey] = useState("");
  const placeholderTextColor = String(useThemeColor("--color-foreground-muted"));

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
          Connect to this environment to manage its agent settings.
        </Text>
      </SettingsSection>
    );
  }
  if (!supportsEnvironmentAgentSettings(config.environment.capabilities)) {
    return (
      <SettingsSection title={props.environmentLabel}>
        <Text className="p-4 text-sm leading-normal text-foreground-muted">
          This server version does not advertise remote agent administration. Update the server to
          manage providers, skills, MCP, and voice from mobile.
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
        updateSettings={updateSettings}
      />

      <SettingsSection title="Server behavior">
        <SettingsSwitchRow
          icon="arrow.triangle.2.circlepath"
          label="Provider update checks"
          value={settings.enableProviderUpdateChecks}
          onValueChange={(value) =>
            void updateSettings({ enableProviderUpdateChecks: value }, "provider update checks")
          }
        />
        <SettingsSwitchRow
          icon="text.bubble"
          label="Legacy token streaming"
          value={settings.enableLegacyTokenStreaming}
          onValueChange={(value) =>
            void updateSettings({ enableLegacyTokenStreaming: value }, "token streaming")
          }
        />
        <SettingsSwitchRow
          icon="arrow.triangle.branch"
          label="New worktrees start from origin"
          value={settings.newWorktreesStartFromOrigin}
          onValueChange={(value) =>
            void updateSettings({ newWorktreesStartFromOrigin: value }, "worktree defaults")
          }
        />
      </SettingsSection>

      <SettingsSection title="Agent models">
        <ModelSelectionSetting
          allowDefault={false}
          config={config}
          icon="text.bubble"
          label="Text generation"
          selection={settings.textGenerationModelSelection}
          onSelect={(selection) => {
            if (selection)
              void updateSettings({ textGenerationModelSelection: selection }, "text model");
          }}
        />
        <ModelSelectionSetting
          config={config}
          defaultLabel="Automatic"
          icon="sparkles"
          label="Fetch workers"
          selection={settings.fetchModelSelection}
          onSelect={(selection) =>
            void updateSettings({ fetchModelSelection: selection }, "Fetch model")
          }
        />
        <ModelSelectionSetting
          allowDefault={false}
          config={config}
          icon="arrow.triangle.branch"
          label="Parallel plan review"
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
          defaultLabel="Text generation model"
          icon="mic"
          label="Voice translation"
          selection={settings.voiceTranslationModelSelection}
          onSelect={(selection) =>
            void updateSettings({ voiceTranslationModelSelection: selection }, "voice model")
          }
        />
      </SettingsSection>

      <SettingsSection title="Voice transcription">
        <View className="gap-3 p-4">
          <View className="gap-1">
            <Text className="text-lg text-foreground">AssemblyAI API key</Text>
            <Text className="text-sm leading-normal text-foreground-muted">
              {keyConfigured
                ? "A key is stored securely on this server. Enter a replacement below."
                : "Stored by this server and exchanged only for short-lived streaming tokens."}
            </Text>
          </View>
          <TextInput
            accessibilityLabel="AssemblyAI API key"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setAssemblyAiKey}
            placeholder={keyConfigured ? "Saved API key" : "aai_..."}
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
              <Text className="font-t3-medium text-background">Save key</Text>
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
                <Text className="font-t3-medium text-foreground">Remove</Text>
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
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const ready = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {};
  return (
    <SettingsSection title="This device">
      <SettingsSwitchRow
        disabled={!ready}
        icon="sparkles"
        label="Fetch mode"
        value={preferences.experimentalFetch === true}
        onValueChange={(value) => savePreferences({ experimentalFetch: value })}
      />
      <SettingsSwitchRow
        disabled={!ready}
        icon="wand.and.stars"
        label="Improve prompts before send"
        value={preferences.improvePromptBeforeSend === true}
        onValueChange={(value) => savePreferences({ improvePromptBeforeSend: value })}
      />
      <SettingsSwitchRow
        disabled={!ready}
        icon="arrow.triangle.branch"
        label="Parallel plan implementation"
        value={preferences.experimentalParallelPlanImplementation === true}
        onValueChange={(value) =>
          savePreferences({ experimentalParallelPlanImplementation: value })
        }
      />
      <SettingsSwitchRow
        disabled={!ready}
        icon="mic"
        label="Translate voice input to English"
        value={preferences.voiceInputOutputLanguage === "english"}
        onValueChange={(value) =>
          savePreferences({ voiceInputOutputLanguage: value ? "english" : "native" })
        }
      />
    </SettingsSection>
  );
}

export function SettingsAgentEnvironmentsRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useWorkspaceState();
  const projects = useProjects();

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Agents & Servers" onBack={() => navigation.goBack()} />
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
          <SettingsSection title="Environments">
            <Text className="p-4 text-sm text-foreground-muted">
              Add an environment before configuring agents and servers.
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
