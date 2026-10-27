// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
const shader = vi.hoisted(() => ({ prepare: vi.fn(), paint: vi.fn(), dispose: vi.fn() }));
vi.mock("./chatInteractionRipple", () => ({ createChatInteractionRipple: () => shader }));
import { createChatMessageArrival } from "./chatMessageArrival";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("finishes its shader sweep, cancels on scroll, and releases its GPU surface", () => {
  const media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(performance, "now").mockReturnValue(100);
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++next;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const viewport = document.createElement("div");
  const surface = document.createElement("div");
  viewport.append(surface);
  document.body.append(viewport);
  surface.getBoundingClientRect = () => new DOMRect(0, 0, 500, 240);
  const arrival = createChatMessageArrival(viewport);
  const tick = (now: number) => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  };
  arrival.play(surface);
  expect(shader.prepare).toHaveBeenCalledWith(500, 240, 0, 240, expect.any(String), 0.75, true);
  expect(surface.querySelector("canvas")).not.toBeNull();
  tick(100);
  tick(720);
  expect(frames.size).toBe(0);
  expect(surface.querySelector("canvas")).toBeNull();
  arrival.play(surface);
  viewport.dispatchEvent(new Event("scroll"));
  expect(frames.size).toBe(0);
  expect(surface.querySelector("canvas")).toBeNull();
  media.matches = true;
  media.dispatchEvent(new Event("change"));
  const calls = shader.prepare.mock.calls.length;
  arrival.play(surface);
  expect(shader.prepare).toHaveBeenCalledTimes(calls);
  arrival.dispose();
  expect(shader.dispose).toHaveBeenCalledOnce();
});
