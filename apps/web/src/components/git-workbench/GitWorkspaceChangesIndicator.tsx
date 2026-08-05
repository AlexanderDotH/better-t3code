import { cn } from "~/lib/utils";

import type { GitCompactStatus } from "./GitCompactCard";

export interface GitWorkspaceChangesIndicatorProps {
  readonly blocked: boolean;
  readonly status: GitCompactStatus;
}

function indicatorCopy(status: GitCompactStatus): {
  readonly accessibleLabel: string;
  readonly visibleLabel: string;
} {
  if (status.kind === "stale") {
    return {
      accessibleLabel: "Repository status refreshing",
      visibleLabel: "Refreshing",
    };
  }
  if (status.kind === "disconnected" || status.kind === "unavailable") {
    return {
      accessibleLabel: "Repository unavailable",
      visibleLabel: "Unavailable",
    };
  }

  const countLabel = `${status.changeCount} ${status.changeCount === 1 ? "change" : "changes"}`;
  return {
    accessibleLabel: `${countLabel}${status.conflicts > 0 ? ", conflicts present" : ""}`,
    visibleLabel: countLabel,
  };
}

export function GitWorkspaceChangesIndicator(props: GitWorkspaceChangesIndicatorProps) {
  const copy = indicatorCopy(props.status);

  return (
    <span
      className={cn(
        "git-workspace-changes-indicator pointer-events-none relative z-10 hidden min-w-0 shrink-0 items-center gap-1 px-1.5 text-muted-foreground/70 md:inline-flex",
        props.blocked && "opacity-60",
      )}
      data-git-workspace-changes-indicator="true"
      data-repository-state={props.status.kind}
      aria-label={copy.accessibleLabel}
    >
      <span className="git-workspace-changes-indicator__dot" aria-hidden />
      <span className="whitespace-nowrap" aria-hidden>
        {copy.visibleLabel}
      </span>
    </span>
  );
}
