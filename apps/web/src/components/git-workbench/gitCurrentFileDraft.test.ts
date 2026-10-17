import { describe, expect, it } from "vite-plus/test";

import { createGitCurrentFileDraft, reconcileGitCurrentFileDraft } from "./gitCurrentFileDraft";
import type { GitCurrentFileState } from "./GitWorkbench.types";

const file: GitCurrentFileState = {
  baseContent: "old",
  content: "old",
  loading: false,
  path: "src/app.ts",
  revision: "revision-1",
  saveState: "idle",
};

describe("Git current-file drafts", () => {
  it("keeps unsaved content and its original revision when the same file refreshes", () => {
    const draft = { ...createGitCurrentFileDraft(file), content: "mine" };
    expect(
      reconcileGitCurrentFileDraft(draft, { ...file, content: "agent", revision: "revision-2" }),
    ).toBe(draft);
    expect(
      reconcileGitCurrentFileDraft(draft, { ...file, loading: true, revision: "loading" }),
    ).toBe(draft);
  });

  it("follows server refreshes while clean and rebases only an acknowledged save", () => {
    const fresh = { ...file, content: "agent", revision: "revision-2" };
    expect(reconcileGitCurrentFileDraft(createGitCurrentFileDraft(file), fresh)).toMatchObject({
      baseContent: "agent",
      content: "agent",
      revision: "revision-2",
    });
    const draft = { ...createGitCurrentFileDraft(file), content: "mine" };
    expect(
      reconcileGitCurrentFileDraft(draft, {
        ...file,
        content: "mine",
        revision: "revision-3",
        saveState: "saved",
      }),
    ).toEqual({
      baseContent: "mine",
      content: "mine",
      path: file.path,
      revision: "revision-3",
    });
  });

  it("restores a scoped draft after unmount and resets when the opened path changes", () => {
    const draft = createGitCurrentFileDraft(file, {
      content: "retained",
      path: file.path,
      revision: "captured-revision",
    });
    expect(draft).toMatchObject({ content: "retained", revision: "captured-revision" });
    expect(
      reconcileGitCurrentFileDraft(draft, { ...file, path: "other.ts", content: "other" }),
    ).toMatchObject({ path: "other.ts", content: "other", revision: "revision-1" });
    expect(
      createGitCurrentFileDraft(file, { content: "wrong", path: "other.ts", revision: "wrong" }),
    ).toEqual(createGitCurrentFileDraft(file));
  });
});
