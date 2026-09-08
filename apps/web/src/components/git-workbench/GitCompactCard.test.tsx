import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { GitCompactCard, type GitCompactStatus } from "./GitCompactCard";

const status: GitCompactStatus = {
  additions: 4,
  ahead: 0,
  behind: 0,
  branch: "main",
  changeCount: 2,
  conflicts: 0,
  deletions: 1,
  kind: "changed",
  label: "Changed",
  staged: 1,
  unstaged: 1,
  untracked: 0,
  updatedAtLabel: "Updated just now",
};

describe("GitCompactCard", () => {
  it("keeps Expand as the only deck-navigation action in the compact header", () => {
    const html = renderToStaticMarkup(<GitCompactCard status={status} onExpand={vi.fn()} />);

    expect(html).toContain('aria-label="Expand Git workbench"');
    expect(html).not.toContain('aria-label="Return to chat"');
    expect(html).toContain('class="git-compact-card h-full"');
    expect(html).toContain('class="workspace-card-deck__card-content git-compact-card__content"');
  });

  it("lets the expanded drawer define its measured height", () => {
    const html = renderToStaticMarkup(
      <GitCompactCard
        expanded
        status={status}
        workbench={<div>Expanded workbench</div>}
        onExpand={vi.fn()}
      />,
    );

    expect(html).toContain('class="git-compact-card"');
    expect(html).not.toContain('class="git-compact-card h-full"');
    expect(html).toContain("Expanded workbench");
  });

  it("does not present guessed index counts while detailed status is loading", () => {
    const html = renderToStaticMarkup(
      <GitCompactCard
        status={{
          ...status,
          detailsPending: true,
          kind: "stale",
          label: "Refreshing",
          staged: 0,
          unstaged: 2,
        }}
        onExpand={vi.fn()}
      />,
    );

    expect(html).toContain("2 changes");
    expect(html).toContain("Detailed counts loading");
    expect(html).not.toContain("0 staged");
    expect(html).not.toContain("2 unstaged");
    expect(html).not.toContain("Working tree clean");
  });

  it("does not describe unavailable repository state as clean", () => {
    const html = renderToStaticMarkup(
      <GitCompactCard
        status={{
          ...status,
          changeCount: 0,
          kind: "disconnected",
          label: "Disconnected",
          staged: 0,
          unstaged: 0,
        }}
        onExpand={vi.fn()}
      />,
    );

    expect(html).toContain("Repository disconnected");
    expect(html).not.toContain("Working tree clean");
  });
});
