import { DEFAULT_PROJECT_THREAD_PREVIEW_COUNT } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveProjectThreadPreview } from "./projectThreadPreview";

const THREADS = Array.from({ length: 18 }, (_, index) => `thread-${index + 1}`);

describe("resolveProjectThreadPreview", () => {
  it("collapses a project to the default three chats", () => {
    expect(
      resolveProjectThreadPreview({
        items: THREADS,
        count: DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
        showAll: false,
      }),
    ).toEqual({
      hasOverflowingItems: true,
      visibleItems: THREADS.slice(0, 3),
    });
  });

  it("honors custom and maximum collapsed counts", () => {
    expect(
      resolveProjectThreadPreview({ items: THREADS, count: 7, showAll: false }).visibleItems,
    ).toEqual(THREADS.slice(0, 7));
    expect(
      resolveProjectThreadPreview({ items: THREADS, count: 15, showAll: false }).visibleItems,
    ).toEqual(THREADS.slice(0, 15));
  });

  it("shows every item when expansion or search requests an unbounded list", () => {
    expect(resolveProjectThreadPreview({ items: THREADS, count: 3, showAll: true })).toEqual({
      hasOverflowingItems: true,
      visibleItems: THREADS,
    });
  });
});
