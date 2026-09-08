import { TurnId } from "@t3tools/contracts";
import { act, cloneElement, useState, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { ChangedFilesCard } from "./ChangedFilesTree";

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, {}, children),
  TooltipPopup: () => null,
}));

describe("Classic changed-files disclosure", () => {
  it("expands a preview, hides the tree again, and collapses older cards completely", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    function Card({ latest }: { latest: boolean }) {
      const [expanded, setExpanded] = useState(false);
      return (
        <ChangedFilesCard
          turnId={TurnId.make("turn-1")}
          files={[
            { path: "src/main.ts", kind: "modified", additions: 1, deletions: 0 },
            { path: "src/main.test.ts", kind: "modified", additions: 1, deletions: 0 },
            { path: "src/utils.ts", kind: "modified", additions: 1, deletions: 0 },
            { path: "src/hidden.ts", kind: "modified", additions: 1, deletions: 0 },
          ]}
          allDirectoriesExpanded
          resolvedTheme="light"
          onToggleAllDirectories={() => {}}
          onOpenTurnDiff={() => {}}
          classicPresentation={{
            expanded,
            showCompactPreview: latest,
            onExpandedChange: setExpanded,
          }}
        />
      );
    }
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(<Card latest />);
      });
      const text = () => JSON.stringify(renderer!.toJSON());
      const header = () =>
        renderer!.root
          .findAllByType("button")
          .find((button) => button.props["aria-expanded"] !== undefined)!;
      expect(text()).toContain("main.ts");
      expect(text()).not.toContain("hidden.ts");
      await act(() => header().props.onClick());
      expect(text()).toContain("hidden.ts");
      await act(() => header().props.onClick());
      expect(text()).not.toContain("hidden.ts");
      expect(text()).toContain("main.ts");
      await act(() => renderer!.update(<Card latest={false} />));
      expect(text()).not.toContain("main.ts");
      await act(() => header().props.onClick());
      expect(text()).toContain("hidden.ts");
    } finally {
      await act(() => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});
