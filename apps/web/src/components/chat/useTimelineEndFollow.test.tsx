// @vitest-environment jsdom
import { act, createRef, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type { LegendListRef } from "@legendapp/list/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { useTimelineEndFollow } from "./useTimelineEndFollow";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("follows widget and disclosure growth, yields immediately to navigation, and returns to the updated end", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  const viewport = document.createElement("div");
  let height = 1500;
  Object.defineProperties(viewport, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 600 },
  });
  viewport.scrollTop = 900;
  let following = true;
  const scrollToEnd = vi.fn(() => {
    viewport.scrollTop = height - 600;
    return Promise.resolve();
  });
  const listRef = createRef<LegendListRef>();
  listRef.current = { getScrollableNode: () => viewport, scrollToEnd } as unknown as LegendListRef;
  let schedule = () => {};
  function Harness({ identity = "a", inset = 180, enabled = true }) {
    const scheduleFollow = useTimelineEndFollow({
      listRef,
      identity,
      bottomInset: inset,
      enabled,
      isFollowingEnd: () => following,
      revision: identity,
    });
    useLayoutEffect(() => {
      schedule = scheduleFollow;
    }, [scheduleFollow]);
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(() => root.render(<Harness />));
    await flush();
    expect(scrollToEnd).not.toHaveBeenCalled();
    height += 200;
    await act(() => root.render(<Harness inset={380} />));
    await flush();
    expect(viewport.scrollTop).toBe(1100);

    // A large disclosure can grow beyond the virtualizer's near-end threshold.
    height += 1200;
    schedule();
    schedule();
    await flush();
    expect(viewport.scrollTop).toBe(2300);
    height -= 900;
    schedule();
    await flush();
    expect(viewport.scrollTop).toBe(1400);

    height += 300;
    schedule();
    following = false;
    viewport.scrollTop = 400;
    await flush();
    expect(viewport.scrollTop).toBe(400);

    // A queued callback from A cannot move B, whose reader is in history.
    schedule();
    await act(() => root.render(<Harness identity="b" enabled={false} />));
    await flush();
    expect(viewport.scrollTop).toBe(400);
    height += 800;
    following = true;
    await act(() => root.render(<Harness identity="a" />));
    await flush();
    expect(viewport.scrollTop).toBe(height - 600);

    // Citations and send-time anchors keep ownership of their own scroll.
    await act(() => root.render(<Harness enabled={false} />));
    height += 100;
    const saved = viewport.scrollTop;
    schedule();
    await flush();
    expect(viewport.scrollTop).toBe(saved);
  } finally {
    await act(() => root.unmount());
    expect(frames.size).toBe(0);
  }
});
