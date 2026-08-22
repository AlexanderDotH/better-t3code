import { describe, expect, it } from "vite-plus/test";

import branchToolbarSource from "../BranchToolbar.tsx?raw";
import chatViewSource from "../ChatView.tsx?raw";
import indexCssSource from "../../index.css?raw";

describe("workspace card peek layout", () => {
  it("uses card-peek utilities to align Git controls with MCP edge guides", () => {
    expect(branchToolbarSource).toContain("cardPeek?: boolean");
    expect(branchToolbarSource).toMatch(/cardPeek\s*\?\s*"mx-0 w-full max-w-none px-0"/);
    expect(branchToolbarSource).toContain(
      '"mx-auto w-[calc(100%-2.75rem)] max-w-[calc(48rem-2.75rem)] ps-1 pe-2"',
    );
    expect(chatViewSource).toContain("cardPeek={cardPeek}");
    expect(chatViewSource).toMatch(/data-workspace-card-peek-id=\{cardPeek \? "git" : undefined\}/);
    expect(indexCssSource).not.toMatch(
      /\.workspace-card-deck__peek \.chat-composer-context-strip\s*\{[^}]*width:/,
    );
  });

  it("keeps Git controls inside the fixed-height card peek", () => {
    expect(branchToolbarSource).toMatch(
      /cardPeek\s*\?\s*"my-0 py-0"\s*:\s*orientation === "previous"/,
    );
  });
});
