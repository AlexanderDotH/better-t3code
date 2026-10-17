import type { GitCurrentFileState } from "./GitWorkbench.types";

export interface GitCurrentFileDraft {
  readonly baseContent: string;
  readonly content: string;
  readonly path: string;
  readonly revision: string;
}

export type GitCurrentFileDraftInput = Pick<GitCurrentFileDraft, "content" | "path" | "revision">;

export function createGitCurrentFileDraft(
  file: GitCurrentFileState,
  initialDraft?: GitCurrentFileDraftInput | null,
): GitCurrentFileDraft {
  return {
    baseContent: file.content,
    content: initialDraft?.path === file.path ? initialDraft.content : file.content,
    path: file.path,
    revision: initialDraft?.path === file.path ? initialDraft.revision : file.revision,
  };
}

export function reconcileGitCurrentFileDraft(
  draft: GitCurrentFileDraft,
  file: GitCurrentFileState,
): GitCurrentFileDraft {
  if (draft.path === file.path && file.loading) return draft;
  if (
    draft.path !== file.path ||
    draft.content === draft.baseContent ||
    draft.content === file.content
  ) {
    if (
      draft.path === file.path &&
      draft.baseContent === file.content &&
      draft.content === file.content &&
      draft.revision === file.revision
    ) {
      return draft;
    }
    return createGitCurrentFileDraft(file);
  }
  return draft;
}
