import { ArrowUpIcon, GitBranchIcon, GitCommitHorizontalIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { shouldExpandGitCompactPull } from "./gitWorkspaceDeck.logic";

import "./GitWorkspaceDeck.css";

export type GitRepositoryStateKind =
  | "clean"
  | "changed"
  | "conflicted"
  | "detached"
  | "unborn"
  | "stale"
  | "disconnected"
  | "unavailable";

export interface GitCompactStatus {
  readonly kind: GitRepositoryStateKind;
  readonly label: string;
  readonly branch: string | null;
  readonly changeCount: number;
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
  readonly conflicts: number;
  readonly additions: number;
  readonly deletions: number;
  readonly ahead: number;
  readonly behind: number;
  readonly updatedAtLabel: string;
  readonly detailsPending?: boolean;
}

export interface GitCompactQuickAction {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface GitCompactCardProps {
  readonly status: GitCompactStatus;
  readonly lastCommit?: {
    readonly summary: string;
    readonly ageLabel: string;
  } | null;
  readonly expanded?: boolean;
  readonly expansionBlocked?: boolean;
  readonly expandButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly quickAction?: GitCompactQuickAction | null;
  readonly className?: string;
  readonly workbench?: ReactNode;
  readonly onExpand: () => void;
}

function Divergence({ ahead, behind }: { ahead: number; behind: number }) {
  const translate = useInterfaceTranslator().message;
  if (ahead === 0 && behind === 0) return <span>{translate("git.workbench.upToDate")}</span>;

  return (
    <span className="git-compact-card__divergence">
      {ahead > 0 ? translate("git.workbench.aheadCount", { count: ahead }) : null}
      {ahead > 0 && behind > 0 ? <span aria-hidden> · </span> : null}
      {behind > 0 ? translate("git.workbench.behindCount", { count: behind }) : null}
    </span>
  );
}

interface PullState {
  readonly button: number;
  readonly isPrimary: boolean;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
}

function changeSummary(
  status: GitCompactStatus,
  translate: InterfaceTranslator["message"],
): string {
  const changes = translate("git.workbench.changeCount", { count: status.changeCount });
  if (status.conflicts > 0) {
    return translate("git.workbench.conflictSummary", {
      conflicts: translate("git.workbench.conflictCount", { count: status.conflicts }),
      changes,
    });
  }
  if (status.changeCount > 0) return changes;
  if (status.kind === "disconnected") return translate("git.workbench.repositoryDisconnected");
  if (status.kind === "unavailable") return translate("git.workbench.repositoryUnavailable");
  if (status.kind === "stale") return translate("git.workbench.statusRefreshing");
  if (status.kind === "clean") return translate("git.workbench.clean");
  return translate("git.workbench.noChanges");
}

export function GitCompactCard(props: GitCompactCardProps) {
  const translate = useInterfaceTranslator().message;
  const pullHandleRef = useRef<HTMLDivElement | null>(null);
  const pullStateRef = useRef<PullState | null>(null);
  const resetPull = useCallback((releaseCapture = true) => {
    const handle = pullHandleRef.current;
    const pull = pullStateRef.current;
    pullStateRef.current = null;
    handle?.removeAttribute("data-pull-ready");
    if (!releaseCapture || !handle || !pull || !handle.hasPointerCapture(pull.pointerId)) return;
    try {
      handle.releasePointerCapture(pull.pointerId);
    } catch {
      // Native cancellation can release capture before React receives its cleanup event.
    }
  }, []);
  const pullResult = useCallback(
    (pull: PullState, event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) =>
      shouldExpandGitCompactPull({
        button: pull.button,
        cancelled,
        endX: event.clientX,
        endY: event.clientY,
        isPrimary: pull.isPrimary,
        startX: pull.startX,
        startY: pull.startY,
      }),
    [],
  );

  useEffect(() => {
    if (props.expanded || props.expansionBlocked) resetPull();
    return resetPull;
  }, [props.expanded, props.expansionBlocked, resetPull]);

  const handlePullStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (props.expanded || props.expansionBlocked || !event.isPrimary || event.button !== 0)
        return;
      event.preventDefault();
      pullStateRef.current = {
        button: event.button,
        isPrimary: event.isPrimary,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers may not support capture; the gesture still works inside the handle.
      }
    },
    [props.expanded, props.expansionBlocked],
  );
  const handlePullMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pull = pullStateRef.current;
      if (!pull || pull.pointerId !== event.pointerId) return;
      event.currentTarget.toggleAttribute("data-pull-ready", pullResult(pull, event, false));
    },
    [pullResult],
  );
  const handlePullEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pull = pullStateRef.current;
      if (!pull || pull.pointerId !== event.pointerId) return;
      event.preventDefault();
      const shouldExpand = pullResult(pull, event, false);
      resetPull();
      if (shouldExpand && !props.expansionBlocked) props.onExpand();
    },
    [props.expansionBlocked, props.onExpand, pullResult, resetPull],
  );
  const handlePullCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pullStateRef.current?.pointerId === event.pointerId) resetPull(false);
    },
    [resetPull],
  );

  return (
    <article
      className={cn("git-compact-card", !props.expanded && "h-full", props.className)}
      data-expanded={props.expanded ? "true" : undefined}
      data-repository-state={props.status.kind}
      data-workspace-card-compact-surface="true"
      aria-label={
        props.expanded
          ? translate("git.workbench.title")
          : translate("git.workbench.repositoryOverview")
      }
    >
      <div
        className="workspace-card-deck__card-content git-compact-card__content"
        data-workspace-card-compact-content="true"
        hidden={props.expanded}
      >
        <div
          ref={pullHandleRef}
          className="git-compact-card__pull-handle"
          data-git-compact-pull-handle="true"
          data-disabled={props.expansionBlocked ? "true" : undefined}
          aria-hidden="true"
          onLostPointerCapture={() => resetPull(false)}
          onPointerCancel={handlePullCancel}
          onPointerDown={handlePullStart}
          onPointerMove={handlePullMove}
          onPointerUp={handlePullEnd}
        >
          <span />
        </div>
        <header className="git-compact-card__header">
          <div className="min-w-0">
            <div className="git-compact-card__branch-row">
              <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
              <strong className="truncate font-medium text-sm">
                {props.status.branch ?? translate("git.workbench.noBranch")}
              </strong>
              <span className="git-compact-card__state" data-repository-state={props.status.kind}>
                {translate(`git.workbench.state.${props.status.kind}`)}
              </span>
            </div>
            <div className="git-compact-card__freshness">
              <Divergence ahead={props.status.ahead} behind={props.status.behind} />
              <span aria-hidden> · </span>
              <span>{props.status.updatedAtLabel}</span>
            </div>
          </div>
          <div className="git-compact-card__header-actions">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    ref={props.expandButtonRef}
                    type="button"
                    className="git-compact-card__header-action"
                    aria-label={translate("git.workbench.expand")}
                    disabled={props.expansionBlocked}
                    onClick={props.onExpand}
                  />
                }
              >
                <ArrowUpIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup side="top">{translate("git.workbench.expand")}</TooltipPopup>
            </Tooltip>
          </div>
        </header>

        <section
          className="git-compact-card__summary"
          aria-label={translate("git.workbench.workingTreeSummary")}
        >
          <strong className="git-compact-card__change-total">
            {changeSummary(props.status, translate)}
          </strong>
          <span className="git-compact-card__diff-stat">
            <span
              className="font-mono text-success"
              aria-label={translate("git.workbench.additionCount", {
                count: props.status.additions,
              })}
            >
              +{props.status.additions}
            </span>
            <span
              className="font-mono text-destructive"
              aria-label={translate("git.workbench.deletionCount", {
                count: props.status.deletions,
              })}
            >
              −{props.status.deletions}
            </span>
          </span>
          {props.status.detailsPending ? (
            <span className="git-compact-card__summary-pending">
              {translate("git.workbench.detailsLoading")}
            </span>
          ) : (
            <div className="git-compact-card__summary-groups">
              <span>{translate("git.workbench.stagedCount", { count: props.status.staged })}</span>
              <span>
                {translate("git.workbench.unstagedCount", { count: props.status.unstaged })}
              </span>
              <span>
                {translate("git.workbench.untrackedCount", { count: props.status.untracked })}
              </span>
              <span>
                {translate("git.workbench.conflictsCount", { count: props.status.conflicts })}
              </span>
            </div>
          )}
        </section>

        <footer className="git-compact-card__footer">
          <div className="git-compact-card__last-commit">
            <GitCommitHorizontalIcon aria-hidden className="size-3.5 shrink-0" />
            {props.lastCommit ? (
              <span className="truncate">
                {props.lastCommit.summary}
                <span className="text-muted-foreground"> · {props.lastCommit.ageLabel}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{translate("git.workbench.noCommits")}</span>
            )}
          </div>
          {props.quickAction ? (
            <button
              type="button"
              className="git-compact-card__quick-action"
              disabled={props.quickAction.disabled}
              onClick={props.quickAction.onSelect}
            >
              {props.quickAction.label}
            </button>
          ) : null}
        </footer>
      </div>
      {props.workbench}
    </article>
  );
}
