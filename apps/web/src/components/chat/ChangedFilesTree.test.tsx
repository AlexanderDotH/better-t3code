// @vitest-environment jsdom

import { TurnId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { ChangedFilesCard, ChangedFilesTree } from "./ChangedFilesTree";

describe("ChangedFilesCard", () => {
  it("shows three compact results and preserves diff, context menu, and expand/collapse actions", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onOpenTurnDiff = vi.fn();
    const onFileContextMenu = vi.fn();
    const turnId = TurnId.make("compact-turn");
    const files = Array.from({ length: 5 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      kind: "modified",
      additions: index + 1,
      deletions: 0,
    }));
    function Harness() {
      const [expanded, onExpandedChange] = useState(false);
      return (
        <ChangedFilesCard
          turnId={turnId}
          files={files}
          allDirectoriesExpanded={false}
          resolvedTheme="light"
          onToggleAllDirectories={() => {}}
          onOpenTurnDiff={onOpenTurnDiff}
          onFileContextMenu={onFileContextMenu}
          compactPresentation={{ expanded, onExpandedChange }}
        />
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(() => root.render(<Harness />));
      const fileButtons = () => [
        ...host.querySelectorAll<HTMLButtonElement>("button[data-presentation-file]"),
      ];
      expect(fileButtons().map((button) => button.dataset.presentationFile)).toEqual(
        files.slice(0, 3).map((file) => file.path),
      );
      await act(() => fileButtons()[1]!.click());
      expect(onOpenTurnDiff).toHaveBeenCalledWith(turnId, "src/file-1.ts");
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      await act(() => {
        fileButtons()[1]!.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
      expect(onFileContextMenu).toHaveBeenCalledWith(
        "src/file-1.ts",
        expect.objectContaining({ nativeEvent: event }),
      );
      await act(() =>
        host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click(),
      );
      expect(fileButtons()).toHaveLength(5);
      await act(() => fileButtons()[4]!.click());
      expect(onOpenTurnDiff).toHaveBeenLastCalledWith(turnId, "src/file-4.ts");
      await act(() =>
        host.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')!.click(),
      );
      expect(fileButtons()).toHaveLength(3);
    } finally {
      await act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps its compact header sticky while preserving singular labels", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesCard
        turnId={TurnId.make("turn-1")}
        files={[{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }]}
        allDirectoriesExpanded
        resolvedTheme="light"
        onToggleAllDirectories={() => {}}
        onOpenTurnDiff={() => {}}
      />,
    );

    expect(markup).toContain('data-changed-files-state="tree"');
    expect(markup).toContain('aria-label="Open diff"');
    expect(markup).toContain('role="group" aria-label="2 additions, 1 deletions"');
    expect(markup).toContain("1 changed file");
    expect(markup).not.toContain("1 changed files");
  });

  it("shows collapsed folders and root files together", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesCard
        turnId={TurnId.make("turn-1")}
        files={[
          { path: "apps/web/src/App.tsx", kind: "modified", additions: 120, deletions: 20 },
          { path: "apps/web/src/App.test.tsx", kind: "modified", additions: 30, deletions: 2 },
          {
            path: "packages/shared/src/git.ts",
            kind: "modified",
            additions: 15,
            deletions: 4,
          },
          { path: "README.md", kind: "modified", additions: 3, deletions: 0 },
        ]}
        allDirectoriesExpanded={false}
        resolvedTheme="light"
        onToggleAllDirectories={() => {}}
        onOpenTurnDiff={() => {}}
      />,
    );

    expect(markup).toContain('data-changed-files-state="tree"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("apps/web/src");
    expect(markup).not.toContain("App.tsx");
    expect(markup).toContain("packages/shared/src");
    expect(markup).not.toContain("git.ts");
    expect(markup).toContain("README.md");
    expect(markup).not.toContain("Show all");
    expect(markup).not.toContain("App.test.tsx");
  });

  it("keeps the folder tree visible when folders are collapsed", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesCard
        turnId={TurnId.make("turn-1")}
        files={[{ path: "apps/web/src/App.tsx", kind: "modified", additions: 120, deletions: 20 }]}
        allDirectoriesExpanded={false}
        resolvedTheme="light"
        onToggleAllDirectories={() => {}}
        onOpenTurnDiff={() => {}}
      />,
    );

    expect(markup).toContain('data-changed-files-state="tree"');
    expect(markup).toContain("1 changed file");
    expect(markup).toContain("apps/web/src");
    expect(markup).not.toContain("Show all");
    expect(markup).not.toContain("App.tsx");
  });
});

describe("ChangedFilesTree", () => {
  it.each([
    {
      name: "a compacted single-chain directory",
      files: [
        { path: "apps/web/src/index.ts", kind: "modified", additions: 2, deletions: 1 },
        { path: "apps/web/src/main.ts", kind: "modified", additions: 3, deletions: 0 },
      ],
      visibleLabels: ["apps/web/src"],
      hiddenLabels: ["index.ts", "main.ts"],
    },
    {
      name: "a branch point after a compacted prefix",
      files: [
        {
          path: "apps/server/src/git/Layers/GitCore.ts",
          kind: "modified",
          additions: 4,
          deletions: 3,
        },
        {
          path: "apps/server/src/provider/Layers/CodexAdapter.ts",
          kind: "modified",
          additions: 7,
          deletions: 2,
        },
      ],
      visibleLabels: ["apps/server/src"],
      hiddenLabels: ["git", "provider", "GitCore.ts", "CodexAdapter.ts"],
    },
    {
      name: "mixed root files and nested compacted directories",
      files: [
        { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "packages/shared/src/git.ts", kind: "modified", additions: 8, deletions: 2 },
        {
          path: "packages/contracts/src/orchestration.ts",
          kind: "modified",
          additions: 13,
          deletions: 3,
        },
      ],
      visibleLabels: ["README.md", "packages"],
      hiddenLabels: ["shared/src", "contracts/src", "git.ts", "orchestration.ts"],
    },
  ])(
    "renders $name collapsed on the first render when collapse-all is active",
    ({ files, visibleLabels, hiddenLabels }) => {
      const markup = renderToStaticMarkup(
        <ChangedFilesTree
          turnId={TurnId.make("turn-1")}
          files={files}
          allDirectoriesExpanded={false}
          resolvedTheme="light"
          onOpenTurnDiff={() => {}}
        />,
      );

      for (const label of visibleLabels) {
        expect(markup).toContain(label);
      }
      for (const label of hiddenLabels) {
        expect(markup).not.toContain(label);
      }
    },
  );

  it.each([
    {
      name: "a compacted single-chain directory",
      files: [
        { path: "apps/web/src/index.ts", kind: "modified", additions: 2, deletions: 1 },
        { path: "apps/web/src/main.ts", kind: "modified", additions: 3, deletions: 0 },
      ],
      visibleLabels: ["apps/web/src", "index.ts", "main.ts"],
    },
    {
      name: "a branch point after a compacted prefix",
      files: [
        {
          path: "apps/server/src/git/Layers/GitCore.ts",
          kind: "modified",
          additions: 4,
          deletions: 3,
        },
        {
          path: "apps/server/src/provider/Layers/CodexAdapter.ts",
          kind: "modified",
          additions: 7,
          deletions: 2,
        },
      ],
      visibleLabels: [
        "apps/server/src",
        "git/Layers",
        "provider/Layers",
        "GitCore.ts",
        "CodexAdapter.ts",
      ],
    },
    {
      name: "mixed root files and nested compacted directories",
      files: [
        { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "packages/shared/src/git.ts", kind: "modified", additions: 8, deletions: 2 },
        {
          path: "packages/contracts/src/orchestration.ts",
          kind: "modified",
          additions: 13,
          deletions: 3,
        },
      ],
      visibleLabels: [
        "README.md",
        "packages",
        "shared/src",
        "contracts/src",
        "git.ts",
        "orchestration.ts",
      ],
    },
  ])(
    "renders $name expanded on the first render when expand-all is active",
    ({ files, visibleLabels }) => {
      const markup = renderToStaticMarkup(
        <ChangedFilesTree
          turnId={TurnId.make("turn-1")}
          files={files}
          allDirectoriesExpanded
          resolvedTheme="light"
          onOpenTurnDiff={() => {}}
        />,
      );

      for (const label of visibleLabels) {
        expect(markup).toContain(label);
      }
    },
  );
});
