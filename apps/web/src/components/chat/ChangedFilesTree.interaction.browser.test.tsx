import { RunId } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render } from "../../../test/render";
import { ChangedFilesCard } from "./ChangedFilesTree";

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({
    message: (key: string, params?: { count?: number }) =>
      ({
        "chat.files.showAll": `Show all ${params?.count ?? 0} files`,
        "chat.files.showFewer": "Show fewer",
        "chat.changedFiles.count": `${params?.count ?? 0} changed files`,
        "chat.changedFiles.hide": "Hide changes",
        "chat.changedFiles.show": "Show changes",
        "chat.changedFiles.openDiff": "Open diff",
        "chat.changedFiles.openFullDiff": "Open full diff",
        "chat.changedFiles.collapseFolders": "Collapse all folders",
      })[key] ?? key,
  }),
}));

describe("ChangedFilesCard", () => {
  it("opens run diffs and context menus while expanding and collapsing a compact preview", async () => {
    const runId = RunId.make("compact-run");
    const onOpenTurnDiff = vi.fn();
    const onFileContextMenu = vi.fn();
    const files = Array.from({ length: 5 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      kind: "modified",
      additions: index + 1,
      deletions: 0,
    }));
    function Card() {
      const [expanded, onExpandedChange] = useState(false);
      return (
        <ChangedFilesCard
          runId={runId}
          files={files}
          totals={{ count: 5, additions: 15, deletions: 0 }}
          allDirectoriesExpanded={false}
          resolvedTheme="light"
          onToggleAllDirectories={() => {}}
          onOpenTurnDiff={onOpenTurnDiff}
          onFileContextMenu={onFileContextMenu}
          compactPresentation={{ expanded, onExpandedChange }}
        />
      );
    }
    await using screen = await render(<Card />);
    await expect.element(screen.getByRole("button", { name: "src/file-1.ts" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "src/file-4.ts" })).not.toBeVisible();
    await screen.getByRole("button", { name: "src/file-1.ts" }).click();
    expect(onOpenTurnDiff).toHaveBeenCalledWith(runId, "src/file-1.ts");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(() =>
      screen.container
        .querySelector<HTMLButtonElement>('button[aria-label="src/file-1.ts"]')!
        .dispatchEvent(event),
    );
    expect(event.defaultPrevented).toBe(true);
    expect(onFileContextMenu).toHaveBeenCalledWith(
      "src/file-1.ts",
      expect.objectContaining({ nativeEvent: event }),
    );
    await screen.getByRole("button", { name: "Show all 5 files" }).click();
    await expect.element(screen.getByRole("button", { name: "src/file-4.ts" })).toBeVisible();
    await screen.getByRole("button", { name: "src/file-4.ts" }).click();
    expect(onOpenTurnDiff).toHaveBeenLastCalledWith(runId, "src/file-4.ts");
    await screen.getByRole("button", { name: "Show fewer" }).click();
    await expect.element(screen.getByRole("button", { name: "src/file-4.ts" })).not.toBeVisible();
  });

  it("keeps root files actionable while collapsed folders expand through the public card", async () => {
    const runId = RunId.make("tree-run");
    const onOpenTurnDiff = vi.fn();
    const files = ["README.md", "apps/web/src/App.tsx", "apps/web/src/App.test.tsx"].map(
      (path) => ({ path, kind: "modified", additions: 1, deletions: 0 }),
    );
    function Card() {
      const [expanded, setExpanded] = useState(false);
      return (
        <ChangedFilesCard
          runId={runId}
          files={files}
          totals={{ count: 3, additions: 3, deletions: 0 }}
          allDirectoriesExpanded={expanded}
          resolvedTheme="light"
          onToggleAllDirectories={() => setExpanded((value) => !value)}
          onOpenTurnDiff={onOpenTurnDiff}
        />
      );
    }
    await using screen = await render(<Card />);
    await expect.element(screen.getByRole("button", { name: "apps/web/src" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "App.tsx" })).not.toBeVisible();
    await screen.getByRole("button", { name: "README.md" }).click();
    expect(onOpenTurnDiff).toHaveBeenCalledWith(runId, "README.md");
    await screen.getByRole("button", { name: "Expand all folders" }).click();
    await expect.element(screen.getByRole("button", { name: "App.tsx" })).toBeVisible();
    await screen.getByRole("button", { name: "App.tsx" }).click();
    expect(onOpenTurnDiff).toHaveBeenLastCalledWith(runId, "apps/web/src/App.tsx");
    await screen.getByRole("button", { name: "Collapse all folders" }).click();
    await expect.element(screen.getByRole("button", { name: "App.tsx" })).not.toBeVisible();
  });

  it("expands a classic preview and hides older cards until requested", async () => {
    const files = ["main.ts", "main.test.ts", "utils.ts", "hidden.ts"].map((name) => ({
      path: `src/${name}`,
      kind: "modified",
      additions: 1,
      deletions: 0,
    }));
    function Card({ latest }: { latest: boolean }) {
      const [expanded, onExpandedChange] = useState(false);
      return (
        <ChangedFilesCard
          runId={RunId.make("classic-run")}
          files={files}
          totals={{ count: 4, additions: 4, deletions: 0 }}
          allDirectoriesExpanded
          resolvedTheme="light"
          onToggleAllDirectories={() => {}}
          onOpenTurnDiff={() => {}}
          classicPresentation={{ expanded, showCompactPreview: latest, onExpandedChange }}
        />
      );
    }
    await using screen = await render(<Card latest />);
    const main = screen.getByRole("button", { name: "main.ts" });
    const hidden = screen.getByRole("button", { name: "hidden.ts" });
    const header = () =>
      screen.container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    await expect.element(main).toBeVisible();
    await expect.element(hidden).not.toBeVisible();
    await act(() => header().click());
    await expect.element(hidden).toBeVisible();
    await act(() => header().click());
    await expect.element(hidden).not.toBeVisible();
    await expect.element(main).toBeVisible();
    await screen.rerender(<Card latest={false} />);
    await expect.element(main).not.toBeVisible();
    await act(() => header().click());
    await expect.element(hidden).toBeVisible();
  });
});
