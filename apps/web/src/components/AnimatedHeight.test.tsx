// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { AnimatedHeight } from "./AnimatedHeight";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("resizes changing content, rebases after disable, and follows a textarea drag directly", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let height = 80;
  let notify: () => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 300, height),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (enabled: boolean) => (
    <AnimatedHeight enabled={enabled} containMargins>
      <textarea defaultValue="Draft" />
    </AnimatedHeight>
  );
  try {
    await act(() => root.render(render(true)));
    const shell = host.firstElementChild as HTMLElement;
    expect(shell.style.height).toBe("80px");
    expect(shell.style.overflow).toBe("visible");
    height = 200;
    await act(() => notify());
    expect(shell.style.height).toBe("200px");
    expect(shell.style.overflow).toBe("hidden");
    height = 100;
    await act(() => notify());
    expect(shell.style.height).toBe("100px");
    const textarea = host.querySelector("textarea")!;
    await act(() =>
      textarea.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 295, clientY: 95 }),
      ),
    );
    height = 160;
    await act(() => notify());
    expect(shell.style.height).toBe("160px");
    expect(shell.style.overflow).toBe("visible");
    expect(shell.className).not.toContain("transition");
    await act(() => window.dispatchEvent(new Event("pointerup")));
    await act(() => root.render(render(false)));
    expect(shell.style.height).toBe("");
    height = 260;
    await act(() => root.render(render(true)));
    expect(shell.style.height).toBe("260px");
    expect(shell.style.overflow).toBe("visible");
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
  expect(disconnect).toHaveBeenCalled();
});
