import { useState, type UIEvent } from "react";
import { ArrowLeft, FileDiff, GitCommitHorizontal, LoaderCircle } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

import { deriveHistoryWindow } from "./GitWorkbench.logic";
import type {
  GitBranch,
  GitCommitDetail,
  GitHistoryState,
  GitWorkbenchOperationInput,
} from "./GitWorkbench.types";

interface GitHistoryPanelProps {
  readonly branches: readonly GitBranch[];
  readonly history: GitHistoryState;
  readonly onHistoryPathFilterChange?: ((path: string) => void) | undefined;
  readonly onHistoryRefFilterChange?: ((refName: string) => void) | undefined;
  readonly onLoadCommit: (oid: string) => void;
  readonly onLoadCommitPatch?: ((oid: string, path: string) => void) | undefined;
  readonly onLoadMore: () => void;
  readonly onOpenCurrentFile: (path: string) => void;
  readonly onRunOperation: (input: GitWorkbenchOperationInput) => void;
  readonly onSelectCommit: (oid: string | null) => void;
  readonly pathFilter?: string | undefined;
  readonly refFilter?: string | undefined;
  readonly readOnly: boolean;
  readonly selectedCommit: GitCommitDetail | null;
}

const ROW_HEIGHT = 64;

export function GitHistoryPanel(props: GitHistoryPanelProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const range = deriveHistoryWindow({
    itemCount: props.history.commits.length,
    rowHeight: ROW_HEIGHT,
    scrollTop,
    viewportHeight,
  });
  const visibleCommits = props.history.commits.slice(range.start, range.end);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    setViewportHeight(event.currentTarget.clientHeight);
    if (
      props.history.hasMore &&
      !props.history.loading &&
      event.currentTarget.scrollHeight -
        event.currentTarget.scrollTop -
        event.currentTarget.clientHeight <
        180
    ) {
      props.onLoadMore();
    }
  };

  return (
    <div className="grid size-full min-h-0 @container/git-history @3xl/git-history:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.4fr)]">
      <aside
        className={cn(
          "flex min-h-0 flex-col border-r",
          props.selectedCommit ? "hidden @3xl/git-history:flex" : "flex",
        )}
      >
        <div className="grid gap-2 border-b p-2">
          <select
            aria-label="Filter history by branch"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => props.onHistoryRefFilterChange?.(event.currentTarget.value)}
            value={props.refFilter ?? ""}
          >
            <option value="">Current branch</option>
            {props.branches.map((branch) => (
              <option
                key={`${branch.remote ? "remote" : "local"}:${branch.name}`}
                value={branch.name}
              >
                {branch.name}
                {branch.remote ? " (remote)" : ""}
              </option>
            ))}
          </select>
          <Input
            aria-label="Filter history by path"
            onChange={(event) => props.onHistoryPathFilterChange?.(event.currentTarget.value)}
            placeholder="Filter by path"
            value={props.pathFilter ?? ""}
          />
          {props.history.snapshotOid ? (
            <p className="truncate px-1 font-mono text-muted-foreground text-[11px]">
              Snapshot {props.history.snapshotOid.slice(0, 12)}
            </p>
          ) : null}
        </div>
        <div
          aria-label="Commit history"
          className="min-h-0 flex-1 overflow-auto"
          onScroll={onScroll}
          role="list"
        >
          <div style={{ height: range.paddingTop }} />
          {visibleCommits.map((commit) => (
            <button
              aria-current={commit.oid === props.selectedCommit?.oid ? "true" : undefined}
              className="flex h-16 w-full items-start gap-2 border-b px-3 py-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-current:bg-accent"
              key={commit.oid}
              onClick={() => {
                props.onSelectCommit(commit.oid);
                props.onLoadCommit(commit.oid);
              }}
              role="listitem"
              type="button"
            >
              <GitCommitHorizontal aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{commit.subject}</span>
                <span className="mt-0.5 flex min-w-0 gap-2 text-muted-foreground text-xs">
                  <span className="truncate">{commit.author}</span>
                  <span className="font-mono">{commit.oid.slice(0, 8)}</span>
                </span>
                {commit.decorations.length ? (
                  <span className="mt-0.5 flex gap-1 overflow-hidden">
                    {commit.decorations.slice(0, 2).map((decoration) => (
                      <Badge key={decoration} size="sm" variant="outline">
                        {decoration}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
          <div style={{ height: range.paddingBottom }} />
          {props.history.loading ? (
            <p
              className="flex items-center justify-center gap-2 p-3 text-muted-foreground text-sm"
              role="status"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              Loading history…
            </p>
          ) : null}
          {props.history.error ? (
            <p className="p-3 text-destructive-foreground text-sm">{props.history.error}</p>
          ) : null}
        </div>
      </aside>
      <main
        className={cn(
          "min-h-0 overflow-auto",
          props.selectedCommit ? "block" : "hidden @3xl/git-history:block",
        )}
      >
        {props.selectedCommit ? (
          <GitCommitDetailPanel {...props} commit={props.selectedCommit} />
        ) : (
          <div className="grid size-full min-h-48 place-content-center text-muted-foreground text-sm">
            Select a commit to inspect its metadata and changed files.
          </div>
        )}
      </main>
    </div>
  );
}

function GitCommitDetailPanel({
  commit,
  onLoadCommitPatch,
  onOpenCurrentFile,
  onRunOperation,
  onSelectCommit,
  readOnly,
}: GitHistoryPanelProps & { readonly commit: GitCommitDetail }) {
  return (
    <article className="p-4">
      <div className="flex items-start gap-2">
        <Button
          aria-label="Back to commit history"
          className="@3xl/git-history:hidden"
          onClick={() => onSelectCommit(null)}
          size="icon-xs"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-lg">{commit.subject}</h2>
          <p className="mt-1 break-all font-mono text-muted-foreground text-xs">{commit.oid}</p>
          <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="inline text-muted-foreground">Author: </dt>
              <dd className="inline">{commit.author}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Committer: </dt>
              <dd className="inline">{commit.committer}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Authored: </dt>
              <dd className="inline">{new Date(commit.authoredAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Committed: </dt>
              <dd className="inline">{new Date(commit.committedAt).toLocaleString()}</dd>
            </div>
          </dl>
          {commit.body ? <p className="mt-3 whitespace-pre-wrap text-sm">{commit.body}</p> : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            disabled={readOnly}
            onClick={() => onRunOperation({ commitOid: commit.oid, kind: "revert" })}
            size="xs"
            variant="outline"
          >
            Revert
          </Button>
          <Button
            disabled={readOnly}
            onClick={() => onRunOperation({ commitOid: commit.oid, kind: "cherry-pick" })}
            size="xs"
            variant="outline"
          >
            Cherry-pick
          </Button>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <FileDiff aria-hidden="true" className="size-4" />
        <h3 className="font-semibold text-sm">Changed files</h3>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">Historical files are read-only.</p>
      <div className="mt-2 space-y-2">
        {commit.files.map((file) => (
          <section className="rounded-lg border" key={`${file.kind}:${file.path}`}>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Badge variant="outline">{file.kind}</Badge>
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              <span className="font-mono text-xs">
                <span className="text-success-foreground">+{file.additions}</span>{" "}
                <span className="text-destructive-foreground">-{file.deletions}</span>
              </span>
              <Button onClick={() => onOpenCurrentFile(file.path)} size="xs" variant="outline">
                Open current worktree version
              </Button>
              {!file.binary && !file.unifiedDiff ? (
                <Button
                  onClick={() => onLoadCommitPatch?.(commit.oid, file.path)}
                  size="xs"
                  variant="ghost"
                >
                  Load patch
                </Button>
              ) : null}
            </div>
            {file.binary ? (
              <p className="border-t p-3 text-muted-foreground text-xs">Binary file changed.</p>
            ) : null}
            {file.unifiedDiff ? (
              <pre className="max-h-80 overflow-auto border-t bg-muted/24 p-3 text-xs">
                <code>{file.unifiedDiff}</code>
              </pre>
            ) : null}
            {file.truncated ? (
              <p className="border-t p-2 text-warning-foreground text-xs">Patch truncated.</p>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}
