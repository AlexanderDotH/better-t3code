import { EnvironmentId, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => motion.reduced }));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: () => "Thinking" }),
}));
vi.mock("../ChatMarkdown", () => ({
  default: ({ text, isStreaming }: { text: string; isStreaming: boolean }) => (
    <p data-full-trace="true" data-live={isStreaming}>
      {text}
    </p>
  ),
}));
vi.mock("../ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <>
      {children}
      {open ? (
        <button data-close-reasoning="true" onClick={() => onOpenChange(false)}>
          Close
        </button>
      ) : null}
    </>
  ),
  DialogPopup: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, undefined, children),
}));

import { ComposerReasoningScroller } from "./ComposerReasoningScroller";
import type { WorkLogEntry } from "../../session-logic";
import {
  WorkingReasoningDialogProvider,
  WorkingReasoningLog,
  type WorkingReasoningTrace,
} from "./WorkingReasoningDialog";

let renderer: ReactTestRenderer | undefined;
let nextFrame = 0;
let frames: Map<number, FrameRequestCallback>;
let resizeCallbacks: Set<() => void>;
const viewport = {
  scrollTop: 0,
  scrollHeight: 24,
  clientHeight: 24,
  scrollTo: vi.fn(({ top, behavior }: { top: number; behavior: ScrollBehavior }) => {
    // Native smooth scrolling takes time; manual input can interrupt it before completion.
    if (behavior !== "smooth") viewport.scrollTop = top;
  }),
};

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
}

function resizeContent() {
  resizeCallbacks.forEach((callback) => callback());
}

function renderedText(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(renderedText).join("");
}

const turnId = TurnId.make("turn");
const traces = [{ id: "thought", detail: "**Plan**\n\nFirst paragraph", streaming: true, turnId }];
const contentProps = {
  traces,
  active: true,
  streamIdPrefix: "thread",
  streamingMotionEnabled: true,
};

function DialogFixture(props: {
  traces: readonly WorkingReasoningTrace[];
  active: boolean;
  streamIdPrefix: string;
  streamingMotionEnabled: boolean;
  enabled?: boolean;
}) {
  const messages = props.traces.map((trace) => ({
    id: MessageId.make(trace.id),
    role: "reasoning" as const,
    turnId,
    text: trace.detail,
    createdAt: "2026-09-30T10:00:00Z",
    updatedAt: "2026-09-30T10:00:00Z",
    streaming: trace.streaming,
  }));
  return (
    <WorkingReasoningDialogProvider
      entries={[]}
      messages={messages}
      activeTurnId={props.active ? turnId : null}
      isWorking={props.active}
      streamIdPrefix={props.streamIdPrefix}
      streamingMotionEnabled={props.streamingMotionEnabled}
      {...(props.enabled === undefined ? {} : { enabled: props.enabled })}
    >
      <WorkingReasoningLog traces={props.traces} followTurnId={turnId} />
    </WorkingReasoningDialogProvider>
  );
}

async function renderContent() {
  await act(() => {
    renderer = create(<DialogFixture {...contentProps} />, {
      createNodeMock: ({ props }) =>
        typeof props === "object" && props !== null && "data-working-reasoning-content" in props
          ? viewport
          : {},
    });
  });
  await act(() => renderer!.root.findByProps({ "data-reasoning-log": "true" }).props.onClick());
  flushFrames();
  return renderer!.root.findByProps({ "data-working-reasoning-content": "true" });
}

beforeEach(() => {
  motion.reduced = false;
  frames = new Map();
  resizeCallbacks = new Set();
  viewport.scrollTop = 0;
  viewport.scrollHeight = 24;
  viewport.scrollTo.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {}
      observe() {
        resizeCallbacks.add(this.callback);
      }
      disconnect() {
        resizeCallbacks.delete(this.callback);
      }
    },
  );
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it.each([
  "**Investigating**",
  "## Investigating",
  "> Investigating",
  "`Investigating`",
  "[Investigating](https://example.com)",
])("shows readable title text for provider formatting %s", async (title) => {
  const detail = `${title}\n\nFull reasoning body`;
  await act(() => {
    renderer = create(<DialogFixture {...contentProps} traces={[{ ...traces[0]!, detail }]} />, {
      createNodeMock: () => viewport,
    });
  });
  const trigger = renderer!.root.findByProps({ "data-reasoning-log": "true" });
  expect(renderedText(trigger)).toBe("Investigating");
  expect(renderer!.root.findAllByProps({ "data-full-trace": "true" })).toHaveLength(0);
  await act(() => trigger.props.onClick());
  expect(renderer!.root.findByProps({ "data-full-trace": "true" }).children).toEqual([detail]);
});

it("keeps only titles in the Working strip and opens complete historical and live bodies in its dialog", async () => {
  const environmentId = EnvironmentId.make("env");
  const props = {
    entries: [],
    messages: Array.from({ length: 5 }, (_, index) => ({
      id: MessageId.make(`thought-${index}`),
      role: "reasoning" as const,
      turnId,
      text: `## Title ${index}\n\nPrivate body ${index}`,
      createdAt: `2026-09-30T10:00:0${index}Z`,
      updatedAt: `2026-09-30T10:00:0${index}Z`,
      streaming: index === 4,
    })),
    turnId,
    environmentId,
    threadRef: { environmentId, threadId: ThreadId.make("thread") },
    cwd: undefined,
    active: true,
    streamingMotionEnabled: true,
  };
  const composer = (next = props, showStrip = true, scope = "thread") => (
    <WorkingReasoningDialogProvider
      entries={next.entries}
      messages={next.messages}
      activeTurnId={next.active ? turnId : null}
      isWorking={next.active}
      streamIdPrefix={scope}
      streamingMotionEnabled={next.streamingMotionEnabled}
    >
      {showStrip ? <ComposerReasoningScroller {...next} /> : null}
    </WorkingReasoningDialogProvider>
  );
  await act(() => {
    renderer = create(composer(), { createNodeMock: () => viewport });
  });
  flushFrames();
  expect(renderer!.root.findAllByProps({ "data-full-trace": "true" })).toHaveLength(0);
  expect(
    renderer!.root
      .findAllByProps({ "data-reasoning-log": "true" })
      .map((node) => node.findByType("span").children.join("")),
  ).toHaveLength(5);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Private body");
  expect(JSON.stringify(renderer!.toJSON())).toContain("Title 4");
  await act(() =>
    renderer!.root.findAllByProps({ "data-reasoning-log": "true" }).at(-1)!.props.onClick(),
  );
  const bodies = () => renderer!.root.findAllByProps({ "data-full-trace": "true" });
  expect(bodies().map((node) => node.children.join(""))).toEqual(
    props.messages.map((message) => message.text),
  );
  expect(bodies().at(-1)!.props["data-live"]).toBe(true);
  const streamingMessages = [
    ...props.messages,
    {
      ...props.messages[4]!,
      id: MessageId.make("thought-5"),
      text: "### Next title\n\nBody arriving after the dialog opened",
      createdAt: "2026-09-30T10:00:05Z",
    },
  ];
  await act(() => renderer!.update(composer({ ...props, messages: streamingMessages })));
  expect(bodies().map((node) => node.children.join(""))).toEqual(
    streamingMessages.map((message) => message.text),
  );
  const appended = streamingMessages.map((message, index) =>
    index === 5
      ? { ...message, text: `${message.text}\nNew final line`, streaming: false }
      : message,
  );
  await act(() =>
    renderer!.update(composer({ ...props, messages: appended, active: false }, false)),
  );
  expect(renderer!.root.findAllByProps({ "data-reasoning-log": "true" })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
  expect(bodies().at(-1)!.children.join("")).toContain("New final line");
  expect(bodies().every((node) => node.props["data-live"] === false)).toBe(true);
  await act(() => renderer!.update(composer(props, false, "another-thread")));
  expect(renderer!.toJSON()).toBeNull();
});

it("shows current-turn canonical and legacy thinking once, excluding prior turns, inherited context, tools, and blank traces", async () => {
  const canonical = {
    id: MessageId.make("canonical"),
    role: "reasoning" as const,
    turnId,
    text: "**Canonical**\n\nComplete canonical body",
    createdAt: "2026-09-30T10:00:00Z",
    updatedAt: "2026-09-30T10:00:00Z",
    streaming: false,
  };
  const legacy: WorkLogEntry = {
    id: "legacy",
    turnId,
    createdAt: "2026-09-30T10:00:01Z",
    tone: "thinking",
    label: "Thinking",
    sourceActivityKind: "reasoning.summary",
    detail: "# Legacy\n\nComplete legacy body",
  };
  const messages = [
    {
      ...canonical,
      id: MessageId.make("previous"),
      turnId: TurnId.make("previous"),
      text: "Previous turn body",
    },
    canonical,
  ];
  const entries: WorkLogEntry[] = [
    {
      ...legacy,
      id: "previous-legacy",
      turnId: TurnId.make("previous"),
      detail: "Previous turn body",
    },
    { ...legacy, id: "duplicate", detail: canonical.text },
    legacy,
    { ...legacy, id: "tool", sourceActivityKind: "tool.started", detail: "Tool body" },
    { ...legacy, id: "empty", detail: "  " },
    {
      ...legacy,
      id: "inherited",
      detail: "Inherited context",
      historyOrigin: { sourceThreadId: ThreadId.make("origin"), sourceId: "original", ordinal: 0 },
    },
  ];
  const environmentId = EnvironmentId.make("env");
  await act(() => {
    renderer = create(
      <WorkingReasoningDialogProvider
        entries={entries}
        messages={messages}
        activeTurnId={null}
        isWorking={false}
        streamIdPrefix="thread"
        streamingMotionEnabled
      >
        <ComposerReasoningScroller
          entries={entries}
          messages={messages}
          turnId={turnId}
          environmentId={environmentId}
          threadRef={{ environmentId, threadId: ThreadId.make("thread") }}
          cwd={undefined}
          streamingMotionEnabled
          active={false}
        />
      </WorkingReasoningDialogProvider>,
      { createNodeMock: () => viewport },
    );
  });
  expect(renderer!.root.findAllByProps({ "data-reasoning-log": "true" }).map(renderedText)).toEqual(
    ["Canonical", "Legacy"],
  );
  await act(() =>
    renderer!.root.findAllByProps({ "data-reasoning-log": "true" })[1]!.props.onClick(),
  );
  expect(renderer!.root.findAllByProps({ "data-full-trace": "true" }).map(renderedText)).toEqual([
    canonical.text,
    legacy.detail,
  ]);
});

it("retains selected raw text when a historical work producer leaves the loaded scope", async () => {
  await renderContent();
  await act(() => renderer!.update(<DialogFixture {...contentProps} traces={[]} active={false} />));
  expect(renderer!.root.findAllByProps({ "data-reasoning-log": "true" })).toHaveLength(0);
  expect(renderer!.root.findByProps({ "data-full-trace": "true" }).children).toEqual([
    traces[0]!.detail,
  ]);
  expect(renderer!.root.findByProps({ "data-full-trace": "true" }).props["data-live"]).toBe(false);
});

it("closes Thinking when Working presentation is disabled and keeps the raw trace for reopening", async () => {
  await renderContent();
  await act(() => renderer!.update(<DialogFixture {...contentProps} enabled={false} />));
  expect(renderer!.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ "data-full-trace": "true" })).toHaveLength(0);
  await act(() => renderer!.update(<DialogFixture {...contentProps} enabled />));
  expect(renderer!.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  await act(() => renderer!.root.findByProps({ "data-reasoning-log": "true" }).props.onClick());
  expect(renderer!.root.findByProps({ "data-full-trace": "true" }).children).toEqual([
    traces[0]!.detail,
  ]);
});

it("smoothly follows the first overflow and coalesces appended lines and resize notifications without idle frames", async () => {
  await renderContent();
  expect(viewport.scrollTo).not.toHaveBeenCalled();
  viewport.scrollHeight = 72;
  await act(() =>
    renderer!.update(
      <DialogFixture
        {...contentProps}
        traces={[{ ...traces[0]!, detail: `${traces[0]!.detail}\n\nNext paragraph` }]}
      />,
    ),
  );
  resizeContent();
  resizeContent();
  expect(frames.size).toBe(1);
  flushFrames();
  expect(viewport.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 48, behavior: "smooth" });
  expect(frames.size).toBe(0);
  flushFrames();
  expect(viewport.scrollTo).toHaveBeenCalledTimes(1);
});

it("interrupts smooth follow for manual scroll-up and resumes after the reader returns to the bottom", async () => {
  const region = await renderContent();
  viewport.scrollHeight = 96;
  resizeContent();
  flushFrames();
  viewport.scrollTop = 30;
  region.props.onWheel({ deltaY: -20 });
  expect(viewport.scrollTo).toHaveBeenLastCalledWith({ top: 30, behavior: "instant" });
  viewport.scrollTop = 10;
  region.props.onScroll();
  viewport.scrollTo.mockClear();
  viewport.scrollHeight = 120;
  resizeContent();
  flushFrames();
  expect(viewport.scrollTop).toBe(10);
  expect(viewport.scrollTo).not.toHaveBeenCalled();
  viewport.scrollTop = 96;
  region.props.onScroll();
  viewport.scrollHeight = 144;
  resizeContent();
  flushFrames();
  expect(viewport.scrollTo).toHaveBeenLastCalledWith({ top: 120, behavior: "smooth" });
});

it("keeps following after clicking content, snaps for reduced motion, and cancels queued work on close", async () => {
  motion.reduced = true;
  const region = await renderContent();
  region.props.onPointerDown({ target: {}, currentTarget: viewport });
  viewport.scrollHeight = 72;
  resizeContent();
  flushFrames();
  expect(viewport.scrollTo).toHaveBeenLastCalledWith({ top: 48, behavior: "instant" });
  viewport.scrollHeight = 96;
  resizeContent();
  expect(frames.size).toBe(1);
  await act(() => renderer!.root.findByProps({ "data-close-reasoning": "true" }).props.onClick());
  expect(renderer!.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  expect(frames.size).toBe(0);
  expect(resizeCallbacks.size).toBe(0);
});
