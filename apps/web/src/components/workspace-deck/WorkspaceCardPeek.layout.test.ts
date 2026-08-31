// @effect-diagnostics nodeBuiltinImport:off - Layout policy coverage reads the colocated deck stylesheet.
import { describe, expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";

import { branchToolbarContextStripClassName } from "../BranchToolbar";
import chatViewSource from "../ChatView.tsx?raw";
import indexCssSource from "../../index.css?raw";

const workspaceCardDeckCssSource = NodeFS.readFileSync(
  new URL("./WorkspaceCardDeck.css", import.meta.url),
  "utf8",
);

// Deliberate repository-policy assertions: the Node test runtime has no CSS
// layout engine, so this pins the cross-file class and stylesheet contract.
// Browser acceptance remains the separate visual proof for computed geometry.
describe("workspace card peek repository layout policy", () => {
  it("keeps card-peek controls flush and suppresses the standalone strip backdrop", () => {
    const className = branchToolbarContextStripClassName({ cardPeek: true, orientation: "next" });

    expect(className.split(" ")).toEqual(
      expect.arrayContaining([
        "mx-0",
        "mt-0",
        "mb-0",
        "w-full",
        "max-w-none",
        "ps-0",
        "pe-0",
        "pt-0",
        "pb-0",
        "before:hidden",
      ]),
    );
    expect(chatViewSource).toContain("cardPeek={cardPeek}");
    expect(chatViewSource).toMatch(/data-workspace-card-peek-id=\{cardPeek \? "git" : undefined\}/);
    expect(indexCssSource).not.toMatch(
      /\.workspace-card-deck__peek \.chat-composer-context-strip\s*\{[^}]*width:/,
    );
  });

  it("preserves the standalone previous strip overlap without duplicating next defaults", () => {
    expect(
      branchToolbarContextStripClassName({ cardPeek: false, orientation: "previous" }).split(" "),
    ).toEqual(
      expect.arrayContaining([
        "chat-composer-context-strip--previous",
        "mt-0",
        "-mb-4",
        "pt-1",
        "pb-5",
      ]),
    );
    expect(branchToolbarContextStripClassName({ cardPeek: false, orientation: "next" })).toBe(
      "chat-composer-context-strip--next",
    );
  });

  it("pins shrink constraints for long localized peek content", () => {
    expect(workspaceCardDeckCssSource).toMatch(
      /\.workspace-card-deck__peek\s*\{[^}]*min-width:\s*0;/s,
    );
    expect(workspaceCardDeckCssSource).toMatch(
      /\.workspace-card-deck__peek-content\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    );
    expect(workspaceCardDeckCssSource).toMatch(
      /\.workspace-card-deck__peek-content > \[data-workspace-card-peek-id\]\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;/s,
    );
  });
});
