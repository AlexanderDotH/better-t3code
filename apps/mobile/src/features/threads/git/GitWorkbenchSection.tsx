import type { EnvironmentId, GitWorkbenchFile } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { gitWorkbenchEnvironment } from "../../../state/git-workbench";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import { gitWorkbenchChangeRows, type GitWorkbenchChangeRow } from "./git-workbench-changes";

function fileStatusLabel(row: GitWorkbenchChangeRow<GitWorkbenchFile>): string {
  if (row.file.conflicted) return "Conflict";
  if (row.file.untracked) return "Untracked";
  if (row.source === "staged") return `Staged · ${row.file.kind}`;
  return `Working tree · ${row.file.kind}`;
}

function WorkbenchButton(props: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className={
        props.destructive
          ? "rounded-xl bg-red-500/10 px-3 py-2 disabled:opacity-40"
          : "rounded-xl bg-subtle px-3 py-2 disabled:opacity-40"
      }
    >
      <Text
        className={
          props.destructive
            ? "text-sm font-t3-medium text-red-500"
            : "text-sm font-t3-medium text-foreground"
        }
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function GitWorkbenchSection(props: {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
}) {
  const target =
    props.enabled && props.cwd
      ? { environmentId: props.environmentId, input: { cwd: props.cwd } }
      : null;
  const workbench = useEnvironmentQuery(target ? gitWorkbenchEnvironment.workbench(target) : null);
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
  const history = useEnvironmentQuery(
    props.enabled && props.cwd
      ? gitWorkbenchEnvironment.history({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, cursor: 0, limit: 10 },
        })
      : null,
  );
  const applySelection = useAtomCommand(gitWorkbenchEnvironment.applyChangeSelection, {
    reportFailure: false,
  });
  const refreshWorkbench = useAtomCommand(gitWorkbenchEnvironment.refresh, {
    reportFailure: false,
  });
  const [applying, setApplying] = useState(false);

  const apply = useCallback(
    async (action: "stage" | "unstage" | "discard") => {
      if (!props.cwd || !selected || !snapshot || !diff.data || applying) return;
      if (
        diff.data.path !== selected.file.path ||
        diff.data.source !== selected.source ||
        diff.data.stateToken !== snapshot.stateToken
      ) {
        diff.refresh();
        return;
      }
      setApplying(true);
      const result = await applySelection({
        environmentId: props.environmentId,
        input: {
          cwd: props.cwd,
          path: selected.file.path,
          source: selected.source,
          action,
          selection: { kind: "file" },
          expectedStateToken: diff.data.stateToken,
          expectedPatchId: diff.data.patchId,
          ...(action === "discard" && selected.file.untracked
            ? { confirmedUntrackedDeletion: true }
            : {}),
        },
      });
      setApplying(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          Alert.alert(
            "Could not update changes",
            error instanceof Error ? error.message : "The Git change could not be applied.",
          );
        }
        return;
      }
      setSelectedId(null);
      void refreshWorkbench({ environmentId: props.environmentId, input: { cwd: props.cwd } });
    },
    [
      applySelection,
      applying,
      diff,
      props.cwd,
      props.environmentId,
      refreshWorkbench,
      selected,
      snapshot,
    ],
  );

  if (!props.enabled) return null;

  if (snapshot === null) {
    return (
      <View className="rounded-[22px] border border-border bg-card p-4">
        <Text className="text-sm text-foreground-muted">
          {workbench.error ??
            (workbench.isPending ? "Loading Git workbench…" : "Git workbench unavailable.")}
        </Text>
      </View>
    );
  }

  const totals = snapshot.totals;
  const diffReady =
    selected !== null &&
    diff.data !== null &&
    diff.data.path === selected.file.path &&
    diff.data.source === selected.source &&
    diff.data.stateToken === snapshot.stateToken;

  return (
    <View className="gap-3">
      <View className="gap-3 rounded-[22px] border border-border bg-card p-4">
        <View className="flex-row items-center gap-3">
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base font-t3-semibold text-foreground">Repository workbench</Text>
            <Text className="text-sm text-foreground-muted">
              {totals.staged} staged · {totals.unstaged} unstaged · {totals.untracked} untracked
            </Text>
          </View>
          <Text className="text-sm text-foreground-muted">
            +{totals.insertions} −{totals.deletions}
          </Text>
        </View>
        {snapshot.operation.kind !== "none" ? (
          <View className="rounded-xl bg-amber-500/10 px-3 py-2">
            <Text className="text-sm font-t3-medium text-amber-600">
              {snapshot.operation.kind} in progress
              {snapshot.operation.currentStep && snapshot.operation.totalSteps
                ? ` · ${snapshot.operation.currentStep}/${snapshot.operation.totalSteps}`
                : ""}
            </Text>
          </View>
        ) : null}
        {snapshot.lastCommit ? (
          <View className="gap-0.5 border-t border-border-subtle pt-3">
            <Text className="text-sm text-foreground-muted">Last commit</Text>
            <Text className="text-sm font-t3-medium text-foreground" numberOfLines={2}>
              {snapshot.lastCommit.shortOid} · {snapshot.lastCommit.subject}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="overflow-hidden rounded-[22px] border border-border bg-card">
        <View className="px-4 py-3">
          <Text className="text-sm font-t3-semibold text-foreground">Changes</Text>
        </View>
        {rows.length === 0 ? (
          <Text className="border-t border-border-subtle p-4 text-sm text-foreground-muted">
            Working tree clean.
          </Text>
        ) : (
          rows.map((row) => {
            const expanded = selected?.id === row.id;
            const stats = row.source === "staged" ? row.file.stagedStats : row.file.unstagedStats;
            return (
              <View key={row.id} className="border-t border-border-subtle">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSelectedId(expanded ? null : row.id)}
                  className="gap-1 px-4 py-3"
                >
                  <View className="flex-row items-center gap-3">
                    <Text
                      className="min-w-0 flex-1 text-sm font-t3-medium text-foreground"
                      numberOfLines={2}
                    >
                      {row.file.path}
                    </Text>
                    <Text className="text-xs text-foreground-muted">
                      +{stats.insertions} −{stats.deletions}
                    </Text>
                  </View>
                  <Text className="text-xs text-foreground-muted">{fileStatusLabel(row)}</Text>
                </Pressable>
                {expanded ? (
                  <View className="gap-3 border-t border-border-subtle bg-subtle/40 px-4 py-3">
                    {diff.error ? (
                      <Text className="text-sm text-red-500">{diff.error}</Text>
                    ) : !diffReady ? (
                      <Text className="text-sm text-foreground-muted">Loading diff…</Text>
                    ) : diff.data.binary ? (
                      <Text className="text-sm text-foreground-muted">Binary file</Text>
                    ) : (
                      <View className="max-h-56 gap-1 overflow-hidden rounded-xl bg-screen p-3">
                        {diff.data.hunks.slice(0, 5).map((hunk) => (
                          <View key={hunk.id} className="gap-0.5">
                            <Text className="font-mono text-xs text-foreground-muted">
                              {hunk.header}
                            </Text>
                            {hunk.lines.slice(0, 20).map((line) => (
                              <Text
                                key={line.id}
                                className={
                                  line.type === "addition"
                                    ? "font-mono text-xs text-green-600"
                                    : line.type === "deletion"
                                      ? "font-mono text-xs text-red-500"
                                      : "font-mono text-xs text-foreground-muted"
                                }
                                numberOfLines={1}
                              >
                                {line.type === "addition"
                                  ? "+"
                                  : line.type === "deletion"
                                    ? "−"
                                    : " "}
                                {line.content}
                              </Text>
                            ))}
                          </View>
                        ))}
                      </View>
                    )}
                    <View className="flex-row flex-wrap gap-2">
                      {row.source === "staged" ? (
                        <WorkbenchButton
                          disabled={!diffReady || applying}
                          label="Unstage"
                          onPress={() => void apply("unstage")}
                        />
                      ) : (
                        <>
                          <WorkbenchButton
                            disabled={!diffReady || applying || row.file.conflicted}
                            label="Stage"
                            onPress={() => void apply("stage")}
                          />
                          <WorkbenchButton
                            destructive
                            disabled={!diffReady || applying || row.file.conflicted}
                            label="Discard"
                            onPress={() =>
                              Alert.alert(
                                row.file.untracked ? "Delete untracked file?" : "Discard changes?",
                                row.file.path,
                                [
                                  { text: "Cancel", style: "cancel" },
                                  {
                                    text: row.file.untracked ? "Delete" : "Discard",
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
            );
          })
        )}
      </View>

      <View className="overflow-hidden rounded-[22px] border border-border bg-card">
        <View className="px-4 py-3">
          <Text className="text-sm font-t3-semibold text-foreground">Recent history</Text>
        </View>
        {history.data?.items.map((commit) => (
          <View key={commit.oid} className="gap-0.5 border-t border-border-subtle px-4 py-3">
            <Text className="text-sm font-t3-medium text-foreground" numberOfLines={2}>
              {commit.subject}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {commit.shortOid} · {commit.authorName}
            </Text>
          </View>
        )) ?? (
          <Text className="border-t border-border-subtle p-4 text-sm text-foreground-muted">
            {history.error ?? "Loading history…"}
          </Text>
        )}
      </View>
    </View>
  );
}
