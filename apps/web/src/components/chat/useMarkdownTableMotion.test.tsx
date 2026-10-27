// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { useMarkdownTableMotion } from "./useMarkdownTableMotion";

function Harness({
  enabled = true,
  initialExpanded = false,
}: {
  enabled?: boolean;
  initialExpanded?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [width, setWidth] = useState(500);
  const motion = useMarkdownTableMotion(ref, `${expanded}:${width}`, enabled);
  return (
    <>
      <button
        onClick={() => {
          motion.prepare();
          setExpanded((value) => !value);
        }}
      >
        Toggle table
      </button>
      <button
        onClick={() => {
          motion.prepare();
          setWidth((value) => value + 80);
        }}
      >
        Resize table
      </button>
      <div
        ref={ref}
        data-testid="table"
        style={{ width: expanded ? width : 300, height: expanded ? 160 : 80 }}
      />
    </>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

it("animates only user toggles, reverses cleanly, and honors reduced motion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(
      0,
      0,
      Number.parseFloat(this.style.width) || 0,
      Number.parseFloat(this.style.height) || 0,
    );
  });
  const animations: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];
  const animate = vi.fn(() => {
    const animation = { cancel: vi.fn(), onfinish: null };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<Harness />));
    expect(animate).not.toHaveBeenCalled();
    await act(() => host.querySelector("button")!.click());
    expect(animate).toHaveBeenLastCalledWith(
      { width: ["300px", "500px"], height: ["80px", "160px"] },
      expect.objectContaining({ duration: 280 }),
    );
    expect(host.querySelector("[data-table-animating]")).not.toBeNull();
    await act(() => host.querySelector("button")!.click());
    expect(animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenLastCalledWith(
      { width: ["500px", "300px"], height: ["160px", "80px"] },
      expect.objectContaining({ duration: 280 }),
    );
    await act(() => animations[1]!.onfinish?.());
    expect(host.querySelector("[data-table-animating]")).toBeNull();
    await act(() => host.querySelector("button")!.click());
    await act(() => host.querySelectorAll("button")[1]!.click());
    expect(animate).toHaveBeenLastCalledWith(
      { width: ["500px", "580px"], height: ["160px", "160px"] },
      expect.any(Object),
    );
    await act(() => {
      media.matches = true;
      media.dispatchEvent(new Event("change"));
    });
    expect(animations[3]!.cancel).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-table-animating]")).toBeNull();
    await act(() => host.querySelector("button")!.click());
    expect(animate).toHaveBeenCalledTimes(4);
    await act(() => root.render(<Harness key="restored" initialExpanded />));
    expect(animate).toHaveBeenCalledTimes(4);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
