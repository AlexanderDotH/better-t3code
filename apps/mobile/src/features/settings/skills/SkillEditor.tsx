import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, SkillDescriptor } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { agentSettingsEnvironment } from "../../../state/agent-settings";
import { skillMutationTarget } from "../environment-agent-settings";
import { ManagementError, ManagementField, ManagementScopeFields } from "../mcp/ManagementFields";
import type { ManagementScope } from "../mcp/mcp-form";
import { useManagementCommand, useManagementTask } from "../mcp/useManagementCommand";
import {
  skillCreateFromDraft,
  skillDraftFromDescriptor,
  skillUpdateFromDraft,
  validateSkillDraft,
} from "./skill-form";

export function SkillEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly skill: SkillDescriptor | null;
  readonly initialScope: ManagementScope;
  readonly projects: readonly EnvironmentProject[];
  readonly onSaved: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [skill, setSkill] = useState(props.skill);
  const [draft, setDraft] = useState(() => skillDraftFromDescriptor(props.skill));
  const [scope, setScope] = useState(props.initialScope);
  const create = useManagementCommand(agentSettingsEnvironment.skills.create);
  const update = useManagementCommand(agentSettingsEnvironment.skills.update);
  const rename = useManagementCommand(agentSettingsEnvironment.skills.rename);
  const canSave = useAtomValue(
    (skill
      ? agentSettingsEnvironment.skills.update
      : agentSettingsEnvironment.skills.create
    ).permissionAtom(props.environmentId),
  );
  const canRename = useAtomValue(
    agentSettingsEnvironment.skills.rename.permissionAtom(props.environmentId),
  );
  const task = useManagementTask();
  const disabled = task.pending || !canSave || skill?.readOnly === true;
  return (
    <View className="gap-5">
      {!skill ? (
        <ManagementScopeFields
          value={scope}
          projects={props.projects}
          onChange={setScope}
          disabled={disabled}
        />
      ) : (
        <AppText className="text-sm text-foreground-muted">
          {skill.scope === "project"
            ? skill.projectCwd
            : translator.message("settings.skills.global")}
        </AppText>
      )}
      <ManagementField
        label={translator.message("settings.skills.name")}
        value={draft.name}
        disabled={disabled || (skill !== null && !canRename)}
        onChangeText={(name) => setDraft({ ...draft, name })}
      />
      <ManagementField
        label={translator.message("settings.skills.description")}
        value={draft.description}
        disabled={disabled}
        onChangeText={(description) => setDraft({ ...draft, description })}
        multiline
      />
      <ManagementField
        label={translator.message("settings.skills.displayName")}
        value={draft.displayName}
        disabled={disabled}
        onChangeText={(displayName) => setDraft({ ...draft, displayName })}
      />
      <ManagementField
        label={translator.message("settings.skills.shortDescription")}
        value={draft.shortDescription}
        disabled={disabled}
        onChangeText={(shortDescription) => setDraft({ ...draft, shortDescription })}
      />
      <ManagementField
        label={translator.message("settings.skills.instructions")}
        value={draft.body}
        disabled={disabled}
        onChangeText={(body) => setDraft({ ...draft, body })}
        multiline
      />
      <ManagementError message={task.error} />
      <Button
        label={translator.message("settings.skills.save")}
        tone="primary"
        loading={task.pending}
        disabled={disabled}
        onPress={() =>
          void task.run(async () => {
            const contents = validateSkillDraft(draft);
            if (!skill) {
              const result = await create({
                environmentId: props.environmentId,
                input: skillCreateFromDraft(draft, scope),
              });
              if (result) props.onSaved();
              return;
            }
            let currentSkill = skill;
            if (contents.name !== skill.name) {
              const renamed = await rename({
                environmentId: props.environmentId,
                input: { target: skillMutationTarget(skill), newName: contents.name },
              });
              if (!renamed) return;
              currentSkill = renamed.skill;
              setSkill(currentSkill);
            }
            const result = await update({
              environmentId: props.environmentId,
              input: skillUpdateFromDraft(draft, currentSkill),
            });
            if (result) props.onSaved();
          })
        }
      />
    </View>
  );
}
