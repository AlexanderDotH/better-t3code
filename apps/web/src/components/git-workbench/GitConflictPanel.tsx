import { GitMerge } from "lucide-react";

import { Badge } from "~/components/ui/badge";

import type { GitWorkbenchChange } from "./GitWorkbench.types";

export function GitConflictPanel({ change }: { readonly change: GitWorkbenchChange }) {
  return (
    <section aria-labelledby="git-conflict-heading" className="border-b bg-warning/5 p-3">
      <div className="flex items-center gap-2">
        <GitMerge aria-hidden="true" className="size-4 text-warning-foreground" />
        <h3 className="font-medium text-sm" id="git-conflict-heading">
          Resolve conflict in {change.path}
        </h3>
        <Badge variant="warning">{change.conflict?.replaceAll("-", " ")}</Badge>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        Edit the current worktree result below. Stage the whole file after all conflict markers are
        removed.
      </p>
      {change.conflictVersions ? (
        <div className="mt-3 grid gap-2 @2xl/git-panel:grid-cols-3">
          <ConflictVersion content={change.conflictVersions.base} label="Base" />
          <ConflictVersion content={change.conflictVersions.ours} label="Ours" />
          <ConflictVersion content={change.conflictVersions.theirs} label="Theirs" />
        </div>
      ) : null}
      <p className="mt-2 font-medium text-xs">Current result</p>
    </section>
  );
}

function ConflictVersion({ content, label }: { content: string | null; label: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background">
      <h4 className="border-b px-2 py-1 font-medium text-xs">{label}</h4>
      <pre className="max-h-32 overflow-auto p-2 text-xs">
        <code>{content ?? "Version not available"}</code>
      </pre>
    </div>
  );
}
