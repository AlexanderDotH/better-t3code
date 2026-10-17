import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import type {
  GitChangeSelectionInput,
  GitOperationState,
  GitWorkbenchChange,
  GitWorkbenchRebaseNode,
} from "./GitWorkbench.types";

export interface GitChangeGroup {
  readonly changes: readonly GitWorkbenchChange[];
  readonly id: "conflicts" | "staged" | "unstaged" | "untracked";
  readonly label: string;
}

const groupDefinitions: readonly Omit<GitChangeGroup, "changes">[] = [
  { id: "conflicts", label: "Conflicts" },
  { id: "staged", label: "Staged" },
  { id: "unstaged", label: "Unstaged" },
  { id: "untracked", label: "Untracked" },
];

const belongsToGroup = (change: GitWorkbenchChange, group: GitChangeGroup["id"]): boolean => {
  if (group === "conflicts") return change.conflict !== undefined;
  if (change.conflict !== undefined) return false;
  if (group === "staged") return change.staged;
  if (group === "unstaged") return change.unstaged;
  return change.untracked;
};

export function groupGitChanges(changes: readonly GitWorkbenchChange[]): readonly GitChangeGroup[] {
  return groupDefinitions
    .map((group) => ({
      ...group,
      changes: changes.filter((change) => belongsToGroup(change, group.id)),
    }))
    .filter((group) => group.changes.length > 0);
}

export interface GitPrimaryActionInput {
  readonly ahead: number;
  readonly behind: number;
  readonly blocked?: boolean;
  readonly conflicts: number;
  readonly operation?: Pick<GitOperationState, "kind"> | null | undefined;
  readonly operationRunning?: boolean;
  readonly pullRequest?: { readonly url: string } | null | undefined;
  readonly readOnly?: boolean;
  readonly pushAvailable?: boolean | undefined;
  readonly pullAvailable?: boolean | undefined;
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
}

export type GitPrimaryActionId =
  | "guided-sync"
  | "prepare-commit"
  | "pull"
  | "push"
  | "resolve-conflicts"
  | "review-operation"
  | "unavailable"
  | "view-history"
  | "view-pull-request";

export interface GitPrimaryAction {
  readonly disabled: boolean;
  readonly id: GitPrimaryActionId;
  readonly label: string;
}

const primaryActionLabelKeys = {
  "guided-sync": "git.workbench.nextAction.guidedSync",
  "prepare-commit": "git.workbench.nextAction.prepareCommit",
  pull: "git.workbench.nextAction.pull",
  push: "git.overview.action.push",
  "resolve-conflicts": "git.overview.action.resolveConflicts",
  "review-operation": "git.workbench.nextAction.reviewOperation",
  unavailable: "git.workbench.nextAction.unavailable",
  "view-history": "git.overview.action.viewHistory",
  "view-pull-request": "git.workbench.nextAction.viewPullRequest",
} as const;

export function deriveGitPrimaryAction(
  input: GitPrimaryActionInput,
  translate?: InterfaceTranslator["message"],
): GitPrimaryAction {
  const recommend = (id: GitPrimaryActionId, label: string): GitPrimaryAction => ({
    disabled:
      input.blocked === true ||
      (input.readOnly === true && (id === "pull" || id === "push")) ||
      (id === "pull" && input.pullAvailable === false) ||
      (id === "push" && input.pushAvailable === false),
    id,
    label: translate?.(primaryActionLabelKeys[id], { count: input.ahead }) ?? label,
  });
  if (input.blocked) return recommend("unavailable", "Git status unavailable");
  if (input.conflicts > 0) return recommend("resolve-conflicts", "Resolve conflicts");
  if (input.operation || input.operationRunning) {
    return recommend("review-operation", "Review Git operation");
  }
  if (input.staged + input.unstaged + input.untracked > 0) {
    return recommend("prepare-commit", "Prepare commit");
  }
  if (input.ahead > 0 && input.behind > 0) return recommend("guided-sync", "Sync branches");
  if (input.behind > 0) return recommend("pull", "Pull");
  if (input.ahead > 0) {
    const suffix = input.ahead === 1 ? "commit" : "commits";
    return recommend("push", `Push ${input.ahead} ${suffix}`);
  }
  if (input.pullRequest) return recommend("view-pull-request", "View pull request");
  return recommend("view-history", "View history");
}

interface HistoryWindowInput {
  readonly itemCount: number;
  readonly rowHeight: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}

export interface HistoryWindow {
  readonly end: number;
  readonly paddingBottom: number;
  readonly paddingTop: number;
  readonly start: number;
}

export function deriveHistoryWindow({
  itemCount,
  rowHeight,
  scrollTop,
  viewportHeight,
}: HistoryWindowInput): HistoryWindow {
  const overscan = 4;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleEnd = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const end = Math.min(itemCount, visibleEnd + overscan);
  return {
    end,
    paddingBottom: Math.max(0, (itemCount - end) * rowHeight),
    paddingTop: start * rowHeight,
    start,
  };
}

export function buildChangeSelection(input: GitChangeSelectionInput): GitChangeSelectionInput {
  return {
    action: input.action,
    changeId: input.changeId,
    ...(input.expectedPatchId ? { expectedPatchId: input.expectedPatchId } : {}),
    expectedStateToken: input.expectedStateToken,
    hunkIds: [...input.hunkIds],
    lineIds: [...input.lineIds],
    path: input.path,
    source: input.source,
  };
}

export function retainValidSelectionIds(
  selectedIds: ReadonlySet<string>,
  availableIds: Iterable<string>,
): ReadonlySet<string> {
  const available = new Set(availableIds);
  return new Set([...selectedIds].filter((id) => available.has(id)));
}

export type RebasePlanValidation =
  | { readonly reason: string; readonly valid: false }
  | { readonly valid: true };

export function validateRebasePlan(nodes: readonly GitWorkbenchRebaseNode[]): RebasePlanValidation {
  const labels = new Set<string>();
  const commitPositions = new Map<string, number>();
  nodes.forEach((node, index) => {
    if ("commitId" in node) commitPositions.set(node.commitId, index);
  });
  for (const [index, node] of nodes.entries()) {
    if (node.kind === "label") {
      if (labels.has(node.label)) {
        return {
          reason: `Label "${node.label}" is defined more than once.`,
          valid: false,
        };
      }
      labels.add(node.label);
      continue;
    }
    if (node.kind === "reset" && !labels.has(node.label)) {
      return {
        reason: `Reset references label "${node.label}" before it is defined.`,
        valid: false,
      };
    }
    if (node.kind === "merge") {
      const missingLabel = node.labels.find((label) => !labels.has(label));
      if (missingLabel) {
        return {
          reason: `Merge references label "${missingLabel}" before it is defined.`,
          valid: false,
        };
      }
    }
    if ("commitId" in node) {
      const lateDependency = node.dependencies?.find(
        (dependency) => (commitPositions.get(dependency) ?? -1) >= index,
      );
      if (lateDependency) {
        return {
          reason: `Commit ${node.commitId.slice(0, 10)} appears before dependency ${lateDependency.slice(0, 10)}.`,
          valid: false,
        };
      }
    }
  }
  return { valid: true };
}
