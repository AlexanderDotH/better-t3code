import type {
  EnvironmentId,
  GitChangeSelection,
  GitChangesDiffResult,
  GitWorkbenchFile,
  ThreadId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText";
import { gitWorkbenchEnvironment } from "../../../state/git-workbench";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import { gitWorkbenchChangeRows, type GitWorkbenchChangeRow } from "./git-workbench-changes";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { buildChangeSelectionInput, resolveChangeSelection } from "./git-workbench-model";
import { GitPatchView } from "./GitPatchView";
import { GitHistorySection } from "./GitHistorySection";
import { GitConflictSection } from "./GitConflictSection";
import { WorkbenchButton, WorkbenchCard } from "./WorkbenchControls";
import { GitOperationsSection } from "./GitOperationsSection";
import { useWorkbenchFileNavigation } from "./use-workbench-file-navigation";

function fileStatusLabel(row: GitWorkbenchChangeRow<GitWorkbenchFile>, t: InterfaceTranslator) {
  if (row.file.conflicted) return t.message("mobile.git.conflict");
  if (row.file.untracked) return t.message("mobile.git.untracked");
  return t.message(
    row.source === "staged" ? "mobile.git.stagedKind" : "mobile.git.workingTreeKind",
    { kind: row.file.kind },
  );
}

export function GitWorkbenchSection(props: {
  readonly enabled: boolean;
  readonly canWrite: boolean;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly threadId?: ThreadId;
}) {
  const t = useMobileInterfaceTranslator();
  const openFile = useWorkbenchFileNavigation(props);
  const workbench = useEnvironmentQuery(
    props.enabled && props.cwd
      ? gitWorkbenchEnvironment.workbench({
          environmentId: props.environmentId,
          input: { cwd: props.cwd },
        })
      : null,
  );
  const snapshot = workbench.data?.snapshot ?? null;
  const rows = useMemo(() => gitWorkbenchChangeRows(snapshot), [snapshot]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const diff = useEnvironmentQuery(
    props.cwd && snapshot && selected
      ? gitWorkbenchEnvironment.changesDiff({
          environmentId: props.environmentId,
          input: {
            cwd: props.cwd,
            path: selected.file.path,
            source: selected.source,
            expectedStateToken: snapshot.stateToken,
          },
        })
      : null,
  );
  const canApply = useAtomValue(
    gitWorkbenchEnvironment.applyChangeSelection.permissionAtom(props.environmentId),
  );
  const applySelection = useAtomCommand(gitWorkbenchEnvironment.applyChangeSelection, {
    reportFailure: false,
  });
  const refreshWorkbench = useAtomCommand(gitWorkbenchEnvironment.refresh, {
    reportFailure: false,
  });
  const [applying, setApplying] = useState(false);
  const [selectionState, setSelectionState] = useState<{
    readonly patchKey: string;
    readonly targetKey: string;
    readonly selection: GitChangeSelection;
  } | null>(null);
  const targetKey = JSON.stringify([props.environmentId, props.cwd, selectedId]);
  const patchKey = JSON.stringify([targetKey, diff.data?.patchId]);
  const selection = resolveChangeSelection(selectionState, targetKey, patchKey);
  const [lastDiff, setLastDiff] = useState<{
    readonly targetKey: string;
    readonly data: GitChangesDiffResult;
  } | null>(null);
  if (
    diff.data &&
    selected &&
    diff.data.path === selected.file.path &&
    diff.data.source === selected.source &&
    lastDiff?.data !== diff.data
  )
    setLastDiff({ targetKey, data: diff.data });
  const displayDiff = lastDiff?.targetKey === targetKey ? lastDiff.data : null;
  const [tab, setTab] = useState<"changes" | "history" | "operations">("changes");
  const diffReady =
    selected &&
    diff.data &&
    diff.data.path === selected.file.path &&
    diff.data.source === selected.source &&
    diff.data.stateToken === snapshot?.stateToken;
  const selectionReady =
    diffReady && !diff.data?.truncated && (selection.kind === "file" || selection.ids.length > 0);
  const refresh = () => {
    if (props.cwd)
      void refreshWorkbench({ environmentId: props.environmentId, input: { cwd: props.cwd } });
    diff.refresh();
  };
  const apply = async (action: "stage" | "unstage" | "discard", selectedChange = selection) => {
    if (
      !props.canWrite ||
      !canApply ||
      !props.cwd ||
      !selected ||
      !snapshot ||
      !diff.data ||
      !diffReady ||
      applying
    )
      return;
    const input = buildChangeSelectionInput(
      props.cwd,
      diff.data,
      action,
      selectedChange,
      snapshot.stateToken,
      selected.file.untracked,
    );
    if (!input) {
      diff.refresh();
      return;
    }
    setApplying(true);
    const result = await applySelection({ environmentId: props.environmentId, input });
    setApplying(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Alert.alert(
        t.message("mobile.git.updateFailed"),
        error instanceof Error ? error.message : String(error),
      );
    }
    if (result._tag === "Success") setSelectionState(null);
    refresh();
  };
  if (!props.enabled) return null;
  if (!snapshot || !props.cwd)
    return (
      <WorkbenchCard title={t.message("mobile.git.workbench")}>
        <Text className="text-sm text-foreground-muted">
          {workbench.error ?? t.message("mobile.git.loadingWorkbench")}
        </Text>
      </WorkbenchCard>
    );
  const cwd = props.cwd;
  if (!snapshot.isRepository)
    return (
      <WorkbenchCard title={t.message("mobile.git.notRepository")}>
        <Text className="text-sm text-foreground-muted">
          {t.message("mobile.git.notRepositoryDetail")}
        </Text>
      </WorkbenchCard>
    );
  return (
    <View className="gap-3">
      <WorkbenchCard title={t.message("mobile.git.workbench")}>
        <Text className="text-sm text-foreground-muted">
          {snapshot.refName ?? "HEAD"} · {t.message("mobile.git.fileCounts", snapshot.totals)} · +
          {snapshot.totals.insertions} −{snapshot.totals.deletions}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {(["changes", "history", "operations"] as const).map((value) => (
            <WorkbenchButton
              key={value}
              selected={tab === value}
              label={t.message(
                value === "changes"
                  ? "mobile.git.changes"
                  : value === "history"
                    ? "mobile.git.recentHistory"
                    : "git.operation.chooseAdvancedAction",
              )}
              onPress={() => setTab(value)}
            />
          ))}
        </View>
      </WorkbenchCard>
      {tab === "changes" ? (
        <WorkbenchCard title={t.message("mobile.git.changes")}>
          {rows.length === 0 ? (
            <Text className="text-sm text-foreground-muted">{t.message("mobile.git.clean")}</Text>
          ) : (
            rows.map((row) => (
              <View key={row.id} className="gap-3 border-t border-border-subtle py-3">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSelectedId(selected?.id === row.id ? null : row.id)}
                  className="gap-1"
                >
                  <Text className="text-sm font-t3-medium text-foreground">{row.file.path}</Text>
                  <Text className="text-xs text-foreground-muted">{fileStatusLabel(row, t)}</Text>
                </Pressable>
                {selected?.id === row.id ? (
                  <View className="gap-3">
                    {row.file.conflicted && displayDiff ? (
                      <GitConflictSection
                        key={row.file.path}
                        environmentId={props.environmentId}
                        cwd={cwd}
                        diff={displayDiff}
                        canWrite={props.canWrite && canApply && !applying && !!diffReady}
                        onResolve={() => void apply("stage", { kind: "file" })}
                        onSaved={refresh}
                      />
                    ) : null}
                    {diff.error ? (
                      <Text className="text-sm text-red-500">{diff.error}</Text>
                    ) : !diffReady || !diff.data ? (
                      <Text>{t.message("mobile.review.loadingDiff")}</Text>
                    ) : (
                      <>
                        <GitPatchView
                          allowPartial={
                            !row.file.conflicted && !row.file.submodule && !row.file.modeChanged
                          }
                          diff={diff.data}
                          selection={selection}
                          onSelectionChange={(next) =>
                            setSelectionState({ patchKey, targetKey, selection: next })
                          }
                        />
                      </>
                    )}
                    <View className="flex-row flex-wrap gap-2">
                      {row.file.kind !== "deleted" ? (
                        <WorkbenchButton
                          label={t.message("git.history.openCurrent")}
                          onPress={() => openFile(row.file.path)}
                        />
                      ) : null}
                      {row.source === "staged" ? (
                        <WorkbenchButton
                          disabled={!props.canWrite || !canApply || !selectionReady || applying}
                          label={t.message("mobile.git.unstage")}
                          onPress={() => void apply("unstage")}
                        />
                      ) : (
                        <>
                          <WorkbenchButton
                            disabled={
                              !props.canWrite ||
                              !canApply ||
                              !selectionReady ||
                              applying ||
                              row.file.conflicted
                            }
                            label={t.message("mobile.git.stage")}
                            onPress={() => void apply("stage")}
                          />
                          <WorkbenchButton
                            destructive
                            disabled={
                              !props.canWrite ||
                              !canApply ||
                              !selectionReady ||
                              (row.file.untracked && selection.kind !== "file") ||
                              applying ||
                              row.file.conflicted
                            }
                            label={t.message("mobile.git.discard")}
                            onPress={() =>
                              Alert.alert(
                                t.message(
                                  row.file.untracked
                                    ? "mobile.git.deleteUntrackedTitle"
                                    : "mobile.git.discardTitle",
                                ),
                                `${row.file.path}${selection.kind === "file" ? "" : ` · ${t.message("mobile.gitParity.selectionCount", { count: selection.ids.length })}`}`,
                                [
                                  { text: t.message("common.cancel"), style: "cancel" },
                                  {
                                    text: t.message("mobile.git.discard"),
                                    style: "destructive",
                                    onPress: () => void apply("discard"),
                                  },
                                ],
                              )
                            }
                          />
                        </>
                      )}
                    </View>
                  </View>
                ) : null}
              </View>
            ))
          )}
          {snapshot.truncated ? (
            <Text className="text-xs text-amber-600">{t.message("git.diff.patchTruncated")}</Text>
          ) : null}
        </WorkbenchCard>
      ) : tab === "history" ? (
        <GitHistorySection
          environmentId={props.environmentId}
          cwd={cwd}
          threadId={props.threadId}
        />
      ) : (
        <GitOperationsSection
          environmentId={props.environmentId}
          cwd={cwd}
          snapshot={snapshot}
          projection={workbench.data!}
          threadId={props.threadId}
          canWrite={props.canWrite}
          onRefresh={refresh}
        />
      )}
    </View>
  );
}
