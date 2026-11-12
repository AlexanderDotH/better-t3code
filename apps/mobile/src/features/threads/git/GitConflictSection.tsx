import type {
  EnvironmentId,
  GitChangesDiffResult,
  ProjectReadFileResult,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { AppText } from "../../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { projectEnvironment } from "../../../state/projects";
import { useEnvironmentQuery } from "../../../state/query";
import { WorkspaceFileEditor } from "../../files/WorkspaceFileEditor";
import { deriveConflictState } from "./git-workbench-model";
import { WorkbenchButton } from "./WorkbenchControls";

export function GitConflictSection(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly diff: GitChangesDiffResult;
  readonly canWrite: boolean;
  readonly onResolve: () => void;
  readonly onSaved: () => void;
}) {
  const t = useMobileInterfaceTranslator();
  const [editing, setEditing] = useState<ProjectReadFileResult | null>(null);
  const file = useEnvironmentQuery(
    projectEnvironment.readFile({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, relativePath: props.diff.path, allowMissing: true },
    }),
  );
  const refreshFile = file.refresh;
  const refreshedSnapshot = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Re-read the host file when its repository snapshot changes during conflict resolution.
  useEffect(() => {
    if (refreshedSnapshot.current === props.diff.stateToken) return;
    refreshedSnapshot.current = props.diff.stateToken;
    refreshFile();
  }, [props.diff.stateToken, refreshFile]);
  const conflict = deriveConflictState(file.data?.contents ?? null, file.data?.truncated ?? true);
  return (
    <View className="gap-3">
      <AppText className="text-sm text-amber-600">
        {t.message("mobile.gitParity.conflictMarkers")}
      </AppText>
      {(["base", "ours", "theirs"] as const).map((side) => (
        <View key={side} className="gap-1">
          <AppText className="text-xs font-t3-semibold text-foreground">
            {t.message(`git.common.${side}`)}
          </AppText>
          <ScrollView nestedScrollEnabled style={{ maxHeight: 180 }}>
            <AppText selectable className="font-mono text-xs text-foreground">
              {props.diff.conflictVersions?.[side] ?? t.message("git.workbench.versionUnavailable")}
            </AppText>
          </ScrollView>
        </View>
      ))}
      {file.error ? <AppText className="text-red-500">{file.error}</AppText> : null}
      {file.data?.exists === false ? (
        <AppText className="text-sm text-foreground-muted">
          {t.message("mobile.gitParity.deletedConflict")}
        </AppText>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <WorkbenchButton
          label={t.message("mobile.gitParity.edit")}
          disabled={!file.data || file.data.truncated || !file.data.revision}
          onPress={() => setEditing(file.data)}
        />
        <WorkbenchButton
          label={t.message("mobile.gitParity.resolve")}
          disabled={!props.canWrite || !conflict.canResolve || file.isPending}
          onPress={props.onResolve}
        />
      </View>
      {editing ? (
        <WorkspaceFileEditor
          {...props}
          path={props.diff.path}
          file={file.data ?? editing}
          initialFile={editing}
          onRefresh={file.refresh}
          onClose={() => setEditing(null)}
          onSaved={props.onSaved}
        />
      ) : null}
    </View>
  );
}
