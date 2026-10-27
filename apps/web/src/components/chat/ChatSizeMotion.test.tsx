// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { useChatWidthMotion } from "./ChatSizeMotion";

function Harness({ width, enabled = true }: { width: number; enabled?: boolean }) {
  const ref = useChatWidthMotion<HTMLDivElement>(width, enabled);
  return <div ref={ref} style={{ width, height: 30 }} />;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

it("keeps initial pills still, interrupts width changes, and cancels for hidden or reduced motion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<Harness width={100} />));
    expect(animate).not.toHaveBeenCalled();
    await act(() => root.render(<Harness width={240} />));
    expect(animate).toHaveBeenLastCalledWith({ width: ["100px", "240px"] }, expect.any(Object));
    visibleWidth = 160;
    await act(() => root.render(<Harness width={80} />));
    expect(animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenLastCalledWith({ width: ["160px", "80px"] }, expect.any(Object));
    await act(() => {
      media.matches = true;
      media.dispatchEvent(new Event("change"));
    });
    expect(animations[1]!.cancel).toHaveBeenCalledOnce();
    await act(() => root.render(<Harness width={200} />));
    expect(animate).toHaveBeenCalledTimes(2);
    media.matches = false;
    visibility.mockReturnValue("hidden");
    await act(() => root.render(<Harness width={300} />));
    expect(animate).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("visible");
    await act(() => root.render(<Harness width={140} enabled={false} />));
    expect(animate).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
