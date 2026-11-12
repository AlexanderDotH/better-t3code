import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  GitQueuedWorkflowPlan,
  GitRebaseTodoNode,
  GitWorkbenchOperationAction,
  GitWorkbenchSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import type { GitWorkbenchLiveProjection } from "@t3tools/client-runtime/git-workbench";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Alert, Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { gitWorkbenchEnvironment } from "../../../state/git-workbench";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useEnvironmentQuery } from "../../../state/query";
import { GitRebaseEditor } from "./GitRebaseEditor";
import { GitWorkflowQueue } from "./GitWorkflowQueue";
import { isValidRebasePlan } from "./rebase-plan";
import { WorkbenchButton, WorkbenchCard, WorkbenchInput } from "./WorkbenchControls";

export function GitOperationsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly snapshot: GitWorkbenchSnapshot;
  readonly projection: GitWorkbenchLiveProjection;
  readonly threadId?: ThreadId;
  readonly canWrite: boolean;
  readonly onRefresh: () => void;
}) {
  const t = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const runOperation = useAtomCommand(gitWorkbenchEnvironment.runOperation, {
    reportFailure: false,
  });
  const restore = useAtomCommand(gitWorkbenchEnvironment.restoreUndoSnapshot, {
    reportFailure: false,
  });
  const canRestore = useAtomValue(
    gitWorkbenchEnvironment.restoreUndoSnapshot.permissionAtom(props.environmentId),
  );
  const progress = useAtomValue(
    gitWorkbenchEnvironment.operationProgress({
      environmentId: props.environmentId,
      cwd: props.cwd,
    }),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetRef, setTargetRef] = useState("");
  const [branchName, setBranchName] = useState("");
  const [planTarget, setPlanTarget] = useState<string | null>(null);
  const plan = useEnvironmentQuery(
    planTarget
      ? gitWorkbenchEnvironment.interactiveRebasePlan({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, upstreamRef: planTarget },
        })
      : null,
  );
  const [draftPlan, setDraftPlan] = useState<{
    readonly key: string;
    readonly nodes: ReadonlyArray<GitRebaseTodoNode>;
  } | null>(null);
  const planKey = JSON.stringify([planTarget, plan.data]);
  const nodes =
    draftPlan?.key === planKey
      ? draftPlan.nodes
      : (plan.data?.items.map((item) => item.node) ?? []);
  const subjects = new Map(
    plan.data?.items.flatMap((item) =>
      "oid" in item.node && item.subject ? [[item.node.oid, item.subject] as const] : [],
    ),
  );
  const parents = new Map(
    plan.data?.items.flatMap((item) =>
      "oid" in item.node && item.parents ? [[item.node.oid, item.parents] as const] : [],
    ),
  );
  const [resetOid, setResetOid] = useState(props.snapshot.headOid ?? "");
  const [resetMode, setResetMode] = useState<"soft" | "mixed" | "hard">("soft");
  const [queueAction, setQueueAction] = useState<GitQueuedWorkflowPlan | null>(null);
  const disabled = !props.canWrite || running || progress.status === "running";
  const rewriteDisabled = disabled || props.snapshot.operation.kind !== "none";
  const run = async (action: GitWorkbenchOperationAction) => {
    if (disabled) return;
    setRunning(true);
    setError(null);
    const result = await runOperation({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, expectedStateToken: props.snapshot.stateToken, action },
    });
    setRunning(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    props.onRefresh();
  };
  const confirm = (action: GitWorkbenchOperationAction, label: string, description: string) =>
    Alert.alert(
      label,
      `${description}\n${props.cwd}\n${t.message("mobile.gitParity.operationConfirmation", { action: label, branch: props.snapshot.refName ?? "HEAD" })}`,
      [
        { text: t.message("common.cancel"), style: "cancel" },
        { text: label, style: "destructive", onPress: () => void run(action) },
      ],
    );
  const active = props.snapshot.operation.kind;
  const lease =
    props.snapshot.upstreamRef && props.snapshot.upstreamOid
      ? /^([^/]+)\/(.+)$/.exec(props.snapshot.upstreamRef)
      : null;
  const rebaseAction =
    planTarget &&
    plan.data &&
    plan.data.upstreamRef === planTarget &&
    isValidRebasePlan(nodes, parents)
      ? { kind: "interactive_rebase" as const, upstreamRef: plan.data.upstreamOid, plan: nodes }
      : null;
  return (
    <View className="gap-3">
      {error || plan.error ? (
        <AppText className="text-red-500">{error ?? plan.error}</AppText>
      ) : null}
      {progress.status === "running" ? (
        <AppText className="text-sm text-foreground-muted">
          {progress.latest?._tag === "progress"
            ? progress.latest.label
            : t.message("mobile.git.inProgress")}
        </AppText>
      ) : null}
      {active !== "none" ? (
        <WorkbenchCard title={`${active} · ${t.message("mobile.git.inProgress")}`}>
          <AppText className="text-sm text-foreground-muted">
            {props.snapshot.operation.currentStep ?? ""} /{" "}
            {props.snapshot.operation.totalSteps ?? ""}
          </AppText>
          {active === "rebase" ||
          active === "merge" ||
          active === "cherry-pick" ||
          active === "revert" ? (
            <View className="flex-row flex-wrap gap-2">
              <WorkbenchButton
                disabled={disabled || props.snapshot.totals.conflicted > 0}
                label={t.message("git.common.continue")}
                onPress={() => void run({ kind: "continue", operation: active })}
              />
              {active !== "merge" ? (
                <WorkbenchButton
                  disabled={disabled}
                  label={t.message("git.operation.skip")}
                  onPress={() =>
                    confirm(
                      { kind: "skip", operation: active },
                      t.message("git.operation.skip"),
                      active,
                    )
                  }
                />
              ) : null}
              <WorkbenchButton
                disabled={disabled}
                destructive
                label={t.message("git.operation.abort")}
                onPress={() =>
                  confirm(
                    { kind: "abort", operation: active },
                    t.message("git.operation.abort"),
                    t.message("git.operation.abortDescription"),
                  )
                }
              />
            </View>
          ) : null}
        </WorkbenchCard>
      ) : null}
      {!props.threadId ? (
        <WorkbenchCard title={t.message("git.branches.title")}>
          <WorkbenchInput
            label={t.message("git.common.branch")}
            value={branchName}
            onChangeText={setBranchName}
            editable={!rewriteDisabled}
          />
          <View className="flex-row flex-wrap gap-2">
            <WorkbenchButton
              disabled={rewriteDisabled || !branchName.trim()}
              label={t.message("git.branches.create")}
              onPress={() =>
                confirm(
                  { kind: "create_branch", name: branchName.trim() },
                  t.message("git.branches.create"),
                  branchName.trim(),
                )
              }
            />
            <WorkbenchButton
              disabled={rewriteDisabled || !branchName.trim()}
              label={t.message("git.branches.switch")}
              onPress={() =>
                confirm(
                  { kind: "switch_branch", refName: branchName.trim() },
                  t.message("git.branches.switch"),
                  branchName.trim(),
                )
              }
            />
          </View>
        </WorkbenchCard>
      ) : null}
      <WorkbenchCard title={t.message("git.operation.rebaseCurrent")}>
        <WorkbenchInput
          label={t.message("git.operation.rebaseOnto")}
          value={targetRef}
          onChangeText={setTargetRef}
          editable={!rewriteDisabled}
        />
        <View className="flex-row flex-wrap gap-2">
          <WorkbenchButton
            disabled={rewriteDisabled || !targetRef.trim()}
            label={t.message("git.branches.rebaseOnto")}
            onPress={() =>
              confirm(
                { kind: "guided_rebase", ontoRef: targetRef.trim() },
                t.message("git.branches.rebaseOnto"),
                targetRef.trim(),
              )
            }
          />
          <WorkbenchButton
            disabled={rewriteDisabled || !targetRef.trim()}
            label={t.message("git.operation.prepareRebase")}
            onPress={() => {
              setPlanTarget(targetRef.trim());
              plan.refresh();
            }}
          />
          <WorkbenchButton
            disabled={!props.canWrite || !targetRef.trim()}
            label={t.message("git.operation.runAfterTurn")}
            onPress={() =>
              setQueueAction({
                kind: "advanced_operation",
                action: { kind: "guided_rebase", ontoRef: targetRef.trim() },
              })
            }
          />
        </View>
        {plan.data && planTarget === targetRef.trim() ? (
          <>
            <GitRebaseEditor
              nodes={nodes}
              subjects={subjects}
              parents={parents}
              disabled={rewriteDisabled}
              onChange={(next) => setDraftPlan({ key: planKey, nodes: next })}
            />
            <WorkbenchButton
              disabled={rewriteDisabled || !rebaseAction}
              label={t.message("git.operation.startRebase")}
              onPress={() =>
                rebaseAction &&
                confirm(rebaseAction, t.message("git.operation.startRebase"), planTarget!)
              }
            />
            <WorkbenchButton
              disabled={!props.canWrite || !rebaseAction}
              label={t.message("git.operation.runAfterTurn")}
              onPress={() =>
                rebaseAction && setQueueAction({ kind: "advanced_operation", action: rebaseAction })
              }
            />
          </>
        ) : null}
      </WorkbenchCard>
      <WorkbenchCard title={t.message("git.branches.resetCurrent")}>
        <WorkbenchInput
          label={t.message("git.operation.targetCommit")}
          value={resetOid}
          onChangeText={setResetOid}
          editable={!rewriteDisabled}
        />
        <View className="flex-row flex-wrap gap-2">
          {(["soft", "mixed", "hard"] as const).map((mode) => (
            <WorkbenchButton
              key={mode}
              disabled={rewriteDisabled}
              selected={resetMode === mode}
              label={t.message(
                mode === "soft"
                  ? "git.branches.resetSoft"
                  : mode === "mixed"
                    ? "git.branches.resetMixed"
                    : "git.branches.resetHard",
              )}
              onPress={() => setResetMode(mode)}
            />
          ))}
        </View>
        <WorkbenchButton
          disabled={rewriteDisabled || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(resetOid.trim())}
          destructive
          label={t.message("git.branches.resetAction", { mode: resetMode })}
          onPress={() =>
            confirm(
              { kind: "reset", mode: resetMode, targetOid: resetOid.trim() },
              t.message("git.branches.resetTitle", {
                mode: resetMode,
                target: resetOid.slice(0, 12),
              }),
              t.message("git.branches.resetDescription"),
            )
          }
        />
        <WorkbenchButton
          disabled={!props.canWrite || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(resetOid.trim())}
          label={t.message("git.operation.runAfterTurn")}
          onPress={() =>
            setQueueAction({
              kind: "advanced_operation",
              action: { kind: "reset", mode: resetMode, targetOid: resetOid.trim() },
            })
          }
        />
      </WorkbenchCard>
      <WorkbenchCard title={t.message("git.operation.forceWithLease")}>
        <AppText className="text-sm text-foreground-muted">
          {t.message("git.operation.forceLeaseDescription")}
        </AppText>
        <AppText selectable className="font-mono text-xs text-foreground">
          {props.snapshot.upstreamRef} {props.snapshot.upstreamOid}
        </AppText>
        <WorkbenchButton
          disabled={rewriteDisabled || !lease}
          destructive
          label={t.message("git.operation.forceWithLease")}
          onPress={() =>
            lease &&
            props.snapshot.upstreamOid &&
            confirm(
              {
                kind: "force_with_lease",
                remote: lease[1]!,
                branch: lease[2]!,
                expectedRemoteOid: props.snapshot.upstreamOid,
              },
              t.message("git.operation.forceWithLease"),
              t.message("git.operation.forcePush.description", {
                remote: props.snapshot.upstreamRef ?? "",
              }),
            )
          }
        />
        {!lease ? (
          <AppText className="text-xs text-foreground-muted">
            {t.message("mobile.gitParity.noRef")}
          </AppText>
        ) : null}
      </WorkbenchCard>
      <GitWorkflowQueue
        key={JSON.stringify([
          props.projection.queuedWorkflow?.id,
          props.projection.queuedWorkflow?.revision,
        ])}
        {...props}
        requestedPlan={null}
        onClearRequested={() => setQueueAction(null)}
      />
      {queueAction ? (
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setQueueAction(null)}
        >
          <View
            className="flex-1 gap-3 bg-sheet px-4"
            style={{
              paddingTop: Platform.OS === "android" ? insets.top + 12 : 16,
              paddingBottom: Math.max(insets.bottom, 16),
            }}
          >
            <WorkbenchButton
              label={t.message("common.cancel")}
              onPress={() => setQueueAction(null)}
            />
            <ScrollView>
              <GitWorkflowQueue
                {...props}
                requestedPlan={queueAction}
                onClearRequested={() => setQueueAction(null)}
              />
            </ScrollView>
          </View>
        </Modal>
      ) : null}
      <WorkbenchCard title={t.message("git.operation.undoSnapshots")}>
        {props.projection.undoSnapshots.map((snapshot) => (
          <View key={snapshot.id} className="gap-2">
            <AppText className="text-sm text-foreground">
              {snapshot.reason} · {t.date(new Date(snapshot.createdAt))} · {snapshot.headRef}
            </AppText>
            <WorkbenchButton
              disabled={disabled || !canRestore}
              label={t.message("git.operation.restoreSnapshot")}
              onPress={() =>
                Alert.alert(
                  t.message("git.operation.restoreTitle", { label: snapshot.reason }),
                  t.message("git.operation.restoreDescription"),
                  [
                    { text: t.message("common.cancel"), style: "cancel" },
                    {
                      text: t.message("git.operation.restoreSnapshot"),
                      style: "destructive",
                      onPress: () => {
                        setRunning(true);
                        void restore({
                          environmentId: props.environmentId,
                          input: {
                            cwd: props.cwd,
                            expectedStateToken: props.snapshot.stateToken,
                            snapshotId: snapshot.id,
                          },
                        }).then((result) => {
                          setRunning(false);
                          if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
                            setError(String(squashAtomCommandFailure(result)));
                          props.onRefresh();
                        });
                      },
                    },
                  ],
                )
              }
            />
          </View>
        ))}
        {!props.projection.undoSnapshots.length ? (
          <AppText className="text-sm text-foreground-muted">
            {t.message("git.overview.noRecoverable")}
          </AppText>
        ) : null}
      </WorkbenchCard>
    </View>
  );
}
