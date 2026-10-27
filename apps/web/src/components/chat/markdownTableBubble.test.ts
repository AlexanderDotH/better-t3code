// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { observeMarkdownTableBubble } from "./markdownTableBubble";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("tracks the widest expanded table through resizing, collapse, and stale observer callbacks", () => {
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const bubble = document.createElement("div");
  bubble.style.padding = "16px 20px";
  const first = document.createElement("div");
  const second = document.createElement("div");
  bubble.append(first, second);
  document.body.append(bubble);
  let firstBounds = new DOMRect(100, 0, 1200, 200);
  let secondBounds = new DOMRect(50, 0, 1300, 200);
  bubble.getBoundingClientRect = () => new DOMRect(300, 0, 800, 500);
  first.getBoundingClientRect = () => firstBounds;
  second.getBoundingClientRect = () => secondBounds;
  const surface = () => [
    bubble.style.getPropertyValue("--chat-table-surface-left"),
    bubble.style.getPropertyValue("--chat-table-surface-width"),
  ];
  const resize = (index: number) => callbacks[index]!([], {} as ResizeObserver);

  const closeFirst = observeMarkdownTableBubble(first, bubble);
  expect(surface()).toEqual(["-220px", "1240px"]);
  firstBounds = new DOMRect(200, 0, 1000, 200);
  resize(0);
  expect(surface()).toEqual(["-120px", "1040px"]);

  const closeSecond = observeMarkdownTableBubble(second, bubble);
  expect(surface()).toEqual(["-270px", "1340px"]);
  closeFirst();
  expect(surface()).toEqual(["-270px", "1340px"]);

  // A narrow viewport returns the table to the normal content width.
  secondBounds = new DOMRect(320, 0, 760, 200);
  resize(1);
  expect(surface()).toEqual(["0px", "800px"]);
  closeSecond();
  expect(surface()).toEqual(["", ""]);
  expect(bubble.hasAttribute("data-expanded-table")).toBe(false);
  resize(0);
  resize(1);
  expect(surface()).toEqual(["", ""]);
});
