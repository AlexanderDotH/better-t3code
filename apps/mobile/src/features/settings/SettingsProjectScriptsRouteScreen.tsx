import { useState } from "react";
import { View } from "react-native";
import { type StaticScreenProps } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthSettingsWriteScope, ProjectScriptIcon, type ProjectScript } from "@t3tools/contracts";
import { clearProjectSettingsOverrides } from "@t3tools/shared/projectSettings";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useProjects } from "../../state/entities";
import { useEnvironmentsWithScope } from "../../state/session";
import { uuidv4 } from "../../lib/uuid";
import { ProjectSettingsField, ProjectSettingsSelect } from "./ProjectSettingsFields";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import { managedSettingReason, resolveMobileSettingsTargets } from "./settings-scoped-server";
import { useSettingsWriter } from "./useSettingsWriter";
import { parseProjectScript, upsertProjectScript } from "./project-editor-settings";

export type ProjectScriptsSettingsRouteParams = {
  readonly environmentId?: string;
  readonly projectId?: string;
};

export function SettingsProjectScriptsRouteScreen(
  props: StaticScreenProps<ProjectScriptsSettingsRouteParams | undefined>,
) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const filter = useSettingsEnvironmentFilter();
  const projects = useProjects();
  const params = props.route.params;
  const scopedProject = filter.projectGroups.find(
    (group) => group.key === filter.selectedProjectKey,
  );
  const environments = params?.environmentId
    ? filter.availableTargets.filter((target) => target.environmentId === params.environmentId)
    : filter.selectedTargets;
  const projectSelected =
    params?.projectId !== undefined ||
    (!params?.environmentId && filter.selectedProjectKey !== null);
  const members = params?.projectId
    ? projects.filter(
        (project) =>
          project.id === params.projectId &&
          (params.environmentId === undefined || project.environmentId === params.environmentId),
      )
    : (scopedProject?.members.map((member) => member.project) ?? []);
  const targets = resolveMobileSettingsTargets(environments, projectSelected ? members : null);
  const targetsKey = targets
    .map((target) => `${target.environment.environmentId}:${target.projectId}`)
    .join(",");
  const writable = useEnvironmentsWithScope(environments, AuthSettingsWriteScope);
  const write = useSettingsWriter();
  const [pending, setPending] = useState(false);
  const [editor, setEditor] = useState<{
    readonly targetsKey: string;
    readonly script: ProjectScript;
  } | null>(null);
  const editing = editor?.targetsKey === targetsKey ? editor.script : null;
  const setEditing = (script: ProjectScript | null) =>
    setEditor(script === null ? null : { targetsKey, script });
  const disabled =
    pending ||
    targets.length === 0 ||
    targets.some((target) => !writable.has(target.environment.environmentId)) ||
    managedSettingReason(targets, "defaultProjectScripts") !== undefined;
  const scriptsFor = (target: (typeof targets)[number]) => {
    const project = members.find(
      (member) =>
        member.id === target.projectId && member.environmentId === target.environment.environmentId,
    );
    return project
      ? resolveProjectScripts(target.environment.serverConfig.settings, project)
      : target.settings.defaultProjectScripts;
  };
  const scripts = targets[0] ? scriptsFor(targets[0]) : [];
  const persist = async (
    transform: (scripts: readonly ProjectScript[]) => readonly ProjectScript[] | null,
  ) => {
    if (disabled) return;
    const writes = targets.map((target) => {
      const next = transform(scriptsFor(target));
      const settings = target.environment.serverConfig.settings;
      return {
        environmentId: target.environment.environmentId,
        patch: target.projectId
          ? {
              projectSettingsOverrides: {
                [target.projectId]:
                  next === null
                    ? clearProjectSettingsOverrides(settings, target.projectId, [
                        "defaultProjectScripts",
                      ])
                    : {
                        ...settings.projectSettingsOverrides[target.projectId],
                        defaultProjectScripts: next,
                      },
              },
            }
          : { defaultProjectScripts: next ?? [] },
      };
    });
    setPending(true);
    await (async () => {
      if (await write(targets, writes)) setEditing(null);
    })().finally(() => {
      setPending(false);
    });
  };
  return (
    <>
      {params?.environmentId === undefined ? <SettingsEnvironmentFilterHeader /> : null}
      <SettingsScreen
        title={translator.message("mobile.projects.scripts.title")}
        trailing={
          params?.environmentId === undefined ? <AndroidSettingsEnvironmentFilter /> : undefined
        }
      >
        <ScreenScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          <SettingsSection
            title={translator.message("mobile.projects.scripts.title")}
            footer={managedSettingReason(targets, "defaultProjectScripts")}
          >
            {targets.some(
              (target) => JSON.stringify(scriptsFor(target)) !== JSON.stringify(scripts),
            ) ? (
              <AppText className="p-4 text-foreground-muted">
                {translator.message("mobile.projects.scripts.mixed")}
              </AppText>
            ) : null}
            {scripts.map((script) => (
              <SettingsRow
                key={script.id}
                icon="terminal"
                label={script.name}
                value={script.command}
                disabled={disabled}
                onPress={() => setEditing(script)}
              />
            ))}
            <View className="flex-row flex-wrap gap-2 p-4">
              <Button
                label={translator.message("mobile.projects.scripts.add")}
                disabled={disabled}
                onPress={() =>
                  setEditing({
                    id: `script-${uuidv4()}`,
                    name: "",
                    command: "",
                    icon: "play",
                    runOnWorktreeCreate: false,
                  })
                }
              />
              {projectSelected ? (
                <Button
                  label={translator.message("mobile.projects.scripts.inherit")}
                  disabled={disabled}
                  tone="text"
                  onPress={() => void persist(() => null)}
                />
              ) : null}
            </View>
          </SettingsSection>
          {editing ? (
            <ProjectScriptSettingsEditor
              key={`${targetsKey}:${editing.id}`}
              script={editing}
              disabled={disabled}
              onSave={(script) => void persist((current) => upsertProjectScript(current, script))}
              onDelete={
                scripts.some((script) => script.id === editing.id)
                  ? () =>
                      void persist((current) =>
                        current.filter((script) => script.id !== editing.id),
                      )
                  : undefined
              }
              onClose={() => setEditing(null)}
            />
          ) : null}
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}

function ProjectScriptSettingsEditor(props: {
  readonly script: ProjectScript;
  readonly disabled: boolean;
  readonly onSave: (script: ProjectScript) => void;
  readonly onDelete?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [draft, setDraft] = useState(props.script);
  const parsed = parseProjectScript(draft);
  return (
    <SettingsSection title={translator.message("mobile.projects.scripts.edit")}>
      <ProjectSettingsField
        label={translator.message("mobile.projects.scripts.name")}
        value={draft.name}
        disabled={props.disabled}
        onChange={(name) => setDraft({ ...draft, name })}
      />
      <ProjectSettingsSelect
        label={translator.message("mobile.projects.scripts.icon")}
        value={draft.icon}
        options={ProjectScriptIcon.literals.map((value) => ({
          value,
          label: translator.message(`mobile.projects.scripts.icon.${value}`),
        }))}
        disabled={props.disabled}
        onChange={(icon) => setDraft({ ...draft, icon })}
      />
      <ProjectSettingsField
        label={translator.message("mobile.projects.scripts.command")}
        multiline
        value={draft.command}
        disabled={props.disabled}
        onChange={(command) => setDraft({ ...draft, command })}
      />
      <ProjectSettingsField
        label={translator.message("mobile.projects.scripts.previewUrl")}
        value={draft.previewUrl ?? ""}
        disabled={props.disabled}
        onChange={(previewUrl) => setDraft({ ...draft, previewUrl })}
      />
      {(["runOnWorktreeCreate", "async", "runOnSettle", "autoOpenPreview"] as const).map((key) => (
        <SettingsSwitchRow
          key={key}
          icon="terminal"
          label={translator.message(`mobile.projects.scripts.${key}`)}
          value={key === "async" ? draft.async !== false : draft[key] === true}
          disabled={props.disabled || (key === "autoOpenPreview" && !draft.previewUrl?.trim())}
          onValueChange={(value) => setDraft({ ...draft, [key]: value })}
        />
      ))}
      <View className="gap-3 p-4">
        {parsed === null ? (
          <AppText className="text-sm text-danger">
            {translator.message("mobile.projects.scripts.invalid")}
          </AppText>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={translator.message("mobile.projects.save")}
            disabled={props.disabled || parsed === null}
            tone="primary"
            onPress={() => {
              if (parsed) props.onSave(parsed);
            }}
          />
          <Button
            label={translator.message("common.cancel")}
            disabled={props.disabled}
            tone="text"
            onPress={props.onClose}
          />
          {props.onDelete ? (
            <Button
              label={translator.message("mobile.projects.delete")}
              disabled={props.disabled}
              tone="danger"
              onPress={props.onDelete}
            />
          ) : null}
        </View>
      </View>
    </SettingsSection>
  );
}
