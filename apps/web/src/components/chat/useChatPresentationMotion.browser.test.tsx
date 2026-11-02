import { useState } from "react";
import { act, render, stubGlobal } from "../../../test/render";
import { MessageId, type ChatVisualMode } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import type { TimelineEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { useChatDetailMotion, useChatPresentationMotion } from "./useChatPresentationMotion";

const motion = vi.hoisted(() => ({ animate: vi.fn() }));
vi.mock("motion/mini", () => ({ animate: motion.animate }));
vi.mock("./chatMessageArrival", () => ({
  createChatMessageArrival: () => ({ play() {}, stop() {}, dispose() {} }),
}));

function entry(id: string, second: number): Extract<TimelineEntry, { kind: "message" }> {
  const createdAt = `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
  return {
    id,
    createdAt,
    kind: "message",
    message: {
      id: MessageId.make(id),
      createdAt,
      updatedAt: createdAt,
      role: "assistant",
      text: id,
      runId: null,
      streaming: false,
    },
  };
}

function Harness({
  entries,
  mode = "better-t3",
  enabled = true,
  textMotion = true,
  identity = "thread:1",
  connected = true,
  deferNewest = false,
}: {
  entries: Extract<TimelineEntry, { kind: "message" }>[];
  mode?: ChatVisualMode;
  enabled?: boolean;
  textMotion?: boolean;
  identity?: string;
  connected?: boolean;
  deferNewest?: boolean;
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
    identity,
    mode,
    enabled: enabled && mode === "better-t3",
    textMotion,
    connected,
    entries,
    rows,
    viewport,
  });
  return (
    <div ref={setViewport} data-viewport>
      {rows
        .filter((_, index) => !deferNewest || index < rows.length - 1)
        .map((row) => (
          <div key={row.id} data-timeline-row-id={row.id}>
            <div data-presentation-bubble data-motion-id={row.id}>
              <div aria-hidden data-presentation-surface data-motion-id={row.id} />
              {row.id}
            </div>
          </div>
        ))}
    </div>
  );
}

function DetailHarness({ expanded, enabled = true }: { expanded: boolean; enabled?: boolean }) {
  const ref = useChatDetailMotion(enabled, expanded, "details");
  return expanded ? (
    <div ref={ref} data-detail>
      Complete tool output
    </div>
  ) : null;
}

function StatusHarness({ status }: { status: "inProgress" | "completed" | "failed" }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const source: Extract<TimelineEntry, { kind: "work" }> = {
    id: "tool",
    kind: "work",
    createdAt: "2026-01-01T00:00:01.000Z",
    entry: {
      id: "tool",
      createdAt: "2026-01-01T00:00:01.000Z",
      label: "Run command",
      tone: "tool",
      toolLifecycleStatus: status,
      runId: null,
    },
  };
  const rows: MessagesTimelineRow[] = [
    { ...source, groupedEntries: [source.entry], isExpandedToolGroup: false },
  ];
  useChatPresentationMotion({
    identity: "status",
    mode: "better-t3",
    enabled: true,
    textMotion: true,
    connected: true,
    entries: [source],
    rows,
    viewport,
  });
  return (
    <div ref={setViewport} data-viewport>
      <div data-timeline-row-id="tool">
        <div data-presentation-status>{status}</div>
      </div>
    </div>
  );
}

function setupMotion() {
  const cleanup = new DisposableStack();
  const media = Object.assign(new EventTarget(), { matches: false });
  cleanup.use(stubGlobal("matchMedia", () => media));
  cleanup.defer(() => vi.restoreAllMocks());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const offscreen = new Set<string>();
  const cancellations: ReturnType<typeof vi.fn>[] = [];
  const completions: ((commitStyles?: boolean) => void)[] = [];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = offscreen.has(this.dataset.motionId ?? this.dataset.timelineRowId ?? "") ? 400 : 20;
    return {
      top: this.hasAttribute("data-viewport") ? 0 : top,
      bottom: this.hasAttribute("data-viewport") ? 200 : top + 40,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
  const animate = motion.animate
    .mockReset()
    .mockImplementation((element: HTMLElement, keyframes: Record<string, unknown>) => {
      const cancel = vi.fn();
      cancellations.push(cancel);
      const completion = new Promise<void>((resolve) =>
        completions.push((commitStyles = true) => {
          if (commitStyles) {
            if ("opacity" in keyframes) element.style.opacity = "1";
            if ("transform" in keyframes) element.style.transform = "translateY(0)";
          }
          resolve();
        }),
      );
      return Object.assign(completion, { cancel });
    });
  cleanup.use(stubGlobal("Animation", EventTarget));
  const previousAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  cleanup.defer(() => {
    if (previousAnimate) Object.defineProperty(HTMLElement.prototype, "animate", previousAnimate);
    else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });
  return {
    media,
    offscreen,
    cancellations,
    completions,
    animate,
    [Symbol.dispose]: () => cleanup.dispose(),
  };
}

describe("visible chat presentation motion", () => {
  it("animates a visible append once and consumes overscan without later replay", async () => {
    const history = entry("history", 1);
    const live = entry("live", 2);
    const outside = entry("outside", 3);
    using setup = setupMotion();
    await using screen = await render(<Harness entries={[history]} />);
    expect(setup.animate).not.toHaveBeenCalled();
    await screen.rerender(<Harness entries={[history, live]} />);
    expect(setup.animate).toHaveBeenCalledTimes(2);
    setup.offscreen.add(outside.id);
    await screen.rerender(<Harness entries={[history, live, outside]} />);
    expect(setup.animate).toHaveBeenCalledTimes(2);
    setup.offscreen.clear();
    await screen.rerender(<Harness entries={[entry("backfill", 0), history, live, outside]} />);
    expect(setup.animate).toHaveBeenCalledTimes(2);
  });

  it("waits for a virtualized message to mount and consumes its entrance once", async () => {
    const history = entry("history", 1);
    const incoming = entry("delayed", 2);
    using setup = setupMotion();
    await using screen = await render(<Harness entries={[history]} />);
    await screen.rerender(<Harness entries={[history, incoming]} deferNewest />);
    expect(setup.animate).not.toHaveBeenCalled();
    const row = document.createElement("div");
    row.dataset.timelineRowId = incoming.id;
    const bubble = document.createElement("div");
    bubble.setAttribute("data-presentation-bubble", "");
    bubble.dataset.motionId = incoming.id;
    const surface = document.createElement("div");
    surface.setAttribute("data-presentation-surface", "");
    bubble.append(surface);
    row.append(bubble);
    const viewport = screen.container.querySelector("[data-viewport]")!;
    await act(async () => {
      viewport.append(row);
    });
    expect(setup.animate).toHaveBeenCalledTimes(2);
    await act(async () => {
      row.remove();
      viewport.append(row);
    });
    expect(setup.animate).toHaveBeenCalledTimes(2);
  });

  it("keeps mode switches and reconnects still while new messages move with character motion off", async () => {
    const history = entry("history", 1);
    using setup = setupMotion();
    await using screen = await render(<Harness entries={[history]} />);
    await screen.rerender(<Harness entries={[history]} mode="current" />);
    await screen.rerender(<Harness entries={[history]} />);
    const recovered = entry("recovered", 2);
    await screen.rerender(<Harness entries={[history, recovered]} identity="thread:2" />);
    expect(setup.animate).not.toHaveBeenCalled();
    await screen.rerender(
      <Harness
        entries={[history, recovered, entry("silent", 3)]}
        identity="thread:2"
        textMotion={false}
      />,
    );
    expect(setup.animate).toHaveBeenCalledOnce();
    expect(setup.animate).toHaveBeenCalledWith(
      screen.container.querySelector("[data-motion-id='silent'][data-presentation-bubble]"),
      { opacity: [0, 1], transform: ["translateY(10px)", "translateY(0)"] },
      expect.objectContaining({ duration: 0.36, ease: expect.any(Function) }),
    );
  });

  it("releases temporary transform and filter styles after a reveal completes", async () => {
    const history = entry("history", 1);
    using setup = setupMotion();
    await using screen = await render(<Harness entries={[history]} />);
    await screen.rerender(<Harness entries={[history, entry("live", 2)]} />);
    const element = screen.container.querySelector<HTMLElement>(
      "[data-motion-id='live'][data-presentation-bubble]",
    )!;
    await act(() => setup.completions[0]!());
    await vi.waitFor(() => {
      expect(element.style.opacity).toBe("");
      expect(element.style.transform).toBe("");
      expect(element.style.filter).toBe("");
    });
  });

  it("ignores a cancelled animation's delayed completion after a new status starts", async () => {
    using setup = setupMotion();
    await using screen = await render(<StatusHarness status="inProgress" />);
    await screen.rerender(<StatusHarness status="completed" />);
    await screen.rerender(<StatusHarness status="failed" />);
    expect(setup.animate).toHaveBeenCalledTimes(2);
    expect(setup.cancellations[0]).toHaveBeenCalledOnce();
    const status = screen.container.querySelector<HTMLElement>("[data-presentation-status]")!;
    status.style.opacity = "0.45";
    await act(() => setup.completions[0]!(false));
    await vi.waitFor(() => expect(status.style.opacity).toBe("0.45"));
  });

  it("fades newly opened details without changing row height and cancels when disabled", async () => {
    using setup = setupMotion();
    await using screen = await render(<DetailHarness expanded={false} />);
    await screen.rerender(<DetailHarness expanded />);
    expect(setup.animate).toHaveBeenCalledWith(
      screen.container.querySelector("[data-detail]"),
      { opacity: [0, 1] },
      expect.objectContaining({ duration: 0.16, ease: expect.any(Function) }),
    );
    await screen.rerender(<DetailHarness expanded enabled={false} />);
    expect(setup.cancellations[0]).toHaveBeenCalledOnce();
  });

  it.each(["hidden", "reduced", "disabled"] as const)(
    "cancels an active reveal when %s",
    async (condition) => {
      const history = entry("history", 1);
      const entries = [history, entry("live", 2)];
      using setup = setupMotion();
      await using screen = await render(<Harness entries={[history]} />);
      await screen.rerender(<Harness entries={entries} />);
      expect(setup.animate).toHaveBeenCalledTimes(2);
      await act(() => {
        if (condition === "hidden") document.dispatchEvent(new Event("visibilitychange"));
        if (condition === "reduced") {
          setup.media.matches = true;
          setup.media.dispatchEvent(new Event("change"));
        }
        if (condition === "disabled")
          return screen.rerender(<Harness entries={entries} enabled={false} />);
      });
      expect(setup.cancellations[0]).toHaveBeenCalledTimes(1);
    },
  );
});
