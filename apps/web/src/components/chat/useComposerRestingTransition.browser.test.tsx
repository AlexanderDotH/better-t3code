import { act, fakeTimers, render as renderScreen, type Screen } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";

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
let host: HTMLElement;
let animateDescriptor: PropertyDescriptor | undefined;

function Fixture({
  collapsed,
  enabled = true,
  footerLayout,
}: {
  collapsed: boolean;
  enabled?: boolean;
  footerLayout?: "inline" | "external";
}) {
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
          {footerLayout ? (
            <div
              data-chat-composer-footer="true"
              data-footer-layout={footerLayout}
              data-collapsed={collapsed}
            >
              {!collapsed ? (
                <div
                  data-chat-composer-footer-controls="true"
                  data-chat-composer-controls={footerLayout === "external" ? "left" : "footer"}
                >
                  Model and mode
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

async function renderFixture(
  screen: Screen,
  collapsed: boolean,
  enabled = true,
  footerLayout?: "inline" | "external",
) {
  geometry.naturalHeight = collapsed ? 50 : 144;
  geometry.bodyHeight = collapsed ? 48 : 94;
  await act(() =>
    screen.rerender(
      <Fixture
        collapsed={collapsed}
        enabled={enabled}
        {...(footerLayout ? { footerLayout } : {})}
      />,
    ),
  );
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

it("keeps the collapse animation running when ResizeObserver redelivers its target layout", async () => {
  using _timers = fakeTimers();
  using _setup = setup();

  await using screen = await renderScreen(null, { router: false });
  host = screen.container;

  await renderFixture(screen, false);
  expect(heightAnimations()).toHaveLength(0);
  publishHeight.mockClear();
  await renderFixture(screen, true);
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
  using _timers = fakeTimers();
  using _setup = setup();

  await using screen = await renderScreen(null, { router: false });
  host = screen.container;

  await renderFixture(screen, false);
  await renderFixture(screen, true);
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
  using _timers = fakeTimers();
  using _setup = setup();

  await using screen = await renderScreen(null, { router: false });
  host = screen.container;

  await renderFixture(screen, false);
  await renderFixture(screen, true);
  const collapse = heightAnimations()[0]!;
  geometry.visibleHeight = 105;
  collapse.animation.currentTime = 100;
  await renderFixture(screen, false);
  const expansion = heightAnimations()[1]!;
  expect(expansion.keyframes).toEqual([{ height: "105px" }, { height: "144px" }]);
  expect(collapse.cancel).toHaveBeenCalledOnce();

  const overlay = host.querySelector<HTMLElement>("[data-chat-composer-overlay]")!;
  await act(() => screen.rerender(null));
  expect(expansion.cancel).toHaveBeenCalledOnce();
  expect(overlay.style.height).toBe("");
  expect(overlay.style.display).toBe("");
});

it("uses natural geometry without animation when motion is disabled", async () => {
  using _timers = fakeTimers();
  using _setup = setup();

  await using screen = await renderScreen(null, { router: false });
  host = screen.container;

  await renderFixture(screen, false, false);
  await renderFixture(screen, true, false);
  expect(heightAnimations()).toHaveLength(0);
  expect(publishHeight).toHaveBeenLastCalledWith(50, 0);
  expect(host.querySelector<HTMLElement>("[data-chat-composer-overlay]")!.style.height).toBe("");
});

it.each(["inline", "external"] as const)(
  "retains the %s footer position and reveals its controls when expanding",
  async (footerLayout) => {
    using _timers = fakeTimers();
    using _setup = setup();
    await using screen = await renderScreen(null, { router: false });
    host = screen.container;

    await renderFixture(screen, false, true, footerLayout);
    await renderFixture(screen, true, true, footerLayout);
    const footer = host.querySelector<HTMLElement>("[data-chat-composer-footer]")!;
    expect(footer.style.bottom).toBe(footerLayout === "inline" ? "40px" : "1px");
    await act(() => heightAnimations()[0]!.finish());
    expect(footer.style.bottom).toBe("");

    await renderFixture(screen, false, true, footerLayout);
    const controls = host.querySelector<HTMLElement>("[data-chat-composer-footer-controls]")!;
    expect(animations.some(({ target }) => target === controls)).toBe(true);
    await act(() => {
      for (const entry of animations) entry.finish();
    });
  },
);

function setup() {
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
    if (this.hasAttribute("data-chat-composer-footer")) {
      const bottom =
        this.dataset.collapsed === "true" && this.dataset.footerLayout === "inline" ? 40 : 1;
      return new DOMRect(0, 600 - bottom - 48, 500, 48);
    }
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
      if (this.hasAttribute("data-chat-composer-main-surface")) {
        currentHeightAnimation = animation;
        geometry.visibleHeight = Number.parseFloat(String(keyframes[0]?.height));
      }
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

  return {
    [Symbol.dispose]() {
      if (animateDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "animate", animateDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "animate");
      }
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
