import { describe, expect, it } from "vite-plus/test";

import {
  resolveProjectThreadPreview,
  resolveProjectThreadSections,
} from "./projectThreadPreview.ts";

const THREADS = [
  { id: "thread-1", active: false },
  { id: "thread-2", active: false },
  { id: "thread-3", active: false },
  { id: "thread-4", active: true },
  { id: "thread-5", active: false },
  { id: "thread-6", active: true },
] as const;

const isActive = (thread: (typeof THREADS)[number]) => thread.active;

describe("resolveProjectThreadPreview", () => {
  it("shows the first three chats and reports the remaining chats as hidden", () => {
    const preview = resolveProjectThreadPreview({
      items: THREADS,
      count: 3,
      showAll: false,
      alwaysVisible: () => false,
    });

    expect(preview.visibleItems).toEqual(THREADS.slice(0, 3));
    expect(preview.hiddenItems).toEqual(THREADS.slice(3));
    expect(preview.hasOverflowingItems).toBe(true);
  });

  it("adds every active chat beyond the normal limit without changing order", () => {
    const preview = resolveProjectThreadPreview({
      items: THREADS,
      count: 3,
      showAll: false,
      alwaysVisible: isActive,
    });

    expect(preview.visibleItems).toEqual([
      THREADS[0],
      THREADS[1],
      THREADS[2],
      THREADS[3],
      THREADS[5],
    ]);
    expect(preview.hiddenItems).toEqual([THREADS[4]]);
    expect(preview.hasOverflowingItems).toBe(true);
  });

  it("does not duplicate an active chat that is already inside the normal limit", () => {
    const preview = resolveProjectThreadPreview({
      items: THREADS,
      count: 4,
      showAll: false,
      alwaysVisible: isActive,
    });

    expect(preview.visibleItems).toEqual([
      THREADS[0],
      THREADS[1],
      THREADS[2],
      THREADS[3],
      THREADS[5],
    ]);
    expect(preview.hiddenItems).toEqual([THREADS[4]]);
  });

  it("has no overflow when every chat beyond the normal limit is active", () => {
    const items = [THREADS[0], THREADS[1], THREADS[3], THREADS[5]];

    const preview = resolveProjectThreadPreview({
      items,
      count: 2,
      showAll: false,
      alwaysVisible: isActive,
    });

    expect(preview.visibleItems).toEqual(items);
    expect(preview.hiddenItems).toEqual([]);
    expect(preview.hasOverflowingItems).toBe(false);
  });

  it("shows every chat and reports none as hidden when expanded", () => {
    const preview = resolveProjectThreadPreview({
      items: THREADS,
      count: 3,
      showAll: true,
      alwaysVisible: isActive,
    });

    expect(preview.visibleItems).toEqual(THREADS);
    expect(preview.hiddenItems).toEqual([]);
    expect(preview.hasOverflowingItems).toBe(false);
  });
});

describe("resolveProjectThreadSections", () => {
  const items = [
    { id: "active-1", settled: false, working: false },
    { id: "settled-1", settled: true, working: false },
    { id: "active-2", settled: false, working: false },
    { id: "settled-2", settled: true, working: false },
    { id: "active-working", settled: false, working: true },
    { id: "active-3", settled: false, working: false },
  ] as const;

  const resolveSections = (
    overrides: {
      readonly count?: number;
      readonly showAllNonSettled?: boolean;
      readonly showSettled?: boolean;
      readonly keepSettledVisible?: (item: (typeof items)[number]) => boolean;
    } = {},
  ) =>
    resolveProjectThreadSections({
      items,
      count: overrides.count ?? 2,
      showAllNonSettled: overrides.showAllNonSettled ?? false,
      showSettled: overrides.showSettled ?? false,
      isSettled: (item) => item.settled,
      alwaysVisible: (item) => item.working,
      keepSettledVisible: overrides.keepSettledVisible ?? (() => false),
    });

  it("applies the preview quota only to non-settled chats", () => {
    const sections = resolveSections();

    expect(sections.visibleNonSettledItems.map((item) => item.id)).toEqual([
      "active-working",
      "active-1",
    ]);
    expect(sections.hiddenNonSettledItems.map((item) => item.id)).toEqual(["active-2", "active-3"]);
    expect(sections.nonSettledItems.map((item) => item.id)).toEqual([
      "active-working",
      "active-1",
      "active-2",
      "active-3",
    ]);
    expect(sections.visibleSettledItems).toEqual([]);
    expect(sections.hiddenSettledItems.map((item) => item.id)).toEqual(["settled-1", "settled-2"]);
  });

  it("reveals every non-settled chat before the settled section", () => {
    const sections = resolveSections({ showAllNonSettled: true, showSettled: true });

    expect(sections.hiddenNonSettledItems).toEqual([]);
    expect(sections.visibleNonSettledItems.map((item) => item.id)).toEqual([
      "active-working",
      "active-1",
      "active-2",
      "active-3",
    ]);
    expect(sections.visibleSettledItems.map((item) => item.id)).toEqual(["settled-1", "settled-2"]);
    expect(sections.hiddenSettledItems).toEqual([]);
  });

  it("keeps a selected settled chat visible without revealing the whole section", () => {
    const sections = resolveSections({
      keepSettledVisible: (item) => item.id === "settled-2",
    });

    expect(sections.visibleSettledItems.map((item) => item.id)).toEqual(["settled-2"]);
    expect(sections.hiddenSettledItems.map((item) => item.id)).toEqual(["settled-1"]);
  });

  it("shows four priority chats when the preview limit is three", () => {
    const priorityItems = [
      { id: "priority-1", settled: false, priority: true },
      { id: "priority-2", settled: false, priority: true },
      { id: "priority-3", settled: false, priority: true },
      { id: "priority-4", settled: false, priority: true },
      { id: "ordinary", settled: false, priority: false },
    ] as const;

    const sections = resolveProjectThreadSections({
      items: priorityItems,
      count: 3,
      showAllNonSettled: false,
      showSettled: false,
      isSettled: (item) => item.settled,
      alwaysVisible: (item) => item.priority,
      keepSettledVisible: () => false,
    });

    expect(sections.visibleNonSettledItems.map((item) => item.id)).toEqual([
      "priority-1",
      "priority-2",
      "priority-3",
      "priority-4",
    ]);
    expect(sections.hiddenNonSettledItems.map((item) => item.id)).toEqual(["ordinary"]);
  });

  it("promotes priority chats while preserving priority and ordinary sort order", () => {
    const mixedItems = [
      { id: "ordinary-1", settled: false, priority: false },
      { id: "priority-1", settled: false, priority: true },
      { id: "ordinary-2", settled: false, priority: false },
      { id: "priority-2", settled: false, priority: true },
      { id: "ordinary-3", settled: false, priority: false },
    ] as const;

    const sections = resolveProjectThreadSections({
      items: mixedItems,
      count: 3,
      showAllNonSettled: false,
      showSettled: false,
      isSettled: (item) => item.settled,
      alwaysVisible: (item) => item.priority,
      keepSettledVisible: () => false,
    });

    expect(sections.visibleNonSettledItems.map((item) => item.id)).toEqual([
      "priority-1",
      "priority-2",
      "ordinary-1",
    ]);
    expect(sections.hiddenNonSettledItems.map((item) => item.id)).toEqual([
      "ordinary-2",
      "ordinary-3",
    ]);
  });

  it("promotes a settled priority chat without duplicating it", () => {
    const mixedItems = [
      { id: "ordinary", settled: false, priority: false },
      { id: "settled-priority", settled: true, priority: true },
      { id: "settled-ordinary", settled: true, priority: false },
    ] as const;

    const sections = resolveProjectThreadSections({
      items: mixedItems,
      count: 2,
      showAllNonSettled: false,
      showSettled: true,
      isSettled: (item) => item.settled,
      alwaysVisible: (item) => item.priority,
      keepSettledVisible: () => false,
    });

    expect(sections.visibleNonSettledItems.map((item) => item.id)).toEqual([
      "settled-priority",
      "ordinary",
    ]);
    expect(sections.settledItems.map((item) => item.id)).toEqual(["settled-ordinary"]);
    expect([...sections.visibleNonSettledItems, ...sections.visibleSettledItems]).toHaveLength(3);
  });

  it("returns a settled priority chat to the hidden settled section when priority clears", () => {
    const settledItem = [{ id: "settled-priority", settled: true }] as const;
    const resolveSettledItem = (hasPriority: boolean) =>
      resolveProjectThreadSections({
        items: settledItem,
        count: 1,
        showAllNonSettled: false,
        showSettled: false,
        isSettled: (item) => item.settled,
        alwaysVisible: () => hasPriority,
        keepSettledVisible: () => false,
      });

    expect(resolveSettledItem(true).visibleNonSettledItems).toEqual(settledItem);

    const clearedSections = resolveSettledItem(false);
    expect(clearedSections.visibleNonSettledItems).toEqual([]);
    expect(clearedSections.hiddenSettledItems).toEqual(settledItem);
  });
});
