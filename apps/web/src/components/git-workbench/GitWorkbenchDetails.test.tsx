import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { GitConflictPanel } from "./GitConflictPanel";
import { GitCurrentFilePanel } from "./GitCurrentFilePanel";
import type { GitWorkbenchChange } from "./GitWorkbench.types";

const selectedChange: GitWorkbenchChange = {
  additions: 2,
  binary: false,
  deletions: 1,
  id: "src/app.ts",
  kind: "modified",
  modeChanged: false,
  path: "src/app.ts",
  staged: false,
  submodule: false,
  unstaged: true,
  untracked: false,
};

describe("GitConflictPanel", () => {
  it("labels base, ours, theirs, and the editable current result", () => {
    const markup = renderToStaticMarkup(
      <GitConflictPanel
        change={{
          ...selectedChange,
          conflict: "both-modified",
          conflictVersions: { base: "base", ours: "ours", theirs: "theirs" },
        }}
      />,
    );

    expect(markup).toContain("Base");
    expect(markup).toContain("Ours");
    expect(markup).toContain("Theirs");
    expect(markup).toContain("Current result");
  });
});

describe("GitCurrentFilePanel", () => {
  it("states that active-turn edits are buffered and keeps the expected revision at the boundary", () => {
    const markup = renderToStaticMarkup(
      <GitCurrentFilePanel
        file={{
          baseContent: "one",
          content: "two",
          loading: false,
          path: "src/app.ts",
          revision: "revision-2",
          saveState: "buffered",
        }}
        onSave={vi.fn()}
        readOnly={false}
      />,
    );

    expect(markup).toContain("buffered until the active agent turn settles");
    expect(markup).toContain("Current working tree file");
  });

  it("offers all three conflict choices without making the historical surface editable", () => {
    const markup = renderToStaticMarkup(
      <GitCurrentFilePanel
        file={{
          baseContent: "base",
          content: "mine",
          loading: false,
          path: "src/app.ts",
          revision: "revision-3",
          saveState: "conflict",
          serverContent: "agent",
        }}
        onSave={vi.fn()}
        readOnly={false}
      />,
    );

    expect(markup).toContain("Keep agent version");
    expect(markup).toContain("Keep my version");
    expect(markup).toContain("Save merged result");
  });
});
