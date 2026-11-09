import { act, render as renderScreen } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { TimelineComposerSpacer } from "./TimelineComposerSpacer";

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

let host: HTMLElement;
let viewport: HTMLDivElement;
let scrollOffset: number;
let animateDescriptor: PropertyDescriptor | undefined;
const visibleHeights = new Map<HTMLElement, number>();
const observers = new Map<Element, () => void>();
const transitions: Array<{
  from: number;
  to: number;
  cancel: ReturnType<typeof vi.fn>;
  tick: (height: number) => void;
  finish: () => void;
}> = [];
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
  return (
    <TimelineComposerSpacer
      height={height}
      transitionDurationMs={transitionDurationMs}
      onHeightChange={() => {}}
    />
  );
}

it("applies direct layout changes immediately when the composer is not animating", async () => {
  using _setup = setup();

  await using screen = await renderScreen(null, { router: false });
  host = screen.container;

  await act(() => screen.rerender(<Harness height={260} />));
  await act(() => screen.rerender(<Harness height={200} transitionDurationMs={0} />));
  expect(transitions).toHaveLength(0);
  expect(insetHeight()).toBe(200);
  expect(gapAboveComposer()).toBe(0);
});

it("reverses from the displayed inset and stops immediately when motion is disabled", async () => {
  using _setup = setup();

  await using screen = await renderScreen(null, { router: false });
  host = screen.container;

  await act(() => screen.rerender(<Harness height={260} />));
  await act(() => screen.rerender(<Harness height={166} />));
  const collapse = transitions[0]!;
  collapse.tick(220);
  await act(() => screen.rerender(<Harness height={260} />));
  expect(collapse.cancel).toHaveBeenCalledOnce();
  expect(transitions[1]!.from).toBe(220);
  expect(transitions[1]!.to).toBe(260);
  await act(() => {
    motion.active = false;
    motion.listeners.forEach((listener) => listener());
  });
  expect(transitions[1]!.cancel).toHaveBeenCalledOnce();
  expect(insetHeight()).toBe(260);
});

function setup() {
  motion.active = true;
  visibleHeights.clear();
  observers.clear();
  transitions.length = 0;
  scrollOffset = 660;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private target: Element | null = null;
      constructor(private callback: (entries: readonly ResizeObserverEntry[]) => void) {}
      observe(target: Element) {
        this.target = target;
        observers.set(target, () =>
          this.callback([
            { target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry,
          ]),
        );
      }
      unobserve(target: Element) {
        observers.delete(target);
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

  return {
    [Symbol.dispose]() {
      expect(observers.size).toBe(0);

      if (animateDescriptor)
        Object.defineProperty(HTMLElement.prototype, "animate", animateDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
