import type { GitWorkbenchChange } from "./GitWorkbench.types";

export interface GitReviewFile {
  readonly path: string;
  readonly index: GitWorkbenchChange | null;
  readonly worktree: GitWorkbenchChange | null;
  readonly conflict: GitWorkbenchChange | null;
  readonly staging: "none" | "partial" | "full";
}

export function gitReviewFiles(changes: readonly GitWorkbenchChange[]): readonly GitReviewFile[] {
  const files = new Map<string, Omit<GitReviewFile, "staging">>();
  for (const change of changes) {
    const file = files.get(change.path) ?? {
      path: change.path,
      index: null,
      worktree: null,
      conflict: null,
    };
    files.set(change.path, {
      ...file,
      ...(change.conflict
        ? { conflict: change }
        : change.staged
          ? { index: change }
          : { worktree: change }),
    });
  }
  return [...files.values()].map((file) => ({
    ...file,
    staging: file.index ? (file.worktree ? "partial" : "full") : "none",
  }));
}

export function defaultGitReviewChange(file: GitReviewFile): GitWorkbenchChange | null {
  return file.conflict ?? file.worktree ?? file.index;
}
