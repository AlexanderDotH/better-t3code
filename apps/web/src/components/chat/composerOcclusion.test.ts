// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  measureComposerOcclusion,
  observeComposerOcclusion,
  pinComposerOcclusion,
} from "./composerOcclusion";

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

it("holds the destination while floating widgets pass through intermediate positions", () => {
  const overlay = document.createElement("div");
  document.body.append(overlay);
  const rect = vi.spyOn(overlay, "getBoundingClientRect");
  rect.mockReturnValue(new DOMRect(0, 640, 800, 160));
  const widget = document.createElement("div");
  widget.dataset.composerBannerSurface = "attached";
  overlay.append(widget);
  const widgetRect = vi.spyOn(widget, "getBoundingClientRect");
  widgetRect.mockReturnValue(new DOMRect(0, 500, 800, 40));
  const release = pinComposerOcclusion(overlay, 200);
  expect(measureComposerOcclusion(overlay, 160)).toBe(200);
  widgetRect.mockReturnValue(new DOMRect(0, 600, 800, 40));
  expect(measureComposerOcclusion(overlay, 160)).toBe(200);
  release();
  expect(measureComposerOcclusion(overlay, 160)).toBe(200);
  widgetRect.mockReturnValue(new DOMRect(0, 560, 800, 40));
  expect(measureComposerOcclusion(overlay, 160)).toBe(240);
});

it("remeasures added, resized, hidden, and removed floating widgets and releases observers", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };
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
  flush();
  const widget = document.createElement("div");
  widget.dataset.chatComposerFloatingBubbleHost = "true";
  const rect = vi.spyOn(widget, "getBoundingClientRect");
  rect.mockReturnValue(new DOMRect(50, 450, 700, 150));
  overlay.append(widget);
  await Promise.resolve();
  expect(observed.has(widget)).toBe(true);
  flush();
  expect(heights.at(-1)).toBe(350);
  rect.mockReturnValue(new DOMRect(50, 350, 700, 250));
  resize!();
  resize!();
  expect(frames.size).toBe(1);
  flush();
  expect(heights.at(-1)).toBe(450);
  widget.setAttribute("aria-hidden", "true");
  await Promise.resolve();
  flush();
  expect(heights.at(-1)).toBe(180);
  widget.remove();
  await Promise.resolve();
  expect(observed.has(widget)).toBe(false);
  stop();
  expect(observed.size).toBe(0);
  expect(frames.size).toBe(0);
  const count = heights.length;
  overlay.append(widget);
  overlay.dispatchEvent(new Event("transitionend"));
  await Promise.resolve();
  expect(heights).toHaveLength(count);
});
