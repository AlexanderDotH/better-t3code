import type { GitQueuedWorkflowPlan } from "@t3tools/contracts";
import { ArrowDown, ArrowUp, GitMerge, ListTodo, Play, ShieldAlert, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import { validateRebasePlan } from "./GitWorkbench.logic";
import { GitWorkbenchConfirmation } from "./GitWorkbenchConfirmation";
import type {
  GitOperationState,
  GitQueuedWorkflow,
  GitUndoSnapshot,
  GitWorkbenchOperationInput,
  GitWorkbenchRebaseNode,
} from "./GitWorkbench.types";

interface GitOperationsPanelProps {
  readonly forcePushTarget?:
    | { readonly expectedRemoteOid: string; readonly remoteRef: string }
    | undefined;
  readonly onCancelQueue: (queueId: string) => void;
  readonly onEditQueue?: ((queueId: string, plan: GitQueuedWorkflowPlan) => void) | undefined;
  readonly onQueueWorkflow: (input: GitWorkbenchOperationInput) => void;
  readonly onRestoreUndo: (snapshotId: string) => void;
  readonly onRetryQueue?: ((queueId: string) => void) | undefined;
  readonly onRunOperation: (input: GitWorkbenchOperationInput) => void;
  readonly onUpdateRebasePlan: (nodes: readonly GitWorkbenchRebaseNode[]) => void;
  readonly operation: GitOperationState | null;
  readonly queue: GitQueuedWorkflow | null;
  readonly readOnly: boolean;
  readonly rebasePlan: readonly GitWorkbenchRebaseNode[];
  readonly rebaseUpstreamRef?: string | null | undefined;
  readonly undoSnapshots: readonly GitUndoSnapshot[];
}

export function GitOperationsPanel(props: GitOperationsPanelProps) {
  const translate = useInterfaceTranslator().message;
  return (
    <div className="grid gap-4 p-4 @3xl/git-panel:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.7fr)]">
      <div className="space-y-4">
        {props.readOnly ? (
          <div className="rounded-xl border border-info/24 bg-info/5 p-3 text-info-foreground text-sm">
            {translate("git.operation.readOnly")}
          </div>
        ) : null}
        <ActiveOperation {...props} />
        <RebasePlanEditor {...props} />
      </div>
      <div className="space-y-4">
        <QueueWorkflow {...props} />
        <UndoSnapshots {...props} />
        <ForcePush {...props} />
      </div>
    </div>
  );
}

function ActiveOperation({ operation, onRunOperation, readOnly }: GitOperationsPanelProps) {
  const translate = useInterfaceTranslator().message;
  if (!operation) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <GitMerge aria-hidden="true" className="size-4" />
          <h2 className="font-semibold text-sm">{translate("git.operation.active")}</h2>
        </div>
        <p className="mt-2 text-muted-foreground text-sm">
          {translate("git.operation.noneActive")}
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="active-operation-heading"
      className="rounded-xl border border-warning/24 bg-warning/5 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <GitMerge aria-hidden="true" className="size-4 text-warning-foreground" />
        <h2 className="font-semibold text-sm" id="active-operation-heading">
          {translate("git.operation.inProgress", {
            operation: operation.kind.replaceAll("-", " "),
          })}
        </h2>
        <Badge variant={operation.conflicts.length ? "error" : "warning"}>
          {operation.conflicts.length
            ? translate("git.workbench.conflictsCount", { count: operation.conflicts.length })
            : translate("git.operation.paused")}
        </Badge>
      </div>
      <p className="mt-2 text-sm">{operation.detail}</p>
      {operation.conflicts.length ? (
        <ul className="mt-2 list-inside list-disc text-sm">
          {operation.conflicts.map((path) => (
            <li className="break-all font-mono text-xs" key={path}>
              {path}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={readOnly || !operation.canContinue || operation.conflicts.length > 0}
          onClick={() => onRunOperation({ kind: "continue" })}
          size="sm"
        >
          {translate("git.common.continue")}
        </Button>
        <Button
          disabled={readOnly || !operation.canSkip}
          onClick={() => onRunOperation({ kind: "skip" })}
          size="sm"
          variant="outline"
        >
          {translate("git.operation.skip")}
        </Button>
        <GitWorkbenchConfirmation
          confirmLabel={translate("git.operation.abortAction")}
          description={translate("git.operation.abortDescription")}
          disabled={readOnly || !operation.canAbort}
          onConfirm={() => onRunOperation({ kind: "abort" })}
          title={translate("git.operation.abortTitle", { operation: operation.kind })}
          triggerLabel={translate("git.operation.abort")}
        />
      </div>
    </section>
  );
}

function RebasePlanEditor({
  onRunOperation,
  onUpdateRebasePlan,
  operation,
  readOnly,
  rebasePlan,
  rebaseUpstreamRef,
}: GitOperationsPanelProps) {
  const translate = useInterfaceTranslator().message;
  const nodes = operation?.rebasePlan ?? rebasePlan;
  if (!nodes.length) return null;
  const validation = validateRebasePlan(nodes);
  const replace = (index: number, node: GitWorkbenchRebaseNode) => {
    const next = [...nodes];
    next[index] = node;
    onUpdateRebasePlan(next);
  };
  const changeCommitAction = (
    index: number,
    node: Extract<GitWorkbenchRebaseNode, { readonly commitId: string }> & {
      readonly kind: CommitRebaseAction;
      readonly subject: string;
    },
    kind: CommitRebaseAction,
  ) => {
    const { message: previousMessage, ...base } = node;
    replace(
      index,
      kind === "reword"
        ? { ...base, kind, message: previousMessage ?? node.subject }
        : { ...base, kind },
    );
  };
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= nodes.length) return;
    const next = [...nodes];
    [next[index], next[target]] = [next[target]!, next[index]!];
    if (validateRebasePlan(next).valid) onUpdateRebasePlan(next);
  };
  return (
    <section aria-labelledby="interactive-rebase-heading" className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div>
          <h2 className="font-semibold text-sm" id="interactive-rebase-heading">
            {translate("git.operation.interactiveRebase")}
          </h2>
          <p className="text-muted-foreground text-xs">
            {translate("git.operation.rebaseTopology")}
          </p>
        </div>
        {!operation ? (
          <Button
            disabled={readOnly || !validation.valid || !rebaseUpstreamRef}
            onClick={() =>
              rebaseUpstreamRef &&
              onRunOperation({
                kind: "start-interactive-rebase",
                nodes,
                upstreamRef: rebaseUpstreamRef,
              })
            }
            size="sm"
          >
            <Play aria-hidden="true" /> {translate("git.operation.startRebase")}
          </Button>
        ) : null}
      </div>
      <ol>
        {nodes.map((node, index) => (
          <li className="flex items-center gap-2 border-b px-3 py-2 last:border-0" key={node.id}>
            <span className="w-7 shrink-0 text-right font-mono text-muted-foreground text-xs">
              {index + 1}
            </span>
            {isCommitAction(node) ? (
              <select
                aria-label={translate("git.operation.actionFor", { subject: node.subject })}
                className="h-7 rounded-md border bg-background px-1 text-xs"
                disabled={readOnly || Boolean(operation)}
                onChange={(event) =>
                  changeCommitAction(index, node, event.currentTarget.value as CommitRebaseAction)
                }
                value={node.kind}
              >
                {commitActions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            ) : (
              <Badge variant={node.kind === "merge" ? "info" : "outline"}>{node.kind}</Badge>
            )}
            <span className="min-w-0 flex-1 text-sm">
              <span className="block truncate">{rebaseNodeLabel(node)}</span>
              {node.kind === "reword" ? (
                <Input
                  aria-label={translate("git.operation.newCommitMessageFor", {
                    subject: node.subject,
                  })}
                  className="mt-1 h-8"
                  disabled={readOnly || Boolean(operation)}
                  onChange={(event) =>
                    replace(index, { ...node, message: event.currentTarget.value })
                  }
                  placeholder={translate("git.operation.newCommitMessage")}
                  value={node.message ?? ""}
                />
              ) : null}
            </span>
            <div className="flex gap-1">
              <Button
                aria-label={translate("git.operation.moveUp", { label: rebaseNodeLabel(node) })}
                disabled={readOnly || Boolean(operation) || index === 0}
                onClick={() => move(index, -1)}
                size="icon-xs"
                variant="ghost"
              >
                <ArrowUp />
              </Button>
              <Button
                aria-label={translate("git.operation.moveDown", { label: rebaseNodeLabel(node) })}
                disabled={readOnly || Boolean(operation) || index === nodes.length - 1}
                onClick={() => move(index, 1)}
                size="icon-xs"
                variant="ghost"
              >
                <ArrowDown />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {!validation.valid ? (
        <p
          className="border-t bg-destructive/5 p-3 text-destructive-foreground text-xs"
          role="alert"
        >
          {validation.reason}
        </p>
      ) : null}
    </section>
  );
}

function QueueWorkflow(props: GitOperationsPanelProps) {
  const translate = useInterfaceTranslator().message;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GitQueuedWorkflowPlan | null>(props.queue?.plan ?? null);
  useEffect(() => {
    setEditing(false);
    setDraft(props.queue?.plan ?? null);
  }, [props.queue?.id, props.queue?.revision]);

  if (props.queue) {
    return (
      <section aria-labelledby="workflow-queue-heading" className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <ListTodo aria-hidden="true" className="size-4" />
          <h2 className="font-semibold text-sm" id="workflow-queue-heading">
            {translate("git.operation.queuedWorkflow")}
          </h2>
          <Badge variant={props.queue.status === "needs-review" ? "warning" : "info"}>
            {props.queue.status.replaceAll("-", " ")}
          </Badge>
        </div>
        <p className="mt-2 text-sm">{props.queue.label}</p>
        {props.queue.staleReasons.length ? (
          <ul className="mt-2 list-inside list-disc text-warning-foreground text-xs">
            {props.queue.staleReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        {props.queue.lastError ? (
          <p className="mt-2 rounded-md bg-destructive/8 p-2 text-destructive-foreground text-xs">
            {props.queue.lastError}
          </p>
        ) : null}
        {editing && draft ? (
          <QueuePlanEditor onChange={setDraft} plan={draft} />
        ) : (
          <QueuePlanSummary plan={props.queue.plan} />
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button
                disabled={props.readOnly || !props.onEditQueue || !draft || !validQueuePlan(draft)}
                onClick={() => {
                  if (!draft) return;
                  props.onEditQueue?.(props.queue!.id, draft);
                  setEditing(false);
                }}
                size="xs"
              >
                {translate("git.operation.saveWorkflow")}
              </Button>
              <Button
                onClick={() => {
                  setDraft(props.queue!.plan);
                  setEditing(false);
                }}
                size="xs"
                variant="ghost"
              >
                {translate("git.operation.cancelEdit")}
              </Button>
            </>
          ) : (
            <Button
              disabled={props.readOnly || !props.onEditQueue}
              onClick={() => setEditing(true)}
              size="xs"
              variant="outline"
            >
              {translate("git.operation.reviewEdit")}
            </Button>
          )}
          {props.queue.status === "needs-review" || props.queue.status === "failed" ? (
            <Button
              disabled={props.readOnly || !props.onRetryQueue}
              onClick={() => props.onRetryQueue?.(props.queue!.id)}
              size="xs"
              variant="outline"
            >
              {translate("git.operation.retryValidation")}
            </Button>
          ) : null}
          <GitWorkbenchConfirmation
            confirmLabel={translate("git.operation.replaceWorkflow")}
            description={translate("git.operation.replaceWorkflowDescription")}
            disabled={props.readOnly}
            onConfirm={() => props.onQueueWorkflow({ kind: "stage-all-and-commit" })}
            title={translate("git.operation.replaceWorkflowConfirm")}
            triggerLabel={`${translate("git.operation.replaceWorkflow")}…`}
            variant="outline"
          />
          <Button
            disabled={props.readOnly}
            onClick={() => props.onCancelQueue(props.queue!.id)}
            size="xs"
            variant="outline"
          >
            {translate("git.operation.cancelWorkflow")}
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="workflow-queue-heading" className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <ListTodo aria-hidden="true" className="size-4" />
        <h2 className="font-semibold text-sm" id="workflow-queue-heading">
          {translate("git.operation.runAfterTurn")}
        </h2>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        {translate("git.operation.durableWorkflow")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={props.readOnly}
          onClick={() => props.onQueueWorkflow({ kind: "stage-all-and-commit" })}
          size="xs"
          variant="outline"
        >
          {translate("git.operation.queueStageCommit")}
        </Button>
        <Button
          disabled={props.readOnly}
          onClick={() => props.onQueueWorkflow({ kind: "push" })}
          size="xs"
          variant="outline"
        >
          {translate("git.operation.queuePush")}
        </Button>
        <Button
          disabled={props.readOnly}
          onClick={() => props.onQueueWorkflow({ kind: "create-pull-request" })}
          size="xs"
          variant="outline"
        >
          {translate("git.operation.queuePullRequest")}
        </Button>
      </div>
    </section>
  );
}

function QueuePlanSummary({ plan }: { readonly plan: GitQueuedWorkflowPlan }) {
  const translate = useInterfaceTranslator().message;
  if (plan.kind === "delivery") {
    return (
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted/45 p-2 text-xs">
        <dt className="text-muted-foreground">{translate("git.common.selection")}</dt>
        <dd>
          {plan.stage.mode === "paths" ? `${plan.stage.paths.length} paths` : plan.stage.mode}
        </dd>
        <dt className="text-muted-foreground">{translate("git.common.push")}</dt>
        <dd>{translate(plan.push ? "git.common.yes" : "git.common.no")}</dd>
        <dt className="text-muted-foreground">{translate("git.common.pullRequest")}</dt>
        <dd>{translate(plan.createPullRequest ? "git.common.yes" : "git.common.no")}</dd>
      </dl>
    );
  }
  return (
    <p className="mt-3 rounded-md bg-muted/45 p-2 font-mono text-xs">
      {plan.action.kind.replaceAll("_", " ")}
    </p>
  );
}

function QueuePlanEditor({
  onChange,
  plan,
}: {
  readonly onChange: (plan: GitQueuedWorkflowPlan) => void;
  readonly plan: GitQueuedWorkflowPlan;
}) {
  const translate = useInterfaceTranslator().message;
  if (plan.kind === "delivery") {
    return (
      <div className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3">
        <label className="block text-xs">
          {translate("git.operation.commitSelection")}
          <select
            className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
            onChange={(event) => {
              const mode = event.currentTarget.value;
              if (mode === "all" || mode === "staged") {
                onChange({ ...plan, stage: { mode } });
              }
            }}
            value={plan.stage.mode}
          >
            <option value="staged">{translate("git.operation.currentlyStaged")}</option>
            <option value="all">{translate("git.operation.allFinalChanges")}</option>
            {plan.stage.mode === "paths" ? (
              <option value="paths">
                {translate("git.operation.selectedPaths", { count: plan.stage.paths.length })}
              </option>
            ) : null}
          </select>
        </label>
        <label className="block text-xs">
          {translate("git.actions.commitMessageOptional")}
          <Input
            className="mt-1"
            onChange={(event) => {
              const commitMessage = event.currentTarget.value;
              const { commitMessage: _previous, ...base } = plan;
              onChange(commitMessage.trim().length > 0 ? { ...base, commitMessage } : base);
            }}
            placeholder={translate("git.operation.generateFinalDiff")}
            value={plan.commitMessage ?? ""}
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={plan.push}
            onChange={(event) =>
              onChange({
                ...plan,
                push: event.currentTarget.checked,
                createPullRequest: event.currentTarget.checked ? plan.createPullRequest : false,
              })
            }
            type="checkbox"
          />
          {translate("git.operation.pushAfterCommit")}
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={plan.createPullRequest}
            onChange={(event) =>
              onChange({
                ...plan,
                createPullRequest: event.currentTarget.checked,
                push: event.currentTarget.checked || plan.push,
              })
            }
            type="checkbox"
          />
          {translate("git.operation.createPullRequest")}
        </label>
      </div>
    );
  }

  const action = plan.action;
  return (
    <div className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3">
      <p className="text-muted-foreground text-xs">{translate("git.operation.advancedSingle")}</p>
      {action.kind === "reset" ? (
        <>
          <label className="block text-xs">
            {translate("git.operation.resetMode")}
            <select
              className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
              onChange={(event) =>
                onChange({
                  ...plan,
                  action: { ...action, mode: event.currentTarget.value as typeof action.mode },
                })
              }
              value={action.mode}
            >
              <option value="soft">{translate("git.operation.soft")}</option>
              <option value="mixed">{translate("git.operation.mixed")}</option>
              <option value="hard">{translate("git.operation.hard")}</option>
            </select>
          </label>
          <QueueTextField
            label={translate("git.operation.targetCommit")}
            onChange={(targetOid) => onChange({ ...plan, action: { ...action, targetOid } })}
            value={action.targetOid}
          />
        </>
      ) : action.kind === "revert" || action.kind === "cherry_pick" ? (
        <QueueTextField
          label={translate("git.common.commit")}
          onChange={(commitOid) => onChange({ ...plan, action: { ...action, commitOid } })}
          value={action.commitOid}
        />
      ) : action.kind === "guided_rebase" ? (
        <QueueTextField
          label={translate("git.operation.rebaseOnto")}
          onChange={(ontoRef) => onChange({ ...plan, action: { ...action, ontoRef } })}
          value={action.ontoRef}
        />
      ) : (
        <QueueTextField
          label={translate("git.operation.upstreamRef")}
          onChange={(upstreamRef) => onChange({ ...plan, action: { ...action, upstreamRef } })}
          value={action.upstreamRef}
        />
      )}
    </div>
  );
}

function QueueTextField({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  return (
    <label className="block text-xs">
      {label}
      <Input
        className="mt-1 font-mono"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function validQueuePlan(plan: GitQueuedWorkflowPlan): boolean {
  if (plan.kind === "delivery") return plan.commitMessage?.trim().length !== 0;
  const action = plan.action;
  if (action.kind === "reset" || action.kind === "revert" || action.kind === "cherry_pick") {
    const oid = action.kind === "reset" ? action.targetOid : action.commitOid;
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid);
  }
  return (action.kind === "guided_rebase" ? action.ontoRef : action.upstreamRef).trim().length > 0;
}

function UndoSnapshots(props: GitOperationsPanelProps) {
  const translate = useInterfaceTranslator().message;
  return (
    <section aria-labelledby="undo-heading" className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Undo2 aria-hidden="true" className="size-4" />
        <h2 className="font-semibold text-sm" id="undo-heading">
          {translate("git.operation.undoSnapshots")}
        </h2>
      </div>
      {props.undoSnapshots.length ? (
        <ul className="mt-2 space-y-2">
          {props.undoSnapshots.map((snapshot) => (
            <li className="flex items-center gap-2" key={snapshot.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{snapshot.label}</p>
                <p className="text-muted-foreground text-xs">
                  {new Date(snapshot.createdAt).toLocaleString()}
                </p>
              </div>
              <GitWorkbenchConfirmation
                confirmLabel={translate("git.operation.restoreSnapshot")}
                description={translate("git.operation.restoreDescription")}
                disabled={props.readOnly}
                onConfirm={() => props.onRestoreUndo(snapshot.id)}
                phrase="RESTORE"
                title={translate("git.operation.restoreTitle", { label: snapshot.label })}
                triggerLabel={`${translate("git.operation.restoreSnapshot")}…`}
                variant="outline"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">
          {translate("git.operation.noSnapshots")}
        </p>
      )}
    </section>
  );
}

function ForcePush(props: GitOperationsPanelProps) {
  const translate = useInterfaceTranslator().message;
  if (!props.forcePushTarget) return null;
  return (
    <section
      aria-labelledby="force-push-heading"
      className="rounded-xl border border-destructive/24 bg-destructive/5 p-4"
    >
      <div className="flex items-center gap-2 text-destructive-foreground">
        <ShieldAlert aria-hidden="true" className="size-4" />
        <h2 className="font-semibold text-sm" id="force-push-heading">
          {translate("git.operation.forcePush.title")}
        </h2>
      </div>
      <p className="mt-2 text-muted-foreground text-xs">
        {translate("git.operation.forcePush.description", {
          remote: props.forcePushTarget.remoteRef,
        })}
      </p>
      <div className="mt-3">
        <GitWorkbenchConfirmation
          confirmLabel={translate("git.operation.forceWithLease")}
          description={translate("git.operation.forceLeaseDescription")}
          disabled={props.readOnly}
          onConfirm={() =>
            props.onRunOperation({
              expectedRemoteOid: props.forcePushTarget!.expectedRemoteOid,
              kind: "force-with-lease",
              remoteRef: props.forcePushTarget!.remoteRef,
            })
          }
          phrase="FORCE"
          title={translate("git.operation.forcePushConfirm")}
          triggerLabel={`${translate("git.operation.forceWithLease")}…`}
        />
      </div>
    </section>
  );
}

const commitActions = ["pick", "reword", "edit", "squash", "fixup", "drop"] as const;
type CommitRebaseAction = (typeof commitActions)[number];

const isCommitAction = (
  node: GitWorkbenchRebaseNode,
): node is GitWorkbenchRebaseNode & {
  readonly commitId: string;
  readonly kind: CommitRebaseAction;
  readonly subject: string;
} => commitActions.some((kind) => kind === node.kind);

const rebaseNodeLabel = (node: GitWorkbenchRebaseNode): string => {
  if (node.kind === "label" || node.kind === "reset") return node.label;
  if (node.kind === "merge") return `${node.subject} ← ${node.labels.join(", ")}`;
  return node.subject;
};
