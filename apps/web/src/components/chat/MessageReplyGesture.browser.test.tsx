import { act, render as renderScreen, type Screen } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";
import { MessageReplyGesture } from "./MessageReplyGesture";

const contextMenu = vi.hoisted(() => ({ show: vi.fn().mockResolvedValue("message-reply") }));
vi.mock("../../localApi", () => ({ readLocalApi: () => ({ contextMenu }) }));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));

let container: HTMLElement;
let eventTime = 0;

async function pointer(
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
    timeStamp: { value: eventTime },
  });
  await act(() => target.dispatchEvent(event));
  return event;
}

async function renderGesture(screen: Screen, role: "user" | "assistant" = "assistant") {
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
  await act(() =>
    screen.rerender(
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
  it("replies on release without rerendering message content", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text, renderContent } = await renderGesture(screen, role);
    const surface = container.querySelector("[data-message-reply-gesture]")!;
    await pointer(text, "pointerdown", 0);
    expect(surface.hasAttribute("data-message-reply-dragging")).toBe(false);
    await pointer(text, "pointermove", direction * 56);
    expect(surface.getAttribute("data-message-reply-dragging")).toBe("true");
    expect(onReply).not.toHaveBeenCalled();
    expect(renderContent).toHaveBeenCalledTimes(1);
    await pointer(text, "pointerup", direction * 56);
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(surface.hasAttribute("data-message-reply-dragging")).toBe(false);
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
  });

  it.each(["mouse", "pen", "touch"])(
    "accepts a halfway 16px reply with %s",
    async (pointerType) => {
      using _setup = setup();

      await using screen = await renderScreen(null, { router: false });
      container = screen.container;

      const { onReply, text, renderContent } = await renderGesture(screen, role);
      await pointer(text, "pointerdown", 0, 0, pointerType);
      eventTime = 50;
      await pointer(text, "pointermove", direction * 16, 2, pointerType);
      expect(container.querySelector<HTMLElement>("[style*='translateX']")).not.toBeNull();
      expect(onReply).not.toHaveBeenCalled();
      await pointer(text, "pointerup", direction * 16, 3, pointerType);
      expect(onReply).toHaveBeenCalledTimes(1);
      expect(renderContent).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["mouse", "pen", "touch"])(
    "recognizes a halfway release without an intermediate movement event with %s",
    async (pointerType) => {
      using _setup = setup();

      await using screen = await renderScreen(null, { router: false });
      container = screen.container;

      const { onReply, text } = await renderGesture(screen, role);
      await pointer(text, "pointerdown", 0, 0, pointerType);
      eventTime = 50;
      await pointer(text, "pointerup", direction * 16, 2, pointerType);
      expect(onReply).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a short reply ready while holding and easing back before release", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    eventTime = 60;
    await pointer(text, "pointermove", direction * 20, 2, "mouse");
    expect(onReply).not.toHaveBeenCalled();
    eventTime = 1000;
    await pointer(text, "pointerup", direction * 16, 3, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("cancels a recognized short reply when dragged back to its origin", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    eventTime = 50;
    await pointer(text, "pointermove", direction * 16, 2, "mouse");
    await pointer(text, "pointerup", 0, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("continues a pending drag outside the message and releases there", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    await pointer(text, "pointermove", direction * 12, 0, "mouse");
    await pointer(document.body, "pointermove", direction * 70, 0, "mouse");
    await pointer(document.body, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
  });

  it("counts the final movement on release when pointer samples are sparse", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    eventTime = 0;
    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    eventTime = 20;
    await pointer(text, "pointermove", direction * 18, 0, "mouse");
    eventTime = 60;
    await pointer(document.body, "pointerup", direction * 56, 2, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("uses event timing when a busy renderer handles movement late", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
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
    eventTime = 400;
    await act(() => document.body.dispatchEvent(move));
    await pointer(document.body, "pointerup", direction * 70, 2, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("does not lose an intended swipe to small initial diagonal motion", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    eventTime = 0;
    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    eventTime = 15;
    await pointer(text, "pointermove", direction * 9, 8, "mouse");
    eventTime = 55;
    await pointer(text, "pointermove", direction * 40, 10, "mouse");
    await pointer(text, "pointerup", direction * 65, 10, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("recognizes a slightly slower deliberate text swipe", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    eventTime = 0;
    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    eventTime = 80;
    await pointer(text, "pointermove", direction * 28, 3, "mouse");
    eventTime = 135;
    await pointer(text, "pointerup", direction * 68, 6, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("keeps a recognized swipe when delayed native selection appears", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    await pointer(text, "pointermove", direction * 45, 0, "mouse");
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    await pointer(document.body, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it("cancels outside the message and on window blur", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    for (const cancellation of ["pointercancel", "blur"]) {
      await pointer(text, "pointerdown", 0, 0, "mouse");
      await pointer(document.body, "pointermove", direction * 70, 0, "mouse");
      if (cancellation === "pointercancel")
        await pointer(document.body, "pointercancel", direction * 70, 0, "mouse");
      else await act(() => window.dispatchEvent(new Event("blur")));
      await pointer(document.body, "pointerup", direction * 70, 0, "mouse");
      expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
    }
    expect(onReply).not.toHaveBeenCalled();
  });

  it("does not round a release below the reply threshold up to a reply", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    await pointer(text, "pointermove", direction * 12, 0, "mouse");
    await pointer(document.body, "pointerup", direction * 15, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("cleans up a pending drag when its message unmounts", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    await pointer(text, "pointermove", direction * 12, 0, "mouse");
    await act(() => screen.rerender(null));
    await pointer(document.body, "pointermove", direction * 80, 0, "mouse");
    await pointer(document.body, "pointerup", direction * 80, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("resets below the release threshold", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0);
    await pointer(text, "pointermove", direction * 15);
    await pointer(text, "pointerup", direction * 15);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("keeps vertical scrolling and rejects diagonal gestures", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0);
    expect((await pointer(text, "pointermove", direction * 8, 20)).defaultPrevented).toBe(false);
    await pointer(text, "pointermove", direction * 90, 22);
    await pointer(text, "pointerup", direction * 90, 22);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("does not treat cancellation as a completed reply", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0);
    await pointer(text, "pointermove", direction * 90);
    await pointer(text, "pointercancel", direction * 90);
    await pointer(text, "pointerup", direction * 90);
    expect(onReply).not.toHaveBeenCalled();
  });

  it.each(["textarea", "video"])("preserves direct manipulation of %s", async (selector) => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply } = await renderGesture(screen, role);
    const target = container.querySelector(selector)!;
    await pointer(target, "pointerdown", 0);
    expect((await pointer(target, "pointermove", direction * 80)).defaultPrevented).toBe(false);
    await pointer(target, "pointerup", direction * 80);
    expect(onReply).not.toHaveBeenCalled();
  });

  it.each(
    ["p", "strong", "a", "button", "code", "td", "img", "[data-margin]"].flatMap((selector) =>
      ["mouse", "touch"].map((pointerType) => ({ selector, pointerType })),
    ),
  )("allows $pointerType dragging directly over $selector", async ({ selector, pointerType }) => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, onAction } = await renderGesture(screen, role);
    const target = container.querySelector(selector)!;
    await pointer(target, "pointerdown", 0, 0, pointerType);
    await pointer(target, "pointermove", direction * 70, 0, pointerType);
    await pointer(target, "pointerup", direction * 70, 0, pointerType);
    expect(onReply).toHaveBeenCalledTimes(1);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(() => target.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(["mouse", "touch"])("rejects the opposite direction with %s", async (pointerType) => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, pointerType);
    expect(
      (await pointer(text, "pointermove", -direction * 70, 0, pointerType)).defaultPrevented,
    ).toBe(false);
    await pointer(text, "pointermove", direction * 70, 0, pointerType);
    await pointer(text, "pointerup", direction * 70, 0, pointerType);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("keeps clicks available when there is no swipe", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onAction, onReply } = await renderGesture(screen, role);
    const button = container.querySelector("button")!;
    await pointer(button, "pointerdown", 0, 0, "mouse");
    await pointer(button, "pointerup", 0, 0, "mouse");
    await act(() => button.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("leaves horizontal scrolling available until the code block reaches its edge", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply } = await renderGesture(screen, role);
    const block = container.querySelector("pre")!;
    block.style.overflowX = "auto";
    Object.defineProperties(block, {
      clientWidth: { value: 100 },
      scrollWidth: { value: 300 },
    });
    block.scrollLeft = 40;
    const target = container.querySelector("code")!;
    await pointer(target, "pointerdown", 0);
    expect((await pointer(target, "pointermove", direction * 80)).defaultPrevented).toBe(false);
    await pointer(target, "pointerup", direction * 80);
    expect(onReply).not.toHaveBeenCalled();
    block.scrollLeft = role === "assistant" ? 0 : 200;
    await pointer(target, "pointerdown", 0);
    await pointer(target, "pointermove", direction * 80);
    await pointer(target, "pointerup", direction * 80);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it.each(["mouse", "pen"])(
    "recognizes a quick straight text swipe with %s",
    async (pointerType) => {
      using _setup = setup();

      await using screen = await renderScreen(null, { router: false });
      container = screen.container;

      eventTime = 0;
      const { onReply, text } = await renderGesture(screen, role);
      await pointer(text, "pointerdown", 0, 0, pointerType);
      const range = document.createRange();
      range.selectNodeContents(text);
      window.getSelection()?.addRange(range);
      eventTime = 20;
      await pointer(text, "pointermove", direction * 12, 0, pointerType);
      expect(window.getSelection()?.toString()).toContain("Message text");
      expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
      eventTime = 60;
      await pointer(text, "pointermove", direction * 56, 1, pointerType);
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(container.querySelector<HTMLElement>("[style*='translateX']")).not.toBeNull();
      await pointer(text, "pointerup", direction * 70, 1, pointerType);
      expect(onReply).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { label: "slow character selection", dx: 12, dy: 0, time: 70 },
    { label: "selection across lines", dx: 28, dy: 12, time: 25 },
  ])("never moves the message during $label", async ({ dx, dy, time }) => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    eventTime = 0;
    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    eventTime = time;
    expect((await pointer(text, "pointermove", direction * dx, dy, "mouse")).defaultPrevented).toBe(
      false,
    );
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
    eventTime = time + 10;
    await pointer(text, "pointermove", direction * 100, 0, "mouse");
    await pointer(text, "pointerup", direction * 100, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toContain("Message text");
  });

  it("commits direction corrections to selection even before a native range appears", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    eventTime = 0;
    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    eventTime = 15;
    await pointer(text, "pointermove", direction * 14, 0, "mouse");
    eventTime = 20;
    await pointer(text, "pointermove", direction * 6, 0, "mouse");
    eventTime = 45;
    await pointer(text, "pointermove", direction * 70, 0, "mouse");
    await pointer(text, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();
  });

  it.each([2, 3])("preserves text selection initiated with %s clicks", async (detail) => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse", detail);
    expect((await pointer(text, "pointermove", direction * 70, 0, "mouse")).defaultPrevented).toBe(
      false,
    );
    await pointer(text, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("leaves a held text selection alone", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    eventTime = 0;
    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0, 0, "mouse");
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    eventTime = 300;
    await pointer(text, "pointermove", direction * 70, 0, "mouse");
    await pointer(text, "pointerup", direction * 70, 0, "mouse");
    expect(onReply).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toContain("Message text");
  });

  it("preserves existing text selection", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    await pointer(text, "pointerdown", 0);
    await pointer(text, "pointermove", direction * 80);
    await pointer(text, "pointerup", direction * 80);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("reveals the side action only near the pointer without rerendering the message", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text, renderContent } = await renderGesture(screen, role);
    const action = container.querySelector<HTMLElement>("[data-message-reply-action]")!;
    const button = action.querySelector("button")!;
    const left = role === "assistant" ? 40 : 440;
    vi.spyOn(action, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: left, y: 100, width: 24, height: 24 }),
    );

    await pointer(text, "pointermove", left + direction * 120, 112, "mouse");
    expect(action.dataset.nearby).toBe("false");
    await pointer(text, "pointermove", left + direction * 48, 112, "mouse");
    expect(action.dataset.nearby).toBe("true");
    await pointer(button, "pointermove", left + 12, 112, "mouse");
    expect(action.dataset.nearby).toBe("true");
    await pointer(button, "pointerdown", left + 12, 112, "mouse");
    await pointer(button, "pointerup", left + 12, 112, "mouse");
    await act(() => button.click());
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLElement>("[style*='translateX']")).toBeNull();

    await pointer(text, "pointermove", left + 12, 210, "mouse");
    expect(action.dataset.nearby).toBe("false");
    await pointer(button, "pointermove", left + 12, 112, "mouse");
    await pointer(button, "pointerout", left + 12, 112, "mouse");
    expect(action.dataset.nearby).toBe("false");
    expect(renderContent).toHaveBeenCalledTimes(1);
  });

  it("keeps the side action usable after a swipe and while text is selected", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await pointer(text, "pointerdown", 0);
    await pointer(text, "pointermove", direction * 32);
    await pointer(text, "pointerup", direction * 32);
    expect(onReply).toHaveBeenCalledTimes(1);
    const button = container.querySelector<HTMLButtonElement>(
      "[data-message-reply-action] button",
    )!;
    // Keyboard activation must not be swallowed as a synthetic post-drag click.
    await act(() => {
      button.focus();
      button.click();
    });
    expect(onReply).toHaveBeenCalledTimes(2);

    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.toString()).toContain("Message text");
    await pointer(button, "pointerdown", 0, 0, "mouse");
    await pointer(button, "pointerup", 0, 0, "mouse");
    await act(() => button.click());
    expect(onReply).toHaveBeenCalledTimes(3);
    expect(window.getSelection()?.toString()).toContain("Message text");
  });

  it("does not reveal the hover action while dragging", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { text } = await renderGesture(screen, role);
    const action = container.querySelector<HTMLElement>("[data-message-reply-action]")!;
    vi.spyOn(action, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 24, height: 24 }),
    );
    await pointer(text, "pointermove", 12, 12, "mouse");
    expect(action.dataset.nearby).toBe("true");
    await pointer(text, "pointerdown", 12, 12, "mouse");
    await pointer(text, "pointermove", 12 + direction * 32, 12, "mouse");
    expect(action.dataset.nearby).toBe("false");
    await pointer(text, "pointercancel", 12 + direction * 32, 12, "mouse");
  });

  it("exposes Reply in the message context menu and leaves a link's native menu alone", async () => {
    using _setup = setup();

    await using screen = await renderScreen(null, { router: false });
    container = screen.container;

    const { onReply, text } = await renderGesture(screen, role);
    await act(async () =>
      text.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    expect(contextMenu.show).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledTimes(1);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(() => container.querySelector("a")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(contextMenu.show).toHaveBeenCalledTimes(1);
  });
});

function setup() {
  window.getSelection()?.removeAllRanges();
  contextMenu.show.mockClear();
  eventTime = 0;
  vi.spyOn(performance, "now").mockImplementation(() => eventTime);

  return {
    [Symbol.dispose]() {
      vi.restoreAllMocks();
    },
  };
}
