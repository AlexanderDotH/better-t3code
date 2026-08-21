import type { GitQueuedWorkflowPlan } from "@t3tools/contracts";
import { ArrowDown, ArrowUp, GitMerge, ListTodo, Play, ShieldAlert, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

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
  return (
    <div className="grid gap-4 p-4 @3xl/git-panel:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.7fr)]">
      <div className="space-y-4">
        {props.readOnly ? (
          <div className="rounded-xl border border-info/24 bg-info/5 p-3 text-info-foreground text-sm">
            Read-only access: operations can be inspected but not changed.
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
  if (!operation) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <GitMerge aria-hidden="true" className="size-4" />
          <h2 className="font-semibold text-sm">Active operation</h2>
        </div>
        <p className="mt-2 text-muted-foreground text-sm">
          No merge, rebase, cherry-pick, or revert is in progress.
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
          {operation.kind.replaceAll("-", " ")} in progress
        </h2>
        <Badge variant={operation.conflicts.length ? "error" : "warning"}>
          {operation.conflicts.length ? `${operation.conflicts.length} conflicts` : "Paused"}
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
          Continue
        </Button>
        <Button
          disabled={readOnly || !operation.canSkip}
          onClick={() => onRunOperation({ kind: "skip" })}
          size="sm"
          variant="outline"
        >
          Skip
        </Button>
        <GitWorkbenchConfirmation
          confirmLabel="Abort operation"
          description="Abort returns the repository to its pre-operation state when Git can do so."
          disabled={readOnly || !operation.canAbort}
          onConfirm={() => onRunOperation({ kind: "abort" })}
          title={`Abort ${operation.kind}?`}
          triggerLabel="Abort…"
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
            Interactive rebase plan
          </h2>
          <p className="text-muted-foreground text-xs">
            Labels, resets, and merges preserve topology.
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
            <Play aria-hidden="true" /> Start rebase
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
                aria-label={`Action for ${node.subject}`}
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
                  aria-label={`New commit message for ${node.subject}`}
                  className="mt-1 h-8"
                  disabled={readOnly || Boolean(operation)}
                  onChange={(event) =>
                    replace(index, { ...node, message: event.currentTarget.value })
                  }
                  placeholder="New commit message"
                  value={node.message ?? ""}
                />
              ) : null}
            </span>
            <div className="flex gap-1">
              <Button
                aria-label={`Move ${rebaseNodeLabel(node)} up`}
                disabled={readOnly || Boolean(operation) || index === 0}
                onClick={() => move(index, -1)}
                size="icon-xs"
                variant="ghost"
              >
                <ArrowUp />
              </Button>
              <Button
                aria-label={`Move ${rebaseNodeLabel(node)} down`}
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
            Queued workflow
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
                Save workflow
              </Button>
              <Button
                onClick={() => {
                  setDraft(props.queue!.plan);
                  setEditing(false);
                }}
                size="xs"
                variant="ghost"
              >
                Cancel edit
              </Button>
            </>
          ) : (
            <Button
              disabled={props.readOnly || !props.onEditQueue}
              onClick={() => setEditing(true)}
              size="xs"
              variant="outline"
            >
              Review & edit
            </Button>
          )}
          {props.queue.status === "needs-review" || props.queue.status === "failed" ? (
            <Button
              disabled={props.readOnly || !props.onRetryQueue}
              onClick={() => props.onRetryQueue?.(props.queue!.id)}
              size="xs"
              variant="outline"
            >
              Retry validation
            </Button>
          ) : null}
          <GitWorkbenchConfirmation
            confirmLabel="Replace workflow"
            description="This replaces the existing workflow with stage all and commit. The server will revalidate it after the turn settles."
            disabled={props.readOnly}
            onConfirm={() => props.onQueueWorkflow({ kind: "stage-all-and-commit" })}
            title="Replace the queued workflow?"
            triggerLabel="Replace workflow…"
            variant="outline"
          />
          <Button
            disabled={props.readOnly}
            onClick={() => props.onCancelQueue(props.queue!.id)}
            size="xs"
            variant="outline"
          >
            Cancel workflow
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
          Run after active turn
        </h2>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        One durable workflow is kept per worktree and revalidated before it runs.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={props.readOnly}
          onClick={() => props.onQueueWorkflow({ kind: "stage-all-and-commit" })}
          size="xs"
          variant="outline"
        >
          Queue stage & commit
        </Button>
        <Button
          disabled={props.readOnly}
          onClick={() => props.onQueueWorkflow({ kind: "push" })}
          size="xs"
          variant="outline"
        >
          Queue push
        </Button>
        <Button
          disabled={props.readOnly}
          onClick={() => props.onQueueWorkflow({ kind: "create-pull-request" })}
          size="xs"
          variant="outline"
        >
          Queue PR
        </Button>
      </div>
    </section>
  );
}

function QueuePlanSummary({ plan }: { readonly plan: GitQueuedWorkflowPlan }) {
  if (plan.kind === "delivery") {
    return (
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted/45 p-2 text-xs">
        <dt className="text-muted-foreground">Selection</dt>
        <dd>
          {plan.stage.mode === "paths" ? `${plan.stage.paths.length} paths` : plan.stage.mode}
        </dd>
        <dt className="text-muted-foreground">Push</dt>
        <dd>{plan.push ? "Yes" : "No"}</dd>
        <dt className="text-muted-foreground">Pull request</dt>
        <dd>{plan.createPullRequest ? "Yes" : "No"}</dd>
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
  if (plan.kind === "delivery") {
    return (
      <div className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3">
        <label className="block text-xs">
          Commit selection
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
            <option value="staged">Currently staged files</option>
            <option value="all">All final worktree changes</option>
            {plan.stage.mode === "paths" ? (
              <option value="paths">Selected paths ({plan.stage.paths.length})</option>
            ) : null}
          </select>
        </label>
        <label className="block text-xs">
          Commit message (optional)
          <Input
            className="mt-1"
            onChange={(event) => {
              const commitMessage = event.currentTarget.value;
              const { commitMessage: _previous, ...base } = plan;
              onChange(commitMessage.trim().length > 0 ? { ...base, commitMessage } : base);
            }}
            placeholder="Generate from final diff"
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
          Push after commit
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
          Create pull request
        </label>
      </div>
    );
  }

  const action = plan.action;
  return (
    <div className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3">
      <p className="text-muted-foreground text-xs">
        Advanced workflows contain exactly one typed Git operation.
      </p>
      {action.kind === "reset" ? (
        <>
          <label className="block text-xs">
            Reset mode
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
              <option value="soft">Soft</option>
              <option value="mixed">Mixed</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <QueueTextField
            label="Target commit"
            onChange={(targetOid) => onChange({ ...plan, action: { ...action, targetOid } })}
            value={action.targetOid}
          />
        </>
      ) : action.kind === "revert" || action.kind === "cherry_pick" ? (
        <QueueTextField
          label="Commit"
          onChange={(commitOid) => onChange({ ...plan, action: { ...action, commitOid } })}
          value={action.commitOid}
        />
      ) : action.kind === "guided_rebase" ? (
        <QueueTextField
          label="Rebase onto"
          onChange={(ontoRef) => onChange({ ...plan, action: { ...action, ontoRef } })}
          value={action.ontoRef}
        />
      ) : (
        <QueueTextField
          label="Upstream ref"
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
  return (
    <section aria-labelledby="undo-heading" className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Undo2 aria-hidden="true" className="size-4" />
        <h2 className="font-semibold text-sm" id="undo-heading">
          Undo snapshots
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
                confirmLabel="Restore snapshot"
                description="The current state is snapshotted first. Restoring cannot undo remote changes."
                disabled={props.readOnly}
                onConfirm={() => props.onRestoreUndo(snapshot.id)}
                phrase="RESTORE"
                title={`Restore ${snapshot.label}?`}
                triggerLabel="Restore…"
                variant="outline"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">No undo snapshots are available.</p>
      )}
    </section>
  );
}

function ForcePush(props: GitOperationsPanelProps) {
  if (!props.forcePushTarget) return null;
  return (
    <section
      aria-labelledby="force-push-heading"
      className="rounded-xl border border-destructive/24 bg-destructive/5 p-4"
    >
      <div className="flex items-center gap-2 text-destructive-foreground">
        <ShieldAlert aria-hidden="true" className="size-4" />
        <h2 className="font-semibold text-sm" id="force-push-heading">
          Publish rewritten history
        </h2>
      </div>
      <p className="mt-2 text-muted-foreground text-xs">
        Uses force-with-lease against {props.forcePushTarget.remoteRef}. Local undo snapshots cannot
        restore remote history.
      </p>
      <div className="mt-3">
        <GitWorkbenchConfirmation
          confirmLabel="Force with lease"
          description="The push is rejected if the remote moved since it was last observed."
          disabled={props.readOnly}
          onConfirm={() =>
            props.onRunOperation({
              expectedRemoteOid: props.forcePushTarget!.expectedRemoteOid,
              kind: "force-with-lease",
              remoteRef: props.forcePushTarget!.remoteRef,
            })
          }
          phrase="FORCE"
          title="Publish rewritten history?"
          triggerLabel="Force with lease…"
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
