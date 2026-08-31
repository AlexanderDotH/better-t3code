import { useEffect, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
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

const MODES: ReadonlyArray<{ value: ProjectMemoryMode; label: string }> = [
  { value: "project", label: "Project file" },
  { value: "provider", label: "Provider memory" },
  { value: "off", label: "Off" },
];

const STATUS_LABELS: Record<ProjectMemoryViewModel["status"], string> = {
  ready: "Ready",
  fallback: "Using T3 home fallback",
  unavailable: "Unavailable",
};

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
  const viewModel = props.viewModel ?? DEFAULT_PROJECT_MEMORY_VIEW_MODEL;
  const [content, setContent] = useState(viewModel.content);
  const unavailable = viewModel.status === "unavailable";
  const editable = canEditProjectMemory(viewModel) && !props.busy;

  useEffect(() => setContent(viewModel.content), [viewModel.content]);

  return (
    <SettingsSection title="Project memory" card>
      <View className="gap-4 p-4">
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">Memory source</Text>
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
                <Text className="text-foreground">{mode.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="-mx-4 border-y border-border-subtle">
          <SettingsSwitchRow
            disabled={props.busy || unavailable}
            icon="doc.text"
            label="Allow agent writes"
            subtitle="Let agents update this project's memory file."
            value={viewModel.allowAgentWrites}
            onValueChange={(allowAgentWrites) =>
              void props.onSavePreferences(
                updateProjectMemoryPreferences(viewModel, { allowAgentWrites }),
              )
            }
          />
        </View>

        <View className="gap-1">
          <Text className="text-sm text-foreground-muted">Effective memory file</Text>
          <Text className="text-sm text-foreground" selectable>
            {viewModel.effectivePath || "No memory file is available."}
          </Text>
          <Text className="text-xs text-foreground-muted">{STATUS_LABELS[viewModel.status]}</Text>
        </View>

        <TextInput
          accessibilityLabel="Project memory content"
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
            label="Import"
            disabled={props.busy || unavailable || viewModel.mode !== "project"}
            onPress={() => void props.onImport()}
          />
          <ActionButton
            label="Export"
            disabled={props.busy || unavailable}
            onPress={() => void props.onExport()}
          />
          <ActionButton
            label="Clear"
            destructive
            disabled={props.busy || unavailable || viewModel.mode !== "project"}
            onPress={() =>
              Alert.alert(
                "Clear project memory?",
                "This deletes the current project memory content and cannot be undone.",
                projectMemoryClearActions(props.onClear),
              )
            }
          />
          <ActionButton
            label="Save"
            disabled={!editable || content === viewModel.content}
            onPress={() => void props.onSaveContent(content)}
          />
        </View>
      </View>
    </SettingsSection>
  );
}
