// @vitest-environment jsdom

import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({
  timing: vi.fn((value: number, _config?: object) => value),
  cancel: vi.fn(),
  spring: vi.fn((value: number, _config?: { duration: number }) => value),
  visible: true,
  listeners: new Set<(token: { sizeVisible: number }) => void>(),
}));
vi.mock("@legendapp/list/react-native", async () => {
  const { useLayoutEffect } = await import("react");
  return {
    useViewabilityAmount: (callback: (token: { sizeVisible: number }) => void) => {
      useLayoutEffect(() => {
        native.listeners.add(callback);
        callback({ sizeVisible: native.visible ? 100 : 0 });
        return () => {
          native.listeners.delete(callback);
        };
      }, [callback]);
    },
  };
});
vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  return {
    default: {
      View: (props: { children?: ReactNode }) => createElement("div", {}, props.children),
    },
    cancelAnimation: native.cancel,
    Easing: { out: (value: unknown) => value, cubic: "cubic" },
    ReduceMotion: { System: "system" },
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: number) =>
      useRef({
        value,
        get() {
          return this.value;
        },
        set(next: number) {
          this.value = next;
        },
      }).current,
    withDelay: (_delay: number, value: number) => value,
    withTiming: native.timing,
    withSpring: native.spring,
  };
});

import { ChatPresentationMotion, ChatPresentationMotionContext } from "./ChatPresentationMotion";
import { createChatMotionAdmission } from "./chat-presentation-motion";

let host: HTMLDivElement;
let root: Root;
const now = Date.parse("2026-10-26T12:00:00Z");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  native.visible = true;
  native.timing.mockClear();
  native.spring.mockClear();
  native.cancel.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function admission() {
  const registry = createChatMotionAdmission();
  const base = {
    context: "thread:better-t3:1",
    now,
    enabled: true,
    characterStreamingMotion: false,
  };
  registry.observe({ ...base, items: [] });
  registry.observe({
    ...base,
    items: [
      { id: "message", kind: "user", createdAt: new Date(now).toISOString(), revision: "message" },
    ],
  });
  return registry;
}

it("runs one native entrance and cancels it immediately when presentation motion becomes unavailable", () => {
  const registry = admission();
  const render = (enabled: boolean) =>
    act(() =>
      root.render(
        <ChatPresentationMotionContext value={{ betterT3: true, enabled, claim: registry.claim }}>
          <ChatPresentationMotion motionId="message">Message</ChatPresentationMotion>
        </ChatPresentationMotionContext>,
      ),
    );
  render(true);
  expect(native.timing).toHaveBeenCalledTimes(1);
  expect(native.timing.mock.calls[0]?.[1]).toMatchObject({ duration: 320, reduceMotion: "system" });
  expect(native.spring).toHaveBeenCalledOnce();
  const springConfig = native.spring.mock.calls[0]?.[1];
  expect(springConfig).toBeDefined();
  expect(springConfig!.duration * 1.5).toBe(320);
  const cancellations = native.cancel.mock.calls.length;
  render(false);
  expect(native.cancel.mock.calls.length).toBeGreaterThan(cancellations);
  render(true);
  expect(native.timing).toHaveBeenCalledTimes(1);
});

it("consumes overscan arrivals without replaying when the row becomes visible", () => {
  native.visible = false;
  const registry = admission();
  act(() =>
    root.render(
      <ChatPresentationMotionContext
        value={{ betterT3: true, enabled: true, claim: registry.claim }}
      >
        <ChatPresentationMotion motionId="message">Offscreen</ChatPresentationMotion>
      </ChatPresentationMotionContext>,
    ),
  );
  expect(native.timing).not.toHaveBeenCalled();
  act(() => {
    for (const callback of native.listeners) callback({ sizeVisible: 100 });
  });
  expect(native.timing).not.toHaveBeenCalled();
  expect(host.textContent).toBe("Offscreen");
});

it("preserves mounted child state and focus through all presentation switches", () => {
  function Draft() {
    const [value, setValue] = useState("");
    return (
      <input
        aria-label="Draft"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onClick={() => setValue("Keep this draft")}
      />
    );
  }
  const registry = admission();
  const render = (betterT3: boolean) =>
    act(() =>
      root.render(
        <ChatPresentationMotionContext
          value={{ betterT3, enabled: betterT3, claim: registry.claim }}
        >
          <ChatPresentationMotion motionId="message">
            <Draft />
          </ChatPresentationMotion>
        </ChatPresentationMotionContext>,
      ),
    );
  render(false);
  const input = host.querySelector("input")!;
  act(() => {
    input.focus();
    input.click();
  });
  for (const betterT3 of [true, false, false, true]) {
    render(betterT3);
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("Keep this draft");
    expect(document.activeElement).toBe(input);
  }
});
