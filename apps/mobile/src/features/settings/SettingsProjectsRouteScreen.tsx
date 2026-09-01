import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  resolveBetterT3FeatureFlag,
  type ModelSelection,
  type ServerConfig,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, Share, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceState } from "../../state/workspace";
import { ModelSelectionModal, modelSelectionLabel } from "./SettingsAgentEnvironmentsRouteScreen";
import { HarnessChatSyncEnvironment } from "./HarnessChatSyncSettings";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  ProjectMemorySettingsCard,
  type ProjectMemoryPreferences,
  type ProjectMemoryViewModel,
} from "./ProjectMemorySettingsCard";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import {
  resolveMobileKnowledgeGraphAccess,
  resolveMobileKnowledgeGraphRoutePolicy,
} from "../knowledge-graph/mobile-knowledge-graph";

function workspaceModeMessageKey(mode: ThreadEnvMode | null) {
  if (mode === "local") return "mobile.settings.projects.settings.projectDirectory" as const;
  if (mode === "worktree") return "mobile.settings.projects.settings.newWorktree" as const;
  return "mobile.settings.projects.settings.environmentDefault" as const;
}

function supportsProjectSettings(config: ServerConfig | null): boolean {
  return (config?.environment.capabilities.projectSettingsVersion ?? 0) >= 1;
}

function ProjectMemorySettingsController({ project }: { project: EnvironmentProject }) {
  const translator = useMobileInterfaceTranslator();
  const query = useEnvironmentQuery(
    serverEnvironment.projectMemoryView({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    }),
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateProjectMemorySettings);
  const replace = useAtomCommand(serverEnvironment.replaceProjectMemory);
  const importMemory = useAtomCommand(serverEnvironment.importProjectMemory);
  const clear = useAtomCommand(serverEnvironment.clearProjectMemory);
  const [busy, setBusy] = useState(false);
  const viewModel: ProjectMemoryViewModel = query.data
    ? {
        mode: query.data.settings.memoryMode,
        allowAgentWrites: query.data.settings.allowAgentWrites,
        effectivePath: query.data.effectivePath ?? "",
        content: query.data.rawMarkdown,
        status:
          query.data.status === "active" && query.data.storage === "fallback"
            ? "fallback"
            : "ready",
      }
    : {
        mode: "project",
        allowAgentWrites: true,
        effectivePath: "",
        content: "",
        status: "unavailable",
      };
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  };
  const target = { environmentId: project.environmentId } as const;

  return (
    <ProjectMemorySettingsCard
      viewModel={viewModel}
      busy={busy || query.isPending}
      onSavePreferences={(preferences: ProjectMemoryPreferences) =>
        run(() =>
          updateSettings({
            ...target,
            input: { projectId: project.id, ...preferences },
          }),
        )
      }
      onSaveContent={(markdown) =>
        run(() => replace({ ...target, input: { projectId: project.id, markdown } }))
      }
      onImport={() => run(() => importMemory({ ...target, input: { projectId: project.id } }))}
      onExport={() =>
        Share.share({
          title: translator.message("settings.projects.memory.filename"),
          message: viewModel.content,
        }).then(() => {})
      }
      onClear={() => run(() => clear({ ...target, input: { projectId: project.id } }))}
    />
  );
}

function ProjectSettingsCard(props: { readonly project: EnvironmentProject }) {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation<
    NativeStackNavigationProp<{
      KnowledgeGraph: { readonly environmentId: string; readonly projectId: string };
    }>
  >();
  const config = useEnvironmentServerConfig(props.project.environmentId);
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const supported = supportsProjectSettings(config);
  const graphEnabled =
    config !== null &&
    resolveBetterT3FeatureFlag(config.settings.betterT3Environment, "knowledge.graph");
  const graphAccess = resolveMobileKnowledgeGraphAccess({
    knowledgeGraphVersion: config?.environment.capabilities.knowledgeGraphVersion,
    enabled: graphEnabled,
  });
  const graphRoutePolicy = resolveMobileKnowledgeGraphRoutePolicy(graphAccess);

  const update = useCallback(
    async (patch: {
      readonly checkpointsEnabled?: boolean;
      readonly defaultModelSelection?: ModelSelection | null;
      readonly defaultThreadEnvMode?: ThreadEnvMode | null;
    }) => {
      if (!supported || saving) return;
      setSaving(true);
      const result = await updateProject({
        environmentId: props.project.environmentId,
        input: { projectId: props.project.id, ...patch },
      });
      setSaving(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        const message =
          error instanceof Error
            ? error.message
            : translator.message("mobile.settings.projects.settings.saveFailed", {
                message: translator.message("knowledgeGraph.error"),
              });
        Alert.alert(
          translator.message("mobile.settings.projects.settings.updateFailed", { message }),
        );
      }
    },
    [props.project.environmentId, props.project.id, saving, supported, translator, updateProject],
  );

  const chooseWorkspaceMode = useCallback(() => {
    if (!supported || saving) return;
    Alert.alert(translator.message("mobile.settings.projects.settings.workspaceTitle"), undefined, [
      {
        text: translator.message("mobile.settings.projects.settings.environmentDefault"),
        onPress: () => void update({ defaultThreadEnvMode: null }),
      },
      {
        text: translator.message("mobile.settings.projects.settings.projectDirectory"),
        onPress: () => void update({ defaultThreadEnvMode: "local" }),
      },
      {
        text: translator.message("mobile.settings.projects.settings.newWorktree"),
        onPress: () => void update({ defaultThreadEnvMode: "worktree" }),
      },
      {
        text: translator.message("mobile.settings.projects.settings.cancel"),
        style: "cancel",
      },
    ]);
  }, [saving, supported, translator, update]);

  return (
    <View className="gap-2">
      <View className="gap-0.5 px-2">
        <Text className="text-lg font-t3-semibold text-foreground">{props.project.title}</Text>
        <Text className="text-sm text-foreground-muted" numberOfLines={1}>
          {props.project.workspaceRoot}
        </Text>
      </View>
      <View className="overflow-hidden rounded-[24px] bg-card">
        {!supported ? (
          <Text className="p-4 text-sm leading-normal text-foreground-muted">
            {translator.message("mobile.settings.projects.settings.unsupported")}
          </Text>
        ) : (
          <>
            <SettingsSwitchRow
              disabled={saving}
              icon="clock.arrow.circlepath"
              label={translator.message("mobile.settings.projects.settings.checkpoints")}
              value={props.project.checkpointsEnabled}
              onValueChange={(checkpointsEnabled) => void update({ checkpointsEnabled })}
            />
            <Pressable
              accessibilityRole="button"
              disabled={saving || config === null}
              onPress={() => setModelPickerOpen(true)}
              className="flex-row items-center gap-3 border-t border-border-subtle p-4"
            >
              <SymbolView
                name="sparkles"
                size={21}
                tintColorClassName={"accent-icon"}
                type="monochrome"
                weight="regular"
              />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-lg text-foreground">
                  {translator.message("mobile.settings.projects.settings.defaultModel")}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  {config
                    ? props.project.defaultModelSelection === null
                      ? translator.message("mobile.settings.projects.settings.environmentDefault")
                      : modelSelectionLabel(config, props.project.defaultModelSelection)
                    : translator.message("mobile.settings.projects.settings.unavailable")}
                </Text>
              </View>
              <SymbolView
                name="chevron.right"
                size={15}
                tintColorClassName={"accent-icon"}
                type="monochrome"
                weight="semibold"
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={chooseWorkspaceMode}
              className="flex-row items-center gap-3 border-t border-border-subtle p-4"
            >
              <SymbolView
                name="arrow.triangle.branch"
                size={21}
                tintColorClassName={"accent-icon"}
                type="monochrome"
                weight="regular"
              />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-lg text-foreground">
                  {translator.message("mobile.settings.projects.settings.workspaceTitle")}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  {translator.message(
                    workspaceModeMessageKey(props.project.defaultThreadEnvMode ?? null),
                  )}
                </Text>
              </View>
              <SymbolView
                name="chevron.right"
                size={15}
                tintColorClassName={"accent-icon"}
                type="monochrome"
                weight="semibold"
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !graphRoutePolicy.canOpenOwnerRoute }}
              disabled={!graphRoutePolicy.canOpenOwnerRoute}
              onPress={() =>
                navigation.navigate("KnowledgeGraph", {
                  environmentId: String(props.project.environmentId),
                  projectId: String(props.project.id),
                })
              }
              className="flex-row items-center gap-3 border-t border-border-subtle p-4 disabled:opacity-45"
            >
              <SymbolView
                name="point.3.connected.trianglepath.dotted"
                size={21}
                tintColorClassName={"accent-icon"}
                type="monochrome"
                weight="regular"
              />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-lg text-foreground">
                  {translator.message("knowledgeGraph.title")}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  {graphAccess === "unsupported"
                    ? translator.message("mobile.settings.projects.settings.graphRequiresUpdate")
                    : graphAccess === "available"
                      ? translator.message("mobile.settings.projects.settings.graphExplore")
                      : translator.message("mobile.settings.projects.settings.graphEnable")}
                </Text>
              </View>
              <SymbolView
                name="chevron.right"
                size={15}
                tintColorClassName={"accent-icon"}
                type="monochrome"
                weight="semibold"
              />
            </Pressable>
          </>
        )}
      </View>
      <ProjectMemorySettingsController project={props.project} />
      {config ? (
        <ModelSelectionModal
          config={config}
          current={props.project.defaultModelSelection}
          defaultLabel={translator.message("mobile.settings.projects.settings.environmentDefault")}
          visible={modelPickerOpen}
          onClose={() => setModelPickerOpen(false)}
          onSelect={(defaultModelSelection) => void update({ defaultModelSelection })}
        />
      ) : null}
    </View>
  );
}

export function SettingsProjectsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const projects = useProjects();
  const { environments } = useWorkspaceState();
  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => left.title.localeCompare(right.title)),
    [projects],
  );

  return (
    <AndroidScreenScaffold title={translator.message("mobile.settings.projects")}>
      <NativeStackScreenOptions
        options={{ title: translator.message("mobile.settings.projects") }}
      />
      <ScreenScaffoldScrollView>
        {environments
          .filter((environment) => environment.connectionState === "connected")
          .map((environment) => (
            <HarnessChatSyncEnvironment
              key={environment.environmentId}
              environmentId={environment.environmentId}
              environmentLabel={environment.environmentLabel}
              projects={projects.filter(
                (project) => project.environmentId === environment.environmentId,
              )}
            />
          ))}
        {sortedProjects.length === 0 ? (
          <SettingsSection title={translator.message("mobile.settings.projects")}>
            <Text className="p-4 text-sm text-foreground-muted">
              {translator.message("mobile.settings.projects.settings.empty")}
            </Text>
          </SettingsSection>
        ) : (
          sortedProjects.map((project) => (
            <ProjectSettingsCard key={`${project.environmentId}:${project.id}`} project={project} />
          ))
        )}
      </ScreenScaffoldScrollView>
    </AndroidScreenScaffold>
  );
}
