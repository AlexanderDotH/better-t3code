import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { AgentImportSource, McpProviderRouting, ServerProvider } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText, AppTextInput } from "../../../components/ui/AppText";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { ThemedSwitch } from "../../../components/ui/ThemedSwitch";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import type { ManagementScope } from "./mcp-form";

export function ManagementField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly multiline?: boolean;
  readonly secureTextEntry?: boolean;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}) {
  return (
    <View className="gap-2">
      <AppText className="text-sm font-t3-medium text-foreground">{props.label}</AppText>
      <AppTextInput
        accessibilityLabel={props.label}
        value={props.value}
        editable={!props.disabled}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={props.multiline}
        secureTextEntry={props.secureTextEntry}
        textAlignVertical={props.multiline ? "top" : "center"}
        className="rounded-xl border border-border-subtle bg-subtle px-3 py-3 text-base text-foreground"
        style={props.multiline ? { minHeight: 144 } : undefined}
      />
    </View>
  );
}

export function ManagementToggle(props: {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
  readonly disabled?: boolean;
}) {
  return (
    <View className="min-h-12 flex-row items-center justify-between gap-3">
      <AppText className="min-w-0 flex-1 text-base text-foreground">{props.label}</AppText>
      <ThemedSwitch
        accessibilityLabel={props.label}
        value={props.value}
        disabled={props.disabled}
        onValueChange={props.onChange}
      />
    </View>
  );
}

export function ManagementChoices<Value extends string>(props: {
  readonly label: string;
  readonly value: Value;
  readonly choices: readonly { readonly value: Value; readonly label: string }[];
  readonly onChange: (value: Value) => void;
  readonly disabled?: boolean;
}) {
  return (
    <View className="gap-2">
      <AppText className="text-sm font-t3-medium text-foreground">{props.label}</AppText>
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
        {props.choices.map((choice) => (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityLabel={choice.label}
            accessibilityState={{ checked: props.value === choice.value, disabled: props.disabled }}
            disabled={props.disabled}
            onPress={() => props.onChange(choice.value)}
            className={
              props.value === choice.value
                ? "min-h-12 justify-center rounded-xl bg-primary px-4 py-2"
                : "min-h-12 justify-center rounded-xl bg-subtle px-4 py-2"
            }
          >
            <AppText
              className={
                props.value === choice.value ? "text-primary-foreground" : "text-foreground"
              }
            >
              {choice.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ManagementScopeFields(props: {
  readonly value: ManagementScope;
  readonly projects: readonly EnvironmentProject[];
  readonly onChange: (value: ManagementScope) => void;
  readonly disabled?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="gap-4">
      <ManagementChoices
        label={translator.message("settings.mcp.editor.scope")}
        value={props.value.scope}
        choices={[
          { value: "global", label: translator.message("settings.mcp.editor.global") },
          { value: "project", label: translator.message("settings.mcp.editor.project") },
        ]}
        disabled={props.disabled}
        onChange={(scope) => {
          const project = !props.value.projectCwd && scope === "project" ? props.projects[0] : null;
          props.onChange(
            project
              ? { scope, projectId: project.id, projectCwd: project.workspaceRoot }
              : { ...props.value, scope },
          );
        }}
      />
      {props.value.scope === "project" ? (
        <>
          {props.projects.length > 0 ? (
            <ManagementChoices
              label={translator.message("settings.mcp.editor.project")}
              value={props.value.projectId}
              choices={props.projects.map((project) => ({
                value: project.id,
                label: project.title,
              }))}
              disabled={props.disabled}
              onChange={(projectId) => {
                const project = props.projects.find((entry) => entry.id === projectId);
                if (project)
                  props.onChange({
                    scope: "project",
                    projectId,
                    projectCwd: project.workspaceRoot,
                  });
              }}
            />
          ) : null}
          <ManagementField
            label={translator.message("mobile.mcp.projectDirectory")}
            value={props.value.projectCwd}
            disabled={props.disabled}
            onChangeText={(projectCwd) =>
              props.onChange({ ...props.value, projectCwd, projectId: "" })
            }
          />
          <ManagementField
            label={translator.message("mobile.mcp.projectIdentifier")}
            value={props.value.projectId}
            disabled={props.disabled}
            onChangeText={(projectId) => props.onChange({ ...props.value, projectId })}
          />
        </>
      ) : null}
    </View>
  );
}

export function McpProviderRoutingFields(props: {
  readonly value: McpProviderRouting;
  readonly providers: readonly ServerProvider[];
  readonly onChange: (routing: McpProviderRouting) => void;
  readonly disabled?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const selectedIds = props.value.mode === "selected" ? props.value.instanceIds : [];
  const providers = props.providers.map((provider) => ({
    id: provider.instanceId,
    label: provider.displayName ?? provider.instanceId,
  }));
  const missingIds = selectedIds.filter((id) => !providers.some((provider) => provider.id === id));
  return (
    <View className="gap-2">
      <ManagementToggle
        label={translator.message("settings.mcp.import.allAccounts")}
        value={props.value.mode === "all"}
        disabled={props.disabled}
        onChange={(enabled) =>
          props.onChange(enabled ? { mode: "all" } : { mode: "selected", instanceIds: [] })
        }
      />
      {props.value.mode === "selected"
        ? [...providers, ...missingIds.map((id) => ({ id, label: id }))].map((provider) => (
            <ManagementToggle
              key={provider.id}
              label={provider.label}
              value={selectedIds.includes(provider.id)}
              disabled={props.disabled}
              onChange={(enabled) =>
                props.onChange({
                  mode: "selected",
                  instanceIds: enabled
                    ? [...selectedIds, provider.id]
                    : selectedIds.filter((id) => id !== provider.id),
                })
              }
            />
          ))
        : null}
    </View>
  );
}

export function ManagementImportSources(props: {
  readonly sources: readonly AgentImportSource[];
  readonly selectedIds: readonly string[];
  readonly kind: "mcp" | "skills";
  readonly onChange: (ids: readonly string[]) => void;
  readonly disabled?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="gap-3">
      {props.sources.length === 0 ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("settings.skills.noSources")}
        </AppText>
      ) : (
        props.sources.map((source) => {
          const count = props.kind === "mcp" ? source.mcpServerCount : source.skillCount;
          return (
            <View key={source.id} className="rounded-xl border border-border-subtle p-3">
              <ManagementToggle
                label={`${source.label} (${count})`}
                disabled={props.disabled || count === 0}
                value={props.selectedIds.includes(source.id)}
                onChange={(selected) =>
                  props.onChange(
                    selected
                      ? [...props.selectedIds, source.id]
                      : props.selectedIds.filter((id) => id !== source.id),
                  )
                }
              />
              <AppText className="text-xs text-foreground-muted" selectable>
                {source.path}
              </AppText>
              {source.message ? (
                <AppText className="text-sm text-foreground-muted">{source.message}</AppText>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

export function ManagementError({ message }: { readonly message: string | null }) {
  return message ? (
    <View className="flex-row gap-2 rounded-xl bg-danger-subtle p-3" accessibilityRole="alert">
      <SymbolView name="exclamationmark.triangle" size={18} tintColorClassName="accent-danger" />
      <AppText className="min-w-0 flex-1 text-sm text-danger">{message}</AppText>
    </View>
  ) : null;
}
