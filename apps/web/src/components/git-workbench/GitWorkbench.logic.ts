import type {
  GitChangeSelectionInput,
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

interface GitPrimaryActionCounts {
  readonly ahead: number;
  readonly conflicts: number;
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
}

export type GitPrimaryActionId =
  | "commit-staged"
  | "push"
  | "resolve-conflicts"
  | "stage-all-and-commit"
  | "view-history";

export function deriveGitPrimaryAction(counts: GitPrimaryActionCounts): {
  readonly id: GitPrimaryActionId;
  readonly label: string;
} {
  if (counts.conflicts > 0) return { id: "resolve-conflicts", label: "Resolve conflicts" };
  if (counts.staged > 0) {
    const suffix = counts.staged === 1 ? "file" : "files";
    return { id: "commit-staged", label: `Commit ${counts.staged} staged ${suffix}` };
  }
  if (counts.unstaged + counts.untracked > 0) {
    return { id: "stage-all-and-commit", label: "Stage all & commit" };
  }
  if (counts.ahead > 0) return { id: "push", label: `Push ${counts.ahead} commits` };
  return { id: "view-history", label: "View history" };
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
