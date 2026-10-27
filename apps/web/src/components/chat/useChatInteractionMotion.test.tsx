// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useChatInteractionMotion } from "./useChatInteractionMotion";

const gpu = vi.hoisted(() => ({
  create: vi.fn(),
  prepare: vi.fn(),
  paint: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./chatInteractionRipple", () => ({ createChatInteractionRipple: gpu.create }));

let root: Root;
let host: HTMLDivElement;
let preference: EventTarget & { matches: boolean };
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
const action = vi.fn();

function Harness({ enabled = true }: { enabled?: boolean }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  useChatInteractionMotion(viewport, enabled, "thread");
  return (
    <div ref={setViewport}>
      <button data-outside onClick={action}>
        Outside timeline
      </button>
      <div data-timeline-row-id="row">
        <button data-action onClick={action}>
          <span>Open thinking</span>
        </button>
        <button data-image data-chat-media-preview onClick={action}>
          <img src="screenshot.png" alt="Screenshot preview" />
        </button>
        <img
          data-inline-image
          data-chat-media-preview
          role="button"
          tabIndex={0}
          src="inline.png"
          alt="Inline preview"
          onClick={action}
        />
        <button data-video data-chat-media-preview onClick={action}>
          Play video
        </button>
        <button data-document data-chat-media-preview onClick={action}>
          Preview document
        </button>
        <button disabled>Disabled</button>
        <div role="button" data-tool>
          <div data-presentation-status>Tool step</div>
          <pre>Selectable output</pre>
        </div>
      </div>
    </div>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  preference = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => preference);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 36,
    right: 200,
    width: 200,
    height: 36,
    toJSON() {},
  });
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  gpu.create.mockReturnValue({ prepare: gpu.prepare, paint: gpu.paint, dispose: gpu.dispose });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root.render(<Harness />));
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const click = (selector = "[data-action]") =>
  act(() => host.querySelector<HTMLElement>(selector)!.click());

it("creates one bounded ripple on activation, preserves the action, and stops all frames when idle", async () => {
  expect(gpu.create).not.toHaveBeenCalled();
  await click();
  expect(action).toHaveBeenCalledTimes(1);
  expect(gpu.prepare).toHaveBeenLastCalledWith(200, 36, 100, 18, expect.any(String), 1);
  expect(frames.size).toBe(1);
  await click();
  expect(gpu.create).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(1);
  const callback = [...frames.values()][0]!;
  frames.clear();
  callback(500);
  expect(gpu.paint).toHaveBeenLastCalledWith(1);
  expect(frames.size).toBe(0);
  expect(host.querySelector("canvas")?.hidden).toBe(true);
});

it("keeps image, video, and document previews free of hover and click shaders while preserving open actions", async () => {
  for (const selector of [
    "[data-image] img",
    "[data-inline-image]",
    "[data-video]",
    "[data-document]",
  ]) {
    const target = host.querySelector<HTMLElement>(selector)!;
    await act(() =>
      target.dispatchEvent(
        Object.assign(new MouseEvent("pointerover", { bubbles: true }), { pointerType: "mouse" }),
      ),
    );
    await click(selector);
  }
  expect(action).toHaveBeenCalledTimes(4);
  expect(gpu.create).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  await click();
  expect(gpu.create).toHaveBeenCalledOnce();
  expect(action).toHaveBeenCalledTimes(5);
});

it("leaves text selection, output, disabled controls, and the surrounding UI alone", async () => {
  await click("[data-outside]");
  await click("button:disabled");
  await click("pre");
  expect(gpu.create).not.toHaveBeenCalled();
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(host.querySelector("pre")!);
  selection.addRange(range);
  await click();
  expect(gpu.create).not.toHaveBeenCalled();
  expect(selection.toString()).toBe("Selectable output");
});

it("cancels when scrolling, reducing motion, hiding the document, or disabling the setting", async () => {
  await click();
  host.firstElementChild!.dispatchEvent(new Event("scroll"));
  expect(frames.size).toBe(0);
  await click();
  preference.matches = true;
  preference.dispatchEvent(new Event("change"));
  expect(frames.size).toBe(0);
  const calls = gpu.prepare.mock.calls.length;
  await click();
  expect(gpu.prepare).toHaveBeenCalledTimes(calls);
  preference.matches = false;
  await click();
  document.dispatchEvent(new Event("visibilitychange"));
  expect(frames.size).toBe(0);
  await click();
  await act(() => root.render(<Harness enabled={false} />));
  expect(frames.size).toBe(0);
  expect(gpu.dispose).toHaveBeenCalledTimes(1);
  expect(host.querySelector("canvas")).toBeNull();
});

it("falls back without interfering with controls if WebGL is unavailable or lost", async () => {
  gpu.create.mockReturnValueOnce(null);
  await click();
  expect(action).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
  await act(() => root.render(<Harness enabled={false} />));
  await act(() => root.render(<Harness />));
  await click();
  expect(frames.size).toBe(1);
  host.querySelector("canvas")!.dispatchEvent(new Event("webglcontextlost"));
  expect(frames.size).toBe(0);
  expect(host.querySelector("canvas")).toBeNull();
  await click();
  expect(action).toHaveBeenCalledTimes(3);
  expect(gpu.create).toHaveBeenCalledTimes(2);
});
