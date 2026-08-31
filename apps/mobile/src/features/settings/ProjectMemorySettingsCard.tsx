import { useEffect, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  DEFAULT_PROJECT_MEMORY_VIEW_MODEL,
  canEditProjectMemory,
  projectMemoryClearActions,
  updateProjectMemoryPreferences,
  type ProjectMemoryMode,
  type ProjectMemoryPreferences,
  type ProjectMemoryViewModel,
} from "./project-memory-settings";

export type { ProjectMemoryPreferences, ProjectMemoryViewModel };

type ProjectMemorySettingsCardProps = {
  readonly viewModel?: ProjectMemoryViewModel;
  readonly busy?: boolean;
  readonly onSavePreferences: (preferences: ProjectMemoryPreferences) => void | Promise<void>;
  readonly onSaveContent: (content: string) => void | Promise<void>;
  readonly onImport: () => void | Promise<void>;
  readonly onExport: () => void | Promise<void>;
  readonly onClear: () => void | Promise<void>;
};

const MODES = [
  { value: "project", messageKey: "settings.projects.memory.source.project" },
  { value: "provider", messageKey: "settings.projects.memory.source.provider" },
  { value: "off", messageKey: "settings.projects.memory.source.off" },
] as const satisfies ReadonlyArray<{ value: ProjectMemoryMode; messageKey: string }>;

const STATUS_MESSAGE_KEYS = {
  ready: "settings.projects.memory.status.ready",
  fallback: "settings.projects.memory.status.fallback",
  unavailable: "settings.projects.memory.status.unavailable",
} as const satisfies Record<ProjectMemoryViewModel["status"], string>;

function ActionButton(props: {
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      className={`rounded-full px-4 py-2 ${
        props.destructive ? "bg-destructive/12" : "bg-subtle"
      } disabled:opacity-45`}
      onPress={props.onPress}
    >
      <Text className={props.destructive ? "text-danger" : "text-foreground"}>{props.label}</Text>
    </Pressable>
  );
}

export function ProjectMemorySettingsCard(props: ProjectMemorySettingsCardProps) {
  const translator = useMobileInterfaceTranslator();
  const viewModel = props.viewModel ?? DEFAULT_PROJECT_MEMORY_VIEW_MODEL;
  const [content, setContent] = useState(viewModel.content);
  const unavailable = viewModel.status === "unavailable";
  const editable = canEditProjectMemory(viewModel) && !props.busy;

  useEffect(() => setContent(viewModel.content), [viewModel.content]);

  return (
    <SettingsSection title={translator.message("settings.projects.memory.title")} card>
      <View className="gap-4 p-4">
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">
            {translator.message("settings.projects.memory.source")}
          </Text>
          <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
            {MODES.map((mode) => (
              <Pressable
                key={mode.value}
                accessibilityRole="radio"
                accessibilityState={{
                  disabled: props.busy || unavailable,
                  selected: viewModel.mode === mode.value,
                }}
                disabled={props.busy || unavailable}
                className={`rounded-full px-4 py-2 ${
                  viewModel.mode === mode.value ? "bg-accent" : "bg-subtle"
                } disabled:opacity-45`}
                onPress={() =>
                  void props.onSavePreferences(
                    updateProjectMemoryPreferences(viewModel, { memoryMode: mode.value }),
                  )
                }
              >
                <Text className="text-foreground">{translator.message(mode.messageKey)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="-mx-4 border-y border-border-subtle">
          <SettingsSwitchRow
            disabled={props.busy || unavailable}
            icon="doc.text"
            label={translator.message("settings.projects.memory.allowAgentWrites")}
            subtitle={translator.message("settings.projects.memory.allowAgentWritesDescription")}
            value={viewModel.allowAgentWrites}
            onValueChange={(allowAgentWrites) =>
              void props.onSavePreferences(
                updateProjectMemoryPreferences(viewModel, { allowAgentWrites }),
              )
            }
          />
        </View>

        <View className="gap-1">
          <Text className="text-sm text-foreground-muted">
            {translator.message("settings.projects.memory.effectiveFile")}
          </Text>
          <Text className="text-sm text-foreground" selectable>
            {viewModel.effectivePath || translator.message("settings.projects.memory.noFile")}
          </Text>
          <Text className="text-xs text-foreground-muted">
            {translator.message(STATUS_MESSAGE_KEYS[viewModel.status])}
          </Text>
        </View>

        <TextInput
          accessibilityLabel={translator.message("settings.projects.memory.content")}
          autoCapitalize="none"
          autoCorrect={false}
          editable={editable}
          multiline
          numberOfLines={8}
          className="min-h-48 rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
          value={content}
          onChangeText={setContent}
        />

        <View className="flex-row flex-wrap justify-end gap-2">
          <ActionButton
            label={translator.message("settings.projects.memory.import")}
            disabled={props.busy || unavailable || viewModel.mode !== "project"}
            onPress={() => void props.onImport()}
          />
          <ActionButton
            label={translator.message("settings.projects.memory.export")}
            disabled={props.busy || unavailable}
            onPress={() => void props.onExport()}
          />
          <ActionButton
            label={translator.message("settings.projects.memory.clear")}
            destructive
            disabled={props.busy || unavailable || viewModel.mode !== "project"}
            onPress={() =>
              Alert.alert(
                translator.message("settings.projects.memory.clearTitle"),
                translator.message("settings.projects.memory.clearDescription"),
                projectMemoryClearActions(props.onClear, {
                  cancel: translator.message("mobile.settings.projects.settings.cancel"),
                  clear: translator.message("settings.projects.memory.clearAction"),
                }),
              )
            }
          />
          <ActionButton
            label={translator.message("settings.projects.memory.save")}
            disabled={!editable || content === viewModel.content}
            onPress={() => void props.onSaveContent(content)}
          />
        </View>
      </View>
    </SettingsSection>
  );
}
