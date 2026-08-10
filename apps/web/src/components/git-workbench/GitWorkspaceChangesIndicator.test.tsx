import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { GitCompactStatus } from "./GitCompactCard";
import { GitWorkspaceChangesIndicator } from "./GitWorkspaceChangesIndicator";

function status(
  changeCount: number,
  kind: GitCompactStatus["kind"] = changeCount === 0 ? "clean" : "changed",
): GitCompactStatus {
  return {
    additions: 0,
    ahead: 0,
    behind: 0,
    branch: "main",
    changeCount,
    conflicts: kind === "conflicted" ? 1 : 0,
    deletions: 0,
    kind,
    label: kind,
    staged: 0,
    unstaged: changeCount,
    untracked: 0,
    updatedAtLabel: "Updated just now",
  };
}

describe("GitWorkspaceChangesIndicator", () => {
  it("leaves activation to the enclosing peek while presenting repository status", () => {
    const html = renderToStaticMarkup(
      <GitWorkspaceChangesIndicator blocked={false} status={status(114)} />,
    );

    expect(html).toContain("114 changes");
    expect(html).toContain('data-repository-state="changed"');
    expect(html).toContain('data-git-workspace-changes-indicator="true"');
    expect(html).toContain('aria-label="114 changes"');
    expect(html).not.toContain("<button");
  });

  it("keeps clean and conflict states truthful", () => {
    const clean = renderToStaticMarkup(
      <GitWorkspaceChangesIndicator blocked={false} status={status(0)} />,
    );
    const conflicted = renderToStaticMarkup(
      <GitWorkspaceChangesIndicator blocked={false} status={status(3, "conflicted")} />,
    );

    expect(clean).toContain("0 changes");
    expect(conflicted).toContain("3 changes");
    expect(conflicted).toContain("conflicts present");
  });

  it("keeps refreshing accessible without rendering a label or dot", () => {
    const refreshing = renderToStaticMarkup(
      <GitWorkspaceChangesIndicator blocked={false} status={status(0, "stale")} />,
    );

    expect(refreshing).toContain("Repository status refreshing");
    expect(refreshing).toContain('data-repository-state="stale"');
    expect(refreshing).toContain('class="sr-only"');
    expect(refreshing).not.toContain("git-workspace-changes-indicator__dot");
    expect(refreshing).not.toContain("whitespace-nowrap");
  });

  it("dims status when the enclosing Git peek is blocked", () => {
    const html = renderToStaticMarkup(<GitWorkspaceChangesIndicator blocked status={status(2)} />);

    expect(html).toContain("opacity-60");
    expect(html).toContain('aria-label="2 changes"');
  });
});
