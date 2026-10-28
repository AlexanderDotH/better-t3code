// @vitest-environment jsdom
import type { LegendListRef } from "@legendapp/list/react";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { TimelineComposerSpacer } from "./TimelineComposerSpacer";
import { useTimelineEndFollow } from "./useTimelineEndFollow";
import {
  shouldResumeTimelineEndFollow,
  type TimelineScrollIntent,
  type TimelineScrollMode,
} from "./timelineScrollAnchoring";

const motion = vi.hoisted(() => ({
  active: true,
  durationMs: 240,
  listeners: new Set<() => void>(),
}));
vi.mock("../../panelAnimations", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePanelAnimationSettings: () => ({
      active: useSyncExternalStore(
        (listener) => {
          motion.listeners.add(listener);
          return () => motion.listeners.delete(listener);
        },
        () => motion.active,
      ),
      durationMs: motion.durationMs,
    }),
  };
});

let root: Root;
let host: HTMLDivElement;
let viewport: HTMLDivElement;
let scrollOffset: number;
let scrollMode: TimelineScrollMode;
let scrollIntent: TimelineScrollIntent;
let animateDescriptor: PropertyDescriptor | undefined;
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const visibleHeights = new Map<HTMLElement, number>();
const observers = new Map<Element, () => void>();
const transitions: Array<{
  from: number;
  to: number;
  cancel: ReturnType<typeof vi.fn>;
  tick: (height: number) => void;
  finish: () => void;
}> = [];
const scrollToEnd = vi.fn(() => {
  viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
  return Promise.resolve();
});
const listRef = createRef<LegendListRef>();
const CONTENT_HEIGHT = 1000;
const VIEWPORT_HEIGHT = 600;

function insetElement() {
  return host.querySelector<HTMLElement>("[data-timeline-composer-inset]")!;
}

function insetHeight() {
  const element = insetElement();
  return element ? (visibleHeights.get(element) ?? Number.parseFloat(element.style.height)) : 260;
}

function gapAboveComposer() {
  const composerTop = VIEWPORT_HEIGHT - insetHeight();
  const lastRowBottom = CONTENT_HEIGHT - viewport.scrollTop;
  return composerTop - lastRowBottom;
}

function Harness({
  height,
  transitionDurationMs = 240,
}: {
  height: number;
  transitionDurationMs?: number;
}) {
  const scheduleFollow = useTimelineEndFollow({
    listRef,
    identity: "composer-gap",
    enabled: true,
    isFollowingEnd: () => scrollMode === "following-end",
    bottomInset: height,
    revision: "rows",
  });
  return (
    <TimelineComposerSpacer
      height={height}
      transitionDurationMs={transitionDurationMs}
      onHeightChange={scheduleFollow}
    />
  );
}

async function flushFrames() {
  await act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}

async function resizeAt(transition: (typeof transitions)[number], height: number) {
  await act(() => {
    transition.tick(height);
    const atEnd = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 40;
    if (atEnd && shouldResumeTimelineEndFollow(scrollMode, scrollIntent)) {
      scrollMode = "following-end";
    }
    observers.get(insetElement())?.();
  });
  await flushFrames();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  motion.active = true;
  frames.clear();
  visibleHeights.clear();
  observers.clear();
  transitions.length = 0;
  scrollMode = "following-end";
  scrollIntent = null;
  scrollOffset = 660;
  scrollToEnd.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private target: Element | null = null;
      constructor(private callback: () => void) {}
      observe(target: Element) {
        this.target = target;
        observers.set(target, this.callback);
      }
      disconnect() {
        if (this.target) observers.delete(this.target);
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, 0, 500, visibleHeights.get(this) ?? Number.parseFloat(this.style.height));
  });
  animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: function (this: HTMLElement, keyframes: Keyframe[]) {
      const from = Number.parseFloat(String(keyframes[0]!.height));
      const to = Number.parseFloat(String(keyframes[1]!.height));
      visibleHeights.set(this, from);
      const cancel = vi.fn(() => visibleHeights.delete(this));
      const animation = { cancel, onfinish: null } as unknown as Animation;
      transitions.push({
        from,
        to,
        cancel,
        tick: (height) => visibleHeights.set(this, height),
        finish: () => {
          visibleHeights.delete(this);
          animation.onfinish?.(
            Object.assign(new Event("finish"), { currentTime: 240, timelineTime: 240 }),
          );
        },
      });
      return animation;
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  viewport = document.createElement("div");
  Object.defineProperties(viewport, {
    clientHeight: { value: VIEWPORT_HEIGHT },
    scrollHeight: { get: () => CONTENT_HEIGHT + insetHeight() },
    scrollTop: {
      get: () => (scrollOffset = Math.min(scrollOffset, viewport.scrollHeight - VIEWPORT_HEIGHT)),
      set: (value: number) => {
        scrollOffset = Math.max(0, Math.min(value, viewport.scrollHeight - VIEWPORT_HEIGHT));
      },
    },
  });
  listRef.current = { getScrollableNode: () => viewport, scrollToEnd } as unknown as LegendListRef;
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  expect(observers.size).toBe(0);
  expect(frames.size).toBe(0);
  host.remove();
  if (animateDescriptor) Object.defineProperty(HTMLElement.prototype, "animate", animateDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("closes the released composer space after a small upward scroll and keeps navigation in control", async () => {
  await act(() => root.render(<Harness height={260} />));
  await flushFrames();
  expect(transitions).toHaveLength(0);
  scrollMode = "free-scrolling";
  scrollIntent = "away-from-end";
  viewport.scrollTop -= 20;

  await act(() => root.render(<Harness height={166} />));
  const collapse = transitions[0]!;
  expect(collapse.from).toBe(260);
  expect(collapse.to).toBe(166);
  expect(viewport.scrollTop).toBe(640);
  for (const height of [240, 213, 185, 166]) {
    await resizeAt(collapse, height);
    expect(gapAboveComposer()).toBeLessThanOrEqual(0);
    expect(scrollMode).toBe("free-scrolling");
  }
  collapse.finish();
  expect(gapAboveComposer()).toBe(0);
  expect(scrollToEnd).not.toHaveBeenCalled();

  scrollIntent = "toward-end";
  if (shouldResumeTimelineEndFollow(scrollMode, scrollIntent)) scrollMode = "following-end";
  expect(scrollMode).toBe("following-end");
  await act(() => root.render(<Harness height={260} />));
  const expansion = transitions[1]!;
  for (const height of [185, 213, 240, 260]) {
    await resizeAt(expansion, height);
    expect(gapAboveComposer()).toBe(0);
  }
  expansion.finish();
  expect(viewport.scrollTop).toBe(660);

  scrollMode = "free-scrolling";
  scrollIntent = "away-from-end";
  viewport.scrollTop = 200;
  scrollToEnd.mockClear();
  await act(() => root.render(<Harness height={166} />));
  await resizeAt(transitions[2]!, 166);
  expect(viewport.scrollTop).toBe(200);
  expect(scrollToEnd).not.toHaveBeenCalled();
});

it("applies direct layout changes immediately when the composer is not animating", async () => {
  await act(() => root.render(<Harness height={260} />));
  await act(() => root.render(<Harness height={200} transitionDurationMs={0} />));
  expect(transitions).toHaveLength(0);
  expect(insetHeight()).toBe(200);
  await flushFrames();
  expect(gapAboveComposer()).toBe(0);
});

it("reverses from the displayed inset and stops immediately when motion is disabled", async () => {
  await act(() => root.render(<Harness height={260} />));
  await act(() => root.render(<Harness height={166} />));
  const collapse = transitions[0]!;
  collapse.tick(220);
  await act(() => root.render(<Harness height={260} />));
  expect(collapse.cancel).toHaveBeenCalledOnce();
  expect(transitions[1]!.from).toBe(220);
  expect(transitions[1]!.to).toBe(260);
  await act(() => {
    motion.active = false;
    motion.listeners.forEach((listener) => listener());
  });
  expect(transitions[1]!.cancel).toHaveBeenCalledOnce();
  expect(insetHeight()).toBe(260);
  await flushFrames();
});
