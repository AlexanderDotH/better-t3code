import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ModelSelection, ServerConfig, ThreadEnvMode } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useThemeColor } from "../../lib/useThemeColor";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceState } from "../../state/workspace";
import { ModelSelectionModal, modelSelectionLabel } from "./SettingsAgentEnvironmentsRouteScreen";
import { HarnessChatSyncEnvironment } from "./HarnessChatSyncSettings";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

function workspaceModeLabel(mode: ThreadEnvMode | null): string {
  if (mode === "local") return "Project directory";
  if (mode === "worktree") return "New worktree";
  return "Environment default";
}

function supportsProjectSettings(config: ServerConfig | null): boolean {
  return (config?.environment.capabilities.projectSettingsVersion ?? 0) >= 1;
}

function ProjectSettingsCard(props: { readonly project: EnvironmentProject }) {
  const config = useEnvironmentServerConfig(props.project.environmentId);
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const checkmarkColor = useThemeColor("--color-icon");
  const supported = supportsProjectSettings(config);

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
        Alert.alert(
          "Could not update project",
          error instanceof Error ? error.message : "The project setting could not be saved.",
        );
      }
    },
    [props.project.environmentId, props.project.id, saving, supported, updateProject],
  );

  const chooseWorkspaceMode = useCallback(() => {
    if (!supported || saving) return;
    Alert.alert("New thread workspace", undefined, [
      {
        text: "Environment default",
        onPress: () => void update({ defaultThreadEnvMode: null }),
      },
      { text: "Project directory", onPress: () => void update({ defaultThreadEnvMode: "local" }) },
      { text: "New worktree", onPress: () => void update({ defaultThreadEnvMode: "worktree" }) },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [saving, supported, update]);

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
            This server version does not advertise remote project settings. Update the server to
            edit this project from mobile.
          </Text>
        ) : (
          <>
            <SettingsSwitchRow
              disabled={saving}
              icon="clock.arrow.circlepath"
              label="Git checkpoints"
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
                tintColor={checkmarkColor}
                type="monochrome"
                weight="regular"
              />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-lg text-foreground">Default model</Text>
                <Text className="text-sm text-foreground-muted">
                  {config
                    ? props.project.defaultModelSelection === null
                      ? "Environment default"
                      : modelSelectionLabel(config, props.project.defaultModelSelection)
                    : "Unavailable"}
                </Text>
              </View>
              <SymbolView
                name="chevron.right"
                size={15}
                tintColor={checkmarkColor}
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
                tintColor={checkmarkColor}
                type="monochrome"
                weight="regular"
              />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-lg text-foreground">New thread workspace</Text>
                <Text className="text-sm text-foreground-muted">
                  {workspaceModeLabel(props.project.defaultThreadEnvMode ?? null)}
                </Text>
              </View>
              <SymbolView
                name="chevron.right"
                size={15}
                tintColor={checkmarkColor}
                type="monochrome"
                weight="semibold"
              />
            </Pressable>
          </>
        )}
      </View>
      {config ? (
        <ModelSelectionModal
          config={config}
          current={props.project.defaultModelSelection}
          defaultLabel="Environment default"
          visible={modelPickerOpen}
          onClose={() => setModelPickerOpen(false)}
          onSelect={(defaultModelSelection) => void update({ defaultModelSelection })}
        />
      ) : null}
    </View>
  );
}

export function SettingsProjectsRouteScreen() {
  const projects = useProjects();
  const { environments } = useWorkspaceState();
  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => left.title.localeCompare(right.title)),
    [projects],
  );

  return (
    <AndroidScreenScaffold title="Projects">
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
          <SettingsSection title="Projects">
            <Text className="p-4 text-sm text-foreground-muted">
              Add a project before configuring project defaults.
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
