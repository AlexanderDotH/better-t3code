import { create } from "zustand";
import type { GitCurrentFileDraftInput } from "./gitCurrentFileDraft";

interface GitFileDraftStore {
  readonly drafts: ReadonlyMap<string, GitCurrentFileDraftInput>;
  readonly setDraft: (key: string, draft: GitCurrentFileDraftInput | null) => void;
  readonly clear: () => void;
}

export const useGitFileDraftStore = create<GitFileDraftStore>((set) => ({
  drafts: new Map(),
  setDraft: (key, draft) =>
    set((state) => {
      const previous = state.drafts.get(key);
      if (
        (draft === null && previous === undefined) ||
        (draft !== null &&
          previous?.content === draft.content &&
          previous.path === draft.path &&
          previous.revision === draft.revision)
      )
        return state;
      const drafts = new Map(state.drafts);
      if (draft === null) drafts.delete(key);
      else drafts.set(key, draft);
      return { drafts };
    }),
  clear: () => set((state) => (state.drafts.size === 0 ? state : { drafts: new Map() })),
}));
