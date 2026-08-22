import { ArrowDown, ArrowUp, Clock3, GitCommitHorizontal, TriangleAlert } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { deriveGitPrimaryAction } from "./GitWorkbench.logic";
import { GitWorkbenchConfirmation } from "./GitWorkbenchConfirmation";
import type {
  GitRepositoryInsights,
  GitUndoSnapshot,
  GitWorkbenchOperationInput,
  GitWorkbenchSnapshot,
  GitQueuedWorkflow,
  GitWorkbenchTabId,
} from "./GitWorkbench.types";

const statePresentation = {
  changed: { label: "Changed", variant: "warning" },
  clean: { label: "Clean", variant: "success" },
  conflicted: { label: "Conflicted", variant: "error" },
  detached: { label: "Detached HEAD", variant: "warning" },
  disconnected: { label: "Disconnected", variant: "outline" },
  stale: { label: "Status stale", variant: "warning" },
  unavailable: { label: "Git unavailable", variant: "outline" },
  unborn: { label: "No commits yet", variant: "info" },
} as const;

interface GitOverviewPanelProps {
  readonly insights: GitRepositoryInsights | null;
  readonly onCancelQueue: (queueId: string) => void;
  readonly onNavigate: (tab: GitWorkbenchTabId) => void;
  readonly onRestoreUndo: (snapshotId: string) => void;
  readonly onRunOperation: (input: GitWorkbenchOperationInput) => void;
  readonly queue: GitQueuedWorkflow | null;
  readonly readOnly: boolean;
  readonly snapshot: GitWorkbenchSnapshot;
  readonly undoSnapshots: readonly GitUndoSnapshot[];
}

const relativeUpdatedLabel = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Updated time unavailable";
  return `Updated ${parsed.toLocaleString()}`;
};

export function GitOverviewPanel({
  insights,
  onCancelQueue,
  onNavigate,
  onRestoreUndo,
  onRunOperation,
  queue,
  readOnly,
  snapshot,
  undoSnapshots,
}: GitOverviewPanelProps) {
  const presentation = statePresentation[snapshot.repositoryState];
  const primaryAction = deriveGitPrimaryAction(snapshot);
  const runPrimaryAction = () => {
    if (primaryAction.id === "resolve-conflicts") return onNavigate("changes");
    if (primaryAction.id === "view-history") return onNavigate("history");
    onRunOperation({ kind: primaryAction.id });
  };

  return (
    <div className="grid min-h-0 gap-4 p-4 @3xl/git-panel:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
      <div className="space-y-4">
        <section
          aria-labelledby="repository-pulse-heading"
          className="rounded-xl border bg-card p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold" id="repository-pulse-heading">
                  Repository pulse
                </h2>
                <Badge variant={presentation.variant}>{presentation.label}</Badge>
                {snapshot.stale ? <Badge variant="warning">Status stale</Badge> : null}
              </div>
              <p className="mt-1 truncate text-muted-foreground text-sm">
                {snapshot.branch ?? "No branch"}
                {snapshot.upstream ? ` · ${snapshot.upstream}` : " · No upstream"}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {relativeUpdatedLabel(snapshot.generatedAt)}
              </p>
            </div>
            <Button
              disabled={readOnly && primaryAction.id !== "view-history"}
              onClick={runPrimaryAction}
            >
              {primaryAction.label}
            </Button>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PulseStat label="Staged" value={snapshot.staged} />
            <PulseStat label="Unstaged" value={snapshot.unstaged} />
            <PulseStat label="Untracked" value={snapshot.untracked} />
            <PulseStat label="Conflicts" value={snapshot.conflicts} warning />
          </dl>

          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
              <ArrowUp aria-hidden="true" className="size-3.5 text-success-foreground" />
              {snapshot.ahead} ahead
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
              <ArrowDown aria-hidden="true" className="size-3.5 text-info-foreground" />
              {snapshot.behind} behind
            </span>
            {snapshot.lastCommit ? (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
                <GitCommitHorizontal aria-hidden="true" className="size-3.5" />
                <span className="truncate">{snapshot.lastCommit.subject}</span>
              </span>
            ) : null}
            {snapshot.additions !== undefined || snapshot.deletions !== undefined ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono">
                <span className="text-success-foreground">+{snapshot.additions ?? 0}</span>
                <span className="text-destructive-foreground">-{snapshot.deletions ?? 0}</span>
              </span>
            ) : null}
          </div>
          {snapshot.pullRequest ? (
            <a
              className="mt-3 flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm hover:bg-accent"
              href={snapshot.pullRequest.url}
              rel="noreferrer"
              target="_blank"
            >
              <Badge variant={snapshot.pullRequest.status === "merged" ? "success" : "info"}>
                PR #{snapshot.pullRequest.number}
              </Badge>
              <span className="min-w-0 flex-1 truncate">{snapshot.pullRequest.title}</span>
              <span className="text-muted-foreground text-xs">{snapshot.pullRequest.status}</span>
            </a>
          ) : null}
        </section>

        <ActivityPanel insights={insights} />
        <CodeMixPanel insights={insights} />
      </div>

      <div className="space-y-4">
        <ContributorPanel insights={insights} />
        <QueuePanel disabled={readOnly} onCancel={onCancelQueue} queue={queue} />
        <UndoPanel
          disabled={readOnly}
          onRestore={onRestoreUndo}
          snapshots={undoSnapshots.slice(0, 5)}
        />
      </div>
    </div>
  );
}

function PulseStat({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className={cn("rounded-lg bg-muted/60 p-2", warning && value > 0 && "bg-warning/8")}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 font-mono font-semibold text-lg">{value}</dd>
    </div>
  );
}

function ActivityPanel({ insights }: { insights: GitRepositoryInsights | null }) {
  const max = Math.max(1, ...(insights?.activity.map((day) => day.count) ?? []));
  return (
    <section
      aria-labelledby="repository-activity-heading"
      className="rounded-xl border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <Clock3 aria-hidden="true" className="size-4 text-muted-foreground" />
        <h2 className="font-semibold text-sm" id="repository-activity-heading">
          Recent activity
        </h2>
      </div>
      {insights ? (
        <>
          <div aria-label="Repository activity" className="mt-3 flex flex-wrap gap-1" role="img">
            {insights.activity.map((day) => (
              <span
                aria-hidden="true"
                className="size-3 rounded-[3px] border border-foreground/5 bg-success"
                key={day.date}
                style={{ opacity: day.count === 0 ? 0.08 : 0.2 + (day.count / max) * 0.8 }}
              />
            ))}
          </div>
          <table className="sr-only">
            <caption>Repository activity by day</caption>
            <tbody>
              {insights.activity.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  <td>
                    {day.count} commits on {day.date}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="mt-3 text-muted-foreground text-sm">Activity loads when Git is open.</p>
      )}
    </section>
  );
}

function ContributorPanel({ insights }: { insights: GitRepositoryInsights | null }) {
  return (
    <section aria-labelledby="contributors-heading" className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold text-sm" id="contributors-heading">
        Top contributors
      </h2>
      {insights?.contributors.length ? (
        <ol className="mt-2 space-y-2">
          {insights.contributors.slice(0, 5).map((contributor, index) => (
            <li className="flex items-center gap-2 text-sm" key={contributor.identity}>
              <span aria-hidden="true" className="w-4 text-muted-foreground text-xs">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{contributor.name}</span>
              <span className="text-muted-foreground">{contributor.commits} commits</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">No contribution data yet.</p>
      )}
    </section>
  );
}

function CodeMixPanel({ insights }: { insights: GitRepositoryInsights | null }) {
  return (
    <section aria-labelledby="code-mix-heading" className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold text-sm" id="code-mix-heading">
        Code mix
      </h2>
      {insights?.codeMix.length ? (
        <>
          <div
            aria-label="Tracked-language mix"
            className="mt-3 flex h-2 overflow-hidden rounded-full"
            role="img"
          >
            {insights.codeMix.map((entry) => (
              <span
                aria-label={`${entry.label}: ${entry.percent}%`}
                key={entry.label}
                style={{ backgroundColor: entry.color, width: `${entry.percent}%` }}
              />
            ))}
          </div>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {insights.codeMix.map((entry) => (
              <li className="flex items-center gap-2 text-sm" key={entry.label}>
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="flex-1">{entry.label}</span>
                <span className="text-muted-foreground">{entry.percent}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground text-xs">
            {insights.coverage.sampledFiles} tracked files · {insights.coverage.sampledCommits}{" "}
            commits sampled{insights.coverage.truncated ? " · results truncated" : ""}
          </p>
        </>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">No tracked source mix available.</p>
      )}
    </section>
  );
}

function QueuePanel({
  disabled,
  onCancel,
  queue,
}: {
  disabled: boolean;
  onCancel: (id: string) => void;
  queue: GitQueuedWorkflow | null;
}) {
  if (!queue) return null;
  return (
    <section
      aria-labelledby="queued-workflow-heading"
      className="rounded-xl border border-info/24 bg-info/5 p-4"
    >
      <h2 className="font-semibold text-sm" id="queued-workflow-heading">
        Queued workflow
      </h2>
      <p className="mt-1 text-sm">{queue.label}</p>
      <p className="mt-1 text-muted-foreground text-xs">{queue.status.replaceAll("-", " ")}</p>
      {queue.staleReasons.length ? (
        <ul className="mt-2 space-y-1 text-warning-foreground text-xs">
          {queue.staleReasons.map((reason) => (
            <li className="flex gap-1" key={reason}>
              <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" /> {reason}
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        className="mt-3"
        disabled={disabled}
        onClick={() => onCancel(queue.id)}
        size="xs"
        variant="outline"
      >
        Cancel workflow
      </Button>
    </section>
  );
}

function UndoPanel({
  disabled,
  onRestore,
  snapshots,
}: {
  disabled: boolean;
  onRestore: (id: string) => void;
  snapshots: readonly GitUndoSnapshot[];
}) {
  return (
    <section aria-labelledby="undo-snapshots-heading" className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold text-sm" id="undo-snapshots-heading">
        Undo snapshots
      </h2>
      {snapshots.length ? (
        <ul className="mt-2 space-y-2">
          {snapshots.map((snapshot) => (
            <li className="flex items-center gap-2" key={snapshot.id}>
              <span className="min-w-0 flex-1 truncate text-sm">{snapshot.label}</span>
              <GitWorkbenchConfirmation
                confirmLabel="Restore snapshot"
                description="The current repository state is snapshotted first. Remote history is not affected."
                disabled={disabled}
                onConfirm={() => onRestore(snapshot.id)}
                phrase="RESTORE"
                title={`Restore ${snapshot.label}?`}
                triggerLabel="Restore…"
                variant="outline"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">No recoverable operations yet.</p>
      )}
    </section>
  );
}
