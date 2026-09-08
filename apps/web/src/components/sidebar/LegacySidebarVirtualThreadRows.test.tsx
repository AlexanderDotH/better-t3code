import { describe, expect, it, vi } from "vite-plus/test";

import {
  createLegacySidebarVirtualThreadRowObserver,
  LEGACY_SIDEBAR_VIRTUAL_THREAD_OVERSCAN_PX,
  LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_CONTENT_HEIGHT_PX,
  LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX,
  type LegacySidebarThreadRowObserverFactory,
  resolveLegacySidebarVirtualThreadRowsMode,
  shouldHydrateLegacySidebarVirtualThreadRow,
} from "./LegacySidebarVirtualThreadRows";

interface ObserverRecord {
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;
  readonly observe: (target: Element) => void;
  readonly unobserve: (target: Element) => void;
  readonly disconnect: () => void;
}

function createObserverHarness() {
  const records: ObserverRecord[] = [];
  const createObserver = vi.fn<LegacySidebarThreadRowObserverFactory>((callback, options) => {
    const record: ObserverRecord = {
      callback,
      options,
      observe: vi.fn<(target: Element) => void>(),
      unobserve: vi.fn<(target: Element) => void>(),
      disconnect: vi.fn<() => void>(),
    };
    records.push(record);
    return record;
  });

  return { createObserver, records };
}

function element(name: string): HTMLElement {
  return { dataset: { testName: name } } as unknown as HTMLElement;
}

function entry(target: HTMLElement, isIntersecting: boolean): IntersectionObserverEntry {
  return { target, isIntersecting } as unknown as IntersectionObserverEntry;
}

describe("classic sidebar virtual thread rows", () => {
  it("keeps 24 rows animated and virtualizes 25 rows", () => {
    expect(resolveLegacySidebarVirtualThreadRowsMode(24, true)).toEqual({
      isVirtualized: false,
      shouldAnimateThreadList: true,
    });
    expect(resolveLegacySidebarVirtualThreadRowsMode(25, true)).toEqual({
      isVirtualized: true,
      shouldAnimateThreadList: false,
    });
  });

  it("matches the real 28px thread row and 2px list gap", () => {
    expect(LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_CONTENT_HEIGHT_PX).toBe(28);
    expect(LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX).toBe(30);
    expect(LEGACY_SIDEBAR_VIRTUAL_THREAD_OVERSCAN_PX).toBe(
      LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX * 4,
    );
  });

  it("hydrates forced rows and the first preview rows before observation", () => {
    const common = {
      isVirtualized: true,
      previewRowCount: 4,
      isIntersecting: false,
    } as const;

    expect(
      shouldHydrateLegacySidebarVirtualThreadRow({ ...common, rowIndex: 0, isForced: false }),
    ).toBe(true);
    expect(
      shouldHydrateLegacySidebarVirtualThreadRow({ ...common, rowIndex: 3, isForced: false }),
    ).toBe(true);
    expect(
      shouldHydrateLegacySidebarVirtualThreadRow({ ...common, rowIndex: 4, isForced: false }),
    ).toBe(false);
    expect(
      shouldHydrateLegacySidebarVirtualThreadRow({ ...common, rowIndex: 159, isForced: true }),
    ).toBe(true);
  });

  it("roots one observer at the nearest sidebar scroll viewport with four-row overscan", () => {
    const harness = createObserverHarness();
    const viewport = element("viewport");
    const container = {
      closest: vi.fn(() => viewport),
    } as unknown as HTMLElement;
    const observer = createLegacySidebarVirtualThreadRowObserver({
      createObserver: harness.createObserver,
      onHydrationChange: vi.fn(),
    });

    observer.setEnabled(true);
    observer.containerRef(container);
    observer.getSlotRef("thread-1")(element("thread-1"));
    observer.getSlotRef("thread-2")(element("thread-2"));

    expect(harness.createObserver).toHaveBeenCalledOnce();
    expect(container.closest).toHaveBeenCalledWith('[data-slot="scroll-area-viewport"]');
    expect(harness.records[0]?.options).toEqual({
      root: viewport,
      rootMargin: `${LEGACY_SIDEBAR_VIRTUAL_THREAD_OVERSCAN_PX}px 0px`,
    });
    expect(harness.records[0]?.observe).toHaveBeenCalledTimes(2);
  });

  it("hydrates rows entering overscan and removes rows leaving it", () => {
    const harness = createObserverHarness();
    const onHydrationChange = vi.fn();
    const observer = createLegacySidebarVirtualThreadRowObserver({
      createObserver: harness.createObserver,
      onHydrationChange,
    });
    const slot = element("thread-40");

    observer.setEnabled(true);
    observer.containerRef({ closest: vi.fn(() => null) } as unknown as HTMLElement);
    observer.getSlotRef("thread-40")(slot);
    harness.records[0]?.callback(
      [entry(slot, true)],
      harness.records[0] as unknown as IntersectionObserver,
    );

    expect(observer.isIntersecting("thread-40")).toBe(true);
    expect(onHydrationChange).toHaveBeenCalledTimes(1);

    harness.records[0]?.callback(
      [entry(slot, false)],
      harness.records[0] as unknown as IntersectionObserver,
    );

    expect(observer.isIntersecting("thread-40")).toBe(false);
    expect(onHydrationChange).toHaveBeenCalledTimes(2);
  });

  it("hydrates every row and keeps animation when IntersectionObserver is unavailable", () => {
    expect(resolveLegacySidebarVirtualThreadRowsMode(160, false)).toEqual({
      isVirtualized: false,
      shouldAnimateThreadList: true,
    });
    expect(
      shouldHydrateLegacySidebarVirtualThreadRow({
        isVirtualized: false,
        rowIndex: 159,
        previewRowCount: 0,
        isForced: false,
        isIntersecting: false,
      }),
    ).toBe(true);
  });

  it("keeps per-key refs stable and unobserves or disconnects cleanly", () => {
    const harness = createObserverHarness();
    const observer = createLegacySidebarVirtualThreadRowObserver({
      createObserver: harness.createObserver,
      onHydrationChange: vi.fn(),
    });
    const viewport = element("viewport");
    const container = { closest: vi.fn(() => viewport) } as unknown as HTMLElement;
    const slot = element("thread-1");
    const slotRef = observer.getSlotRef("thread-1");

    expect(observer.containerRef).toBe(observer.containerRef);
    expect(observer.getSlotRef("thread-1")).toBe(slotRef);

    observer.setEnabled(true);
    observer.containerRef(container);
    slotRef(slot);
    slotRef(null);

    expect(harness.records[0]?.unobserve).toHaveBeenCalledWith(slot);
    observer.retainKeys([]);
    expect(observer.getSlotRef("thread-1")).not.toBe(slotRef);

    observer.containerRef(null);
    expect(harness.records[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it("does not schedule a render while disabling the observer during cleanup", () => {
    const harness = createObserverHarness();
    const onHydrationChange = vi.fn();
    const observer = createLegacySidebarVirtualThreadRowObserver({
      createObserver: harness.createObserver,
      onHydrationChange,
    });
    const slot = element("thread-1");

    observer.setEnabled(true);
    observer.containerRef({ closest: vi.fn(() => null) } as unknown as HTMLElement);
    observer.getSlotRef("thread-1")(slot);
    harness.records[0]?.callback(
      [entry(slot, true)],
      harness.records[0] as unknown as IntersectionObserver,
    );
    onHydrationChange.mockClear();

    observer.setEnabled(false);

    expect(harness.records[0]?.disconnect).toHaveBeenCalledOnce();
    expect(onHydrationChange).not.toHaveBeenCalled();
  });

  it("keeps 160 logical slots while bounding heavy hydration to viewport plus overscan", () => {
    const harness = createObserverHarness();
    const observer = createLegacySidebarVirtualThreadRowObserver({
      createObserver: harness.createObserver,
      onHydrationChange: vi.fn(),
    });
    const keys = Array.from({ length: 160 }, (_, index) => `thread-${index}`);
    const slots = keys.map((key) => element(key));
    const forcedKeys = new Set(["thread-80", "thread-159"]);

    observer.setEnabled(true);
    observer.containerRef({ closest: vi.fn(() => null) } as unknown as HTMLElement);
    keys.forEach((key, index) => observer.getSlotRef(key)(slots[index] ?? null));

    const viewportRows = 10;
    const overscanRows =
      (LEGACY_SIDEBAR_VIRTUAL_THREAD_OVERSCAN_PX * 2) / LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX;
    const nearViewportSlots = slots.slice(20, 20 + viewportRows + overscanRows);
    harness.records[0]?.callback(
      nearViewportSlots.map((slot) => entry(slot, true)),
      harness.records[0] as unknown as IntersectionObserver,
    );

    const hydratedKeys = keys.filter((key, rowIndex) =>
      shouldHydrateLegacySidebarVirtualThreadRow({
        isVirtualized: true,
        rowIndex,
        previewRowCount: 4,
        isForced: forcedKeys.has(key),
        isIntersecting: observer.isIntersecting(key),
      }),
    );

    expect(harness.records[0]?.observe).toHaveBeenCalledTimes(160);
    expect(hydratedKeys).toHaveLength(viewportRows + overscanRows + 4 + forcedKeys.size);
    expect(hydratedKeys.length).toBeLessThanOrEqual(
      Math.ceil(
        (viewportRows * LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX) /
          LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX,
      ) +
        8 +
        4 +
        forcedKeys.size,
    );
  });
});
