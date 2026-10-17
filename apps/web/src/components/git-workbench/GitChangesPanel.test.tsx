import type { ComponentProps } from "react";
import { act, useState } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { GitChangesPanel } from "./GitChangesPanel";
import { GitCurrentFilePanel } from "./GitCurrentFilePanel";
import type { GitCurrentFileState, GitWorkbenchChange } from "./GitWorkbench.types";

const editorLifecycle = vi.hoisted(() => ({ created: 0, cleaned: 0 }));

vi.mock("~/hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useInterfaceTranslator: () => translator };
});
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { wordWrap: boolean }) => unknown) =>
    select({ wordWrap: false }),
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@pierre/diffs/editor", () => ({
  Editor: class {
    readonly onChange: (file: { contents: string }) => void;
    constructor(options: { onChange: (file: { contents: string }) => void }) {
      this.onChange = options.onChange;
      editorLifecycle.created += 1;
    }
    cleanUp() {
      editorLifecycle.cleaned += 1;
    }
  },
}));
vi.mock("~/components/files/WorkspaceFileEditorSurface", () => ({
  WorkspaceFileEditorSurface: (props: {
    ariaLabel: string;
    contentEditable: boolean;
    file: { contents: string };
    editor: { onChange: (file: { contents: string }) => void };
  }) => (
    <textarea
      aria-label={props.ariaLabel}
      onChange={(event) => props.editor.onChange({ contents: event.currentTarget.value })}
      readOnly={!props.contentEditable}
      value={props.file.contents}
    />
  ),
}));
vi.mock("~/components/ui/checkbox", () => ({
  Checkbox: (props: {
    "aria-label": string;
    checked: boolean;
    disabled?: boolean;
    indeterminate?: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <input
      aria-checked={props.indeterminate ? "mixed" : props.checked}
      aria-label={props["aria-label"]}
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onCheckedChange(event.currentTarget.checked)}
      type="checkbox"
    />
  ),
}));
vi.mock("./GitWorkbenchConfirmation", () => ({
  GitWorkbenchConfirmation: (props: {
    disabled: boolean;
    onConfirm: () => void;
    triggerLabel: string;
  }) => (
    <button disabled={props.disabled} onClick={props.onConfirm} type="button">
      {props.triggerLabel}
    </button>
  ),
}));

function change(
  source: "index" | "worktree",
  overrides: Partial<GitWorkbenchChange> = {},
): GitWorkbenchChange {
  return {
    additions: 1,
    binary: false,
    deletions: 1,
    diff: {
      hunks: [
        {
          header: "@@ -1 +1 @@",
          id: `hunk-${source}`,
          lines: [
            {
              content: `old-${source}`,
              id: `old-${source}`,
              kind: "deletion",
              newLine: null,
              oldLine: 1,
              selectable: true,
            },
            {
              content: `new-${source}`,
              id: `new-${source}`,
              kind: "addition",
              newLine: 1,
              oldLine: null,
              selectable: true,
            },
          ],
        },
      ],
      patchId: `patch-${source}`,
      source,
    },
    id: `src/app.ts::${source}`,
    kind: "modified",
    modeChanged: false,
    path: "src/app.ts",
    staged: source === "index",
    submodule: false,
    unstaged: source === "worktree",
    untracked: false,
    ...overrides,
  };
}

const currentFile: GitCurrentFileState = {
  baseContent: "old",
  content: "old",
  loading: false,
  path: "src/app.ts",
  revision: "revision-1",
  saveState: "idle",
};
const index = change("index");
const worktree = change("worktree");
const baseProps = (): ComponentProps<typeof GitChangesPanel> => ({
  changes: [index, worktree],
  currentFile,
  onApplySelection: vi.fn(),
  onOpenCurrentFile: vi.fn(),
  onRefreshChange: vi.fn(),
  onSaveCurrentFile: vi.fn(),
  onSelectChange: vi.fn(),
  onSetFilesStaged: vi.fn(),
  readOnly: false,
  selectedChangeId: null,
  stateToken: "state-1",
});

function nodeText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : nodeText(child)))
    .join("");
}
function button(renderer: ReactTestRenderer, label: string) {
  const found = renderer.root
    .findAllByType("button")
    .find((node) => node.props["aria-label"] === label || nodeText(node).trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function checkbox(renderer: ReactTestRenderer, label: string) {
  const found = renderer.root
    .findAllByType("input")
    .find((node) => node.props["aria-label"] === label);
  if (!found) throw new Error(`Missing checkbox: ${label}`);
  return found;
}

let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  editorLifecycle.created = 0;
  editorLifecycle.cleaned = 0;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("GitChangesPanel", () => {
  it("shows one index-controlled checkbox for a partially staged path", async () => {
    const props = baseProps();
    await act(async () => {
      renderer = create(<GitChangesPanel {...props} />);
    });
    expect(renderer.root.findAllByProps({ "data-git-review-path": "src/app.ts" })).toHaveLength(1);
    const stageCheckbox = checkbox(renderer, "Stage src/app.ts");
    expect(stageCheckbox.props["aria-checked"]).toBe("mixed");

    await act(async () => stageCheckbox.props.onChange({ currentTarget: { checked: true } }));
    expect(props.onSetFilesStaged).toHaveBeenCalledWith(["src/app.ts"], true);
    expect(checkbox(renderer, "Stage src/app.ts").props["aria-checked"]).toBe("mixed");

    await act(async () => renderer.update(<GitChangesPanel {...props} changes={[index]} />));
    expect(checkbox(renderer, "Unstage src/app.ts").props["aria-checked"]).toBe(true);
    await act(async () =>
      checkbox(renderer, "Unstage src/app.ts").props.onChange({
        currentTarget: { checked: false },
      }),
    );
    expect(props.onSetFilesStaged).toHaveBeenLastCalledWith(["src/app.ts"], false);
  });

  it("selects Diff without opening the current file and switches staged/worktree sources", async () => {
    const open = vi.fn();
    function Review() {
      const [selected, select] = useState<string | null>(null);
      return (
        <GitChangesPanel
          {...baseProps()}
          onOpenCurrentFile={open}
          onSelectChange={select}
          selectedChangeId={selected}
        />
      );
    }
    await act(async () => {
      renderer = create(<Review />);
    });
    const row = renderer.root.findByProps({ "data-git-review-path": "src/app.ts" });
    await act(async () => row.findByType("button").props.onClick());
    expect(open).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
    expect(nodeText(renderer.root)).toContain("new-worktree");
    await act(async () => button(renderer, "Staged").props.onClick());
    expect(nodeText(renderer.root)).toContain("new-index");
    expect(nodeText(renderer.root)).not.toContain("new-worktree");
    await act(async () => button(renderer, "Back to changed files").props.onClick());
    expect(renderer.root.findAllByProps({ "data-git-change-detail": "content" })).toHaveLength(0);
  });

  it("opens only the explicit editor, waits for the read, and leaves a rejected Back in place", async () => {
    const close = vi.fn();
    const props = { ...baseProps(), selectedChangeId: worktree.id, onCloseCurrentFile: close };
    await act(async () => {
      renderer = create(<GitChangesPanel {...props} />);
    });
    await act(async () => button(renderer, "Edit src/app.ts").props.onClick());
    expect(props.onOpenCurrentFile).toHaveBeenCalledWith("src/app.ts");

    await act(async () =>
      renderer.update(
        <GitChangesPanel
          {...props}
          editorPath={currentFile.path}
          currentFile={{ ...currentFile, loading: true, revision: "loading" }}
        />,
      ),
    );
    expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
    expect(nodeText(renderer.root)).toContain("Loading current working tree file");
    await act(async () =>
      renderer.update(<GitChangesPanel {...props} editorPath={currentFile.path} />),
    );
    expect(renderer.root.findByType("textarea").props.value).toBe("old");
    expect(renderer.root.findAllByProps({ "data-git-change-detail": "content" })).toHaveLength(0);
    await act(async () => button(renderer, "Back to Diff").props.onClick());
    expect(close).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByType("textarea")).toHaveLength(1);
    await act(async () => renderer.update(<GitChangesPanel {...props} editorPath={null} />));
    expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
    expect(nodeText(renderer.root)).toContain("new-worktree");
  });

  it("retains hunk/line staging and clears old selections when a diff becomes stale", async () => {
    const props = { ...baseProps(), selectedChangeId: worktree.id };
    await act(async () => {
      renderer = create(<GitChangesPanel {...props} />);
    });
    await act(async () =>
      checkbox(renderer, "Select hunk @@ -1 +1 @@").props.onChange({
        currentTarget: { checked: true },
      }),
    );
    await act(async () =>
      checkbox(renderer, "Select deletion line 1").props.onChange({
        currentTarget: { checked: false },
      }),
    );
    await act(async () => button(renderer, "Stage selection").props.onClick());
    expect(props.onApplySelection).toHaveBeenCalledWith({
      action: "stage",
      changeId: worktree.id,
      expectedPatchId: "patch-worktree",
      expectedStateToken: "state-1",
      hunkIds: [],
      lineIds: ["new-worktree"],
      path: worktree.path,
      source: "worktree",
    });

    await act(async () =>
      renderer.update(
        <GitChangesPanel
          {...props}
          changes={[index, { ...worktree, diff: { ...worktree.diff!, stale: true } }]}
        />,
      ),
    );
    expect(button(renderer, "Stage file").props.disabled).toBe(true);
    expect(checkbox(renderer, "Select addition line 1").props.checked).toBe(false);
    await act(async () => button(renderer, "Refresh diff").props.onClick());
    expect(props.onRefreshChange).toHaveBeenCalledWith(worktree.path);
  });

  it("All and None act on eligible paths, preserve review, and display partial failure", async () => {
    const conflict = change("worktree", {
      path: "conflict.ts",
      id: "conflict.ts::conflict",
      conflict: "both-modified",
    });
    const fresh = change("worktree", {
      path: "new.ts",
      id: "new.ts::worktree",
      kind: "untracked",
      untracked: true,
    });
    const props = { ...baseProps(), changes: [index, worktree, conflict, fresh] };
    await act(async () => {
      renderer = create(<GitChangesPanel {...props} />);
    });
    await act(async () => button(renderer, "Stage all files").props.onClick());
    await act(async () => button(renderer, "Unstage all files").props.onClick());
    expect(props.onSetFilesStaged).toHaveBeenNthCalledWith(1, ["src/app.ts", "new.ts"], true);
    expect(props.onSetFilesStaged).toHaveBeenNthCalledWith(2, ["src/app.ts"], false);
    expect(checkbox(renderer, "Stage conflict.ts").props.disabled).toBe(true);
    await act(async () =>
      renderer.update(
        <GitChangesPanel
          {...props}
          stagingPending
          stagingError="Stopped at new.ts. 1 files updated."
        />,
      ),
    );
    expect(button(renderer, "Stage all files").props.disabled).toBe(true);
    expect(nodeText(renderer.root.findByProps({ role: "alert" }))).toContain("1 files updated");
    expect(renderer.root.findAllByProps({ "data-git-review-path": "src/app.ts" })).toHaveLength(1);
  });

  it("blocks index edits during an active turn while preserving buffered file editing", async () => {
    const props = { ...baseProps(), selectedChangeId: worktree.id, indexReadOnly: true };
    await act(async () => {
      renderer = create(<GitChangesPanel {...props} />);
    });
    expect(checkbox(renderer, "Stage src/app.ts").props.disabled).toBe(true);
    expect(button(renderer, "Stage file").props.disabled).toBe(true);
    await act(async () =>
      renderer.update(
        <GitChangesPanel
          {...props}
          editorPath={currentFile.path}
          currentFile={{ ...currentFile, saveState: "buffered" }}
        />,
      ),
    );
    expect(renderer.root.findByType("textarea").props.readOnly).toBe(false);
    expect(nodeText(renderer.root)).toContain("buffered until the active agent turn settles");
  });

  it("keeps explicit conflict resolution staging available during an operation", async () => {
    const conflict = change("worktree", { id: "src/app.ts::conflict", conflict: "both-modified" });
    await act(async () => {
      renderer = create(
        <GitChangesPanel
          {...baseProps()}
          changes={[conflict]}
          selectedChangeId={conflict.id}
          operationActive
        />,
      );
    });
    expect(button(renderer, "Mark resolved").props.disabled).toBe(false);
    expect(button(renderer, "Stage all files").props.disabled).toBe(true);
    expect(checkbox(renderer, "Stage src/app.ts").props.disabled).toBe(true);
  });

  it("supports current-file editing from history without a changed-file entry", async () => {
    const file = { ...currentFile, path: "unchanged.ts" };
    const props = { ...baseProps(), changes: [], currentFile: file, editorPath: file.path };
    await act(async () => {
      renderer = create(<GitChangesPanel {...props} />);
    });
    expect(renderer.root.findByType("textarea").props["aria-label"]).toBe("Edit unchanged.ts");
    await act(async () =>
      renderer.update(
        <GitChangesPanel
          {...props}
          currentFile={{ ...file, content: "", readOnlyReason: "File is unavailable" }}
        />,
      ),
    );
    expect(nodeText(renderer.root)).toContain("File is unavailable");
    expect(renderer.root.findByType("textarea").props.readOnly).toBe(true);
  });

  it.each([
    { kind: "deleted" as const, binary: false },
    { kind: "modified" as const, binary: true },
  ])(
    "keeps whole-file review for $kind binary=$binary without an editor action",
    async (overrides) => {
      const selected = change("worktree", overrides);
      await act(async () => {
        renderer = create(
          <GitChangesPanel {...baseProps()} changes={[selected]} selectedChangeId={selected.id} />,
        );
      });
      expect(
        renderer.root
          .findAllByType("button")
          .some((node) => node.props["aria-label"] === "Edit src/app.ts"),
      ).toBe(false);
      expect(button(renderer, "Stage file").props.disabled).toBe(false);
    },
  );
});

describe("GitCurrentFilePanel drafts", () => {
  it("preserves unsaved typing across refreshes and saves against its captured revision", async () => {
    const save = vi.fn();
    const draft = vi.fn();
    const refreshedDraft = vi.fn();
    await act(async () => {
      renderer = create(
        <GitCurrentFilePanel
          file={currentFile}
          onDraftChange={draft}
          onSave={save}
          readOnly={false}
        />,
      );
    });
    await act(async () =>
      renderer.root.findByType("textarea").props.onChange({ currentTarget: { value: "mine" } }),
    );
    await act(async () =>
      renderer.update(
        <GitCurrentFilePanel
          file={{ ...currentFile, content: "agent", revision: "revision-2" }}
          onDraftChange={refreshedDraft}
          onSave={save}
          readOnly={false}
        />,
      ),
    );
    expect(renderer.root.findByType("textarea").props.value).toBe("mine");
    expect(editorLifecycle.created).toBe(1);
    expect(editorLifecycle.cleaned).toBe(0);
    await act(async () => button(renderer, "Save").props.onClick());
    expect(save).toHaveBeenCalledWith({
      content: "mine",
      expectedRevision: "revision-1",
      path: currentFile.path,
    });
    expect(refreshedDraft).toHaveBeenLastCalledWith({
      content: "mine",
      path: currentFile.path,
      revision: "revision-1",
    });
    await act(async () =>
      renderer.update(
        <GitCurrentFilePanel
          file={{ ...currentFile, content: "mine", revision: "revision-3", saveState: "saved" }}
          onDraftChange={draft}
          onSave={save}
          readOnly={false}
        />,
      ),
    );
    expect(button(renderer, "Save").props.disabled).toBe(true);
    expect(draft).toHaveBeenLastCalledWith({
      content: "mine",
      path: currentFile.path,
      revision: "revision-3",
    });
  });

  it("restores an initial draft once and ignores later seed updates while typing", async () => {
    const props = { file: currentFile, onSave: vi.fn(), readOnly: false };
    await act(async () => {
      renderer = create(
        <GitCurrentFilePanel
          {...props}
          initialDraft={{ content: "retained", path: currentFile.path, revision: "captured" }}
        />,
      );
    });
    expect(renderer.root.findByType("textarea").props.value).toBe("retained");
    await act(async () =>
      renderer.root
        .findByType("textarea")
        .props.onChange({ currentTarget: { value: "new typing" } }),
    );
    await act(async () =>
      renderer.update(
        <GitCurrentFilePanel
          {...props}
          initialDraft={{ content: "stale seed", path: currentFile.path, revision: "other" }}
        />,
      ),
    );
    expect(renderer.root.findByType("textarea").props.value).toBe("new typing");
    await act(async () => button(renderer, "Save").props.onClick());
    expect(props.onSave).toHaveBeenCalledWith({
      content: "new typing",
      expectedRevision: "captured",
      path: currentFile.path,
    });
  });
});
