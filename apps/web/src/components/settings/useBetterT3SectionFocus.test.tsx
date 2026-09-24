import { act, useRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { useBetterT3SectionFocus } from "./useBetterT3SectionFocus";

afterEach(() => vi.unstubAllGlobals());

function SectionFocusProbe() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { activeGroup } = useBetterT3SectionFocus(contentRef, "general");
  return <div ref={contentRef} data-active-group={activeGroup} />;
}

it("focuses the section occupying the most visible space and only updates row styles when focus or layout changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const groupTops = { general: 180, appearance: 420, chat: 900 };
  const groupHeights = { general: 200, appearance: 200, chat: 200 };
  let navigationBottom = 160;
  let onScroll = () => {};
  let onResize = () => {};
  let nextFrame = 0;
  const scheduledFrames = new Map<number, FrameRequestCallback>();
  const flushFrames = () => {
    const frames = [...scheduledFrames.values()];
    scheduledFrames.clear();
    for (const frame of frames) frame(0);
  };
  const scrollArea = {
    getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
    addEventListener: (_event: string, listener: () => void) => {
      onScroll = listener;
    },
    removeEventListener: vi.fn(),
  };
  const navigation = { getBoundingClientRect: () => ({ bottom: navigationBottom }) };
  const groups = Object.keys(groupTops).map((id) => {
    const top = () => groupTops[id as keyof typeof groupTops];
    const values = new Map<string, string>();
    const item = {
      dataset: {},
      parentElement: null,
      style: { setProperty: (key: string, value: string) => values.set(key, value) },
      getBoundingClientRect: vi.fn(() => ({ top: top() + 40, bottom: top() + 100 })),
    };
    return {
      dataset: { betterT3Group: id, focusActive: "" },
      getBoundingClientRect: () => ({
        top: top(),
        bottom: top() + groupHeights[id as keyof typeof groupHeights],
      }),
      querySelectorAll: () => [item],
      values,
      item,
    };
  });
  const content = {
    closest: () => scrollArea,
    querySelector: () => navigation,
    querySelectorAll: () => groups,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const frame = ++nextFrame;
      scheduledFrames.set(frame, callback);
      return frame;
    },
    cancelAnimationFrame: (frame: number) => scheduledFrames.delete(frame),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<SectionFocusProbe />, {
        createNodeMock: (element) =>
          (element.props as Record<string, unknown>)["data-active-group"] !== undefined
            ? content
            : null,
      });
    });
    await act(flushFrames);
    expect(renderer!.root.findByProps({ "data-active-group": "general" })).toBeDefined();
    expect(groups[0]!.dataset.focusActive).toBe("true");
    expect(groups[0]!.values.get("--settings-focus-blur")).toBe("0px");
    expect(parseFloat(groups[2]!.values.get("--settings-focus-blur")!)).toBeGreaterThan(
      parseFloat(groups[1]!.values.get("--settings-focus-blur")!),
    );
    expect(Number(groups[2]!.values.get("--settings-focus-opacity"))).toBeLessThan(
      Number(groups[1]!.values.get("--settings-focus-opacity")),
    );
    const measurements = groups.map((group) => group.item.getBoundingClientRect.mock.calls.length);
    await act(() => {
      onScroll();
      flushFrames();
    });
    expect(groups.map((group) => group.item.getBoundingClientRect.mock.calls.length)).toEqual(
      measurements,
    );

    groupTops.general = -200;
    groupTops.appearance = 150;
    await act(() => {
      onScroll();
      flushFrames();
    });
    expect(renderer!.root.findByProps({ "data-active-group": "appearance" })).toBeDefined();
    expect(groups[0]!.dataset.focusActive).toBe("false");
    expect(groups[1]!.values.get("--settings-focus-opacity")).toBe("1");

    // The tall chat section fills more of the viewport even though appearance is almost fully visible.
    groupTops.chat = 390;
    groupHeights.chat = 1_200;
    await act(() => {
      onScroll();
      flushFrames();
    });
    expect(renderer!.root.findByProps({ "data-active-group": "chat" })).toBeDefined();
    expect(groups[1]!.dataset.focusActive).toBe("false");
    expect(groups[2]!.values.get("--settings-focus-blur")).toBe("0px");

    // Scrolling back should focus appearance before its heading reaches the navigation.
    groupTops.general += 250;
    groupTops.appearance += 250;
    groupTops.chat += 250;
    await act(() => {
      onScroll();
      flushFrames();
    });
    expect(renderer!.root.findByProps({ "data-active-group": "appearance" })).toBeDefined();
    expect(groups[1]!.values.get("--settings-focus-blur")).toBe("0px");

    groupTops.general = -200;
    groupTops.appearance = 100;
    groupHeights.appearance = 600;
    groupTops.chat = 720;
    await act(() => {
      onScroll();
      flushFrames();
    });
    expect(renderer!.root.findByProps({ "data-active-group": "appearance" })).toBeDefined();

    // Content covered by the sticky navigation does not count toward visible space.
    navigationBottom = 640;
    await act(() => {
      onResize();
      flushFrames();
    });
    expect(renderer!.root.findByProps({ "data-active-group": "chat" })).toBeDefined();

    // Equal visible areas keep the current selection stable.
    navigationBottom = 340;
    groupTops.appearance = 340;
    groupHeights.appearance = 200;
    groupTops.chat = 600;
    await act(() => {
      onResize();
      flushFrames();
    });
    expect(renderer!.root.findByProps({ "data-active-group": "chat" })).toBeDefined();
    expect(groups[2]!.values.get("--settings-focus-blur")).toBe("0px");
  } finally {
    await act(() => renderer?.unmount());
  }
});
