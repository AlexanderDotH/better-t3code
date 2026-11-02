import { useState } from "react";
import { act, render, stubGlobal } from "../../../test/render";
import { MessageId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import type { TimelineEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { useChatDetailMotion, useChatPresentationMotion } from "./useChatPresentationMotion";

vi.mock("./chatMessageArrival", () => ({
  createChatMessageArrival: () => ({ play() {}, stop() {}, dispose() {} }),
}));

function entry(
  id: string,
  second: number,
  role: "assistant" | "user",
): Extract<TimelineEntry, { kind: "message" }> {
  const createdAt = `2026-01-01T00:00:0${second}.000Z`;
  return {
    id,
    createdAt,
    kind: "message",
    message: {
      id: MessageId.make(id),
      createdAt,
      updatedAt: createdAt,
      role,
      text: id,
      runId: null,
      streaming: false,
    },
  };
}

function Harness({
  entries,
  expanded = false,
  enabled = true,
}: {
  entries: Extract<TimelineEntry, { kind: "message" }>[];
  expanded?: boolean;
  enabled?: boolean;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const rows: MessagesTimelineRow[] = entries.map((item) => ({
    ...item,
    showAssistantMeta: false,
    showAssistantTimestamp: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
  }));
  useChatPresentationMotion({
    identity: "engine",
    mode: "better-t3",
    enabled,
    textMotion: true,
    connected: true,
    entries,
    rows,
    viewport,
  });
  const detailRef = useChatDetailMotion(enabled, expanded, "details");
  return (
    <div ref={setViewport} data-viewport>
      {rows.map((row) => (
        <div key={row.id} data-timeline-row-id={row.id}>
          <div data-presentation-bubble data-motion-id={row.id}>
            {row.id}
          </div>
        </div>
      ))}
      {expanded ? (
        <div ref={detailRef} data-motion-id="detail">
          Full output
        </div>
      ) : null}
    </div>
  );
}

it("uses Motion's native bridge with exact durations and releases completed or cancelled styles", async () => {
  using cleanup = new DisposableStack();
  cleanup.defer(() => vi.restoreAllMocks());
  cleanup.use(
    stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: 200,
    left: 0,
    right: 300,
    width: 300,
    height: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const native: {
    element: HTMLElement;
    options: KeyframeAnimationOptions;
    animation: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null };
  }[] = [];
  const previousAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  cleanup.defer(() => {
    if (previousAnimate) Object.defineProperty(Element.prototype, "animate", previousAnimate);
    else Reflect.deleteProperty(Element.prototype, "animate");
  });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, _keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = {
        cancel: vi.fn(() => {
          animation.playState = "idle";
        }),
        onfinish: null as (() => void) | null,
        playState: "running",
        currentTime: 0,
        playbackRate: 1,
        startTime: 0,
        effect: { getComputedTiming: () => options },
      };
      native.push({ element: this, options, animation });
      return animation;
    },
  });
  const history = entry("history", 1, "assistant");
  const user = entry("user", 2, "user");
  const assistant = entry("assistant", 3, "assistant");
  await using screen = await render(<Harness entries={[history]} />);
  await screen.rerender(<Harness entries={[history, user, assistant]} expanded />);
  const controlled = native.filter((item) => item.element.dataset.motionId);
  expect(
    controlled
      .filter((item) => item.element.dataset.motionId === "user")
      .map((item) => item.options.duration),
  ).toEqual([320, 320]);
  expect(
    controlled
      .filter((item) => item.element.dataset.motionId === "assistant")
      .map((item) => item.options.duration),
  ).toEqual([360]);
  expect(
    controlled
      .filter((item) => item.element.dataset.motionId === "detail")
      .map((item) => item.options.duration),
  ).toEqual([160]);
  expect(controlled.every((item) => String(item.options.easing).startsWith("linear("))).toBe(true);
  await act(() => {
    for (const item of controlled.filter((item) => item.element.dataset.motionId === "assistant"))
      item.animation.onfinish?.();
  });
  const bubble = screen.container.querySelector<HTMLElement>("[data-motion-id='assistant']")!;
  await vi.waitFor(() => {
    expect(bubble.style.opacity).toBe("");
    expect(bubble.style.transform).toBe("");
    expect(bubble.style.filter).toBe("");
  });
  await screen.rerender(<Harness entries={[history, user, assistant]} expanded enabled={false} />);
  for (const item of controlled) expect(item.animation.cancel).toHaveBeenCalled();
});
