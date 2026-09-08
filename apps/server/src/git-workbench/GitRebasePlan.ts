import type { GitRebaseTodoNode } from "@t3tools/contracts";

export type { GitRebaseTodoNode } from "@t3tools/contracts";

export type GitRebaseCommitAction = Extract<GitRebaseTodoNode, { readonly oid: string }>["kind"];

export type GitRebasePlanIssueCode =
  | "duplicate_label"
  | "duplicate_oid"
  | "invalid_fold_target"
  | "invalid_label"
  | "invalid_oid"
  | "dependency_order"
  | "merge_topology"
  | "missing_commit"
  | "unknown_commit"
  | "unknown_label";

export interface GitRebasePlanIssue {
  readonly index: number;
  readonly code: GitRebasePlanIssueCode;
  readonly detail: string;
}

export type GitRebasePlanValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly issues: readonly GitRebasePlanIssue[] };

export interface GitRebaseGraphCommit {
  readonly oid: string;
  readonly parents: readonly string[];
}

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LABEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT_ACTIONS = new Set<GitRebaseCommitAction>([
  "pick",
  "reword",
  "edit",
  "squash",
  "fixup",
  "drop",
]);

function isCommitNode(
  node: GitRebaseTodoNode,
): node is Extract<GitRebaseTodoNode, { readonly oid: string }> {
  return COMMIT_ACTIONS.has(node.kind as GitRebaseCommitAction);
}

function pushInvalidOidIssue(issues: GitRebasePlanIssue[], index: number, oid: string): void {
  if (FULL_OBJECT_ID.test(oid)) return;
  issues.push({
    index,
    code: "invalid_oid",
    detail: "Commit object id must be a full SHA.",
  });
}

function validateLabelName(issues: GitRebasePlanIssue[], index: number, name: string): void {
  if (LABEL_NAME.test(name)) return;
  issues.push({
    index,
    code: "invalid_label",
    detail: "Label names may contain only letters, numbers, dot, underscore, and dash.",
  });
}

export function validateGitRebasePlan(
  nodes: readonly GitRebaseTodoNode[],
): GitRebasePlanValidation {
  const issues: GitRebasePlanIssue[] = [];
  const definedLabels = new Set<string>();
  const seenOids = new Set<string>();
  let hasFoldTarget = false;

  nodes.forEach((node, index) => {
    if (isCommitNode(node)) {
      pushInvalidOidIssue(issues, index, node.oid);
      if (seenOids.has(node.oid)) {
        issues.push({
          index,
          code: "duplicate_oid",
          detail: `Commit ${node.oid} appears more than once.`,
        });
      }
      seenOids.add(node.oid);

      if ((node.kind === "squash" || node.kind === "fixup") && !hasFoldTarget) {
        issues.push({
          index,
          code: "invalid_fold_target",
          detail: `${node.kind} requires a preceding commit in the same topology segment.`,
        });
      }
      hasFoldTarget = node.kind !== "drop";
      return;
    }

    if (node.kind === "label") {
      validateLabelName(issues, index, node.name);
      if (definedLabels.has(node.name)) {
        issues.push({
          index,
          code: "duplicate_label",
          detail: `Label ${node.name} is already defined.`,
        });
      }
      definedLabels.add(node.name);
      return;
    }

    if (node.kind === "reset") {
      validateLabelName(issues, index, node.label);
      if (!definedLabels.has(node.label)) {
        issues.push({
          index,
          code: "unknown_label",
          detail: `Label ${node.label} is not defined yet.`,
        });
      }
      hasFoldTarget = false;
      return;
    }

    validateLabelName(issues, index, node.label);
    pushInvalidOidIssue(issues, index, node.originalOid);
    if (!definedLabels.has(node.label)) {
      issues.push({
        index,
        code: "unknown_label",
        detail: `Label ${node.label} is not defined yet.`,
      });
    }
    hasFoldTarget = true;
  });

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

/** Validates an edited todo against the exact commit graph resolved for this rebase. */
export function validateGitRebasePlanTopology(
  nodes: readonly GitRebaseTodoNode[],
  commits: readonly GitRebaseGraphCommit[],
  upstreamOid: string,
): GitRebasePlanValidation {
  const structural = validateGitRebasePlan(nodes);
  if (!structural.valid) return structural;

  const issues: GitRebasePlanIssue[] = [];
  const graph = new Map(commits.map((commit) => [commit.oid, commit] as const));
  const resolved = new Map<string, string>();
  const labels = new Map<string, string>();
  const seen = new Set<string>();
  let current = upstreamOid;

  const resolvedParent = (oid: string): string | null => {
    if (!graph.has(oid)) return upstreamOid;
    return resolved.get(oid) ?? null;
  };
  const requireDependencies = (commit: GitRebaseGraphCommit, index: number): boolean => {
    const missing = commit.parents.filter((parent) => graph.has(parent) && !seen.has(parent));
    if (missing.length === 0) return true;
    issues.push({
      index,
      code: "dependency_order",
      detail: `Commit ${commit.oid} appears before ${missing[0]}.`,
    });
    return false;
  };

  nodes.forEach((node, index) => {
    if (node.kind === "label") {
      labels.set(node.name, current);
      return;
    }
    if (node.kind === "reset") {
      const target = labels.get(node.label);
      if (target !== undefined) current = target;
      return;
    }

    const oid = node.kind === "merge" ? node.originalOid : node.oid;
    const commit = graph.get(oid);
    if (!commit) {
      issues.push({
        index,
        code: "unknown_commit",
        detail: `Commit ${oid} is outside the prepared rebase range.`,
      });
      return;
    }
    if (!requireDependencies(commit, index)) return;

    if (node.kind === "merge") {
      const firstParent = commit.parents[0];
      const secondParent = commit.parents[1];
      const expectedFirst = firstParent ? resolvedParent(firstParent) : upstreamOid;
      const expectedSecond = secondParent ? resolvedParent(secondParent) : null;
      if (
        commit.parents.length !== 2 ||
        expectedFirst === null ||
        expectedSecond === null ||
        current !== expectedFirst ||
        labels.get(node.label) !== expectedSecond
      ) {
        issues.push({
          index,
          code: "merge_topology",
          detail: `Merge ${oid} no longer preserves both original parents.`,
        });
        return;
      }
      seen.add(oid);
      resolved.set(oid, oid);
      current = oid;
      return;
    }

    const firstParent = commit.parents[0];
    const expectedParent = firstParent ? resolvedParent(firstParent) : upstreamOid;
    if (expectedParent === null || current !== expectedParent) {
      issues.push({
        index,
        code: "dependency_order",
        detail: `Commit ${oid} is no longer applied after its original dependency.`,
      });
      return;
    }
    seen.add(oid);
    if (node.kind === "drop") {
      resolved.set(oid, current);
      return;
    }
    resolved.set(oid, oid);
    current = oid;
  });

  for (const commit of commits) {
    if (seen.has(commit.oid)) continue;
    issues.push({
      index: nodes.length,
      code: "missing_commit",
      detail: `Commit ${commit.oid} is missing from the rebase plan.`,
    });
  }

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderNode(node: GitRebaseTodoNode): string {
  switch (node.kind) {
    case "pick":
    case "edit":
    case "squash":
    case "fixup":
    case "drop":
      return `${node.kind} ${node.oid}`;
    case "reword":
      return `${node.kind} ${node.oid}${node.message ? ` ${sanitizeMessage(node.message)}` : ""}`;
    case "label":
      return `label ${node.name}`;
    case "reset":
      return `reset ${node.label}`;
    case "merge":
      return `merge -${node.messageMode === "reuse" ? "C" : "c"} ${node.originalOid} ${node.label}`;
  }
}

export function renderGitRebasePlan(nodes: readonly GitRebaseTodoNode[]): string {
  return `${nodes.map(renderNode).join("\n")}\n`;
}
