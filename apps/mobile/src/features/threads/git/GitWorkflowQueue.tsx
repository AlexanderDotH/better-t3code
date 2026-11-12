import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  GitQueuedWorkflowPlan,
  GitWorkbenchSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import type { GitWorkbenchLiveProjection } from "@t3tools/client-runtime/git-workbench";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { AppText } from "../../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { gitWorkbenchEnvironment } from "../../../state/git-workbench";
import { useAtomCommand } from "../../../state/use-atom-command";
import { GitRebaseEditor } from "./GitRebaseEditor";
import { isValidQueuedWorkflowPlan } from "./git-workbench-model";
import { WorkbenchButton, WorkbenchCard, WorkbenchInput } from "./WorkbenchControls";
import { useProjects, useThreadShells } from "../../../state/entities";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

function queuePlanDescription(plan: GitQueuedWorkflowPlan, t: InterfaceTranslator): string {
  if (plan.kind === "delivery") {
    const selection =
      plan.stage.mode === "paths"
        ? plan.stage.paths.join(", ")
        : t.message(
            plan.stage.mode === "staged"
              ? "git.operation.currentlyStaged"
              : "git.operation.allFinalChanges",
          );
    return [
      selection,
      plan.commitMessage,
      plan.push ? t.message("git.common.push") : null,
      plan.createPullRequest ? t.message("git.common.pullRequest") : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const action = plan.action;
  if (action.kind === "reset")
    return `${t.message("git.branches.resetAction", { mode: action.mode })} → ${action.targetOid}\n${t.message("git.branches.resetDescription")}`;
  if (action.kind === "guided_rebase")
    return `${t.message("git.operation.rebaseCurrent")} → ${action.ontoRef}`;
  if (action.kind === "interactive_rebase")
    return `${t.message("git.operation.startRebase")} → ${action.upstreamRef}`;
  return `${t.message(action.kind === "revert" ? "git.history.revert" : "git.history.cherryPick")} → ${action.commitOid}`;
}

export function GitWorkflowQueue(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly snapshot: GitWorkbenchSnapshot;
  readonly projection: GitWorkbenchLiveProjection;
  readonly threadId?: ThreadId;
  readonly canWrite: boolean;
  readonly requestedPlan: GitQueuedWorkflowPlan | null;
  readonly onClearRequested: () => void;
  readonly onRefresh: () => void;
}) {
  const t = useMobileInterfaceTranslator();
  const existing = props.projection.queuedWorkflow;
  const activeQueue =
    existing && existing.status !== "completed" && existing.status !== "cancelled"
      ? existing
      : null;
  const threads = useThreadShells();
  const projects = useProjects();
  const queueThreads = useMemo(
    () =>
      threads.filter(
        (thread) =>
          thread.environmentId === props.environmentId &&
          thread.archivedAt === null &&
          (thread.worktreePath ??
            projects.find(
              (project) =>
                project.environmentId === thread.environmentId && project.id === thread.projectId,
            )?.workspaceRoot) === props.cwd,
      ),
    [threads, projects, props.environmentId, props.cwd],
  );
  const [selectedThreadId, setSelectedThreadId] = useState<ThreadId | null>(null);
  const threadId =
    activeQueue?.threadId ??
    props.threadId ??
    queueThreads.find((thread) => thread.id === selectedThreadId)?.id;
  const canUpsert = useAtomValue(
    gitWorkbenchEnvironment.upsertQueuedWorkflow.permissionAtom(props.environmentId),
  );
  const canCancel = useAtomValue(
    gitWorkbenchEnvironment.cancelQueuedWorkflow.permissionAtom(props.environmentId),
  );
  const upsert = useAtomCommand(gitWorkbenchEnvironment.upsertQueuedWorkflow, {
    reportFailure: false,
  });
  const cancel = useAtomCommand(gitWorkbenchEnvironment.cancelQueuedWorkflow, {
    reportFailure: false,
  });
  const [plan, setPlan] = useState<GitQueuedWorkflowPlan>(
    () =>
      props.requestedPlan ??
      existing?.plan ?? {
        kind: "delivery",
        stage: { mode: "all" },
        push: false,
        createPullRequest: false,
      },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled =
    !props.canWrite || !canUpsert || !threadId || busy || activeQueue?.status === "running";
  const valid = isValidQueuedWorkflowPlan(plan);
  const save = async (next: GitQueuedWorkflowPlan) => {
    if (disabled || !isValidQueuedWorkflowPlan(next)) return;
    setBusy(true);
    setError(null);
    const result = await upsert({
      environmentId: props.environmentId,
      input: {
        cwd: props.cwd,
        expectedStateToken: props.snapshot.stateToken,
        plan: next,
        ...(activeQueue
          ? {
              workflowId: activeQueue.id,
              expectedRevision: activeQueue.revision,
              replaceExisting: true,
            }
          : {}),
        ...(threadId ? { threadId } : {}),
        ...(activeQueue?.turnId ? { turnId: activeQueue.turnId } : {}),
        ...(activeQueue?.runId ? { runId: activeQueue.runId } : {}),
      },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(String(squashAtomCommandFailure(result)));
    if (result._tag === "Success") props.onClearRequested();
    props.onRefresh();
  };
  const confirmSave = (next: GitQueuedWorkflowPlan) =>
    Alert.alert(
      t.message(
        activeQueue ? "git.operation.replaceWorkflowConfirm" : "git.operation.runAfterTurn",
      ),
      [
        t.message("git.operation.durableWorkflow"),
        props.cwd,
        props.snapshot.refName ?? "HEAD",
        queuePlanDescription(next, t),
      ].join("\n"),
      [
        { text: t.message("common.cancel"), style: "cancel" },
        { text: t.message("git.operation.saveWorkflow"), onPress: () => void save(next) },
      ],
    );
  return (
    <WorkbenchCard title={t.message("git.operation.queuedWorkflow")}>
      <AppText className="text-xs text-foreground-muted">
        {t.message("mobile.gitParity.queueThreadDescription")}
      </AppText>
      {!props.threadId && !activeQueue?.threadId ? (
        <View className="flex-row flex-wrap gap-2">
          {queueThreads.map((thread) => (
            <WorkbenchButton
              key={thread.id}
              selected={threadId === thread.id}
              label={thread.title}
              onPress={() => setSelectedThreadId(thread.id)}
            />
          ))}
          {!queueThreads.length ? (
            <AppText className="text-sm text-foreground-muted">
              {t.message("mobile.gitParity.queueNeedsThread")}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {existing ? (
        <>
          <AppText className="text-sm text-foreground">
            {existing.status.replaceAll("_", " ")}
          </AppText>
          {existing.needsReviewReasons.map((reason) => (
            <AppText key={reason.code} className="text-xs text-amber-600">
              {reason.message}
            </AppText>
          ))}
          {existing.lastError ? (
            <AppText className="text-sm text-red-500">{existing.lastError}</AppText>
          ) : null}
        </>
      ) : null}
      {error ? <AppText className="text-sm text-red-500">{error}</AppText> : null}
      {plan.kind === "delivery" ? (
        <>
          <View className="flex-row flex-wrap gap-2">
            {(["staged", "all", "paths"] as const).map((mode) => (
              <WorkbenchButton
                key={mode}
                disabled={disabled}
                selected={plan.stage.mode === mode}
                label={
                  mode === "staged"
                    ? t.message("git.operation.currentlyStaged")
                    : mode === "all"
                      ? t.message("git.operation.allFinalChanges")
                      : t.message("mobile.gitParity.queuePaths")
                }
                onPress={() =>
                  setPlan({ ...plan, stage: mode === "paths" ? { mode, paths: [] } : { mode } })
                }
              />
            ))}
          </View>
          {plan.stage.mode === "paths" ? (
            <WorkbenchInput
              multiline
              editable={!disabled}
              label={t.message("mobile.gitParity.queuePaths")}
              value={plan.stage.paths.join("\n")}
              onChangeText={(text) =>
                setPlan({
                  ...plan,
                  stage: {
                    mode: "paths",
                    paths: text
                      .split("\n")
                      .map((path) => path.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          ) : null}
          <WorkbenchInput
            label={t.message("mobile.gitParity.queueMessage")}
            value={plan.commitMessage ?? ""}
            editable={!disabled}
            onChangeText={(commitMessage) => {
              const { commitMessage: _previous, ...rest } = plan;
              setPlan(commitMessage.trim() ? { ...rest, commitMessage } : rest);
            }}
          />
          <View className="flex-row flex-wrap gap-2">
            <WorkbenchButton
              selected={plan.push}
              disabled={disabled}
              label={t.message("git.operation.pushAfterCommit")}
              onPress={() =>
                setPlan({
                  ...plan,
                  push: !plan.push,
                  createPullRequest: plan.push ? false : plan.createPullRequest,
                })
              }
            />
            <WorkbenchButton
              selected={plan.createPullRequest}
              disabled={disabled}
              label={t.message("git.common.pullRequest")}
              onPress={() =>
                setPlan({
                  ...plan,
                  createPullRequest: !plan.createPullRequest,
                  push: !plan.createPullRequest || plan.push,
                })
              }
            />
          </View>
        </>
      ) : (
        <>
          <AppText className="text-sm text-foreground">
            {plan.action.kind.replaceAll("_", " ")}
          </AppText>
          {plan.action.kind === "guided_rebase" ? (
            <WorkbenchInput
              editable={!disabled}
              label={t.message("git.operation.rebaseOnto")}
              value={plan.action.ontoRef}
              onChangeText={(ontoRef) =>
                setPlan({ kind: "advanced_operation", action: { kind: "guided_rebase", ontoRef } })
              }
            />
          ) : plan.action.kind === "reset" ? (
            <WorkbenchInput
              editable={!disabled}
              label={t.message("git.operation.targetCommit")}
              value={plan.action.targetOid}
              onChangeText={(targetOid) => {
                if (plan.action.kind === "reset")
                  setPlan({ ...plan, action: { ...plan.action, targetOid } });
              }}
            />
          ) : plan.action.kind === "interactive_rebase" ? (
            <GitRebaseEditor
              disabled={disabled}
              nodes={plan.action.plan}
              onChange={(nodes) => {
                if (plan.action.kind === "interactive_rebase")
                  setPlan({ ...plan, action: { ...plan.action, plan: nodes } });
              }}
            />
          ) : (
            <WorkbenchInput
              editable={!disabled}
              label={t.message("git.operation.targetCommit")}
              value={plan.action.commitOid}
              onChangeText={(commitOid) => {
                if (plan.action.kind === "cherry_pick" || plan.action.kind === "revert")
                  setPlan({ ...plan, action: { ...plan.action, commitOid } });
              }}
            />
          )}
        </>
      )}
      <View className="flex-row flex-wrap gap-2">
        <WorkbenchButton
          disabled={disabled || !valid}
          label={t.message("git.operation.saveWorkflow")}
          onPress={() => confirmSave(plan)}
        />
        {activeQueue &&
        (activeQueue.status === "needs_review" || activeQueue.status === "failed") ? (
          <WorkbenchButton
            disabled={disabled}
            label={t.message("git.operation.retryValidation")}
            onPress={() => confirmSave(activeQueue.plan)}
          />
        ) : null}
        {activeQueue ? (
          <WorkbenchButton
            disabled={!props.canWrite || !canCancel || busy || activeQueue.status === "running"}
            label={t.message("git.operation.cancelWorkflow")}
            onPress={() => {
              setBusy(true);
              void cancel({
                environmentId: props.environmentId,
                input: {
                  cwd: props.cwd,
                  workflowId: activeQueue.id,
                  expectedRevision: activeQueue.revision,
                },
              }).then((result) => {
                setBusy(false);
                if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
                  setError(String(squashAtomCommandFailure(result)));
                props.onRefresh();
              });
            }}
          />
        ) : null}
      </View>
    </WorkbenchCard>
  );
}
