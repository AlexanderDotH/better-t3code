import type {
  GitApplyChangeSelectionInput,
  GitChangeSelection,
  GitChangesDiffResult,
  GitHistoryListInput,
  GitHistoryListResult,
  GitQueuedWorkflowPlan,
} from "@t3tools/contracts";
import { isValidRebasePlan } from "./rebase-plan";

export function resolveChangeSelection(
  current: {
    readonly targetKey: string;
    readonly patchKey: string;
    readonly selection: GitChangeSelection;
  } | null,
  targetKey: string,
  patchKey: string,
): GitChangeSelection {
  if (!current || current.targetKey !== targetKey) return { kind: "file" };
  if (current.patchKey === patchKey || current.selection.kind === "file") return current.selection;
  return { kind: current.selection.kind, ids: [] };
}

export function toggleChangeSelection(
  selection: GitChangeSelection,
  kind: "hunks" | "lines",
  id: string,
): GitChangeSelection {
  const ids = selection.kind === kind ? selection.ids : [];
  return { kind, ids: ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id] };
}

export function buildChangeSelectionInput(
  cwd: string,
  diff: GitChangesDiffResult,
  action: GitApplyChangeSelectionInput["action"],
  selection: GitChangeSelection,
  stateToken: string,
  untracked = false,
): GitApplyChangeSelectionInput | null {
  if (diff.stateToken !== stateToken || diff.truncated) return null;
  if (action === "discard" && untracked && selection.kind !== "file") return null;
  if (selection.kind !== "file") {
    if (diff.binary || diff.oldPath || selection.ids.length === 0) return null;
    const validIds = new Set(
      selection.kind === "hunks"
        ? diff.hunks
            .filter((hunk) => hunk.lines.some((line) => line.selectable))
            .map((hunk) => hunk.id)
        : diff.hunks.flatMap((hunk) =>
            hunk.lines.filter((line) => line.selectable).map((line) => line.id),
          ),
    );
    if (selection.ids.some((id) => !validIds.has(id))) return null;
  }
  return {
    cwd,
    path: diff.path,
    source: diff.source,
    action,
    selection,
    expectedStateToken: diff.stateToken,
    expectedPatchId: diff.patchId,
    ...(action === "discard" && untracked ? { confirmedUntrackedDeletion: true } : {}),
  };
}

export function deriveConflictState(contents: string | null, truncated: boolean) {
  const hasMarkers = contents !== null && /^(?:<{7,}|\|{7,}|={7,}|>{7,})(?:\s|$)/m.test(contents);
  return { hasMarkers, canResolve: contents !== null && !truncated && !hasMarkers };
}

export function historyPageInput(
  cwd: string,
  filters: { readonly refName: string; readonly path: string },
  previous: Pick<GitHistoryListResult, "snapshotOid" | "nextCursor"> | null,
): GitHistoryListInput | null {
  if (previous !== null && (previous.nextCursor === null || previous.snapshotOid === null))
    return null;
  const refName = filters.refName.trim();
  const path = filters.path.trim();
  return {
    cwd,
    limit: 25,
    cursor: previous?.nextCursor ?? 0,
    ...(previous?.snapshotOid ? { snapshotOid: previous.snapshotOid } : {}),
    ...(refName ? { refName } : {}),
    ...(path ? { path } : {}),
  };
}

export function isValidQueuedWorkflowPlan(plan: GitQueuedWorkflowPlan): boolean {
  if (plan.kind === "delivery")
    return (
      (!plan.createPullRequest || plan.push) &&
      (plan.stage.mode !== "paths" ||
        (plan.stage.paths.length > 0 && plan.stage.paths.every((path) => path.trim().length > 0)))
    );
  const action = plan.action;
  if (action.kind === "guided_rebase") return action.ontoRef.trim().length > 0;
  if (action.kind === "interactive_rebase")
    return !!action.upstreamRef.trim() && isValidRebasePlan(action.plan);
  const oid = action.kind === "reset" ? action.targetOid : action.commitOid;
  return /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(oid);
}
