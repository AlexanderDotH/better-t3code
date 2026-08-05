import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import "../../index.css";
import { GitCompactCard, type GitCompactStatus } from "./GitCompactCard";

const crowdedStatus: GitCompactStatus = {
  additions: 7_358,
  ahead: 12,
  behind: 4,
  branch: "feature/a-very-long-branch-name-that-must-not-change-the-card-height",
  changeCount: 206,
  conflicts: 0,
  deletions: 791,
  kind: "changed",
  label: "Changes present",
  staged: 0,
  unstaged: 87,
  untracked: 119,
  updatedAtLabel: "Updated just now",
};

function dispatchPull(
  target: HTMLElement,
  input: { readonly endX: number; readonly endY: number; readonly pointerId: number },
) {
  const common = {
    bubbles: true,
    button: 0,
    clientX: 100,
    isPrimary: true,
    pointerId: input.pointerId,
    pointerType: "mouse",
  } as const;
  target.dispatchEvent(new PointerEvent("pointerdown", { ...common, clientY: 100 }));
  target.dispatchEvent(
    new PointerEvent("pointermove", {
      ...common,
      clientX: input.endX,
      clientY: input.endY,
    }),
  );
  target.dispatchEvent(
    new PointerEvent("pointerup", {
      ...common,
      clientX: input.endX,
      clientY: input.endY,
    }),
  );
}

describe("GitCompactCard browser layout", () => {
  it("fits the important repository facts inside the Chat-sized card without scrolling", async () => {
    await page.viewport(840, 620);
    document.documentElement.classList.add("dark");
    const mounted = await render(
      <div
        data-compact-card-fixture="true"
        style={{ height: 140, margin: "48px auto", width: "min(760px, calc(100vw - 40px))" }}
      >
        <GitCompactCard
          status={crowdedStatus}
          lastCommit={{
            ageLabel: "12 minutes ago",
            summary:
              "feat: preserve a deliberately long commit subject without growing the compact panel",
          }}
          quickAction={{ label: "Stage all & commit", onSelect: vi.fn() }}
          onExpand={vi.fn()}
        />
      </div>,
    );

    try {
      await vi.waitFor(() => {
        const card = document.querySelector<HTMLElement>(".git-compact-card")!;
        const content = document.querySelector<HTMLElement>(".git-compact-card__content")!;
        expect(Math.abs(card.getBoundingClientRect().height - 140)).toBeLessThanOrEqual(1);
        expect(content.scrollHeight).toBeLessThanOrEqual(content.clientHeight);
        expect(getComputedStyle(content).overflowY).toBe("hidden");
      });

      const cardRect = document
        .querySelector<HTMLElement>(".git-compact-card")!
        .getBoundingClientRect();
      for (const selector of [
        ".git-compact-card__header",
        ".git-compact-card__summary",
        ".git-compact-card__footer",
        ".git-compact-card__header-action",
        ".git-compact-card__quick-action",
      ]) {
        const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        expect(rect.top).toBeGreaterThanOrEqual(cardRect.top);
        expect(rect.bottom).toBeLessThanOrEqual(cardRect.bottom);
      }

      const cardText = document.querySelector<HTMLElement>(".git-compact-card")!.textContent;
      expect(cardText).toContain("206 changes");
      expect(cardText).toContain("87 unstaged");
      expect(cardText).toContain("119 untracked");
      expect(cardText).not.toContain("Recent activity");
      expect(cardText).not.toContain("Top contributors");
      expect(cardText).not.toContain("Code mix");

      const fixture = document.querySelector<HTMLElement>("[data-compact-card-fixture]")!;
      fixture.style.width = "360px";
      await vi.waitFor(() => {
        const summary = document.querySelector<HTMLElement>(".git-compact-card__summary")!;
        expect(summary.scrollWidth).toBeLessThanOrEqual(summary.clientWidth);
        expect(
          document.querySelector<HTMLElement>(".git-compact-card__content")!.scrollHeight,
        ).toBeLessThanOrEqual(
          document.querySelector<HTMLElement>(".git-compact-card__content")!.clientHeight,
        );
      });
    } finally {
      document.documentElement.classList.remove("dark");
      await mounted.unmount();
    }
  });

  it("opens only after an upward, vertically dominant pull", async () => {
    const onExpand = vi.fn();
    const mounted = await render(
      <div style={{ height: 192, width: 720 }}>
        <GitCompactCard status={crowdedStatus} onExpand={onExpand} />
      </div>,
    );

    try {
      const handle = document.querySelector<HTMLElement>("[data-git-compact-pull-handle]")!;
      dispatchPull(handle, { endX: 100, endY: 65, pointerId: 1 });
      dispatchPull(handle, { endX: 140, endY: 64, pointerId: 2 });
      expect(onExpand).not.toHaveBeenCalled();

      dispatchPull(handle, { endX: 104, endY: 60, pointerId: 3 });
      await vi.waitFor(() => expect(onExpand).toHaveBeenCalledTimes(1));
    } finally {
      await mounted.unmount();
    }
  });

  it("keeps the pull and keyboard expansion actions inert while blocked", async () => {
    const onExpand = vi.fn();
    const mounted = await render(
      <div style={{ height: 140, width: 720 }}>
        <GitCompactCard expansionBlocked status={crowdedStatus} onExpand={onExpand} />
      </div>,
    );

    try {
      const handle = document.querySelector<HTMLElement>("[data-git-compact-pull-handle]")!;
      const button = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand Git workbench"]',
      )!;
      expect(handle.getAttribute("aria-hidden")).toBe("true");
      expect(handle.tabIndex).toBe(-1);
      expect(button.disabled).toBe(true);

      dispatchPull(handle, { endX: 100, endY: 50, pointerId: 4 });
      button.click();
      expect(onExpand).not.toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
  });
});
