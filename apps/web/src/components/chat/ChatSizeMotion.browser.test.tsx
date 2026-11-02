import { act, render as renderScreen } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { useChatWidthMotion } from "./ChatSizeMotion";

function Harness({ width, enabled = true }: { width: number; enabled?: boolean }) {
  const ref = useChatWidthMotion<HTMLDivElement>(width, enabled);
  return <div ref={ref} style={{ width, height: 30 }} />;
}

it("keeps initial pills still, interrupts width changes, and cancels for hidden or reduced motion", async () => {
  using _setup = setup();

  const media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let visibleWidth: number | null = null;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, 20, visibleWidth ?? Number.parseFloat(this.style.width), 30);
  });
  const animations: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];
  const animate = vi.fn(() => {
    const animation = {
      cancel: vi.fn(() => {
        visibleWidth = null;
      }),
      onfinish: null,
    };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
  await using screen = await renderScreen(null, { router: false });

  await act(() => screen.rerender(<Harness width={100} />));
  expect(animate).not.toHaveBeenCalled();
  await act(() => screen.rerender(<Harness width={240} />));
  expect(animate).toHaveBeenLastCalledWith({ width: ["100px", "240px"] }, expect.any(Object));
  visibleWidth = 160;
  await act(() => screen.rerender(<Harness width={80} />));
  expect(animations[0]!.cancel).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenLastCalledWith({ width: ["160px", "80px"] }, expect.any(Object));
  await act(() => {
    media.matches = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(animations[1]!.cancel).toHaveBeenCalledOnce();
  await act(() => screen.rerender(<Harness width={200} />));
  expect(animate).toHaveBeenCalledTimes(2);
  media.matches = false;
  visibility.mockReturnValue("hidden");
  await act(() => screen.rerender(<Harness width={300} />));
  expect(animate).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue("visible");
  await act(() => screen.rerender(<Harness width={140} enabled={false} />));
  expect(animate).toHaveBeenCalledTimes(2);
});

function setup() {
  const animationDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");

  return {
    [Symbol.dispose]() {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      if (animationDescriptor)
        Object.defineProperty(HTMLElement.prototype, "animate", animationDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
    },
  };
}
