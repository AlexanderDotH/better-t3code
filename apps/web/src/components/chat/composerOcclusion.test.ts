// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { measureComposerOcclusion, observeComposerOcclusion } from "./composerOcclusion";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reserves the visible widget union without double-counting surfaces inside the composer", () => {
  const overlay = document.createElement("div");
  document.body.append(overlay);
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 620, 800, 180));
  const widget = document.createElement("div");
  widget.dataset.composerBannerSurface = "attached";
  overlay.append(widget);
  const rect = vi.spyOn(widget, "getBoundingClientRect");
  rect.mockReturnValue(new DOMRect(50, 650, 700, 40));
  expect(measureComposerOcclusion(overlay, 180)).toBe(180);
  rect.mockReturnValue(new DOMRect(50, 450, 700, 150));
  expect(measureComposerOcclusion(overlay, 180)).toBe(350);
  widget.style.visibility = "hidden";
  expect(measureComposerOcclusion(overlay, 180)).toBe(180);
  widget.style.visibility = "";
  widget.setAttribute("inert", "");
  expect(measureComposerOcclusion(overlay, 180)).toBe(180);
  widget.removeAttribute("inert");
  rect.mockReturnValue(new DOMRect(50, 620, 0, 0));
  expect(measureComposerOcclusion(overlay, 180)).toBe(180);
});

it("remeasures added, resized, hidden, and removed floating widgets and releases observers", async () => {
  const observed = new Set<Element>();
  let resize: (() => void) | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(element: Element) {
        observed.add(element);
      }
      disconnect() {
        observed.clear();
      }
    },
  );
  const overlay = document.createElement("div");
  document.body.append(overlay);
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 620, 800, 180));
  const heights: number[] = [];
  const stop = observeComposerOcclusion(overlay, () => {
    heights.push(measureComposerOcclusion(overlay, 180));
  });
  const widget = document.createElement("div");
  widget.dataset.chatComposerFloatingBubbleHost = "true";
  const rect = vi.spyOn(widget, "getBoundingClientRect");
  rect.mockReturnValue(new DOMRect(50, 450, 700, 150));
  overlay.append(widget);
  await Promise.resolve();
  expect(observed.has(widget)).toBe(true);
  expect(heights.at(-1)).toBe(350);
  rect.mockReturnValue(new DOMRect(50, 350, 700, 250));
  resize!();
  expect(heights.at(-1)).toBe(450);
  widget.setAttribute("aria-hidden", "true");
  await Promise.resolve();
  expect(heights.at(-1)).toBe(180);
  widget.remove();
  await Promise.resolve();
  expect(observed.has(widget)).toBe(false);
  stop();
  expect(observed.size).toBe(0);
  const count = heights.length;
  overlay.append(widget);
  overlay.dispatchEvent(new Event("transitionend"));
  await Promise.resolve();
  expect(heights).toHaveLength(count);
});
