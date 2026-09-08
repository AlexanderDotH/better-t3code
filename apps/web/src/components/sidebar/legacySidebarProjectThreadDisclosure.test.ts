import { describe, expect, it } from "vite-plus/test";

import { resolveLegacySidebarProjectThreadDisclosure } from "./legacySidebarProjectThreadDisclosure.ts";

interface TestThread {
  readonly id: string;
}

const nonSettledThreads = Array.from(
  { length: 150 },
  (_, index): TestThread => ({ id: `active-${index + 1}` }),
);
const settledThreads = Array.from(
  { length: 10 },
  (_, index): TestThread => ({ id: `settled-${index + 1}` }),
);
const selectedSettledThread = settledThreads[9]!;

const overflowingSections = {
  nonSettledItems: nonSettledThreads,
  settledItems: settledThreads,
  visibleNonSettledItems: nonSettledThreads.slice(0, 4),
  hiddenNonSettledItems: nonSettledThreads.slice(4),
  visibleSettledItems: [selectedSettledThread],
  hiddenSettledItems: settledThreads.slice(0, 9),
};

describe("resolveLegacySidebarProjectThreadDisclosure", () => {
  it("shows only the four preview chats and the selected settled chat while collapsed", () => {
    const disclosure = resolveLegacySidebarProjectThreadDisclosure({
      sections: overflowingSections,
      isThreadListExpanded: false,
      settledThreadsVisible: false,
    });

    expect(disclosure.renderedThreads).toEqual([
      ...nonSettledThreads.slice(0, 4),
      selectedSettledThread,
    ]);
    expect(disclosure.hasOverflowingThreads).toBe(true);
    expect(disclosure.canToggleSettledThreads).toBe(true);
    expect(disclosure.canShowLess).toBe(false);
  });

  it("renders all 160 chats in non-settled then settled order after Show more", () => {
    const disclosure = resolveLegacySidebarProjectThreadDisclosure({
      sections: overflowingSections,
      isThreadListExpanded: true,
      settledThreadsVisible: true,
    });

    expect(disclosure.renderedThreads).toEqual([...nonSettledThreads, ...settledThreads]);
    expect(disclosure.renderedThreads).toHaveLength(160);
    expect(disclosure.hasOverflowingThreads).toBe(false);
    expect(disclosure.canShowLess).toBe(true);
  });

  it("keeps settled chats gated while hidden non-settled chats remain", () => {
    const disclosure = resolveLegacySidebarProjectThreadDisclosure({
      sections: overflowingSections,
      isThreadListExpanded: false,
      settledThreadsVisible: true,
    });

    expect(disclosure.renderedThreads).toEqual([
      ...nonSettledThreads.slice(0, 4),
      selectedSettledThread,
    ]);
    expect(disclosure.canShowLess).toBe(true);
  });

  it("reveals settled chats directly when no non-settled chats remain hidden", () => {
    const sections = {
      ...overflowingSections,
      nonSettledItems: nonSettledThreads.slice(0, 4),
      visibleNonSettledItems: nonSettledThreads.slice(0, 4),
      hiddenNonSettledItems: [],
    };

    const disclosure = resolveLegacySidebarProjectThreadDisclosure({
      sections,
      isThreadListExpanded: false,
      settledThreadsVisible: true,
    });

    expect(disclosure.renderedThreads).toEqual([
      ...nonSettledThreads.slice(0, 4),
      ...settledThreads,
    ]);
    expect(disclosure.hasOverflowingThreads).toBe(false);
  });

  it("hides unselected settled chats when the settled section is closed", () => {
    const sections = {
      ...overflowingSections,
      nonSettledItems: nonSettledThreads.slice(0, 4),
      visibleNonSettledItems: nonSettledThreads.slice(0, 4),
      hiddenNonSettledItems: [],
    };

    const disclosure = resolveLegacySidebarProjectThreadDisclosure({
      sections,
      isThreadListExpanded: false,
      settledThreadsVisible: false,
    });

    expect(disclosure.renderedThreads).toEqual([
      ...nonSettledThreads.slice(0, 4),
      selectedSettledThread,
    ]);
    expect(disclosure.canToggleSettledThreads).toBe(true);
    expect(disclosure.canShowLess).toBe(false);
  });

  it("offers Show less for expanded chats or an open settled section", () => {
    const expanded = resolveLegacySidebarProjectThreadDisclosure({
      sections: overflowingSections,
      isThreadListExpanded: true,
      settledThreadsVisible: false,
    });
    const settledOpen = resolveLegacySidebarProjectThreadDisclosure({
      sections: overflowingSections,
      isThreadListExpanded: false,
      settledThreadsVisible: true,
    });
    const preview = resolveLegacySidebarProjectThreadDisclosure({
      sections: overflowingSections,
      isThreadListExpanded: false,
      settledThreadsVisible: false,
    });

    expect(expanded.canShowLess).toBe(true);
    expect(settledOpen.canShowLess).toBe(true);
    expect(preview.canShowLess).toBe(false);
  });

  it("renders only the pinned chat for a collapsed project", () => {
    const pinnedCollapsedThread = nonSettledThreads[149]!;

    const disclosure = resolveLegacySidebarProjectThreadDisclosure({
      sections: overflowingSections,
      isThreadListExpanded: false,
      settledThreadsVisible: true,
      pinnedCollapsedThread,
    });

    expect(disclosure.renderedThreads).toEqual([pinnedCollapsedThread]);
  });
});
