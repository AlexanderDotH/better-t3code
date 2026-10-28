// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useComposerRestingTransition } from "./useComposerRestingTransition";

const publishHeight = vi.fn();
const restingControlsRef = { current: null };
const geometry = { naturalHeight: 144, bodyHeight: 94, visibleHeight: null as number | null };
const animations: Array<{
  target: HTMLElement;
  keyframes: Keyframe[];
  animation: Animation;
  cancel: ReturnType<typeof vi.fn>;
  finish: () => void;
}> = [];
let currentHeightAnimation: Animation | null = null;
let notifyResize: (entries: ResizeObserverEntry[]) => void;
let host: HTMLDivElement;
let root: Root;
let animateDescriptor: PropertyDescriptor | undefined;

function Fixture({ collapsed, enabled = true }: { collapsed: boolean; enabled?: boolean }) {
  const ref = useComposerRestingTransition(
    collapsed,
    collapsed,
    restingControlsRef,
    publishHeight,
    enabled,
    240,
    true,
  );
  return (
    <div data-chat-composer-overlay="true">
      <div ref={ref} data-chat-composer-main-surface="true">
        <div data-chat-composer-surface="true">
          <div data-chat-composer-body="true">Draft</div>
        </div>
      </div>
    </div>
  );
}

async function render(collapsed: boolean, enabled = true) {
  geometry.naturalHeight = collapsed ? 50 : 144;
  geometry.bodyHeight = collapsed ? 48 : 94;
  await act(() => root.render(<Fixture collapsed={collapsed} enabled={enabled} />));
}

async function resizeBody() {
  const body = host.querySelector<HTMLElement>("[data-chat-composer-body]")!;
  await act(() => {
    const contentRect = body.getBoundingClientRect();
    const size = [{ blockSize: contentRect.height, inlineSize: contentRect.width }];
    notifyResize([
      {
        target: body,
        contentRect,
        borderBoxSize: size,
        contentBoxSize: size,
        devicePixelContentBoxSize: size,
      },
    ]);
  });
}

function heightAnimations() {
  return animations.filter(({ target }) => target.hasAttribute("data-chat-composer-main-surface"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  geometry.naturalHeight = 144;
  geometry.bodyHeight = 94;
  geometry.visibleHeight = null;
  currentHeightAnimation = null;
  animations.length = 0;
  publishHeight.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = (entries) => callback(entries, this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute("data-chat-composer-body")) {
      return new DOMRect(0, 0, 500, geometry.bodyHeight);
    }
    const height = this.hasAttribute("data-chat-composer-overlay")
      ? Number.parseFloat(this.style.height) || geometry.naturalHeight
      : (geometry.visibleHeight ?? geometry.naturalHeight);
    return new DOMRect(0, 600 - height, 500, height);
  });
  animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      let resolveFinished: () => void = () => {};
      let rejectFinished: (reason: unknown) => void = () => {};
      const finished = new Promise<void>((resolve, reject) => {
        resolveFinished = resolve;
        rejectFinished = reject;
      });
      const animation = {
        currentTime: 0,
        effect: { getComputedTiming: () => ({ duration: options.duration }) },
        finished,
        cancel: vi.fn(() => {
          if (currentHeightAnimation === animation) {
            currentHeightAnimation = null;
            geometry.visibleHeight = null;
          }
          rejectFinished(new DOMException("Animation cancelled", "AbortError"));
        }),
      } as unknown as Animation;
      // Content animations are absent from this geometry fixture.
      currentHeightAnimation = animation;
      geometry.visibleHeight = Number.parseFloat(String(keyframes[0]?.height));
      animations.push({
        target: this,
        keyframes,
        animation,
        cancel: animation.cancel as ReturnType<typeof vi.fn>,
        finish() {
          if (currentHeightAnimation === animation) {
            currentHeightAnimation = null;
            geometry.visibleHeight = null;
          }
          resolveFinished();
        },
      });
      return animation;
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  if (animateDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "animate", animateDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the collapse animation running when ResizeObserver redelivers its target layout", async () => {
  await render(false);
  expect(heightAnimations()).toHaveLength(0);
  publishHeight.mockClear();
  await render(true);
  const transition = heightAnimations()[0]!;
  expect(publishHeight.mock.calls).toEqual([[50, 240]]);
  expect(transition.keyframes).toEqual([{ height: "144px" }, { height: "50px" }]);

  geometry.visibleHeight = 110;
  transition.animation.currentTime = 80;
  await resizeBody();
  await resizeBody();
  expect(heightAnimations()).toHaveLength(1);
  expect(transition.cancel).not.toHaveBeenCalled();
  expect(geometry.visibleHeight).toBe(110);

  await act(() => transition.finish());
  expect(host.querySelector<HTMLElement>("[data-chat-composer-overlay]")!.style.height).toBe("");
  expect(host.querySelector<HTMLElement>("[data-chat-composer-surface]")!.style.height).toBe("");
  expect(host.querySelector<HTMLElement>("[data-chat-composer-main-surface]")!.style.overflow).toBe(
    "",
  );
});

it("retargets real body growth from the visible height and leaves later duplicate measurements alone", async () => {
  await render(false);
  await render(true);
  const first = heightAnimations()[0]!;
  geometry.visibleHeight = 110;
  first.animation.currentTime = 80;
  geometry.naturalHeight = 70;
  geometry.bodyHeight = 68;
  await resizeBody();

  const second = heightAnimations()[1]!;
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(second.keyframes).toEqual([{ height: "110px" }, { height: "70px" }]);
  await resizeBody();
  expect(heightAnimations()).toHaveLength(2);
  expect(second.cancel).not.toHaveBeenCalled();

  await act(() => second.finish());
  expect(geometry.visibleHeight).toBeNull();
  expect(host.querySelector<HTMLElement>("[data-chat-composer-overlay]")!.style.height).toBe("");
});

it("reverses an interrupted collapse from its current height and clears the overlay on unmount", async () => {
  await render(false);
  await render(true);
  const collapse = heightAnimations()[0]!;
  geometry.visibleHeight = 105;
  collapse.animation.currentTime = 100;
  await render(false);
  const expansion = heightAnimations()[1]!;
  expect(expansion.keyframes).toEqual([{ height: "105px" }, { height: "144px" }]);
  expect(collapse.cancel).toHaveBeenCalledOnce();

  const overlay = host.querySelector<HTMLElement>("[data-chat-composer-overlay]")!;
  await act(() => root.render(null));
  expect(expansion.cancel).toHaveBeenCalledOnce();
  expect(overlay.style.height).toBe("");
  expect(overlay.style.display).toBe("");
});

it("uses natural geometry without animation when motion is disabled", async () => {
  await render(false, false);
  await render(true, false);
  expect(heightAnimations()).toHaveLength(0);
  expect(publishHeight).toHaveBeenLastCalledWith(50, 0);
  expect(host.querySelector<HTMLElement>("[data-chat-composer-overlay]")!.style.height).toBe("");
});
