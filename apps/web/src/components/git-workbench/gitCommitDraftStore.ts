import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import type { GitCommitOutcome } from "../gitActionsControlBus";

export type GitCommitMessageMode = "automatic" | "manual";

export interface GitCommitSubmission {
  readonly version: number;
  readonly message: string;
  readonly mode: GitCommitMessageMode;
}

interface GitCommitDraft {
  readonly message: string;
  readonly mode: GitCommitMessageMode;
  readonly version: number;
  readonly pending: GitCommitSubmission | null;
  readonly outcome: GitCommitOutcome | null;
}

export function gitCommitDraftKey(environmentId: EnvironmentId, cwd: string): string {
  return JSON.stringify([environmentId, cwd]);
}

export const EMPTY_GIT_COMMIT_DRAFT: GitCommitDraft = {
  message: "",
  mode: "automatic",
  version: 0,
  pending: null,
  outcome: null,
};

interface GitCommitDraftStore {
  readonly drafts: ReadonlyMap<string, GitCommitDraft>;
  readonly update: (key: string, change: { message?: string; mode?: GitCommitMessageMode }) => void;
  readonly begin: (key: string) => GitCommitSubmission | null;
  readonly settle: (
    key: string,
    submission: GitCommitSubmission,
    outcome: GitCommitOutcome,
  ) => void;
  readonly clear: () => void;
}

export const useGitCommitDraftStore = create<GitCommitDraftStore>((set, get) => ({
  drafts: new Map(),
  update: (key, change) =>
    set((state) => {
      const previous = state.drafts.get(key) ?? EMPTY_GIT_COMMIT_DRAFT;
      const next = { ...previous, ...change };
      if (next.message === previous.message && next.mode === previous.mode) return state;
      const drafts = new Map(state.drafts);
      drafts.set(key, { ...next, version: previous.version + 1 });
      return { drafts };
    }),
  begin: (key) => {
    const state = get();
    const draft = state.drafts.get(key) ?? EMPTY_GIT_COMMIT_DRAFT;
    if (draft.pending) return null;
    const submission = { version: draft.version, message: draft.message, mode: draft.mode };
    const drafts = new Map(state.drafts);
    drafts.set(key, { ...draft, pending: submission, outcome: null });
    set({ drafts });
    return submission;
  },
  settle: (key, submission, outcome) =>
    set((state) => {
      const draft = state.drafts.get(key);
      if (!draft || draft.pending !== submission) return state;
      const clearMessage =
        outcome.status === "success" &&
        outcome.result.commit.status === "created" &&
        submission.mode === "manual" &&
        draft.version === submission.version;
      const drafts = new Map(state.drafts);
      drafts.set(key, {
        ...draft,
        ...(clearMessage ? { message: "", version: draft.version + 1 } : {}),
        pending: null,
        outcome,
      });
      return { drafts };
    }),
  clear: () => set({ drafts: new Map() }),
}));
