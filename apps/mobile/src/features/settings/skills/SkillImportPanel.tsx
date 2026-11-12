import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { agentSettingsEnvironment } from "../../../state/agent-settings";
import { useEnvironmentQuery } from "../../../state/query";
import {
  ManagementError,
  ManagementImportSources,
  ManagementScopeFields,
  ManagementToggle,
} from "../mcp/ManagementFields";
import { managementScopeInput, type ManagementScope } from "../mcp/mcp-form";
import { useManagementCommand, useManagementTask } from "../mcp/useManagementCommand";

export function SkillImportPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly initialScope: ManagementScope;
  readonly projects: readonly EnvironmentProject[];
  readonly onImported: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [scope, setScope] = useState(props.initialScope);
  const [selection, setSelection] = useState<readonly string[] | null>(null);
  const [deduplicate, setDeduplicate] = useState(true);
  const sources = useEnvironmentQuery(
    agentSettingsEnvironment.skills.importSourcesQuery({
      environmentId: props.environmentId,
      input: {},
    }),
  );
  const selectedIds =
    selection ??
    sources.data?.sources.filter((source) => source.skillCount > 0).map((source) => source.id) ??
    [];
  const importSources = useManagementCommand(agentSettingsEnvironment.skills.importSources);
  const allowed = useAtomValue(
    agentSettingsEnvironment.skills.importSources.permissionAtom(props.environmentId),
  );
  const task = useManagementTask();
  const disabled = task.pending || !allowed;
  return (
    <View className="gap-5">
      <ManagementScopeFields
        value={scope}
        projects={props.projects}
        onChange={setScope}
        disabled={disabled}
      />
      {sources.isPending ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("settings.skills.scanning")}
        </AppText>
      ) : null}
      <ManagementImportSources
        kind="skills"
        sources={sources.data?.sources ?? []}
        selectedIds={selectedIds}
        onChange={setSelection}
        disabled={disabled}
      />
      <ManagementError message={sources.error} />
      <Button
        label={translator.message("settings.skills.refresh")}
        onPress={sources.refresh}
        disabled={disabled}
      />
      <ManagementToggle
        label={translator.message("settings.skills.deduplicate")}
        value={deduplicate}
        onChange={setDeduplicate}
        disabled={disabled}
      />
      <ManagementError message={task.error} />
      <Button
        label={translator.message("settings.skills.import")}
        tone="primary"
        loading={task.pending}
        disabled={disabled || selectedIds.length === 0}
        onPress={() =>
          void task.run(async () => {
            const result = await importSources({
              environmentId: props.environmentId,
              input: { ...managementScopeInput(scope), sourceIds: selectedIds, deduplicate },
            });
            if (result) props.onImported();
          })
        }
      />
    </View>
  );
}
