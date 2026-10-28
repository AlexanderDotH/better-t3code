// @vitest-environment jsdom
import {
  CHAT_THINKING_PHRASE_CYCLES,
  CHAT_THINKING_PHRASE_KEYS,
} from "@t3tools/client-runtime/chat-presentation";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ChatThinkingIndicator } from "./ChatThinkingIndicator";

const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => translator,
}));

let host: HTMLDivElement;
let root: Root;

function iteration(target: Element, animationName = "better-chat-thinking-north") {
  const type = "AnimationEvent" in window ? "animationiteration" : "webkitAnimationIteration";
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  target.dispatchEvent(event);
}

function glyph() {
  return host.querySelector<HTMLElement>(".better-chat-thinking-glyph")!;
}

function phrase() {
  return host.querySelector(".better-chat-thinking-word")!.textContent;
}

async function cycles(count = CHAT_THINKING_PHRASE_CYCLES) {
  await act(() => {
    for (let index = 0; index < count; index += 1)
      iteration(glyph().querySelector('[data-side="north"]')!);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("rotates complete translated phrases at the existing cadence and ignores unrelated child animations", async () => {
  await act(() => root.render(<ChatThinkingIndicator motion />));
  const first = translator.message(CHAT_THINKING_PHRASE_KEYS[0]);
  expect(phrase()).toBe(first);

  await act(() => {
    for (let index = 0; index < CHAT_THINKING_PHRASE_CYCLES; index += 1) {
      iteration(glyph().firstElementChild!, "better-chat-thinking-glow");
      iteration(glyph(), "unrelated-animation");
    }
  });
  expect(phrase()).toBe(first);
  await cycles(CHAT_THINKING_PHRASE_CYCLES - 1);
  expect(phrase()).toBe(first);
  await cycles(1);
  expect(phrase()).toBe(translator.message(CHAT_THINKING_PHRASE_KEYS[1]));

  for (let index = 1; index < CHAT_THINKING_PHRASE_KEYS.length; index += 1) await cycles();
  expect(phrase()).toBe(first);
  expect(host.querySelector(".sr-only")!.textContent).toBe(
    translator.message("chat.timeline.thinking"),
  );
});

it("holds its phrase while motion is disabled and resumes after re-enabling it", async () => {
  await act(() => root.render(<ChatThinkingIndicator motion />));
  await cycles();
  const current = phrase();
  await act(() => root.render(<ChatThinkingIndicator motion={false} />));
  await cycles(CHAT_THINKING_PHRASE_CYCLES * 3);
  expect(phrase()).toBe(current);
  await act(() => root.render(<ChatThinkingIndicator motion />));
  await cycles();
  expect(phrase()).toBe(translator.message(CHAT_THINKING_PHRASE_KEYS[2]));
});
