import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, SkillDescriptor } from "@t3tools/contracts";
import { useState } from "react";
import { Alert, View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { ListRow } from "../../../components/ui/ListRow";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { agentSettingsEnvironment } from "../../../state/agent-settings";
import { useProjects } from "../../../state/entities";
import { useEnvironmentQuery } from "../../../state/query";
import { SettingsSection } from "../components/SettingsSection";
import { skillMutationTarget } from "../environment-agent-settings";
import { ManagementError, ManagementScopeFields, ManagementToggle } from "../mcp/ManagementFields";
import { ManagementSheet } from "../mcp/ManagementSheet";
import { EMPTY_MANAGEMENT_SCOPE, type ManagementScope } from "../mcp/mcp-form";
import { useManagementCommand, useManagementTask } from "../mcp/useManagementCommand";
import { SkillEditor } from "./SkillEditor";
import { SkillImportPanel } from "./SkillImportPanel";

type SkillsPage =
  | { readonly kind: "list" | "import" }
  | { readonly kind: "editor"; readonly skill: SkillDescriptor | null };

export function SkillsSettingsEntry(props: { readonly environmentId: EnvironmentId }) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection title={translator.message("mobile.settings.agents.skills")}>
      <ListRow
        label={translator.message("mobile.mcp.manageSkills")}
        icon="sparkles"
        onPress={() => setOpen(true)}
      />
      {open ? (
        <SkillsManagementScreen
          environmentId={props.environmentId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </SettingsSection>
  );
}

function SkillsManagementScreen(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const [scope, setScope] = useState<ManagementScope>(EMPTY_MANAGEMENT_SCOPE);
  const [page, setPage] = useState<SkillsPage>({ kind: "list" });
  const skills = useEnvironmentQuery(
    scope.scope === "global" || scope.projectCwd.trim()
      ? agentSettingsEnvironment.skills.listQuery({
          environmentId: props.environmentId,
          input: {
            includeBody: true,
            forceReload: true,
            ...(scope.scope === "project"
              ? {
                  projectCwd: scope.projectCwd.trim(),
                  ...(scope.projectId
                    ? { projectId: scope.projectId as SkillDescriptor["projectId"] }
                    : {}),
                }
              : {}),
          },
        })
      : null,
  );
  const visibleSkills = (skills.data?.skills ?? []).filter(
    (skill) =>
      skill.scope === scope.scope || (scope.scope === "global" && skill.scope === "system"),
  );
  const canCreate = useAtomValue(
    agentSettingsEnvironment.skills.create.permissionAtom(props.environmentId),
  );
  const canUpdate = useAtomValue(
    agentSettingsEnvironment.skills.update.permissionAtom(props.environmentId),
  );
  const canDelete = useAtomValue(
    agentSettingsEnvironment.skills.delete.permissionAtom(props.environmentId),
  );
  const canToggle = useAtomValue(
    agentSettingsEnvironment.skills.setEnabled.permissionAtom(props.environmentId),
  );
  const canImport = useAtomValue(
    agentSettingsEnvironment.skills.importSources.permissionAtom(props.environmentId),
  );
  const deleteSkill = useManagementCommand(agentSettingsEnvironment.skills.delete);
  const setEnabled = useManagementCommand(agentSettingsEnvironment.skills.setEnabled);
  const task = useManagementTask();
  const saved = () => {
    skills.refresh();
    setPage({ kind: "list" });
  };
  const title = translator.message(
    page.kind === "editor"
      ? page.skill
        ? "settings.skills.editTitle"
        : "settings.skills.newTitle"
      : page.kind === "import"
        ? "settings.skills.importTitle"
        : "settings.skills.title",
  );
  return (
    <ManagementSheet
      title={title}
      onClose={props.onClose}
      onBack={page.kind === "list" ? undefined : () => setPage({ kind: "list" })}
      busy={task.pending}
    >
      {page.kind === "editor" ? (
        <SkillEditor
          environmentId={props.environmentId}
          skill={page.skill}
          initialScope={scope}
          projects={projects}
          onSaved={saved}
        />
      ) : page.kind === "import" ? (
        <SkillImportPanel
          environmentId={props.environmentId}
          initialScope={scope}
          projects={projects}
          onImported={saved}
        />
      ) : (
        <>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={translator.message("settings.skills.newTitle")}
              icon="plus"
              disabled={!canCreate || task.pending}
              onPress={() => setPage({ kind: "editor", skill: null })}
            />
            <Button
              label={translator.message("settings.skills.import")}
              disabled={!canImport || task.pending}
              onPress={() => setPage({ kind: "import" })}
            />
            <Button
              label={translator.message("settings.skills.refresh")}
              onPress={skills.refresh}
              disabled={task.pending}
            />
          </View>
          <ManagementScopeFields
            value={scope}
            projects={projects}
            onChange={setScope}
            disabled={task.pending}
          />
          <ManagementError message={task.error ?? skills.error} />
          {skills.isPending && skills.data === null ? (
            <AppText className="text-sm text-foreground-muted">
              {translator.message("settings.skills.loading")}
            </AppText>
          ) : visibleSkills.length === 0 ? (
            <AppText className="text-sm text-foreground-muted">
              {translator.message(
                scope.scope === "project" && !scope.projectCwd.trim()
                  ? "settings.skills.selectProjectSave"
                  : "settings.skills.empty",
              )}
            </AppText>
          ) : null}
          {visibleSkills.map((skill) => (
            <View key={skill.id} className="gap-3 rounded-xl border border-border-subtle p-4">
              <AppText className="text-base font-t3-semibold text-foreground">
                {skill.displayName || skill.name}
              </AppText>
              <AppText className="text-sm text-foreground-muted">
                {skill.shortDescription || skill.description || skill.name}
              </AppText>
              <AppText className="text-xs text-foreground-muted" selectable>
                {skill.path}
              </AppText>
              {skill.readOnly ? (
                <AppText className="text-xs text-foreground-muted">
                  {translator.message("settings.skills.readOnly")}
                </AppText>
              ) : null}
              <ManagementToggle
                label={translator.message("settings.mcp.editor.enabled")}
                value={skill.enabled}
                disabled={skill.readOnly || !canToggle || task.pending}
                onChange={(enabled) =>
                  void task.run(async () => {
                    const result = await setEnabled({
                      environmentId: props.environmentId,
                      input: { target: skillMutationTarget(skill), enabled },
                    });
                    if (result) skills.refresh();
                  })
                }
              />
              {!skill.readOnly ? (
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    label={translator.message("settings.mcp.action.edit")}
                    disabled={!canUpdate || task.pending}
                    onPress={() => setPage({ kind: "editor", skill })}
                  />
                  <Button
                    label={translator.message("settings.mcp.action.delete")}
                    tone="danger"
                    disabled={!canDelete || task.pending}
                    onPress={() =>
                      Alert.alert(
                        translator.message("settings.mcp.action.delete"),
                        translator.message("settings.skills.deleteConfirm", { skill: skill.name }),
                        [
                          { text: translator.message("common.cancel"), style: "cancel" },
                          {
                            text: translator.message("settings.mcp.action.delete"),
                            style: "destructive",
                            onPress: () =>
                              void task.run(async () => {
                                const result = await deleteSkill({
                                  environmentId: props.environmentId,
                                  input: { target: skillMutationTarget(skill) },
                                });
                                if (result) skills.refresh();
                              }),
                          },
                        ],
                      )
                    }
                  />
                </View>
              ) : null}
            </View>
          ))}
        </>
      )}
    </ManagementSheet>
  );
}
