import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import {
  LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_CONTENT_HEIGHT_PX,
  LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX,
  useLegacySidebarVirtualThreadRows,
} from "./LegacySidebarVirtualThreadRows";

const ROW_KEYS = Array.from({ length: 160 }, (_, index) => `thread-${index}`);
const VIEWPORT_HEIGHT_PX = LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX * 10;
const EXPECTED_HYDRATED_BOUND =
  Math.ceil(VIEWPORT_HEIGHT_PX / LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX) + 8 + 3;

function VirtualThreadRowsHarness() {
  const [showAll, setShowAll] = useState(false);
  const rowKeys = showAll ? ROW_KEYS : ROW_KEYS.slice(0, 3);
  const virtualRows = useLegacySidebarVirtualThreadRows({
    rowKeys,
    previewRowCount: 3,
  });

  return (
    <div>
      <button type="button" onClick={() => setShowAll((current) => !current)}>
        {showAll ? "Show less" : "Show more"}
      </button>
      <div
        data-slot="scroll-area-viewport"
        data-testid="virtual-thread-viewport"
        style={{ height: VIEWPORT_HEIGHT_PX, overflowY: "auto" }}
      >
        <ul
          ref={virtualRows.containerRef}
          data-testid="virtual-thread-list"
          data-virtualized={virtualRows.isVirtualized}
          style={{ display: "flex", flexDirection: "column", gap: 2, margin: 0, padding: 0 }}
        >
          {rowKeys.map((key) => {
            const isHydrated = virtualRows.isHydrated(key);
            return (
              <li
                key={key}
                ref={virtualRows.getSlotRef(key)}
                data-hydrated={isHydrated}
                data-thread-key={key}
                style={{
                  flex: `0 0 ${LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_CONTENT_HEIGHT_PX}px`,
                  listStyle: "none",
                }}
              >
                {isHydrated ? <span data-heavy-thread-row>{key}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function hydratedRowCount(): number {
  return document.querySelectorAll('[data-hydrated="true"]').length;
}

describe("Classic Sidebar viewport hydration", () => {
  it("hydrates the bottom window and unloads an old offscreen row while keeping 160 slots", async () => {
    render(<VirtualThreadRowsHarness />);

    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-thread-key]")).toHaveLength(3);
    });
    document.querySelector<HTMLButtonElement>("button")?.click();

    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-thread-key="thread-5"]')?.getAttribute("data-hydrated"),
      ).toBe("true");
    });
    expect(document.querySelectorAll("[data-thread-key]")).toHaveLength(160);
    expect(hydratedRowCount()).toBeLessThanOrEqual(EXPECTED_HYDRATED_BOUND);

    const viewport = document.querySelector<HTMLElement>('[data-testid="virtual-thread-viewport"]');
    expect(viewport).not.toBeNull();
    viewport!.scrollTop = viewport!.scrollHeight;
    viewport!.dispatchEvent(new Event("scroll"));

    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-thread-key="thread-159"]')?.getAttribute("data-hydrated"),
      ).toBe("true");
      expect(
        document.querySelector('[data-thread-key="thread-5"]')?.getAttribute("data-hydrated"),
      ).toBe("false");
    });
    expect(hydratedRowCount()).toBeLessThanOrEqual(EXPECTED_HYDRATED_BOUND);

    document.querySelector<HTMLButtonElement>("button")?.click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll("[data-thread-key]")).toHaveLength(3);
      expect(
        document
          .querySelector('[data-testid="virtual-thread-list"]')
          ?.getAttribute("data-virtualized"),
      ).toBe("false");
    });
  });
});
