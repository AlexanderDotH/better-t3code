// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MessageReplyGesture } from "./MessageReplyGesture";

const contextMenu = vi.hoisted(() => ({ show: vi.fn().mockResolvedValue("message-reply") }));
vi.mock("../../localApi", () => ({ readLocalApi: () => ({ contextMenu }) }));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));

let container: HTMLDivElement;
let root: Root;

function pointer(
  target: Element,
  type: string,
  x: number,
  y = 0,
  pointerType = "touch",
  detail = 1,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    detail,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
    isPrimary: { value: true },
    timeStamp: { value: performance.now() },
  });
  act(() => target.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.getSelection()?.removeAllRanges();
  contextMenu.show.mockClear();
  vi.spyOn(performance, "now").mockReturnValue(0);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function renderGesture(role: "user" | "assistant" = "assistant") {
  const onReply = vi.fn();
  const renderContent = vi.fn();
  const onAction = vi.fn();
  function Content() {
    renderContent();
    return (
      <div data-margin>
        <p data-text>
          Message text <strong>with emphasis</strong>
        </p>
        <a href="https://example.com">Link</a>
        <button type="button" onClick={onAction}>
          Action
        </button>
        <textarea aria-label="Editable text" />
        <pre>
          <code>long code</code>
        </pre>
        <table>
          <tbody>
            <tr>
              <td>Cell</td>
            </tr>
          </tbody>
        </table>
        <video />
        <img alt="Attachment" />
      </div>
    );
  }
  act(() =>
    root.render(
      <MessageReplyGesture role={role} onReply={onReply}>
        <Content />
      </MessageReplyGesture>,
    ),
  );
  return {
    onReply,
    renderContent,
    onAction,
    text: container.querySelector("p")!,
    margin: container.querySelector("[data-margin]")!,
  };
}

describe.each([
  ["assistant", 1],
  ["user", -1],
] as const)("reply pointer gesture for %s messages", (role, direction) => {
  it("replies on release without rerendering message content", () => {
    const { onReply, text, renderContent } = renderGesture(role);
    pointer(text, "pointerdown", 0);
    pointer(text, "pointermove", direction * 56);
    expect(onReply).not.toHaveBeenCalled();
    expect(renderContent).toHaveBeenCalledTimes(1);
    pointer(text, "pointerup", direction * 56);
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
  });

  it.each(["mouse", "pen", "touch"])("accepts a halfway 16px reply with %s", (pointerType) => {
    const { onReply, text, renderContent } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, pointerType);
    vi.mocked(performance.now).mockReturnValue(50);
    pointer(text, "pointermove", direction * 16, 2, pointerType);
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).not.toBeNull();
    expect(onReply).not.toHaveBeenCalled();
    pointer(text, "pointerup", direction * 16, 3, pointerType);
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(renderContent).toHaveBeenCalledTimes(1);
  });

  it.each(["mouse", "pen", "touch"])(
    "recognizes a halfway release without an intermediate movement event with %s",
    (pointerType) => {
      const { onReply, text } = renderGesture(role);
      pointer(text, "pointerdown", 0, 0, pointerType);
      vi.mocked(performance.now).mockReturnValue(50);
      pointer(text, "pointerup", direction * 16, 2, pointerType);
      expect(onReply).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a short reply ready while holding and easing back before release", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    vi.mocked(performance.now).mockReturnValue(60);
    pointer(text, "pointermove", direction * 20, 2, "mouse");
    expect(onReply).not.toHaveBeenCalled();
    vi.mocked(performance.now).mockReturnValue(1000);
    pointer(text, "pointerup", direction * 16, 3, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("cancels a recognized short reply when dragged back to its origin", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    vi.mocked(performance.now).mockReturnValue(50);
    pointer(text, "pointermove", direction * 16, 2, "mouse");
    pointer(text, "pointerup", 0, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("continues a pending drag outside the message and releases there", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    pointer(text, "pointermove", direction * 12, 0, "mouse");
    pointer(document.body, "pointermove", direction * 70, 0, "mouse");
    pointer(document.body, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
  });

  it("counts the final movement on release when pointer samples are sparse", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    now.mockReturnValue(20);
    pointer(text, "pointermove", direction * 18, 0, "mouse");
    now.mockReturnValue(60);
    pointer(document.body, "pointerup", direction * 56, 2, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("uses event timing when a busy renderer handles movement late", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    const move = new MouseEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX: direction * 56,
      clientY: 2,
      button: 0,
    });
    Object.defineProperties(move, {
      pointerId: { value: 1 },
      pointerType: { value: "mouse" },
      isPrimary: { value: true },
      timeStamp: { value: 70 },
    });
    vi.mocked(performance.now).mockReturnValue(400);
    act(() => document.body.dispatchEvent(move));
    pointer(document.body, "pointerup", direction * 70, 2, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("does not lose an intended swipe to small initial diagonal motion", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    now.mockReturnValue(15);
    pointer(text, "pointermove", direction * 9, 8, "mouse");
    now.mockReturnValue(55);
    pointer(text, "pointermove", direction * 40, 10, "mouse");
    pointer(text, "pointerup", direction * 65, 10, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("recognizes a slightly slower deliberate text swipe", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    now.mockReturnValue(80);
    pointer(text, "pointermove", direction * 28, 3, "mouse");
    now.mockReturnValue(135);
    pointer(text, "pointerup", direction * 68, 6, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("keeps a recognized swipe when delayed native selection appears", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    pointer(text, "pointermove", direction * 45, 0, "mouse");
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    pointer(document.body, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it("cancels outside the message and on window blur", () => {
    const { onReply, text } = renderGesture(role);
    for (const cancellation of ["pointercancel", "blur"]) {
      pointer(text, "pointerdown", 0, 0, "mouse");
      pointer(document.body, "pointermove", direction * 70, 0, "mouse");
      if (cancellation === "pointercancel")
        pointer(document.body, "pointercancel", direction * 70, 0, "mouse");
      else act(() => window.dispatchEvent(new Event("blur")));
      pointer(document.body, "pointerup", direction * 70, 0, "mouse");
      expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
    }
    expect(onReply).not.toHaveBeenCalled();
  });

  it("does not round a release below the reply threshold up to a reply", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    pointer(text, "pointermove", direction * 12, 0, "mouse");
    pointer(document.body, "pointerup", direction * 15, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("cleans up a pending drag when its message unmounts", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    pointer(text, "pointermove", direction * 12, 0, "mouse");
    act(() => root.render(null));
    pointer(document.body, "pointermove", direction * 80, 0, "mouse");
    pointer(document.body, "pointerup", direction * 80, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("resets below the release threshold", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0);
    pointer(text, "pointermove", direction * 15);
    pointer(text, "pointerup", direction * 15);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("keeps vertical scrolling and rejects diagonal gestures", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0);
    expect(pointer(text, "pointermove", direction * 8, 20).defaultPrevented).toBe(false);
    pointer(text, "pointermove", direction * 90, 22);
    pointer(text, "pointerup", direction * 90, 22);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("does not treat cancellation as a completed reply", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0);
    pointer(text, "pointermove", direction * 90);
    pointer(text, "pointercancel", direction * 90);
    pointer(text, "pointerup", direction * 90);
    expect(onReply).not.toHaveBeenCalled();
  });

  it.each(["textarea", "video"])("preserves direct manipulation of %s", (selector) => {
    const { onReply } = renderGesture(role);
    const target = container.querySelector(selector)!;
    pointer(target, "pointerdown", 0);
    expect(pointer(target, "pointermove", direction * 80).defaultPrevented).toBe(false);
    pointer(target, "pointerup", direction * 80);
    expect(onReply).not.toHaveBeenCalled();
  });

  it.each(
    ["p", "strong", "a", "button", "code", "td", "img", "[data-margin]"].flatMap((selector) =>
      ["mouse", "touch"].map((pointerType) => ({ selector, pointerType })),
    ),
  )("allows $pointerType dragging directly over $selector", ({ selector, pointerType }) => {
    const { onReply, onAction } = renderGesture(role);
    const target = container.querySelector(selector)!;
    pointer(target, "pointerdown", 0, 0, pointerType);
    pointer(target, "pointermove", direction * 70, 0, pointerType);
    pointer(target, "pointerup", direction * 70, 0, pointerType);
    expect(onReply).toHaveBeenCalledTimes(1);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => target.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(["mouse", "touch"])("rejects the opposite direction with %s", (pointerType) => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, pointerType);
    expect(pointer(text, "pointermove", -direction * 70, 0, pointerType).defaultPrevented).toBe(
      false,
    );
    pointer(text, "pointermove", direction * 70, 0, pointerType);
    pointer(text, "pointerup", direction * 70, 0, pointerType);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("keeps clicks available when there is no swipe", () => {
    const { onAction, onReply } = renderGesture(role);
    const button = container.querySelector("button")!;
    pointer(button, "pointerdown", 0, 0, "mouse");
    pointer(button, "pointerup", 0, 0, "mouse");
    act(() => button.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("leaves horizontal scrolling available until the code block reaches its edge", () => {
    const { onReply } = renderGesture(role);
    const block = container.querySelector("pre")!;
    block.style.overflowX = "auto";
    Object.defineProperties(block, {
      clientWidth: { value: 100 },
      scrollWidth: { value: 300 },
    });
    block.scrollLeft = 40;
    const target = container.querySelector("code")!;
    pointer(target, "pointerdown", 0);
    expect(pointer(target, "pointermove", direction * 80).defaultPrevented).toBe(false);
    pointer(target, "pointerup", direction * 80);
    expect(onReply).not.toHaveBeenCalled();
    block.scrollLeft = role === "assistant" ? 0 : 200;
    pointer(target, "pointerdown", 0);
    pointer(target, "pointermove", direction * 80);
    pointer(target, "pointerup", direction * 80);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it.each(["mouse", "pen"])("recognizes a quick straight text swipe with %s", (pointerType) => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, pointerType);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    now.mockReturnValue(20);
    pointer(text, "pointermove", direction * 12, 0, pointerType);
    expect(window.getSelection()?.toString()).toContain("Message text");
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
    now.mockReturnValue(60);
    pointer(text, "pointermove", direction * 56, 1, pointerType);
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).not.toBeNull();
    pointer(text, "pointerup", direction * 70, 1, pointerType);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "slow character selection", dx: 12, dy: 0, time: 70 },
    { label: "selection across lines", dx: 28, dy: 12, time: 25 },
  ])("never moves the message during $label", ({ dx, dy, time }) => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    now.mockReturnValue(time);
    expect(pointer(text, "pointermove", direction * dx, dy, "mouse").defaultPrevented).toBe(false);
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
    now.mockReturnValue(time + 10);
    pointer(text, "pointermove", direction * 100, 0, "mouse");
    pointer(text, "pointerup", direction * 100, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toContain("Message text");
  });

  it("commits direction corrections to selection even before a native range appears", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    now.mockReturnValue(15);
    pointer(text, "pointermove", direction * 14, 0, "mouse");
    now.mockReturnValue(20);
    pointer(text, "pointermove", direction * 6, 0, "mouse");
    now.mockReturnValue(45);
    pointer(text, "pointermove", direction * 70, 0, "mouse");
    pointer(text, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
  });

  it.each([2, 3])("preserves text selection initiated with %s clicks", (detail) => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse", detail);
    expect(pointer(text, "pointermove", direction * 70, 0, "mouse").defaultPrevented).toBe(false);
    pointer(text, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("leaves a held text selection alone", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0, 0, "mouse");
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    now.mockReturnValue(300);
    pointer(text, "pointermove", direction * 70, 0, "mouse");
    pointer(text, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toContain("Message text");
  });

  it("preserves existing text selection", () => {
    const { onReply, text } = renderGesture(role);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    pointer(text, "pointerdown", 0);
    pointer(text, "pointermove", direction * 80);
    pointer(text, "pointerup", direction * 80);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("reveals the side action only near the pointer without rerendering the message", () => {
    const { onReply, text, renderContent } = renderGesture(role);
    const action = container.querySelector<HTMLElement>("[data-message-reply-action]")!;
    const button = action.querySelector("button")!;
    const left = role === "assistant" ? 40 : 440;
    vi.spyOn(action, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: left, y: 100, width: 24, height: 24 }),
    );

    pointer(text, "pointermove", left + direction * 120, 112, "mouse");
    expect(action.dataset.nearby).toBe("false");
    pointer(text, "pointermove", left + direction * 48, 112, "mouse");
    expect(action.dataset.nearby).toBe("true");
    pointer(button, "pointermove", left + 12, 112, "mouse");
    expect(action.dataset.nearby).toBe("true");
    pointer(button, "pointerdown", left + 12, 112, "mouse");
    pointer(button, "pointerup", left + 12, 112, "mouse");
    act(() => button.click());
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();

    pointer(text, "pointermove", left + 12, 210, "mouse");
    expect(action.dataset.nearby).toBe("false");
    pointer(button, "pointermove", left + 12, 112, "mouse");
    pointer(button, "pointerout", left + 12, 112, "mouse");
    expect(action.dataset.nearby).toBe("false");
    expect(renderContent).toHaveBeenCalledTimes(1);
  });

  it("keeps the side action usable after a swipe and while text is selected", () => {
    const { onReply, text } = renderGesture(role);
    pointer(text, "pointerdown", 0);
    pointer(text, "pointermove", direction * 32);
    pointer(text, "pointerup", direction * 32);
    expect(onReply).toHaveBeenCalledTimes(1);
    const button = container.querySelector<HTMLButtonElement>(
      "[data-message-reply-action] button",
    )!;
    // Keyboard activation must not be swallowed as a synthetic post-drag click.
    act(() => {
      button.focus();
      button.click();
    });
    expect(onReply).toHaveBeenCalledTimes(2);

    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.toString()).toContain("Message text");
    pointer(button, "pointerdown", 0, 0, "mouse");
    pointer(button, "pointerup", 0, 0, "mouse");
    act(() => button.click());
    expect(onReply).toHaveBeenCalledTimes(3);
    expect(window.getSelection()?.toString()).toContain("Message text");
  });

  it("does not reveal the hover action while dragging", () => {
    const { text } = renderGesture(role);
    const action = container.querySelector<HTMLElement>("[data-message-reply-action]")!;
    vi.spyOn(action, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 24, height: 24 }),
    );
    pointer(text, "pointermove", 12, 12, "mouse");
    expect(action.dataset.nearby).toBe("true");
    pointer(text, "pointerdown", 12, 12, "mouse");
    pointer(text, "pointermove", 12 + direction * 32, 12, "mouse");
    expect(action.dataset.nearby).toBe("false");
    pointer(text, "pointercancel", 12 + direction * 32, 12, "mouse");
  });

  it("exposes Reply in the message context menu and leaves a link's native menu alone", async () => {
    const { onReply, text } = renderGesture(role);
    await act(async () =>
      text.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(contextMenu.show).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledTimes(1);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => container.querySelector("a")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(contextMenu.show).toHaveBeenCalledTimes(1);
  });
});
