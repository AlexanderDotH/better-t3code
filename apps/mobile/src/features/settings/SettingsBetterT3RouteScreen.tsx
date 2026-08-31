import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  resolveBetterT3FeatureFlag,
  type CavemanMode,
  type BetterT3FeatureId,
  type BetterT3FeatureSection,
  type BetterT3SwitchFeatureId,
  type EnvironmentId,
  type ExecutionEnvironmentCapabilities,
  type ModelSelection,
  type ProjectId,
  type ServerSettingsPatch,
  type SidebarThreadSortOrder,
  type ThreadId,
} from "@t3tools/contracts";
import {
  INTERFACE_MESSAGE_KEYS,
  type InterfaceMessageKey,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";
import { stripAutoReasoning } from "@t3tools/shared/model";
import {
  prepareBetterT3StatusModel,
  prepareKnowledgeGraphStatus,
  resolveBetterT3CapabilitySupport,
} from "@t3tools/client-runtime/better-t3-status";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { useEnvironments } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { knowledgeGraphEnvironment } from "../../state/knowledge-graph";
import { useEnvironmentQuery } from "../../state/query";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { ModelSelectionModal, modelSelectionLabel } from "./SettingsAgentEnvironmentsRouteScreen";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { resolveMobileSidebarSettlingPreferences } from "../../persistence/mobile-preferences";
import {
  buildMobileGitWorkbenchThreadOptions,
  mobileGitWorkbenchCanActivate,
  mobileGitWorkbenchStatusMessageKey,
  resolveMobileGitWorkbenchAvailability,
} from "../threads/git/mobile-git-workbench";
import {
  buildMobileBetterT3Sections,
  createMobileBetterT3DeviceControlPatch,
  createMobileBetterT3DevicePreferencePatch,
  createMobileBetterT3EnvironmentControlPatch,
  createMobileBetterT3EnvironmentPatch,
  mobileBetterT3PreparedStatusDetail,
  mobileBetterT3PreparedStatusInput,
  mobileBetterT3PreparedStatusMessageKey,
  mobileLifecycleReceiptFromWelcome,
  mobileBetterT3SurfaceForWidth,
  resolveMobileBetterT3Destination,
  resolveMobileBetterT3EnvironmentTarget,
  resolveMobileBetterT3ProjectSelection,
  supportsMobileKnowledgeGraphModelOption,
  shouldSubscribeMobileKnowledgeGraphProgress,
  type MobilePreparedStatusInput,
  type MobileBetterT3Control,
} from "./better-t3-settings";

const MESSAGE_KEYS = new Set<string>(INTERFACE_MESSAGE_KEYS);

function messageKey(value: string, fallback: InterfaceMessageKey): InterfaceMessageKey {
  return MESSAGE_KEYS.has(value) ? (value as InterfaceMessageKey) : fallback;
}

const SECTION_ICONS: Readonly<Record<BetterT3FeatureSection, AppSymbolName>> = {
  "agent-workflows": "sparkles",
  "chat-layout": "rectangle.split.3x1",
  "workspace-source-control": "arrow.triangle.branch",
  "voice-synchronization": "waveform",
  "knowledge-automation": "point.3.connected.trianglepath.dotted",
  "resource-protection": "memorychip",
  "integration-status": "checkmark.circle",
};

const FALLBACK_CAPABILITIES: ExecutionEnvironmentCapabilities = {
  repositoryIdentity: false,
  midChatProviderSwitching: false,
};

type BetterT3SettingsNavigation = NativeStackNavigationProp<{
  GitOverview: { readonly environmentId: string; readonly threadId: string };
  SettingsAgents: undefined;
  SettingsAppearance: undefined;
  SettingsBetterT3ResourceDiagnostics: { readonly environmentId: EnvironmentId };
  SettingsBetterT3TranscriptPortability: { readonly environmentId: EnvironmentId };
  SettingsEnvironments: undefined;
  SettingsProjects: undefined;
}>;

type BetterT3ChoiceValue = string | number | null;

interface BetterT3Choice<T extends BetterT3ChoiceValue> {
  readonly value: T;
  readonly label: string;
}

function BetterT3ChoiceModal<T extends BetterT3ChoiceValue>(props: {
  readonly title: string;
  readonly visible: boolean;
  readonly current: T;
  readonly choices: ReadonlyArray<BetterT3Choice<T>>;
  readonly onClose: () => void;
  readonly onSelect: (value: T) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={props.visible}>
      <View className="flex-1 bg-sheet">
        <View className="flex-row items-center border-b border-border px-5 py-4">
          <Text className="flex-1 text-xl font-t3-semibold text-foreground">{props.title}</Text>
          <Pressable accessibilityRole="button" className="px-2 py-1" onPress={props.onClose}>
            <Text className="text-base font-t3-medium text-foreground">
              {translator.message("common.done")}
            </Text>
          </Pressable>
        </View>
        <ScrollView className="flex-1" contentContainerClassName="px-5 py-4">
          <View className="overflow-hidden rounded-[24px] bg-card">
            {props.choices.map((choice, index) => {
              const selected = Object.is(choice.value, props.current);
              return (
                <Pressable
                  key={String(choice.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  className={
                    index === 0
                      ? "flex-row items-center gap-3 px-4 py-3"
                      : "flex-row items-center gap-3 border-t border-border-subtle px-4 py-3"
                  }
                  onPress={() => {
                    props.onSelect(choice.value);
                    props.onClose();
                  }}
                >
                  <Text className="flex-1 text-base text-foreground">{choice.label}</Text>
                  {selected ? (
                    <SymbolView
                      name="checkmark"
                      size={17}
                      tintColorClassName="accent-icon"
                      type="monochrome"
                      weight="semibold"
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function BetterT3ActionRow(props: {
  readonly control: MobileBetterT3Control;
  readonly label: string;
  readonly description: string;
  readonly status: string;
  readonly onPress: () => void;
}) {
  const interactive = props.control.controlKind !== "status-only";
  const unavailable = props.control.availability.state !== "available";
  return (
    <Pressable
      accessibilityHint={props.description}
      accessibilityLabel={`${props.label}, ${props.status}`}
      accessibilityRole={interactive ? "button" : "text"}
      accessibilityState={interactive ? { disabled: unavailable } : undefined}
      className={`flex-row items-center gap-3 border-t border-border-subtle p-4 first:border-t-0 ${unavailable ? "opacity-45" : ""}`}
      disabled={!interactive || unavailable}
      onPress={props.onPress}
    >
      <SymbolView
        name={SECTION_ICONS[props.control.descriptor.section]}
        size={21}
        tintColorClassName="accent-icon"
        type="monochrome"
      />
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-lg text-foreground">{props.label}</Text>
        <Text className="text-sm leading-normal text-foreground-muted">{props.description}</Text>
      </View>
      <Text className="max-w-[112px] text-right text-xs text-foreground-muted">{props.status}</Text>
      {props.control.controlKind !== "status-only" ? (
        <SymbolView
          name="chevron.right"
          size={15}
          tintColorClassName="accent-icon"
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}

function preparedStatusText(
  input: MobilePreparedStatusInput,
  message: InterfaceTranslator["message"],
): string {
  const primary = message(mobileBetterT3PreparedStatusMessageKey(input));
  const detail = mobileBetterT3PreparedStatusDetail(input);
  if (detail === null) return primary;

  switch (detail.kind) {
    case "mcp-runtime":
      return `${primary} · ${message("settings.betterT3.status.mcpRuntime", {
        connected: detail.connectedCount,
        runtime: detail.runtimeCount,
        attention: detail.attentionCount,
        authRequired: detail.authRequiredCount,
      })}`;
    case "mcp-configured":
      return message("settings.betterT3.status.mcpConfiguredCount", {
        status: primary,
        count: detail.configuredCount,
      });
    case "skills-loaded":
      return `${primary} · ${message("settings.betterT3.status.skillsLoaded", {
        enabled: detail.enabledCount,
        total: detail.totalCount,
      })}`;
    case "skills-advertised":
      return `${primary} · ${message("settings.betterT3.status.skillsAdvertised", {
        enabled: detail.enabledCount,
        total: detail.totalCount,
      })}`;
    case "compatibility":
      return message("settings.betterT3.status.compatibilityCount", {
        status: primary,
        supported: detail.supportedCount,
        total: detail.totalCount,
      });
    case "knowledge-graph": {
      const parts = [message("knowledgeGraph.nodeCount", { count: detail.nodeCount })];
      if (
        detail.processedFileCount !== null &&
        detail.totalFileCount !== null &&
        detail.queuedSemanticNodeCount !== null
      ) {
        parts.push(
          message("settings.betterT3.status.knowledgeProgress", {
            processed: detail.processedFileCount,
            total: detail.totalFileCount,
            queued: detail.queuedSemanticNodeCount,
          }),
        );
      }
      return `${primary} · ${parts.join(" · ")}`;
    }
  }
}

function KnowledgeGraphStatusRow(props: {
  readonly control: MobileBetterT3Control;
  readonly environmentId: EnvironmentId | null;
  readonly environmentAvailable: boolean;
  readonly projectId: ProjectId | null;
  readonly graphEnabled: boolean;
  readonly knowledgeGraphVersion: number | undefined;
  readonly label: string;
  readonly description: string;
}) {
  const translator = useMobileInterfaceTranslator();
  const shouldSubscribe = shouldSubscribeMobileKnowledgeGraphProgress({
    environmentAvailable: props.environmentAvailable,
    knowledgeGraphVersion: props.knowledgeGraphVersion,
    enabled: props.graphEnabled,
    projectAvailable: props.projectId !== null,
  });
  const target =
    shouldSubscribe && props.environmentId !== null && props.projectId !== null
      ? {
          environmentId: props.environmentId,
          input: { scope: { projectId: props.projectId } },
        }
      : null;
  const graph = useEnvironmentQuery(
    target === null ? null : knowledgeGraphEnvironment.state(target),
  );
  const snapshot = graph.data?.snapshot ?? null;
  const capability = resolveBetterT3CapabilitySupport(
    props.environmentAvailable ? { knowledgeGraphVersion: props.knowledgeGraphVersion } : null,
    "knowledgeGraphVersion",
    1,
  );
  const prepared = prepareKnowledgeGraphStatus({
    capability,
    project: props.projectId === null ? null : { projectId: props.projectId },
    status: snapshot?.status ?? null,
  });
  const status = !props.graphEnabled
    ? translator.message("settings.betterT3.control.statusDisabled")
    : preparedStatusText({ featureId: "knowledge.progress", status: prepared }, translator.message);
  return (
    <BetterT3ActionRow
      control={props.control}
      description={props.description}
      label={props.label}
      onPress={() => undefined}
      status={status}
    />
  );
}

export function SettingsBetterT3RouteScreen() {
  const navigation = useNavigation<BetterT3SettingsNavigation>();
  const { width } = useWindowDimensions();
  const translator = useMobileInterfaceTranslator();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const updateServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const { environments } = useEnvironments();
  const projects = useProjects();
  const threads = useThreadShells();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(null);
  const [selectedGitThreadId, setSelectedGitThreadId] = useState<ThreadId | null>(null);
  const [activeChoice, setActiveChoice] = useState<
    "caveman" | "project-sort" | "thread-sort" | "settling-days" | null
  >(null);
  const [knowledgeModelPickerOpen, setKnowledgeModelPickerOpen] = useState(false);
  const [autoReasoningModelPickerOpen, setAutoReasoningModelPickerOpen] = useState(false);

  useEffect(() => {
    if (
      selectedEnvironmentId !== null &&
      environments.some((environment) => environment.environmentId === selectedEnvironmentId)
    ) {
      return;
    }
    setSelectedGitThreadId(null);
    setSelectedProjectId(null);
    setSelectedEnvironmentId(environments[0]?.environmentId ?? null);
  }, [environments, selectedEnvironmentId]);

  const selectedEnvironment =
    environments.find((environment) => environment.environmentId === selectedEnvironmentId) ?? null;
  const serverConfig = selectedEnvironment?.serverConfig ?? null;
  const environmentTargetId = resolveMobileBetterT3EnvironmentTarget({
    environmentId: selectedEnvironmentId,
    connectionPhase: selectedEnvironment?.connection.phase ?? "offline",
    serverConfigAvailable: serverConfig !== null,
  });
  const environmentAvailable = environmentTargetId !== null;
  const welcome = useEnvironmentQuery(
    environmentTargetId !== null
      ? serverEnvironment.welcome({ environmentId: environmentTargetId, input: {} })
      : null,
  );
  const deviceAvailable = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const devicePreferences = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value
    : undefined;
  const deviceSettings = devicePreferences?.betterT3Device
    ? devicePreferences.betterT3Device
    : DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1;
  const environmentSettings =
    serverConfig?.settings.betterT3Environment ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1;
  const mobileSurface = mobileBetterT3SurfaceForWidth(width);
  const sections = useMemo(
    () =>
      buildMobileBetterT3Sections({
        registry: BETTER_T3_FEATURE_REGISTRY,
        surface: mobileSurface,
        deviceAvailable,
        environmentAvailable,
        deviceSettings,
        environmentSettings,
        capabilities: serverConfig?.environment.capabilities ?? FALLBACK_CAPABILITIES,
      }),
    [
      deviceAvailable,
      deviceSettings,
      environmentAvailable,
      environmentSettings,
      serverConfig?.environment.capabilities,
      mobileSurface,
    ],
  );

  const projectSortOrder =
    devicePreferences?.sidebarProjectSortOrder ??
    (DEFAULT_SIDEBAR_PROJECT_SORT_ORDER === "manual"
      ? "updated_at"
      : DEFAULT_SIDEBAR_PROJECT_SORT_ORDER);
  const threadSortOrder =
    devicePreferences?.sidebarThreadSortOrder ?? DEFAULT_SIDEBAR_THREAD_SORT_ORDER;
  const settling = resolveMobileSidebarSettlingPreferences(devicePreferences);
  const cavemanMode = serverConfig?.settings.agentEnhancement.cavemanMode ?? "off";
  const knowledgeGraphModelSelection = serverConfig?.settings.knowledgeGraphModelSelection ?? null;
  const autoReasoningModelSelection = serverConfig?.settings.autoReasoningModelSelection ?? null;
  const knowledgeGraphEnabled = resolveBetterT3FeatureFlag(environmentSettings, "knowledge.graph");
  const environmentProjects = useMemo(
    () => projects.filter((project) => project.environmentId === selectedEnvironmentId),
    [projects, selectedEnvironmentId],
  );
  const selectedProject = resolveMobileBetterT3ProjectSelection(
    projects,
    selectedEnvironmentId,
    selectedProjectId,
  );
  const gitWorkbenchFeatureEnabled = resolveBetterT3FeatureFlag(
    deviceSettings,
    "workspace.gitWorkbench",
  );
  const gitWorkbenchThreadOptions = useMemo(
    () =>
      environmentTargetId !== null && selectedProject !== null
        ? buildMobileGitWorkbenchThreadOptions(threads, environmentTargetId, selectedProject.id)
        : [],
    [environmentTargetId, selectedProject, threads],
  );
  const selectedGitThread =
    gitWorkbenchThreadOptions.find((option) => option.threadId === selectedGitThreadId) ?? null;
  const gitWorkbenchOwnerAvailability = resolveMobileGitWorkbenchAvailability({
    featureEnabled: deviceAvailable ? gitWorkbenchFeatureEnabled : null,
    gitWorkbenchVersion: serverConfig?.environment.capabilities.gitWorkbenchVersion,
    environmentId: environmentTargetId,
    threadId: selectedGitThread?.threadId ?? null,
  });
  useEffect(() => {
    if (
      selectedGitThreadId === null ||
      gitWorkbenchThreadOptions.some((option) => option.threadId === selectedGitThreadId)
    ) {
      return;
    }
    setSelectedGitThreadId(null);
  }, [gitWorkbenchThreadOptions, selectedGitThreadId]);
  const knowledgeGraphProjectId = selectedProject?.id ?? null;
  const preparedStatusModel = useMemo(
    () =>
      prepareBetterT3StatusModel({
        surface: mobileSurface,
        connectionPhase: selectedEnvironment?.connection.phase ?? "connecting",
        capabilities: serverConfig?.environment.capabilities ?? null,
        lifecycleReceipt: mobileLifecycleReceiptFromWelcome(welcome.data),
        registry: BETTER_T3_FEATURE_REGISTRY,
        mcp:
          serverConfig === null
            ? null
            : {
                configuredCount: serverConfig.settings.mcp.servers.length,
                runtimeServers: null,
              },
        skills:
          serverConfig === null
            ? null
            : {
                advertisedSkills: serverConfig.providers.flatMap((provider) => provider.skills),
                loadedSkills: null,
              },
        project:
          selectedProject === null
            ? null
            : {
                projectId: selectedProject.id,
                checkpointsEnabled: selectedProject.checkpointsEnabled,
              },
        knowledgeGraphStatus: null,
      }),
    [
      mobileSurface,
      selectedEnvironment?.connection.phase,
      selectedProject,
      serverConfig,
      welcome.data,
    ],
  );

  const updateEnvironmentSettings = useCallback(
    async (patch: ServerSettingsPatch): Promise<boolean> => {
      if (environmentTargetId === null) return false;
      const result = await updateServerSettings({
        environmentId: environmentTargetId,
        input: { patch },
      });
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return true;
      const error = squashAtomCommandFailure(result);
      Alert.alert(
        translator.message("mobile.settings.betterT3.updateFailedTitle"),
        translator.message("mobile.settings.betterT3.updateFailedDescription", {
          message:
            error instanceof Error
              ? error.message
              : translator.message("settings.betterT3.availability.unavailable"),
        }),
      );
      return false;
    },
    [environmentTargetId, translator, updateServerSettings],
  );

  const setSwitch = useCallback(
    async (control: MobileBetterT3Control, enabled: boolean) => {
      const featureId = control.id as BetterT3SwitchFeatureId;
      if (control.descriptor.scope === "device") {
        savePreferences(
          createMobileBetterT3DevicePreferencePatch({
            settings: deviceSettings,
            featureId,
            enabled,
          }),
        );
        return;
      }
      await updateEnvironmentSettings(
        createMobileBetterT3EnvironmentPatch({
          settings: environmentSettings,
          featureId,
          enabled,
        }),
      );
    },
    [deviceSettings, environmentSettings, savePreferences, updateEnvironmentSettings],
  );

  const navigateToControl = useCallback(
    (featureId: BetterT3FeatureId) => {
      const destination = resolveMobileBetterT3Destination(featureId);
      switch (destination) {
        case null:
          return;
        case "GitOverview":
          if (environmentTargetId !== null && selectedGitThread !== null) {
            navigation.navigate("GitOverview", {
              environmentId: String(environmentTargetId),
              threadId: String(selectedGitThread.threadId),
            });
          }
          return;
        case "SettingsAgents":
          navigation.navigate("SettingsAgents");
          return;
        case "SettingsAppearance":
          navigation.navigate("SettingsAppearance");
          return;
        case "SettingsEnvironments":
          navigation.navigate("SettingsEnvironments");
          return;
        case "SettingsProjects":
          navigation.navigate("SettingsProjects");
          return;
        case "SettingsBetterT3ResourceDiagnostics":
          if (selectedEnvironmentId !== null) {
            navigation.navigate("SettingsBetterT3ResourceDiagnostics", {
              environmentId: selectedEnvironmentId,
            });
          }
          return;
        case "SettingsBetterT3TranscriptPortability":
          if (selectedEnvironmentId !== null) {
            navigation.navigate("SettingsBetterT3TranscriptPortability", {
              environmentId: selectedEnvironmentId,
            });
          }
      }
    },
    [environmentTargetId, navigation, selectedEnvironmentId, selectedGitThread],
  );

  return (
    <AndroidScreenScaffold title={translator.message("settings.betterT3.title")}>
      <NativeStackScreenOptions
        options={{ title: translator.message("settings.betterT3.title") }}
      />
      <ScreenScaffoldScrollView>
        <Text className="px-2 text-sm leading-normal text-foreground-muted">
          {translator.message("settings.betterT3.description")}
        </Text>

        <SettingsSection card title={translator.message("settings.betterT3.environmentScope")}>
          {environments.length === 0 ? (
            <Text className="p-4 text-sm text-foreground-muted">
              {translator.message("settings.betterT3.noEnvironment")}
            </Text>
          ) : (
            <ScrollView
              horizontal
              contentContainerClassName="gap-2 p-3"
              showsHorizontalScrollIndicator={false}
            >
              {environments.map((environment) => {
                const selected = environment.environmentId === selectedEnvironmentId;
                return (
                  <Pressable
                    key={environment.environmentId}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    className={
                      selected
                        ? "rounded-full bg-primary px-4 py-2.5"
                        : "rounded-full border border-border bg-subtle px-4 py-2.5"
                    }
                    onPress={() => {
                      setSelectedGitThreadId(null);
                      setSelectedProjectId(null);
                      setSelectedEnvironmentId(environment.environmentId);
                    }}
                  >
                    <Text
                      className={
                        selected
                          ? "font-t3-semibold text-primary-foreground"
                          : "font-t3-semibold text-foreground"
                      }
                    >
                      {environment.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </SettingsSection>

        {selectedEnvironmentId !== null && environmentProjects.length > 0 ? (
          <SettingsSection
            card
            title={translator.message("settings.betterT3.status.projectRequired")}
          >
            <ScrollView
              horizontal
              contentContainerClassName="gap-2 p-3"
              showsHorizontalScrollIndicator={false}
            >
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedProjectId === null }}
                className={
                  selectedProjectId === null
                    ? "rounded-full bg-primary px-4 py-2.5"
                    : "rounded-full border border-border bg-subtle px-4 py-2.5"
                }
                onPress={() => {
                  setSelectedGitThreadId(null);
                  setSelectedProjectId(null);
                }}
              >
                <Text
                  className={
                    selectedProjectId === null
                      ? "font-t3-semibold text-primary-foreground"
                      : "font-t3-semibold text-foreground"
                  }
                >
                  {translator.message("settings.betterT3.status.projectRequired")}
                </Text>
              </Pressable>
              {environmentProjects.map((project) => {
                const selected = project.id === selectedProjectId;
                return (
                  <Pressable
                    key={project.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    className={
                      selected
                        ? "rounded-full bg-primary px-4 py-2.5"
                        : "rounded-full border border-border bg-subtle px-4 py-2.5"
                    }
                    onPress={() => {
                      setSelectedGitThreadId(null);
                      setSelectedProjectId(project.id);
                    }}
                  >
                    <Text
                      className={
                        selected
                          ? "font-t3-semibold text-primary-foreground"
                          : "font-t3-semibold text-foreground"
                      }
                    >
                      {project.title}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </SettingsSection>
        ) : null}

        {gitWorkbenchFeatureEnabled &&
        (serverConfig?.environment.capabilities.gitWorkbenchVersion ?? 0) >= 1 &&
        selectedProject !== null ? (
          <SettingsSection card title={translator.message("mobile.thread.openGit")}>
            {gitWorkbenchThreadOptions.length === 0 ? (
              <Text className="p-4 text-sm text-foreground-muted">
                {translator.message("mobile.git.unavailable")}
              </Text>
            ) : (
              <ScrollView
                horizontal
                contentContainerClassName="gap-2 p-3"
                showsHorizontalScrollIndicator={false}
              >
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selectedGitThreadId === null }}
                  className={
                    selectedGitThreadId === null
                      ? "rounded-full bg-primary px-4 py-2.5"
                      : "rounded-full border border-border bg-subtle px-4 py-2.5"
                  }
                  onPress={() => setSelectedGitThreadId(null)}
                >
                  <Text
                    className={
                      selectedGitThreadId === null
                        ? "font-t3-semibold text-primary-foreground"
                        : "font-t3-semibold text-foreground"
                    }
                  >
                    {translator.message("ui.thread.selectOrCreate")}
                  </Text>
                </Pressable>
                {gitWorkbenchThreadOptions.map((option) => {
                  const selected = option.threadId === selectedGitThreadId;
                  return (
                    <Pressable
                      key={option.threadId}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      className={
                        selected
                          ? "rounded-full bg-primary px-4 py-2.5"
                          : "rounded-full border border-border bg-subtle px-4 py-2.5"
                      }
                      onPress={() => setSelectedGitThreadId(option.threadId)}
                    >
                      <Text
                        className={
                          selected
                            ? "font-t3-semibold text-primary-foreground"
                            : "font-t3-semibold text-foreground"
                        }
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </SettingsSection>
        ) : null}

        {sections.map((section) => (
          <SettingsSection
            card
            key={section.id}
            title={translator.message(
              messageKey(`settings.betterT3.section.${section.id}`, "settings.betterT3.title"),
            )}
          >
            {section.controls.map((control) => {
              const label = translator.message(
                messageKey(control.descriptor.labelMessageId, "settings.betterT3.title"),
              );
              const description = translator.message(
                messageKey(
                  control.descriptor.descriptionMessageId,
                  "settings.betterT3.description",
                ),
              );
              const status = translator.message(
                messageKey(
                  control.availability.reasonMessageId ??
                    `settings.betterT3.availability.${control.availability.state}`,
                  "settings.betterT3.availability.unavailable",
                ),
              );
              const preparedStatus = mobileBetterT3PreparedStatusInput(
                preparedStatusModel,
                control.id,
              );
              const preparedStatusLabel =
                preparedStatus === null
                  ? null
                  : preparedStatusText(preparedStatus, translator.message);
              const available = control.availability.state === "available";
              if (control.controlKind === "switch") {
                if (control.id === "workspace.gitWorkbench") {
                  const ownerAvailable = mobileGitWorkbenchCanActivate(
                    gitWorkbenchOwnerAvailability,
                  );
                  const ownerStatusKey = mobileGitWorkbenchStatusMessageKey(
                    gitWorkbenchOwnerAvailability,
                  );
                  const ownerControl: MobileBetterT3Control = {
                    ...control,
                    controlKind: "link",
                    availability: ownerAvailable
                      ? { state: "available" }
                      : {
                          state:
                            gitWorkbenchOwnerAvailability.state === "unsupported"
                              ? "unsupported"
                              : "unavailable",
                          reasonMessageId: ownerStatusKey,
                        },
                  };
                  return (
                    <View key={control.id}>
                      <SettingsSwitchRow
                        disabled={!available}
                        icon={SECTION_ICONS[section.id]}
                        label={label}
                        onValueChange={(enabled) => void setSwitch(control, enabled)}
                        subtitle={available ? description : `${description} · ${status}`}
                        value={control.value === true}
                      />
                      {control.value === true ? (
                        <BetterT3ActionRow
                          control={ownerControl}
                          description={translator.message("mobile.git.moreDetail")}
                          label={translator.message("mobile.thread.openGit")}
                          onPress={() => navigateToControl(control.id)}
                          status={translator.message(ownerStatusKey)}
                        />
                      ) : null}
                    </View>
                  );
                }
                return (
                  <SettingsSwitchRow
                    key={control.id}
                    disabled={control.availability.state !== "available"}
                    icon={SECTION_ICONS[section.id]}
                    label={label}
                    onValueChange={(enabled) => void setSwitch(control, enabled)}
                    subtitle={
                      control.availability.state === "available"
                        ? description
                        : `${description} · ${status}`
                    }
                    value={control.value === true}
                  />
                );
              }
              if (control.id === "agent.cavemanMode") {
                return (
                  <BetterT3ActionRow
                    key={control.id}
                    control={control}
                    description={description}
                    label={label}
                    onPress={() => setActiveChoice("caveman")}
                    status={
                      available
                        ? translator.message(`settings.betterT3.value.${cavemanMode}`)
                        : status
                    }
                  />
                );
              }
              if (control.id === "agent.autoReasoningModel") {
                return (
                  <BetterT3ActionRow
                    key={control.id}
                    control={control}
                    description={description}
                    label={label}
                    onPress={() => setAutoReasoningModelPickerOpen(true)}
                    status={
                      !available || serverConfig === null
                        ? status
                        : autoReasoningModelSelection === null
                          ? translator.message("settings.betterT3.value.automatic")
                          : modelSelectionLabel(serverConfig, autoReasoningModelSelection)
                    }
                  />
                );
              }
              if (control.id === "chat.sorting") {
                return (
                  <View key={control.id}>
                    <BetterT3ActionRow
                      control={control}
                      description={description}
                      label={translator.message("settings.betterT3.value.projectSort")}
                      onPress={() => setActiveChoice("project-sort")}
                      status={translator.message(
                        projectSortOrder === "updated_at"
                          ? "settings.betterT3.value.updated"
                          : "settings.betterT3.value.created",
                      )}
                    />
                    <BetterT3ActionRow
                      control={control}
                      description={description}
                      label={translator.message("settings.betterT3.value.threadSort")}
                      onPress={() => setActiveChoice("thread-sort")}
                      status={translator.message(
                        threadSortOrder === "updated_at"
                          ? "settings.betterT3.value.updated"
                          : "settings.betterT3.value.created",
                      )}
                    />
                  </View>
                );
              }
              if (control.id === "chat.settling") {
                return (
                  <View key={control.id}>
                    <BetterT3ActionRow
                      control={control}
                      description={description}
                      label={label}
                      onPress={() => setActiveChoice("settling-days")}
                      status={
                        settling.afterDays === null
                          ? translator.message("settings.betterT3.value.off")
                          : translator.message("settings.betterT3.value.days", {
                              count: settling.afterDays,
                            })
                      }
                    />
                    <SettingsSwitchRow
                      disabled={!available}
                      icon="arrow.triangle.branch"
                      label={translator.message("settings.betterT3.value.settleOnMerge")}
                      onValueChange={(enabled) =>
                        savePreferences(
                          createMobileBetterT3DeviceControlPatch({
                            id: "chat.settling.onMerge",
                            value: enabled,
                          }),
                        )
                      }
                      subtitle={description}
                      value={settling.onMerge}
                    />
                  </View>
                );
              }
              if (control.id === "knowledge.model") {
                return (
                  <BetterT3ActionRow
                    key={control.id}
                    control={control}
                    description={description}
                    label={label}
                    onPress={() => setKnowledgeModelPickerOpen(true)}
                    status={
                      !available || serverConfig === null
                        ? status
                        : knowledgeGraphModelSelection === null
                          ? translator.message("settings.betterT3.value.automatic")
                          : modelSelectionLabel(serverConfig, knowledgeGraphModelSelection)
                    }
                  />
                );
              }
              if (control.id === "knowledge.progress") {
                return (
                  <KnowledgeGraphStatusRow
                    key={control.id}
                    control={control}
                    description={description}
                    environmentId={selectedEnvironmentId}
                    environmentAvailable={environmentAvailable}
                    graphEnabled={knowledgeGraphEnabled}
                    knowledgeGraphVersion={
                      serverConfig?.environment.capabilities.knowledgeGraphVersion
                    }
                    label={label}
                    projectId={knowledgeGraphProjectId}
                  />
                );
              }
              return (
                <BetterT3ActionRow
                  key={control.id}
                  control={control}
                  description={description}
                  label={label}
                  onPress={() => navigateToControl(control.id)}
                  status={preparedStatusLabel ?? status}
                />
              );
            })}
          </SettingsSection>
        ))}
      </ScreenScaffoldScrollView>
      <BetterT3ChoiceModal<CavemanMode>
        choices={(["off", "lite", "full", "ultra"] as const).map((value) => ({
          value,
          label: translator.message(`settings.betterT3.value.${value}`),
        }))}
        current={cavemanMode}
        onClose={() => setActiveChoice(null)}
        onSelect={(value) =>
          void updateEnvironmentSettings(
            createMobileBetterT3EnvironmentControlPatch({
              id: "agent.cavemanMode",
              value,
            }),
          )
        }
        title={translator.message("betterT3.agent.cavemanMode.label")}
        visible={activeChoice === "caveman"}
      />
      <BetterT3ChoiceModal<"updated_at" | "created_at">
        choices={(["updated_at", "created_at"] as const).map((value) => ({
          value,
          label: translator.message(
            value === "updated_at"
              ? "settings.betterT3.value.updated"
              : "settings.betterT3.value.created",
          ),
        }))}
        current={projectSortOrder}
        onClose={() => setActiveChoice(null)}
        onSelect={(value) =>
          savePreferences(
            createMobileBetterT3DeviceControlPatch({
              id: "chat.sorting.projects",
              value,
            }),
          )
        }
        title={translator.message("settings.betterT3.value.projectSort")}
        visible={activeChoice === "project-sort"}
      />
      <BetterT3ChoiceModal<SidebarThreadSortOrder>
        choices={(["updated_at", "created_at"] as const).map((value) => ({
          value,
          label: translator.message(
            value === "updated_at"
              ? "settings.betterT3.value.updated"
              : "settings.betterT3.value.created",
          ),
        }))}
        current={threadSortOrder}
        onClose={() => setActiveChoice(null)}
        onSelect={(value) =>
          savePreferences(
            createMobileBetterT3DeviceControlPatch({
              id: "chat.sorting.threads",
              value,
            }),
          )
        }
        title={translator.message("settings.betterT3.value.threadSort")}
        visible={activeChoice === "thread-sort"}
      />
      <BetterT3ChoiceModal<number | null>
        choices={([null, 1, 3, 7, 14, 30, 90] as const).map((value) => ({
          value,
          label:
            value === null
              ? translator.message("settings.betterT3.value.off")
              : translator.message("settings.betterT3.value.days", { count: value }),
        }))}
        current={settling.afterDays}
        onClose={() => setActiveChoice(null)}
        onSelect={(value) =>
          savePreferences(
            createMobileBetterT3DeviceControlPatch({
              id: "chat.settling.days",
              value,
            }),
          )
        }
        title={translator.message("betterT3.chat.settling.label")}
        visible={activeChoice === "settling-days"}
      />
      {serverConfig === null ? null : (
        <>
          <ModelSelectionModal
            config={serverConfig}
            current={
              autoReasoningModelSelection === null
                ? null
                : stripAutoReasoning(autoReasoningModelSelection)
            }
            defaultLabel={translator.message("settings.betterT3.value.automatic")}
            onClose={() => setAutoReasoningModelPickerOpen(false)}
            onSelect={(selection: ModelSelection | null) =>
              void updateEnvironmentSettings(
                createMobileBetterT3EnvironmentControlPatch({
                  id: "agent.autoReasoningModel",
                  value: selection === null ? null : stripAutoReasoning(selection),
                }),
              )
            }
            visible={autoReasoningModelPickerOpen}
          />
          <ModelSelectionModal
            config={serverConfig}
            current={knowledgeGraphModelSelection}
            defaultLabel={translator.message("settings.betterT3.value.automatic")}
            onClose={() => setKnowledgeModelPickerOpen(false)}
            onSelect={(selection: ModelSelection | null) =>
              void updateEnvironmentSettings(
                createMobileBetterT3EnvironmentControlPatch({
                  id: "knowledge.model",
                  value: selection,
                }),
              )
            }
            optionPredicate={supportsMobileKnowledgeGraphModelOption}
            visible={knowledgeModelPickerOpen}
          />
        </>
      )}
    </AndroidScreenScaffold>
  );
}
