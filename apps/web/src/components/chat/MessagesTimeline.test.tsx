// @vitest-environment jsdom

import {
  ApprovalRequestId,
  CHAT_VISUAL_MODES,
  type ChatVisualMode,
  ComposerContextId,
  DEFAULT_CLIENT_SETTINGS,
  CheckpointRef,
  EnvironmentId,
  MessageId,
  makeBetterT3SettingsV1,
  resolveBetterT3FeatureFlag,
  TurnId,
  type ComposerContextRecord,
} from "@t3tools/contracts";
import {
  act,
  createRef,
  useLayoutEffect,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef, MaintainScrollAtEndOptions } from "@legendapp/list/react";
import { shouldUseRestingComposerLayout } from "../composerFooterLayout";
import { useComposerFocusState } from "./useComposerFocusState";
import type { TimelineEntry } from "../../session-logic";
import { InlineMessageEditor } from "./InlineMessageEditor";
import { MessagesTimeline, resolvePreviewAnnotationImage } from "./MessagesTimeline";
import { WorkingReasoningDialogProvider } from "./WorkingReasoningDialog";
import { deriveUnsettledTurnId } from "./MessagesTimeline.logic";
import { readTimelinePosition } from "./timelineScrollAnchoring";
import { MAX_STREAMING_TEXT_MOTION_REVEAL_MS } from "./streamingTextMotion";
import { useClientSettings } from "../../hooks/useSettings";

const visualPreference = vi.hoisted(() => ({ mode: "current" as ChatVisualMode }));
vi.mock("../../chatVisualModeSync", () => ({ useChatVisualMode: () => visualPreference.mode }));

vi.mock("@legendapp/list/react", async () => {
  const legendListTestId = "legend-list";

  const LegendList = (props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
    anchoredEndSpace?: {
      anchorIndex: number;
      anchorMaxSize?: number;
      anchorOffset?: number;
      onReady?: (info: { anchorIndex: number }) => void;
    };
    contentInsetEndAdjustment?: number;
    className?: string;
    maintainScrollAtEnd?: boolean | MaintainScrollAtEndOptions;
    maintainVisibleContentPosition?:
      | boolean
      | {
          data?: boolean;
          size?: boolean;
          shouldRestorePosition?: (item: { id: string }) => boolean;
        };
    ref?: Ref<LegendListRef>;
  }) => {
    if (props.anchoredEndSpace) {
      props.anchoredEndSpace.onReady?.({ anchorIndex: props.anchoredEndSpace.anchorIndex });
    }
    return (
      <div
        data-testid={legendListTestId}
        data-anchor-index={props.anchoredEndSpace?.anchorIndex}
        data-anchor-max-size={props.anchoredEndSpace?.anchorMaxSize}
        data-anchor-offset={props.anchoredEndSpace?.anchorOffset}
        data-anchor-on-ready={Boolean(props.anchoredEndSpace?.onReady)}
        data-content-inset-end={props.contentInsetEndAdjustment}
        data-class-name={props.className}
        data-maintain-scroll-at-end={props.maintainScrollAtEnd ? "enabled" : undefined}
        data-maintain-scroll-at-end-animated={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.animated
            : undefined
        }
        data-maintain-scroll-at-end-data-change={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.dataChange
            : undefined
        }
        data-maintain-scroll-at-end-footer-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.footerLayout
            : undefined
        }
        data-maintain-scroll-at-end-item-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.itemLayout
            : undefined
        }
        data-maintain-scroll-at-end-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.layout
            : undefined
        }
        data-maintain-visible-content-position={
          typeof props.maintainVisibleContentPosition === "object"
            ? "object"
            : props.maintainVisibleContentPosition
        }
        data-maintain-visible-content-position-data={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.data
            : undefined
        }
        data-maintain-visible-content-position-size={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.size
            : undefined
        }
        data-maintain-visible-content-position-restore={
          typeof props.maintainVisibleContentPosition === "object"
            ? Boolean(props.maintainVisibleContentPosition.shouldRestorePosition)
            : undefined
        }
      >
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  };

  return { LegendList };
});

function MockFileDiff(props: {
  fileDiff: { name?: string | null; prevName?: string | null };
  renderCustomHeader?: (fileDiff: {
    name?: string | null;
    prevName?: string | null;
  }) => React.ReactNode;
}) {
  return (
    <div data-testid="file-diff">
      {props.renderCustomHeader?.(props.fileDiff)}
      {props.fileDiff.name ?? props.fileDiff.prevName ?? "diff"}
    </div>
  );
}

vi.mock("@pierre/diffs/react", () => {
  return { FileDiff: MockFileDiff };
});

vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => children,
}));

// Install browser globals before the static imports initialize settings and media-query stores.
const { configureTestDom } = vi.hoisted(() => {
  function configureTestDom() {
    window.matchMedia = () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    });
  }

  configureTestDom();
  return { configureTestDom };
});

beforeEach(configureTestDom);

const ACTIVE_THREAD_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const MESSAGE_CREATED_AT = "2026-03-17T19:12:28.000Z";

function ReasoningTimelineFixture({
  children,
  ...props
}: ComponentProps<typeof MessagesTimeline> & { children?: ReactNode }) {
  const settings = useClientSettings();
  return (
    <WorkingReasoningDialogProvider
      entries={props.timelineEntries.flatMap((entry) =>
        entry.kind === "work" ? [entry.entry] : [],
      )}
      messages={props.timelineEntries.flatMap((entry) =>
        entry.kind === "message" ? [entry.message] : [],
      )}
      activeTurnId={deriveUnsettledTurnId(props.latestTurn ?? null, props.runningTurnId ?? null)}
      isWorking={props.isWorking}
      enabled={
        settings.showReasoning &&
        resolveBetterT3FeatureFlag(settings.betterT3Device, "agent.reasoningWorkingOverlay")
      }
      streamIdPrefix={props.routeThreadKey}
      streamingMotionEnabled={props.streamingMotionEnabled ?? false}
      markdownOptions={{ cwd: props.markdownCwd, environmentId: props.activeThreadEnvironmentId }}
    >
      {children ?? <MessagesTimeline {...props} />}
    </WorkingReasoningDialogProvider>
  );
}

function buildProps() {
  return {
    isWorking: false,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    latestTurn: null,
    runningTurnId: null,
    turnDiffSummaries: [],
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ACTIVE_THREAD_ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light" as const,
    timestampFormat: "locale" as const,
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: () => {},
    contentInsetEndAdjustment: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
    onManualNavigation: () => {},
  };
}

it("returns to the updated live edge after switching threads during a layout change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const { LegendList } = await import("@legendapp/list/react");
  const props = buildProps();
  const threadA = "scroll-restoration:thread-a";
  const threadB = "scroll-restoration:thread-b";
  const first = buildUserTimelineEntry("First prompt");
  const answer = buildAssistantTimelineEntry("Growing answer");
  const viewport = document.createElement("div");
  const row = document.createElement("div");
  let contentHeight = 2400;
  viewport.scrollTop = 900;
  Object.defineProperties(viewport, {
    clientHeight: { value: 700 },
    scrollHeight: { get: () => contentHeight },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 700));
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -100, 800, 1600));
  const scrollToEnd = vi.fn(async () => {
    viewport.scrollTop = contentHeight - 700;
  });
  const scrollToIndex = vi.fn(async () => {});
  let following = true;
  let renderer: ReactTestRenderer | undefined;
  const getListProps = () => renderer!.root.findByType(LegendList).props;
  try {
    await act(() => {
      renderer = create(
        <MessagesTimeline
          {...props}
          routeThreadKey={threadA}
          isFollowingEnd={() => following}
          timelineEntries={[first, answer]}
        />,
      );
    });
    props.listRef.current = {
      getScrollableNode: () => viewport,
      getState: () => ({
        data: getListProps().data,
        scroll: viewport.scrollTop,
        scrollLength: 700,
        contentLength: contentHeight,
        positionAtIndex: (index: number) => index * 800,
        sizeAtIndex: () => 800,
        indexByKey: (key: string) =>
          getListProps().data.findIndex((item: { id: string }) => item.id === key),
        elementAtIndex: () => row,
      }),
      scrollToEnd,
      scrollToIndex,
      scrollToOffset: vi.fn(async () => {}),
    } as unknown as LegendListRef;

    // A growing row has moved the physical end, but the user never scrolled away.
    await act(() => getListProps().onScroll());
    expect(readTimelinePosition(threadA)?.atEnd).toBe(true);
    await act(() =>
      renderer!.update(
        <MessagesTimeline
          {...props}
          routeThreadKey={threadB}
          isFollowingEnd={() => following}
          timelineEntries={[first]}
        />,
      ),
    );
    contentHeight = 4100;
    scrollToEnd.mockClear();
    await act(() =>
      renderer!.update(
        <MessagesTimeline
          {...props}
          routeThreadKey={threadA}
          isFollowingEnd={() => following}
          timelineEntries={[
            first,
            { ...answer, message: { ...answer.message, text: "A much longer completed answer" } },
          ]}
        />,
      ),
    );
    expect(scrollToEnd).toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(3400);
    expect(scrollToIndex).not.toHaveBeenCalled();

    // A real navigation gesture changes the saved intent even before React re-renders.
    following = false;
    viewport.scrollTop = 900;
    await act(() => getListProps().onScroll());
    expect(readTimelinePosition(threadA)?.atEnd).toBe(false);
    expect(readTimelinePosition(threadA)?.offsetWithinRow).toBe(100);
    const saved = readTimelinePosition(threadA);

    // Painting the old thread while the next thread loads must not overwrite its position.
    await act(() =>
      renderer!.update(
        <MessagesTimeline
          {...props}
          routeThreadKey={threadB}
          displayThreadKey={threadA}
          liveFollowEnabled={false}
          isFollowingEnd={() => following}
          timelineEntries={[first, answer]}
        />,
      ),
    );
    viewport.scrollTop = 0;
    await act(() => getListProps().onScroll());
    expect(readTimelinePosition(threadA)).toEqual(saved);
  } finally {
    await act(() => renderer?.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("reveals toggled details above the widgets and cancels that adjustment for a new scroll gesture", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const flush = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  const host = document.createElement("div");
  document.body.append(host);
  host.scrollTop = 400;
  Object.defineProperties(host, {
    scrollHeight: { value: 3000 },
    clientHeight: { value: 800 },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === host) return new DOMRect(0, 0, 800, 800);
    if (this.dataset.timelineRowId === "reveal-tool") {
      return new DOMRect(0, 500, 700, this.querySelector('[aria-expanded="true"]') ? 320 : 48);
    }
    if (this.hasAttribute("aria-expanded")) return new DOMRect(0, 500, 200, 36);
    return new DOMRect(0, 0, 800, 0);
  });
  const root = createRoot(host);
  const props = buildProps();
  const scrollToOffset = vi.fn(async ({ offset }: { offset: number }) => {
    host.scrollTop = offset;
  });
  const scrollToEnd = vi.fn(async () => {});
  props.listRef.current = {
    getScrollableNode: () => host,
    getState: () => ({ isAtEnd: false }),
    scrollToOffset,
    scrollToEnd,
  } as unknown as LegendListRef;
  try {
    await act(() =>
      root.render(
        <MessagesTimeline
          {...props}
          routeThreadKey="disclosure-scroll:thread"
          liveFollowEnabled={false}
          contentInsetEndAdjustment={280}
          timelineEntries={[
            {
              id: "reveal-tool",
              kind: "work",
              createdAt: MESSAGE_CREATED_AT,
              entry: {
                id: "reveal-tool",
                createdAt: MESSAGE_CREATED_AT,
                label: "Read source",
                tone: "tool",
                toolLifecycleStatus: "completed",
                detail: "Expanded output",
              },
            },
          ]}
        />,
      ),
    );
    await flush();
    await flush();
    const row = host.querySelector<HTMLElement>('[data-timeline-row-id="reveal-tool"]')!;
    const toggle = row.querySelector<HTMLElement>("[aria-expanded]")!;
    await act(() => toggle.click());
    await flush();
    await flush();
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 716, animated: true });
    expect(scrollToEnd).not.toHaveBeenCalled();
    host.scrollTop = 400;
    await act(() => toggle.click());
    await flush();
    await flush();
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 444, animated: true });

    scrollToOffset.mockClear();
    await act(() => toggle.click());
    await act(() => row.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 })));
    await flush();
    await flush();
    expect(scrollToOffset).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

function buildLongUserMessageText(tail = "deep hidden detail only after expand") {
  return Array.from({ length: 9 }, (_, index) =>
    index === 8 ? tail : `Line ${index + 1}: ${"verbose prompt content ".repeat(8).trim()}`,
  ).join("\n");
}

function buildUserTimelineEntry(text: string) {
  return {
    id: "entry-1",
    kind: "message" as const,
    createdAt: MESSAGE_CREATED_AT,
    message: {
      id: MessageId.make("message-1"),
      role: "user" as const,
      text,
      turnId: null,
      createdAt: MESSAGE_CREATED_AT,
      updatedAt: MESSAGE_CREATED_AT,
      streaming: false,
    },
  };
}

function buildAssistantTimelineEntry(text: string) {
  const entry = buildUserTimelineEntry(text);
  return {
    ...entry,
    message: {
      ...entry.message,
      role: "assistant" as const,
    },
  };
}

it("places attachment previews below Better T3 prose while preserving other layouts and actions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const file = {
    type: "file" as const,
    id: "report",
    name: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 42,
  };
  const archive = { ...file, id: "archive", name: "archive.zip", mimeType: "application/zip" };
  const entry = buildUserTimelineEntry("Review the attached report.");
  const entries = [{ ...entry, message: { ...entry.message, attachments: [archive, file] } }];
  const onFileOpen = vi.fn();
  const onFileDownload = vi.fn();
  try {
    for (const mode of ["current", "better-t3", "classic"] as const) {
      visualPreference.mode = mode;
      await act(() =>
        root.render(
          <MessagesTimeline
            {...buildProps()}
            timelineEntries={entries}
            onFileOpen={onFileOpen}
            onFileDownload={onFileDownload}
          />,
        ),
      );
      const body = container.querySelector("[data-reply-message-content]")!;
      const attachments = container.querySelector("[data-message-attachments]")!;
      expect(body.textContent).toContain("Review the attached report.");
      const follows = Boolean(
        body.compareDocumentPosition(attachments) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(follows).toBe(mode === "better-t3");
      if (mode === "better-t3") {
        const previews = attachments.querySelector(".better-chat-attachment-grid")!;
        const others = attachments.querySelector(".better-chat-attachment-list")!;
        expect(previews.textContent).toContain("report.pdf");
        expect(others.textContent).toContain("archive.zip");
        expect(
          previews.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
      await act(() =>
        container.querySelector<HTMLButtonElement>('[aria-label="Preview report.pdf"]')!.click(),
      );
      expect(onFileOpen).toHaveBeenLastCalledWith(file);
      await act(() =>
        container.querySelector<HTMLButtonElement>('[aria-label="Download report.pdf"]')!.click(),
      );
      expect(onFileDownload).toHaveBeenLastCalledWith(file);
    }
  } finally {
    await act(() => root.unmount());
    container.remove();
    visualPreference.mode = "current";
    vi.unstubAllGlobals();
  }
});

it("preserves the mounted list, scroll position, and open tool output across Better T3 switches", async () => {
  visualPreference.mode = "current";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = buildProps();
  const timelineEntries: TimelineEntry[] = [
    {
      id: "stable-tool",
      kind: "work",
      createdAt: MESSAGE_CREATED_AT,
      entry: {
        id: "stable-tool",
        createdAt: MESSAGE_CREATED_AT,
        tone: "tool",
        label: "Read source",
        command: "cat source.ts",
        detail: "Complete tool output",
        toolLifecycleStatus: "completed",
        itemType: "command_execution",
      },
    },
  ];
  const render = () => <MessagesTimeline {...props} timelineEntries={timelineEntries} />;
  try {
    await act(() => root.render(render()));
    const list = container.querySelector<HTMLElement>("[data-testid='legend-list']")!;
    const row = container.querySelector<HTMLElement>("[data-timeline-row-id='stable-tool']")!;
    await act(() => row.querySelector<HTMLElement>("[role='button']")!.click());
    expect(row.textContent).toContain("Complete tool output");
    list.scrollTop = 140;
    for (const mode of ["better-t3", "current"] as const) {
      visualPreference.mode = mode;
      await act(() => root.render(render()));
      expect(container.querySelector("[data-testid='legend-list']")).toBe(list);
      expect(container.querySelector("[data-timeline-row-id='stable-tool']")).toBe(row);
      expect(list.scrollTop).toBe(140);
      expect(row.querySelector("[aria-expanded='true']")).not.toBeNull();
      expect(row.textContent).toContain("Complete tool output");
    }
  } finally {
    await act(() => root.unmount());
    container.remove();
    visualPreference.mode = "current";
    vi.unstubAllGlobals();
  }
});

it.each([false, true])(
  "keeps Better T3 history and reconnect text still while future chunks honor character motion (%s)",
  async (characters) => {
    const { __setClientSettingsForTests, getClientSettings } =
      await import("../../hooks/useSettings");
    const originalSettings = getClientSettings();
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      betterT3Device: {
        ...makeBetterT3SettingsV1("existing-install-migration"),
        flags: { "chat.characterStreamingMotion": characters },
      },
    });
    visualPreference.mode = "better-t3";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const turnId = TurnId.make("better-stream");
    const base = buildAssistantTimelineEntry("Existing response");
    const render = (text: string, generation = 1) => (
      <MessagesTimeline
        {...buildProps()}
        isWorking
        runningTurnId={turnId}
        presentationConnectionGeneration={generation}
        latestTurn={{ turnId, state: "running", startedAt: MESSAGE_CREATED_AT, completedAt: null }}
        timelineEntries={[{ ...base, message: { ...base.message, text, turnId, streaming: true } }]}
      />
    );
    let renderer: ReactTestRenderer | undefined;
    const charactersOnScreen = () => renderer!.root.findAllByProps({ "data-stream-character": "" });
    try {
      await act(() => {
        renderer = create(render("Existing response"));
      });
      expect(charactersOnScreen()).toHaveLength(0);
      await act(() => renderer!.update(render("Existing response appended")));
      expect(charactersOnScreen().length > 0).toBe(characters);
      await act(() => renderer!.update(render("Existing response appended recovered", 2)));
      expect(charactersOnScreen()).toHaveLength(0);
      await act(() => renderer!.update(render("Existing response appended recovered fresh", 2)));
      expect(charactersOnScreen().length > 0).toBe(characters);
      await act(() => renderer!.unmount());
      await act(() => {
        renderer = create(render("Existing response appended recovered fresh", 2));
      });
      expect(charactersOnScreen()).toHaveLength(0);
      expect(renderer!.root.findAllByProps({ "data-streaming": "" })).toHaveLength(0);
    } finally {
      await act(() => renderer?.unmount());
      __setClientSettingsForTests(originalSettings);
      visualPreference.mode = "current";
    }
  },
);

it.each([false, true])(
  "animates a newly received complete answer with character streaming and presentation motion %s",
  async (presentationMotion) => {
    const { __setClientSettingsForTests, getClientSettings } =
      await import("../../hooks/useSettings");
    const originalSettings = getClientSettings();
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      betterT3Device: {
        ...makeBetterT3SettingsV1("existing-install-migration"),
        flags: {
          "chat.characterStreamingMotion": true,
          "chat.presentationMotion": presentationMotion,
        },
      },
    });
    visualPreference.mode = "better-t3";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const history = buildAssistantTimelineEntry("Previously loaded text");
    const incoming = {
      ...buildAssistantTimelineEntry("A short answer received in one piece."),
      id: "incoming-complete",
      createdAt: "2026-10-27T10:00:01.000Z",
      message: {
        ...buildAssistantTimelineEntry("A short answer received in one piece.").message,
        id: MessageId.make("incoming-complete"),
        createdAt: "2026-10-27T10:00:01.000Z",
        updatedAt: "2026-10-27T10:00:01.000Z",
      },
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(<MessagesTimeline {...buildProps()} timelineEntries={[history]} />);
      });
      expect(renderer!.root.findAllByProps({ "data-stream-character": "" })).toHaveLength(0);
      await act(() =>
        renderer!.update(
          <MessagesTimeline {...buildProps()} timelineEntries={[history, incoming]} />,
        ),
      );
      const row = renderer!.root.findByProps({ "data-timeline-row-id": incoming.id });
      expect(row.findAllByProps({ "data-stream-character": "" }).length).toBeGreaterThan(0);
      expect(
        renderer!.root
          .findByProps({ "data-timeline-row-id": history.id })
          .findAllByProps({ "data-stream-character": "" }),
      ).toHaveLength(0);
      const placeholder = {
        ...incoming,
        id: "incoming-placeholder",
        createdAt: "2026-10-27T10:00:02.000Z",
        message: {
          ...incoming.message,
          id: MessageId.make("incoming-placeholder"),
          text: "",
          createdAt: "2026-10-27T10:00:02.000Z",
        },
      };
      await act(() =>
        renderer!.update(
          <MessagesTimeline {...buildProps()} timelineEntries={[history, incoming, placeholder]} />,
        ),
      );
      await act(() =>
        renderer!.update(
          <MessagesTimeline
            {...buildProps()}
            timelineEntries={[
              history,
              incoming,
              {
                ...placeholder,
                message: {
                  ...placeholder.message,
                  text: "The placeholder now contains a complete answer.",
                },
              },
            ]}
          />,
        ),
      );
      expect(
        renderer!.root
          .findByProps({ "data-timeline-row-id": placeholder.id })
          .findAllByProps({ "data-stream-character": "" }).length,
      ).toBeGreaterThan(0);
    } finally {
      await act(() => renderer?.unmount());
      __setClientSettingsForTests(originalSettings);
      visualPreference.mode = "current";
    }
  },
);

function buildSnapShotTimelineEntry(previewUrl?: string) {
  const entry = buildUserTimelineEntry("First prompt.");
  return {
    ...entry,
    message: {
      ...entry.message,
      attachments: [
        {
          type: "image" as const,
          id: "attachment-1",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 1,
          ...(previewUrl ? { previewUrl } : {}),
          source: {
            kind: "snap-shot" as const,
            capturedAt: "2026-03-17T19:12:28.000Z",
            appName: "Terminal",
            windowTitle: "t3code — Tests",
            appIconDataUrl: "data:image/png;base64,aWNvbg==",
          },
        },
      ],
    },
  };
}

it("switches visual grouping without remounting the existing user message", async () => {
  vi.stubGlobal(
    "Element",
    class Element {
      readonly nodeType = 1;
    },
  );
  Object.defineProperty(window, "Element", { configurable: true, value: Element });
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const timelineEntries = [
    buildUserTimelineEntry("Keep this message"),
    ...Array.from({ length: 3 }, (_, index) => ({
      kind: "work" as const,
      id: `mode-entry-${index}`,
      createdAt: MESSAGE_CREATED_AT,
      entry: {
        id: `mode-work-${index}`,
        createdAt: MESSAGE_CREATED_AT,
        label: `Read file ${index}`,
        tone: "tool" as const,
        toolLifecycleStatus: "completed" as const,
      },
    })),
  ];
  const props = buildProps();
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<MessagesTimeline {...props} timelineEntries={timelineEntries} />);
    });
    const user = renderer!.root.findByProps({ "data-message-role": "user" });
    expect(renderer!.root.findAllByProps({ "data-timeline-row-kind": "work" })).toHaveLength(0);
    visualPreference.mode = "classic";
    await act(() => {
      renderer!.update(
        <MessagesTimeline {...props} timelineEntries={timelineEntries} timestampFormat="12-hour" />,
      );
    });
    expect(renderer!.root.findByProps({ "data-message-role": "user" })).toBe(user);
    expect(renderer!.root.findAllByProps({ "data-timeline-row-kind": "work" })).toHaveLength(1);
    const toggle = renderer!.root
      .findByProps({ "data-timeline-row-kind": "work-toggle" })
      .findByType("button");
    await act(() => toggle.props.onClick());
    expect(renderer!.root.findAllByProps({ "data-timeline-row-kind": "work" })).toHaveLength(3);
    expect(renderer!.root.findAllByProps({ "data-testid": "legend-list" })).toHaveLength(1);
    expect(
      renderer!.root.findByProps({ "data-timeline-row-kind": "work-toggle" }).findByType("button")
        .props["aria-expanded"],
    ).toBe(true);
    visualPreference.mode = "current";
    await act(() => {
      renderer!.update(<MessagesTimeline {...props} timelineEntries={timelineEntries} />);
    });
    expect(renderer!.root.findByProps({ "data-message-role": "user" })).toBe(user);
    expect(renderer!.root.findAllByProps({ "data-timeline-row-kind": "work" })).toHaveLength(1);
    const currentToggle = renderer!.root
      .findByProps({ "data-timeline-row-kind": "work-toggle" })
      .findByType("button");
    expect(currentToggle.props["aria-expanded"]).toBe(true);
    expect(
      currentToggle
        .findAllByType("span")
        .flatMap((node) => node.children.filter((child) => typeof child === "string"))
        .join(""),
    ).not.toContain("Show fewer");
    for (const mode of ["current", "classic", "current"] as const) {
      visualPreference.mode = mode;
      await act(() => {
        renderer!.update(
          <MessagesTimeline
            {...props}
            timelineEntries={[timelineEntries[0]!]}
            isWorking
            activeTurnStartedAt={MESSAGE_CREATED_AT}
            timestampFormat={mode === "classic" ? "12-hour" : "24-hour"}
          />,
        );
      });
      expect(renderer!.root.findByProps({ "data-message-role": "user" })).toBe(user);
      expect(renderer!.root.findAllByProps({ "data-timeline-row-kind": "working" })).toHaveLength(
        1,
      );
      expect(renderer!.root.findAllByProps({ "data-timeline-row-kind": "thinking" })).toHaveLength(
        mode === "classic" ? 0 : 1,
      );
    }
  } finally {
    await act(() => renderer?.unmount());
    visualPreference.mode = "current";
  }
});

it("moves the active plan between the composer and native timeline", async () => {
  const { __setClientSettingsForTests, getClientSettings } =
    await import("../../hooks/useSettings");
  const originalSettings = getClientSettings();
  const settings = {
    ...DEFAULT_CLIENT_SETTINGS,
    showReasoning: true,
  };
  __setClientSettingsForTests(settings);
  visualPreference.mode = "classic";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const audio = {
    type: "audio" as const,
    id: "audio-1",
    name: "voice.wav",
    mimeType: "audio/wav",
    sizeBytes: 12,
    previewUrl: "data:audio/wav;base64,UklGRg==",
  };
  const user = buildUserTimelineEntry("A voice message");
  const assistant = { ...buildAssistantTimelineEntry(""), id: "assistant-audio-entry" };
  const plan = {
    id: "turn-plan:historical",
    createdAt: MESSAGE_CREATED_AT,
    turnId: TurnId.make("historical"),
    plan: {
      createdAt: MESSAGE_CREATED_AT,
      turnId: TurnId.make("historical"),
      steps: [{ step: "Historical task", status: "completed" as const }],
    },
  };
  const timelineEntries = [
    { ...user, message: { ...user.message, attachments: [audio] } },
    {
      kind: "work" as const,
      id: "reasoning",
      createdAt: MESSAGE_CREATED_AT,
      entry: {
        id: "reasoning",
        createdAt: MESSAGE_CREATED_AT,
        tone: "thinking" as const,
        label: "Reasoning",
        sourceActivityKind: "reasoning.completed",
        detail: "Visible provider explanation",
      },
    },
    { kind: "turn-plan" as const, id: plan.id, createdAt: plan.createdAt, turnPlan: plan },
    {
      ...assistant,
      message: {
        ...assistant.message,
        attachments: [{ ...audio, id: "audio-2", name: "reply.wav" }],
      },
    },
  ];
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(
        <MessagesTimeline
          {...buildProps()}
          composerPlanTurnId={plan.turnId}
          timelineEntries={timelineEntries}
        />,
      );
    });
    expect(renderer!.root.findAllByType("audio").map((node) => node.props["aria-label"])).toEqual([
      "voice.wav",
      "reply.wav",
    ]);
    const reasoning = renderer!.root.findByProps({ "data-reasoning-output": "true" });
    expect(reasoning.findAllByType("button")).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "data-turn-plan": "true" })).toHaveLength(0);
    await act(() => {
      __setClientSettingsForTests({
        ...settings,
        showReasoning: false,
      });
      renderer!.update(
        <MessagesTimeline
          {...buildProps()}
          composerPlanTurnId={null}
          timelineEntries={timelineEntries}
        />,
      );
    });
    expect(renderer!.root.findAllByProps({ "data-reasoning-output": "true" })).toHaveLength(0);
    const planNode = renderer!.root.findByProps({ "data-turn-plan": "true" });
    expect(planNode.findAllByType("li")).toHaveLength(0);
    await act(() => planNode.findByType("button").props.onClick());
    expect(planNode.findAllByType("li")).toHaveLength(1);
    expect(renderer!.root.findAllByType("audio")).toHaveLength(2);
  } finally {
    await act(() => renderer?.unmount());
    __setClientSettingsForTests(originalSettings);
    visualPreference.mode = "current";
  }
});

it.each([false, true])(
  "animates only the live assistant and finishes motion on turn completion (characters %s)",
  async (characters) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { __setClientSettingsForTests, getClientSettings } =
      await import("../../hooks/useSettings");
    const originalSettings = getClientSettings();
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      betterT3Device: {
        ...makeBetterT3SettingsV1("existing-install-migration"),
        flags: {
          ...makeBetterT3SettingsV1("existing-install-migration").flags,
          "chat.characterStreamingMotion": characters,
        },
      },
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const currentTurnId = TurnId.make("live-animation");
    const historicalBase = buildAssistantTimelineEntry("Historical text");
    const historical = {
      ...historicalBase,
      id: "historical-animation",
      message: {
        ...historicalBase.message,
        id: MessageId.make("historical-animation"),
        turnId: TurnId.make("historical-turn"),
        streaming: true,
      },
    };
    const liveBase = buildAssistantTimelineEntry("Live text");
    const live = {
      ...liveBase,
      message: {
        ...liveBase.message,
        id: MessageId.make("live-animation"),
        turnId: currentTurnId,
        streaming: true,
      },
    };
    const render = (text: string, isWorking = true) => (
      <MessagesTimeline
        {...buildProps()}
        isWorking={isWorking}
        runningTurnId={isWorking ? currentTurnId : null}
        latestTurn={{
          turnId: currentTurnId,
          state: isWorking ? "running" : "completed",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: isWorking ? null : MESSAGE_CREATED_AT,
        }}
        streamingMotionEnabled
        timelineEntries={[historical, { ...live, message: { ...live.message, text } }]}
      />
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(render("Live text"));
      });
      const views = () =>
        renderer!.root.findAll(
          (node) =>
            node.type === "div" &&
            typeof node.props.className === "string" &&
            node.props.className.startsWith("chat-markdown "),
        );
      expect(views()[0]!.props["data-streaming"]).toBeUndefined();
      expect(views()[1]!.props["data-streaming"]).toBe(characters ? undefined : "");
      expect(views()[1]!.findAllByProps({ "data-stream-character": "" }).length > 0).toBe(
        characters,
      );
      await act(() => {
        renderer!.update(render("Live text appended"));
      });
      expect(views()[0]!.findAllByProps({ "data-stream-character": "" })).toHaveLength(0);
      expect(views()[1]!.findAllByProps({ "data-stream-character": "" }).length > 0).toBe(
        characters,
      );
      await act(() => {
        renderer!.update(render("Live text appended", false));
      });
      for (const view of views()) {
        expect(view.props["data-streaming"]).toBeUndefined();
      }
      expect(views()[1]!.findAllByProps({ "data-stream-character": "" }).length > 0).toBe(
        characters,
      );
      await act(() => vi.advanceTimersByTime(MAX_STREAMING_TEXT_MOTION_REVEAL_MS));
      for (const view of views()) {
        expect(view.findAllByProps({ "data-stream-character": "" })).toHaveLength(0);
      }
    } finally {
      await act(() => renderer?.unmount());
      vi.useRealTimers();
      __setClientSettingsForTests(originalSettings);
    }
  },
);

it("keeps voice-file candidates out of the bubble and preserves them on the clipboard", async () => {
  const { appendVoiceFileContext } = await import("@t3tools/shared/voiceFileContext");
  const prompt = appendVoiceFileContext("Change [index.ts](src/index.ts)", [
    {
      label: "index.ts",
      previewPath: "src/index.ts",
      candidates: [
        { path: "src/index.ts", symbols: [] },
        { path: "other/index.ts", symbols: [] },
      ],
      truncated: false,
    },
  ]);
  const writeText = vi.fn(async (_text: string) => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(
        <MessagesTimeline {...buildProps()} timelineEntries={[buildUserTimelineEntry(prompt)]} />,
      );
    });
    const renderedText = (node: ReactTestInstance | string): string =>
      typeof node === "string" ? node : node.children.map(renderedText).join("");
    const body = renderer!.root.findByProps({ "data-user-message-body": "true" });
    expect(renderedText(body)).toContain("index.ts");
    expect(renderedText(body)).not.toContain("voice_file_context");
    expect(renderedText(body)).not.toContain("other/index.ts");
    const copy = renderer!.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "Copy to clipboard");
    expect(copy).toBeDefined();
    await act(async () => {
      await copy!.props.onClick({
        nativeEvent: new Event("click"),
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(prompt);
  } finally {
    await act(() => renderer?.unmount());
  }
});

it.each(["classic", "current"] as const)(
  "keeps %s reasoning directly visible as traces arrive and update",
  async (mode) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { __setClientSettingsForTests, getClientSettings } =
      await import("../../hooks/useSettings");
    const originalSettings = getClientSettings();
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      showReasoning: true,
      betterT3Device: makeBetterT3SettingsV1("existing-install-migration"),
    });
    visualPreference.mode = mode;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const flushFrames = () =>
      act(() => {
        for (const frame of frames.splice(0)) frame(performance.now());
      });
    const props = {
      ...buildProps(),
      isWorking: true,
      streamingMotionEnabled: true,
      latestTurn: {
        turnId: TurnId.make("reasoning-turn"),
        state: "running" as const,
        startedAt: MESSAGE_CREATED_AT,
        completedAt: null,
      },
    };
    const traces = ["First trace", "Second trace", "Third trace"].map((detail, index) => ({
      kind: "work" as const,
      id: `reasoning-${index}`,
      createdAt: MESSAGE_CREATED_AT,
      entry: {
        id: `reasoning-${index}`,
        createdAt: MESSAGE_CREATED_AT,
        turnId: TurnId.make("reasoning-turn"),
        tone: "thinking" as const,
        label: "Reasoning",
        sourceActivityKind: "reasoning.summary",
        detail,
      },
    }));
    const renderedText = (node: ReactTestInstance | string): string =>
      typeof node === "string" ? node : node.children.map(renderedText).join("");
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <ReasoningTimelineFixture {...props} timelineEntries={traces.slice(0, 1)} />,
        );
      });
      const reasoning = renderer!.root.findByProps({ "data-reasoning-output": "true" });
      await flushFrames();
      expect(reasoning.findAllByProps({ "data-stream-character": "" }).length).toBeGreaterThan(0);
      expect(reasoning.findAllByType("p").map(renderedText)).toEqual(["First trace"]);
      await act(() => {
        renderer!.update(<ReasoningTimelineFixture {...props} timelineEntries={traces} />);
      });
      await flushFrames();
      expect(renderer!.root.findByProps({ "data-reasoning-output": "true" })).toBe(reasoning);
      expect(reasoning.findAllByType("button")).toHaveLength(0);
      expect(reasoning.findAllByType("p").map(renderedText)).toEqual(
        traces.map((trace) => trace.entry.detail),
      );
      const updatedTraces = traces.map((trace, index) =>
        index === 2
          ? { ...trace, entry: { ...trace.entry, detail: "Third trace completed" } }
          : trace,
      );
      await act(() => {
        renderer!.update(<ReasoningTimelineFixture {...props} timelineEntries={updatedTraces} />);
      });
      await flushFrames();
      expect(renderer!.root.findByProps({ "data-reasoning-output": "true" })).toBe(reasoning);
      expect(reasoning.findAllByType("button")).toHaveLength(0);
      expect(reasoning.findAllByType("p").map(renderedText)).toEqual(
        updatedTraces.map((trace) => trace.entry.detail),
      );
      expect(
        reasoning.findAllByProps({ "data-stream-character": "" }).map(renderedText).join(""),
      ).toContain("completed");
      await act(() => {
        renderer!.update(
          <ReasoningTimelineFixture {...props} isWorking={false} timelineEntries={updatedTraces} />,
        );
      });
      await act(() => vi.advanceTimersByTime(MAX_STREAMING_TEXT_MOTION_REVEAL_MS));
      expect(reasoning.findAllByProps({ "data-stream-character": "" })).toHaveLength(0);

      await act(() => {
        __setClientSettingsForTests({
          ...getClientSettings(),
          betterT3Device: {
            ...getClientSettings().betterT3Device,
            flags: {
              ...getClientSettings().betterT3Device.flags,
              "agent.reasoningWorkingOverlay": true,
            },
          },
        });
        renderer!.update(<ReasoningTimelineFixture {...props} timelineEntries={updatedTraces} />);
      });
      expect(renderer!.root.findAllByProps({ "data-reasoning-output": "true" })).toHaveLength(0);
      const { ComposerReasoningScroller } = await import("./ComposerReasoningScroller");
      const { ThreadId } = await import("@t3tools/contracts");
      await act(() =>
        renderer!.update(
          <ReasoningTimelineFixture {...props} timelineEntries={updatedTraces}>
            <ComposerReasoningScroller
              entries={updatedTraces.map(({ entry }) => entry)}
              turnId={TurnId.make("reasoning-turn")}
              threadRef={{
                environmentId: EnvironmentId.make("environment-1"),
                threadId: ThreadId.make("thread-1"),
              }}
              environmentId={EnvironmentId.make("environment-1")}
              cwd={undefined}
            />
          </ReasoningTimelineFixture>,
        ),
      );
      await flushFrames();
      const lyrics = renderer!.root.findByProps({ "data-composer-reasoning": "true" });
      expect(lyrics.findAllByProps({ "data-reasoning-log": "true" }).map(renderedText)).toEqual(
        updatedTraces.map(({ entry }) => entry.detail),
      );
      expect(lyrics.findAllByType("p")).toHaveLength(0);
      expect(lyrics.findAllByProps({ "data-stream-character": "" })).toHaveLength(0);
    } finally {
      await act(() => renderer?.unmount());
      requestFrame.mockRestore();
      vi.useRealTimers();
      __setClientSettingsForTests(originalSettings);
      visualPreference.mode = "current";
    }
  },
);

describe("MessagesTimeline", () => {
  it("renders previous and next controls with the minimap", () => {
    const first = buildUserTimelineEntry("First turn");
    const secondBase = buildUserTimelineEntry("Second turn");
    const second = {
      ...secondBase,
      id: "entry-2",
      message: {
        ...secondBase.message,
        id: MessageId.make("message-2"),
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[first, second]} />,
    );

    expect(markup).toContain('aria-label="Previous turn"');
    expect(markup).toContain('aria-label="Next turn"');
  });

  // Expanding history uses this suite's existing test renderer, deprecated in
  // React 19. Migrate these interaction tests together when a DOM test setup is added.
  it.each([{}, { text: "Text-only answer", file: "Answer with a file" }])(
    "renders attachment-only question history alongside text answers: %j",
    async (answers) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.stubGlobal("requestAnimationFrame", () => 0);
      vi.stubGlobal("cancelAnimationFrame", () => {});
      let renderer: ReactTestRenderer | undefined;
      try {
        await act(() => {
          renderer = create(
            <MessagesTimeline
              {...buildProps()}
              timelineEntries={[
                {
                  id: "answer-entry",
                  kind: "work",
                  createdAt: MESSAGE_CREATED_AT,
                  entry: {
                    id: "answer-work",
                    createdAt: MESSAGE_CREATED_AT,
                    label: "Question answer submitted",
                    tone: "info",
                    questionAnswer: {
                      requestId: ApprovalRequestId.make("question-request"),
                      answers,
                      questionTextById: { file: "Provide a spec", image: "Provide a screenshot" },
                      attachmentsByQuestionId: {
                        file: [
                          {
                            type: "file",
                            id: "spec",
                            name: "spec.txt",
                            mimeType: "text/plain",
                            sizeBytes: 4,
                          },
                        ],
                        image: [
                          {
                            type: "image",
                            id: "shot",
                            name: "shot.png",
                            mimeType: "image/png",
                            sizeBytes: 4,
                          },
                        ],
                      },
                    },
                  },
                },
              ]}
            />,
          );
        });
        const questionToggle = renderer!.root.find(
          (node) =>
            node.props["aria-label"]?.startsWith("Question answer submitted:") &&
            node.props["aria-expanded"] === false,
        );
        expect(questionToggle.props["aria-label"]).toContain(
          Object.values(answers)[0] ?? "spec.txt",
        );
        expect(JSON.stringify(renderer!.toJSON())).not.toContain("Provide a spec");
        await act(() => questionToggle.props.onClick());
        const markup = JSON.stringify(renderer!.toJSON());
        expect(markup.match(/Provide a spec/g)).toHaveLength(1);
        expect(markup).toContain("spec.txt");
        expect(markup).toContain("Provide a screenshot");
        expect(markup).toContain("shot.png");
        for (const answer of Object.values(answers)) expect(markup).toContain(answer);
        await act(() => questionToggle.props.onClick());
        expect(JSON.stringify(renderer!.toJSON())).not.toContain("Provide a spec");
      } finally {
        await act(() => renderer?.unmount());
      }
    },
  );

  it.each([
    { toolLifecycleStatus: "inProgress", isAtEnd: true },
    { toolLifecycleStatus: "inProgress", isAtEnd: false },
    { toolLifecycleStatus: "completed", isAtEnd: true },
    { toolLifecycleStatus: "completed", isAtEnd: false },
  ] as const)(
    "restores the composer after closing $toolLifecycleStatus tool output only at the end: $isAtEnd",
    async ({ toolLifecycleStatus, isAtEnd }) => {
      const frames = new Map<number, FrameRequestCallback>();
      let nextFrame = 0;
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      });
      vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const flushFrame = () =>
        act(() => {
          const callbacks = [...frames.values()];
          frames.clear();
          callbacks.forEach((callback) => callback(0));
        });
      const props = buildProps();
      let timelineIsAtEnd = isAtEnd;
      props.listRef.current = {
        getState: () => ({ isAtEnd: timelineIsAtEnd }),
        getScrollableNode: () => null,
      } as unknown as LegendListRef;
      let isResting = false;
      let composerState: ReturnType<typeof useComposerFocusState> | undefined;
      function ThreadProbe() {
        const composer = useComposerFocusState();
        useLayoutEffect(() => {
          composerState = composer;
          isResting = shouldUseRestingComposerLayout({
            isExistingThread: true,
            isMobileViewport: false,
            isScrollCollapsed: composer.isComposerScrollCollapsed,
            hasExpandedChrome: false,
            hasMultilinePrompt: false,
            timelineOverflows: true,
          });
        });
        return (
          <MessagesTimeline
            {...props}
            isWorking={toolLifecycleStatus === "inProgress"}
            onToolOutputCollapsedAtEnd={composer.restoreAfterTimelineReachedEnd}
            timelineEntries={[
              {
                id: "running-tool",
                kind: "work",
                createdAt: MESSAGE_CREATED_AT,
                entry: {
                  id: "running-tool",
                  createdAt: MESSAGE_CREATED_AT,
                  label: "Run command",
                  tone: "tool",
                  toolLifecycleStatus,
                  detail: "Command output",
                },
              },
            ]}
          />
        );
      }
      let renderer: ReactTestRenderer | undefined;
      try {
        await act(() => {
          renderer = create(<ThreadProbe />);
        });
        // The user scrolled up to read, so the composer is resting.
        await act(() => composerState!.setIsComposerScrollCollapsed(true));
        const toggle = renderer!.root.findByProps({ "aria-expanded": false });
        await act(() => toggle.props.onClick());
        await flushFrame();
        await flushFrame();
        expect(isResting).toBe(true);

        timelineIsAtEnd = false;
        await act(() => toggle.props.onClick());
        await flushFrame();
        timelineIsAtEnd = isAtEnd;
        await flushFrame();
        expect(isResting).toBe(!isAtEnd);
      } finally {
        await act(() => renderer?.unmount());
      }
    },
  );

  it("renders elapsed time for a completed turn", () => {
    const turnId = TurnId.make("turn-with-fold");
    const assistantEntry = buildAssistantTimelineEntry("Done.");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={{
          turnId,
          state: "completed",
          startedAt: "2026-03-17T19:12:20.000Z",
          completedAt: "2026-03-17T19:12:28.000Z",
        }}
        timelineEntries={[
          {
            id: "work-entry-with-fold",
            kind: "work",
            createdAt: "2026-03-17T19:12:22.000Z",
            entry: {
              id: "work-with-fold",
              createdAt: "2026-03-17T19:12:22.000Z",
              turnId,
              label: "Ran command",
              tone: "tool",
              toolLifecycleStatus: "completed",
            },
          },
          {
            ...assistantEntry,
            message: { ...assistantEntry.message, turnId },
          },
        ]}
      />,
    );

    expect(markup).toContain("Worked for 8.0s");
  });

  it("keeps assistant changed-files headers sticky below the thread header", () => {
    const assistantMessageId = MessageId.make("message-assistant-with-files");
    const turnId = TurnId.make("turn-with-files");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={{
          turnId,
          state: "completed",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: MESSAGE_CREATED_AT,
        }}
        timelineEntries={[
          {
            id: "entry-assistant-with-files",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: assistantMessageId,
              role: "assistant",
              text: "Updated the fixture.",
              turnId,
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
        turnDiffSummaries={[
          {
            turnId,
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("checkpoint-with-files"),
            status: "ready",
            files: [{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }],
            assistantMessageId,
            completedAt: MESSAGE_CREATED_AT,
          },
        ]}
      />,
    );

    expect(markup).toContain("sticky top-2 z-10");
    expect(markup).not.toContain("self-start");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("size-3");
    expect(markup).not.toContain('aria-label="Collapse all folders"');
    expect(markup).toContain('aria-label="Open diff"');
    expect(markup).toContain("1 changed file");
  });

  it("treats only the strict list end as the live edge", async () => {
    const {
      resolveTimelineIsAtEnd,
      resolveTimelineMinimapHasPersistentGutter,
      resolveTimelineMinimapCurrentIndex,
      resolveTimelineMinimapHeightStyle,
      resolveTimelineMinimapHitStripWidth,
      resolveTimelineMinimapIndexFromPointer,
      resolveTimelineMinimapInteractiveWidth,
      resolveTimelineMinimapNavigationInteractive,
      resolveTimelineMinimapTopPercent,
    } = await import("./MessagesTimeline.logic");

    expect(resolveTimelineIsAtEnd({ isAtEnd: true })).toBe(true);
    expect(resolveTimelineIsAtEnd(undefined)).toBeUndefined();
    // Within the pixel band above the content bottom counts as the end...
    expect(
      resolveTimelineIsAtEnd({
        isAtEnd: false,
        contentLength: 2000,
        scroll: 1170,
        scrollLength: 800,
      }),
    ).toBe(true);
    // ...but half a viewport up (LegendList's isNearEnd territory) does not.
    expect(
      resolveTimelineIsAtEnd({
        isAtEnd: false,
        contentLength: 2000,
        scroll: 900,
        scrollLength: 800,
      }),
    ).toBe(false);
    // LegendList's isAtEnd is true anywhere within the composer-height band
    // (it subtracts the inset); the last row is still hidden under the
    // composer there, so the flag must not short-circuit the geometry.
    expect(
      resolveTimelineIsAtEnd({
        isAtEnd: true,
        contentLength: 2000,
        scroll: 1100,
        scrollLength: 800,
      }),
    ).toBe(false);
    // Geometry missing (older state shape): fall back to the strict flag.
    expect(resolveTimelineIsAtEnd({ isAtEnd: false })).toBe(false);

    expect(resolveTimelineMinimapHeightStyle(5)).toBe("min(32px, calc(100vh - 18rem))");
    expect(resolveTimelineMinimapTopPercent(2, 5)).toBe(50);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 101,
        railTop: 100,
        railHeight: 500,
        pointerY: 350,
      }),
    ).toBe(50);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 101,
        railTop: 100,
        railHeight: 500,
        pointerY: 999,
      }),
    ).toBe(100);
    expect(
      resolveTimelineMinimapCurrentIndex({
        scrollTop: 100,
        scrollBottom: 500,
        itemBounds: [
          { top: 80, height: 20 },
          { top: 120, height: 20 },
          { top: 220, height: 20 },
        ],
      }),
    ).toBe(1);
    expect(
      resolveTimelineMinimapCurrentIndex({
        scrollTop: 150,
        scrollBottom: 200,
        itemBounds: [
          { top: 80, height: 20 },
          { top: 120, height: 20 },
          { top: 220, height: 20 },
        ],
      }),
    ).toBe(1);
    expect(
      resolveTimelineMinimapCurrentIndex({
        scrollTop: 0,
        scrollBottom: 50,
        itemBounds: [{ top: 80, height: 20 }],
      }),
    ).toBeNull();
    // Comfortable width: the column is capped at 768px.
    expect(resolveTimelineMinimapHasPersistentGutter(832, 768)).toBe(false);
    expect(resolveTimelineMinimapHasPersistentGutter(863, 768)).toBe(false);
    expect(resolveTimelineMinimapHasPersistentGutter(864, 768)).toBe(true);
    // Wider Chat width settings consume the gutter the minimap relies on.
    expect(resolveTimelineMinimapHasPersistentGutter(1400, 1152)).toBe(true);
    expect(resolveTimelineMinimapHasPersistentGutter(1200, 1152)).toBe(false);
    expect(resolveTimelineMinimapHasPersistentGutter(2560, 2560)).toBe(false);

    // No usable gutter (zoomed in / narrow pane): the strip must go inert
    // instead of overlaying the centered content column.
    expect(resolveTimelineMinimapHitStripWidth(768, 768)).toBe(0);
    expect(resolveTimelineMinimapHitStripWidth(792, 768)).toBe(0);
    // Partial gutter: strip shrinks to what fits between the viewport edge
    // and the content column.
    expect(resolveTimelineMinimapHitStripWidth(820, 768)).toBe(14);
    // Full gutter: unchanged 40px-wide strip.
    expect(resolveTimelineMinimapHitStripWidth(872, 768)).toBe(40);
    expect(resolveTimelineMinimapHitStripWidth(1400, 768)).toBe(40);
    // Full Chat width: the column spans the viewport, so the strip is inert
    // however wide the window gets.
    expect(resolveTimelineMinimapHitStripWidth(2560, 2560)).toBe(0);
    // Wide Chat width on a window just wider than the column: partial strip.
    expect(resolveTimelineMinimapHitStripWidth(1204, 1152)).toBe(14);
    expect(resolveTimelineMinimapHitStripWidth(0, 0)).toBe(0);
    expect(resolveTimelineMinimapHitStripWidth(Number.NaN, 768)).toBe(0);

    // Prev/next buttons reach 14px past the strip's left edge; a narrower
    // strip means they would sit on the content column.
    expect(resolveTimelineMinimapNavigationInteractive(40)).toBe(true);
    expect(resolveTimelineMinimapNavigationInteractive(14)).toBe(true);
    expect(resolveTimelineMinimapNavigationInteractive(8)).toBe(false);
    expect(resolveTimelineMinimapNavigationInteractive(0)).toBe(false);

    // The collapsed target stays narrow, but an open preview keeps its full
    // 20rem width plus the 2rem offset from the minimap rail interactive.
    expect(resolveTimelineMinimapInteractiveWidth(0, false)).toBe(0);
    expect(resolveTimelineMinimapInteractiveWidth(14, false)).toBe(14);
    expect(resolveTimelineMinimapInteractiveWidth(40, false)).toBe(40);
    expect(resolveTimelineMinimapInteractiveWidth(0, true)).toBe("22rem");
    expect(resolveTimelineMinimapInteractiveWidth(14, true)).toBe("22rem");
    expect(resolveTimelineMinimapInteractiveWidth(40, true)).toBe("22rem");
  });

  it("anchors the first user message using its measured height", () => {
    const onAnchorReady = vi.fn();
    const firstEntry = buildSnapShotTimelineEntry("data:image/png;base64,iVBORw0KGgo=");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        anchorMessageId={firstEntry.message.id}
        onAnchorReady={onAnchorReady}
        contentInsetEndAdjustment={144}
        timelineEntries={[firstEntry]}
      />,
    );

    expect(markup).toContain('data-anchor-index="0"');
    expect(markup).toContain('data-anchor-offset="24"');
    expect(markup).not.toContain("data-anchor-max-size=");
    expect(markup).toContain('data-content-inset-end="144"');
    expect(markup).toContain("[overflow-anchor:none]");
    expect(markup).not.toContain('data-maintain-scroll-at-end="enabled"');
    expect(markup).toContain('data-maintain-visible-content-position="object"');
    expect(markup).toContain('data-maintain-visible-content-position-data="true"');
    expect(markup).toContain('data-maintain-visible-content-position-size="true"');
    expect(markup).toContain('data-maintain-visible-content-position-restore="true"');
    expect(markup).toContain("Terminal");
    expect(markup).toContain("t3code — Tests");
    expect(markup).toContain('src="data:image/png;base64,aWNvbg=="');
    expect(markup).toContain("h-28 w-52 max-w-full");
    expect(onAnchorReady).toHaveBeenCalledOnce();
    expect(onAnchorReady).toHaveBeenCalledWith(firstEntry.message.id, 0);
  });

  it("does not render window details before the preview URL resolves", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[buildSnapShotTimelineEntry()]} />,
    );

    expect(markup).toContain("screenshot.png");
    expect(markup).not.toContain("Terminal");
    expect(markup).not.toContain("t3code — Tests");
    expect(markup).not.toContain('src="data:image/png;base64,aWNvbg=="');
    expect(markup).not.toContain("h-28 w-52 max-w-full");
  });

  it("does not reserve end space for a follow-up user message", () => {
    const onAnchorReady = vi.fn();
    const firstEntry = buildUserTimelineEntry("First prompt.");
    const secondEntry = {
      ...buildUserTimelineEntry("Newest prompt."),
      id: "entry-2",
      message: {
        ...buildUserTimelineEntry("Newest prompt.").message,
        id: MessageId.make("message-2"),
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        anchorMessageId={secondEntry.message.id}
        onAnchorReady={onAnchorReady}
        timelineEntries={[firstEntry, secondEntry]}
      />,
    );

    expect(markup).not.toContain("data-anchor-index=");
    expect(markup).toContain('data-maintain-scroll-at-end="enabled"');
    expect(onAnchorReady).not.toHaveBeenCalled();
  });

  it("gives browser documents separate preview and download controls", () => {
    const entry = {
      ...buildUserTimelineEntry("Read the report."),
      message: {
        ...buildUserTimelineEntry("Read the report.").message,
        attachments: [
          {
            type: "file" as const,
            id: "attachment-report-pdf",
            name: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 42,
            previewUrl: "https://environment.test/api/assets/report.pdf",
          },
        ],
      },
    };

    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[entry]} />,
    );

    expect(markup).toContain('aria-label="Preview report.pdf"');
    expect(markup).toContain('aria-label="Download report.pdf"');
    expect(markup).not.toContain('download="report.pdf"');
    expect(markup).not.toContain('alt="report.pdf"');
  });

  it("renders video attachments with the shared video player", () => {
    const entry = {
      ...buildUserTimelineEntry("Watch the demo."),
      message: {
        ...buildUserTimelineEntry("Watch the demo.").message,
        attachments: [
          {
            type: "file" as const,
            id: "attachment-demo-mp4",
            name: "demo.mp4",
            mimeType: "video/mp4",
            sizeBytes: 42,
            previewUrl: "https://environment.test/api/assets/demo.mp4",
          },
        ],
      },
    };

    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[entry]} />,
    );

    expect(markup).toContain("<video");
    expect(markup).toContain('aria-label="demo.mp4"');
    expect(markup).not.toContain("Expand demo.mp4");
  });

  it("shows the filename while an optimistic video is unavailable", () => {
    const entry = {
      ...buildUserTimelineEntry("Uploading the demo."),
      message: {
        ...buildUserTimelineEntry("Uploading the demo.").message,
        attachments: [
          {
            type: "file" as const,
            id: "optimistic-demo-mp4",
            name: "pending-demo.mp4",
            mimeType: "video/mp4",
            sizeBytes: 42,
            downloadable: false,
          },
        ],
      },
    };

    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[entry]} />,
    );

    expect(markup).not.toContain("<video");
    expect(markup).toContain(">pending-demo.mp4</div>");
  });
  it("renders an ordinary file with preview and download controls without creating its URL in advance", () => {
    const entry = {
      ...buildUserTimelineEntry("Read the report."),
      message: {
        ...buildUserTimelineEntry("Read the report.").message,
        attachments: [
          {
            type: "file" as const,
            id: "attachment-report-pdf",
            name: "archive.zip",
            mimeType: "application/zip",
            sizeBytes: 42,
          },
        ],
      },
    };

    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[entry]} />,
    );

    expect(markup).toContain('aria-label="Preview archive.zip"');
    expect(markup).toContain('aria-label="Download archive.zip"');
    expect(markup).not.toContain("<a href=");
  });

  it("does not download an optimistic file before the server supplies its attachment ID", () => {
    const entry = {
      ...buildUserTimelineEntry("Read the report."),
      message: {
        ...buildUserTimelineEntry("Read the report.").message,
        attachments: [
          {
            type: "file" as const,
            id: "composer-local-report",
            name: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 42,
            downloadable: false,
          },
        ],
      },
    };

    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[entry]} />,
    );

    expect(markup).toContain("report.pdf");
    expect(markup).not.toContain('aria-label="Download report.pdf"');
  });

  it("renders unknown attachment types as inert rows instead of crashing", () => {
    const entry = {
      ...buildUserTimelineEntry("Play the recording."),
      message: {
        ...buildUserTimelineEntry("Play the recording.").message,
        attachments: [
          {
            // A newer server can introduce attachment types this build does
            // not know. They ride the open contract member.
            type: "recording",
            id: "attachment-voice-memo",
            name: "voice-memo.ogg",
            mimeType: "audio/ogg",
            sizeBytes: 42,
          },
        ],
      },
    };

    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[entry]} />,
    );

    expect(markup).toContain("voice-memo.ogg");
    expect(markup).not.toContain('aria-label="Download voice-memo.ogg"');
    expect(markup).not.toContain('alt="voice-memo.ogg"');
    expect(markup).not.toContain("<a href=");
  });

  it("glides to the end while a turn is running and snaps otherwise", () => {
    const entries = [buildUserTimelineEntry("Hello")];
    const working = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} isWorking timelineEntries={entries} />,
    );
    expect(working).toContain('data-maintain-scroll-at-end-animated="true"');

    const idle = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={entries} />,
    );
    expect(idle).toContain('data-maintain-scroll-at-end-animated="false"');
  });

  it("snaps to the end while a thread switch settles, even mid-turn", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const flushFrame = () =>
      act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(0));
      });
    // A work entry renders without the DOM globals that message rows need
    // under react-test-renderer.
    const entries = [
      {
        id: "entry-settle-work",
        kind: "work" as const,
        createdAt: MESSAGE_CREATED_AT,
        entry: {
          id: "work-settle",
          createdAt: MESSAGE_CREATED_AT,
          toolCallId: "call-settle",
          label: "Run lint",
          tone: "tool" as const,
          itemType: "command_execution" as const,
          command: "pnpm lint",
          toolLifecycleStatus: "completed" as const,
        },
      },
    ];
    const animatedAttr = (renderer: ReactTestRenderer) =>
      renderer.root.findByProps({ "data-testid": "legend-list" }).props[
        "data-maintain-scroll-at-end-animated"
      ];
    let renderer!: ReactTestRenderer;
    try {
      act(() => {
        renderer = create(
          <MessagesTimeline
            {...buildProps()}
            isWorking
            routeThreadKey="env-1:thread-a"
            timelineEntries={entries}
          />,
        );
      });
      expect(animatedAttr(renderer)).toBe(true);

      act(() => {
        renderer.update(
          <MessagesTimeline
            {...buildProps()}
            isWorking
            routeThreadKey="env-1:thread-b"
            timelineEntries={entries}
          />,
        );
      });
      expect(animatedAttr(renderer)).toBe(false);

      // Two frames later the switch has settled and gliding resumes.
      flushFrame();
      flushFrame();
      expect(animatedAttr(renderer)).toBe(true);
    } finally {
      act(() => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("keeps reserved end space when tool work starts while reading history", () => {
    const turnId = TurnId.make("turn-with-active-tool");
    const firstEntry = buildUserTimelineEntry("Run the command.");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        latestTurn={{
          turnId,
          state: "running",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: null,
        }}
        runningTurnId={turnId}
        anchorMessageId={firstEntry.message.id}
        liveFollowEnabled={false}
        timelineEntries={[
          firstEntry,
          {
            id: "entry-active-tool",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "work-active-tool",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              toolCallId: "call-active-tool",
              label: "Run command",
              tone: "tool",
              itemType: "command_execution",
              command: "git status",
              toolLifecycleStatus: "inProgress",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-anchor-index="0"');
    expect(markup).not.toContain('data-maintain-scroll-at-end="enabled"');
  });

  it("keeps a completed turn open until the reader returns to the live edge", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const turnId = TurnId.make("turn-read-while-finishing");
    const userEntry = buildUserTimelineEntry("Read file.");
    const workEntry: TimelineEntry = {
      id: "entry-read-file",
      kind: "work",
      createdAt: MESSAGE_CREATED_AT,
      entry: {
        id: "work-read-file",
        turnId,
        createdAt: MESSAGE_CREATED_AT,
        label: "Read file",
        tone: "tool",
        toolCallId: "call-read-file",
        toolLifecycleStatus: "completed",
        sourceActivityKind: "tool.completed",
      },
    };
    const assistant = buildAssistantTimelineEntry("Read complete.");
    const assistantEntry: TimelineEntry = {
      ...assistant,
      id: "entry-assistant-final",
      message: {
        ...assistant.message,
        id: MessageId.make("message-assistant-final"),
        turnId,
        streaming: true,
      },
    };
    const runningTurn = {
      turnId,
      state: "running" as const,
      startedAt: MESSAGE_CREATED_AT,
      completedAt: null,
    };
    const completedTurn = {
      ...runningTurn,
      state: "completed" as const,
      completedAt: MESSAGE_CREATED_AT,
    };
    const props = buildProps();
    const entries = [userEntry, workEntry, assistantEntry];
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <MessagesTimeline
            {...props}
            isWorking
            latestTurn={runningTurn}
            runningTurnId={turnId}
            liveFollowEnabled={false}
            timelineEntries={entries}
          />,
        );
      });
      expect(renderer!.root.findAllByProps({ "data-timeline-row-kind": "turn-fold" })).toHaveLength(
        0,
      );

      const settledEntries = [
        userEntry,
        workEntry,
        { ...assistantEntry, message: { ...assistantEntry.message, streaming: false } },
      ];
      await act(() => {
        renderer!.update(
          <MessagesTimeline
            {...props}
            latestTurn={completedTurn}
            liveFollowEnabled={false}
            timelineEntries={settledEntries}
          />,
        );
      });
      const fold = renderer!.root.findByProps({ "data-timeline-row-kind": "turn-fold" });
      expect(fold.findByType("button").props["aria-expanded"]).toBe(true);

      await act(() => {
        renderer!.update(
          <MessagesTimeline
            {...props}
            latestTurn={completedTurn}
            liveFollowEnabled
            timelineEntries={settledEntries}
          />,
        );
      });
      expect(
        renderer!.root.findByProps({ "data-timeline-row-kind": "turn-fold" }).findByType("button")
          .props["aria-expanded"],
      ).toBe(false);

      await act(() => {
        renderer!.root
          .findByProps({ "data-timeline-row-kind": "turn-fold" })
          .findByType("button")
          .props.onClick();
      });
      await act(() => {
        renderer!.update(
          <MessagesTimeline
            {...props}
            latestTurn={{ ...runningTurn, turnId: TurnId.make("next-turn") }}
            liveFollowEnabled={false}
            timelineEntries={settledEntries}
          />,
        );
      });
      expect(
        renderer!.root.findByProps({ "data-timeline-row-kind": "turn-fold" }).findByType("button")
          .props["aria-expanded"],
      ).toBe(true);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  it("hands end-following back to the list once the send anchor is released", () => {
    const firstEntry = buildUserTimelineEntry("First prompt.");
    const secondEntry = {
      ...buildUserTimelineEntry("Newest prompt."),
      id: "entry-2",
      message: {
        ...buildUserTimelineEntry("Newest prompt.").message,
        id: MessageId.make("message-2"),
      },
    };
    const timelineEntries = [firstEntry, secondEntry];

    // While the send anchor holds the end space open, ChatView owns streaming
    // scrolls and LegendList must not re-pin behind it.
    expect(
      renderToStaticMarkup(
        <MessagesTimeline
          {...buildProps()}
          anchorMessageId={firstEntry.message.id}
          timelineEntries={timelineEntries}
        />,
      ),
    ).not.toContain('data-maintain-scroll-at-end="enabled"');

    // Dropping the anchor is what actually gives end-following back, so
    // returning to the live edge has to release it — re-enabling live follow
    // alone leaves nothing pinned to the stream.
    expect(
      renderToStaticMarkup(
        <MessagesTimeline
          {...buildProps()}
          anchorMessageId={null}
          timelineEntries={timelineEntries}
        />,
      ),
    ).toContain('data-maintain-scroll-at-end="enabled"');

    // Reading history still wins over both.
    expect(
      renderToStaticMarkup(
        <MessagesTimeline
          {...buildProps()}
          anchorMessageId={null}
          liveFollowEnabled={false}
          timelineEntries={timelineEntries}
        />,
      ),
    ).not.toContain('data-maintain-scroll-at-end="enabled"');
  });

  it("renders collapse controls for long user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    expect(markup).toContain("Show full message");
    expect(markup).toContain('data-maintain-scroll-at-end="enabled"');
    expect(markup).toContain('data-maintain-scroll-at-end-animated="false"');
    expect(markup).toContain('data-maintain-scroll-at-end-data-change="true"');
    expect(markup).toContain('data-maintain-scroll-at-end-footer-layout="true"');
    expect(markup).toContain('data-maintain-scroll-at-end-item-layout="true"');
    expect(markup).toContain('data-maintain-scroll-at-end-layout="true"');
    expect(markup).toContain('data-user-message-collapsed="true"');
    expect(markup).toContain('data-user-message-fade="true"');
    expect(markup).toContain('data-user-message-footer="true"');
  });

  it("does not render collapse controls for short user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry("Short prompt.")]}
      />,
    );

    expect(markup).not.toContain("Show full message");
    expect(markup).toContain('data-user-message-collapsible="false"');
    expect(markup).toContain("rounded-2xl bg-message p-3");
  });

  it("preserves arbitrary XML-like tags and comparisons in rendered user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              'Without reading a file, do you have <global-agent-instructions scope="workspace">',
              'Before <nested data-value="a&b">inside</nested> after',
              "</global-agent-instructions> in your context?",
              "Comparison: 2 < 3 and 5 > 4.",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain("&lt;global-agent-instructions scope=&quot;workspace&quot;&gt;");
    expect(markup).toContain(
      "Before &lt;nested data-value=&quot;a&amp;b&quot;&gt;inside&lt;/nested&gt; after",
    );
    expect(markup).toContain("&lt;/global-agent-instructions&gt; in your context?");
    expect(markup).toContain("Comparison: 2 &lt; 3 and 5 &gt; 4.");
  });

  it("preserves XML-like source inside user code spans and fences", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              'Inline `<tag attr="x">`',
              "",
              "```xml",
              '<root><child enabled="true" /></root>',
              "```",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain('<code data-inline-code="">&lt;tag attr=&quot;x&quot;&gt;</code>');
    expect(markup).toContain("&lt;root&gt;&lt;child enabled=&quot;true&quot; /&gt;&lt;/root&gt;");
  });

  it("does not render markdown title attributes in user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            '[link](https://example.com "link tip") ![image](https://example.com/image.png "image tip")',
          ),
        ]}
      />,
    );

    expect(markup).toContain('href="https://example.com"');
    expect(markup).toContain('src="https://example.com/image.png"');
    expect(markup).not.toContain('title="link tip"');
    expect(markup).not.toContain('title="image tip"');
  });

  it("renders unsafe user HTML as inert source text", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            '<script>globalThis.__t3Xss = 1</script><img src="x" onerror="globalThis.__t3Xss = 2">',
          ),
        ]}
      />,
    );

    expect(markup).toContain("&lt;script&gt;globalThis.__t3Xss = 1&lt;/script&gt;");
    expect(markup).toContain(
      "&lt;img src=&quot;x&quot; onerror=&quot;globalThis.__t3Xss = 2&quot;&gt;",
    );
    expect(markup).not.toMatch(/<script(?:\s|>)/i);
    expect(markup).not.toMatch(/<img(?:\s|>)/i);
  });

  it("continues to render sanitized raw HTML in assistant messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildAssistantTimelineEntry("<details><summary>More</summary>Details</details>"),
        ]}
      />,
    );

    expect(markup).toContain('data-markdown-details=""');
    expect(markup).toContain("More");
    expect(markup).not.toContain("&lt;details&gt;");
  });

  it("sanitizes executable HTML while preserving supported assistant markup", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildAssistantTimelineEntry(
            [
              '<details open onclick="globalThis.__t3Xss = 1">',
              "<summary>Safe details</summary>",
              "<script>globalThis.__t3Xss = 2</script>",
              '<img src="x" onerror="globalThis.__t3Xss = 3">',
              '<a href="javascript:globalThis.__t3Xss = 4">Unsafe link</a>',
              "</details>",
            ].join(""),
          ),
        ]}
      />,
    );

    expect(markup).toContain('data-markdown-details=""');
    expect(markup).toContain("Safe details");
    expect(markup).not.toMatch(/<script(?:\s|>)/i);
    expect(markup).not.toContain("onclick=");
    expect(markup).not.toContain("onerror=");
    expect(markup).not.toContain("javascript:");
    expect(markup).not.toContain("globalThis.__t3Xss");
  });

  it("renders inline terminal labels with the composer chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              buildLongUserMessageText("yoo what's @terminal-1:1-5 mean"),
              "",
              "<terminal_context>",
              "- Terminal 1 lines 1-5:",
              "  1 | julius@mac effect-http-ws-cli % bun i",
              "  2 | bun install v1.3.9 (cf6cdbbb)",
              "</terminal_context>",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s");
    expect(markup).not.toContain("terminal_context");
    expect(markup).toContain("Show full message");
  }, 20_000);

  it("renders chips for standalone element-pick context messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              "<element_context>",
              "- <SubmitButton> (Button.tsx:12):",
              "  url: https://example.com/dashboard",
              "  selector: button.submit",
              "  source: /repo/src/Button.tsx:12:5",
              "  html:",
              '  <button class="submit">Save</button>',
              "</element_context>",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain("SubmitButton");
    expect(markup).not.toContain("&lt;element_context");
    expect(markup).not.toContain("<element_context");
  });

  it("keeps the copy button for collapsed long user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    expect(markup).toContain('aria-label="Copy to clipboard"');
    expect(markup).toContain('data-user-message-collapsed="true"');
    expect(markup).toContain('data-user-message-footer="true"');
  });

  it("renders context compaction entries in the normal work log", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Compacted context 899K → 19K tokens",
              tone: "info",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Compacted context 899K → 19K tokens");
  });

  it("summarizes changed files in one line", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Updated files",
              tone: "tool",
              changedFiles: ["C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts"],
            },
          },
        ]}
        workspaceRoot="C:/Users/mike/dev-stuff/t3code"
      />,
    );

    expect(markup).toContain("Changed 1 file");
    expect(markup).not.toContain("C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts");
  });

  it("keeps mixed-success tool groups neutral", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-failed",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-failed",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Run search",
              tone: "tool",
              itemType: "command_execution",
              toolLifecycleStatus: "failed",
            },
          },
          {
            id: "entry-completed",
            kind: "work",
            createdAt: "2026-03-17T19:12:29.000Z",
            entry: {
              id: "work-completed",
              createdAt: "2026-03-17T19:12:29.000Z",
              label: "Run tests",
              tone: "tool",
              itemType: "command_execution",
              toolLifecycleStatus: "completed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Ran 2 commands");
    expect(markup).not.toContain('aria-label="Tool call failed"');
  });

  it("keeps the collapsed summary icon neutral when the group ends in a failure", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-completed",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-completed",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Run tests",
              tone: "tool",
              itemType: "command_execution",
              toolLifecycleStatus: "completed",
            },
          },
          {
            id: "entry-failed",
            kind: "work",
            createdAt: "2026-03-17T19:12:29.000Z",
            entry: {
              id: "work-failed",
              createdAt: "2026-03-17T19:12:29.000Z",
              label: "Run lint",
              tone: "tool",
              itemType: "command_execution",
              toolLifecycleStatus: "failed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Ran 2 commands");
    expect(markup).toContain("lucide-terminal");
    expect(markup).not.toContain("lucide-x");
    expect(markup).not.toContain("text-destructive");
    // The failure stays discoverable for screen readers.
    expect(markup).toContain("tool call failed");
  });

  it("renders trailing tool calls as part of the terminal assistant block", () => {
    const turnId = TurnId.make("turn-trailing-tools");
    const assistantMessageId = MessageId.make("assistant-trailing-tools");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={{
          turnId,
          state: "error",
          startedAt: "2026-03-17T19:12:20.000Z",
          completedAt: "2026-03-17T19:12:30.000Z",
        }}
        timelineEntries={[
          {
            id: "assistant-entry",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: assistantMessageId,
              role: "assistant",
              text: "I’ll search for it now.",
              turnId,
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: "2026-03-17T19:12:29.000Z",
              streaming: false,
            },
          },
          {
            id: "trailing-work-entry",
            kind: "work",
            createdAt: "2026-03-17T19:12:30.000Z",
            entry: {
              id: "trailing-work",
              createdAt: "2026-03-17T19:12:30.000Z",
              turnId,
              label: "Ran command",
              tone: "tool",
              itemType: "command_execution",
              toolLifecycleStatus: "failed",
            },
          },
        ]}
      />,
    );

    const messageIndex = markup.indexOf('data-timeline-row-id="assistant-entry"');
    const toolIndex = markup.indexOf('data-timeline-row-id="trailing-work-entry"');
    const metaIndex = markup.indexOf(
      'data-timeline-row-id="assistant-meta:assistant-trailing-tools"',
    );
    expect(messageIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(messageIndex);
    expect(metaIndex).toBeGreaterThan(toolIndex);
    expect(markup.match(/I’ll search for it now\./gu)).toHaveLength(1);
  });

  it("keeps mixed work logs neutral after a later tool call succeeds", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-failed",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-failed",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Run search",
              tone: "tool",
              itemType: "command_execution",
              toolLifecycleStatus: "failed",
            },
          },
          {
            id: "entry-info",
            kind: "work",
            createdAt: "2026-03-17T19:12:29.000Z",
            entry: {
              id: "work-info",
              createdAt: "2026-03-17T19:12:29.000Z",
              label: "Status updated",
              tone: "info",
            },
          },
          {
            id: "entry-completed",
            kind: "work",
            createdAt: "2026-03-17T19:12:30.000Z",
            entry: {
              id: "work-completed",
              createdAt: "2026-03-17T19:12:30.000Z",
              label: "Run tests",
              tone: "tool",
              itemType: "command_execution",
              toolLifecycleStatus: "completed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Ran 2 commands and received 1 update");
    expect(markup).not.toContain('aria-label="Hidden work includes a failure"');
  });

  it.each(["detail", "label", "command"] as const)(
    "keeps Better T3 expanded %s content in the details instead of the pill header",
    async (contentSource) => {
      visualPreference.mode = "better-t3";
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.stubGlobal("requestAnimationFrame", () => 0);
      vi.stubGlobal("cancelAnimationFrame", () => {});
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      const title =
        contentSource === "command"
          ? "echo first"
          : "ProviderAdapterSessionClosedError: adapter thread is closed";
      const fullText = [
        title,
        ...Array.from({ length: 60 }, (_, index) =>
          contentSource === "command"
            ? `echo line ${index}`
            : `    at sendTurn (/workspace/server.ts:${index + 1}:1)`,
        ),
      ].join("\n");
      const entry: TimelineEntry = {
        id: "expanded-status",
        kind: "work",
        createdAt: MESSAGE_CREATED_AT,
        entry: {
          id: "expanded-status",
          createdAt: MESSAGE_CREATED_AT,
          tone: contentSource === "command" ? "tool" : "error",
          label: contentSource === "label" ? fullText : title,
          ...(contentSource === "detail" ? { detail: fullText } : {}),
          ...(contentSource === "command" ? { command: fullText } : {}),
        },
      };
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(() =>
          root.render(<MessagesTimeline {...buildProps()} timelineEntries={[entry]} />),
        );
        const row = container.querySelector("[data-timeline-row-id='expanded-status']")!;
        const toggle = row.querySelector<HTMLElement>("[role='button']")!;
        const header = row.querySelector("[data-presentation-status] p")!;
        expect(header.textContent).toBe(title);
        expect(row.querySelector("pre")).toBeNull();

        await act(() => toggle.click());
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(header.textContent).toBe(title);
        const output = row.querySelector("pre")!;
        expect(output.textContent).toBe(fullText);

        await act(() => output.dispatchEvent(new MouseEvent("click", { bubbles: true })));
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        await act(() =>
          toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
        );
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        await act(() => toggle.click());
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(row.querySelector("pre")?.textContent).toBe(fullText);
      } finally {
        await act(() => root.unmount());
        container.remove();
        visualPreference.mode = "current";
        vi.unstubAllGlobals();
      }
    },
  );

  it("keeps classic shell commands compact until expanded", async () => {
    const command = "/bin/zsh -lc 'vp test run apps/web/src/session-logic.test.ts'";
    visualPreference.mode = "classic";
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <MessagesTimeline
            {...buildProps()}
            timelineEntries={[
              {
                id: "entry-command",
                kind: "work",
                createdAt: MESSAGE_CREATED_AT,
                entry: {
                  id: "work-command",
                  createdAt: MESSAGE_CREATED_AT,
                  label: "Ran command",
                  tone: "tool",
                  itemType: "command_execution",
                  command,
                  toolLifecycleStatus: "completed",
                },
              },
            ]}
          />,
        );
      });

      const row = renderer!.root.findByProps({ "aria-label": "Ran vp" });
      expect(row.props["aria-expanded"]).toBe(false);
      expect(row.findAllByType("pre")).toHaveLength(0);

      await act(() => row.props.onClick());
      expect(renderer!.root.findByType("pre").children.join("")).toBe(command);
    } finally {
      await act(() => renderer?.unmount());
      visualPreference.mode = "current";
    }
  });

  it("shows the one-line label for a live tool group", () => {
    const turnId = TurnId.make("turn-live");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        latestTurn={{
          turnId,
          state: "running",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: null,
        }}
        runningTurnId={turnId}
        timelineEntries={[
          {
            id: "entry-live",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "work-live",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              toolCallId: "call-live",
              label: "Run tests",
              tone: "tool",
              itemType: "command_execution",
              command: "pnpm test",
              toolLifecycleStatus: "inProgress",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Working for");
    expect(markup).toContain("Running pnpm");
  });

  it("scopes a live row failure to the tool named by the row", () => {
    const turnId = TurnId.make("turn-live");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        latestTurn={{
          turnId,
          state: "running",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: null,
        }}
        runningTurnId={turnId}
        timelineEntries={[
          {
            id: "entry-failed",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "work-failed",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              toolCallId: "call-failed",
              label: "Run lint",
              tone: "tool",
              itemType: "command_execution",
              command: "pnpm lint",
              toolLifecycleStatus: "failed",
            },
          },
          {
            id: "entry-running",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "work-running",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              toolCallId: "call-running",
              label: "Run tests",
              tone: "tool",
              itemType: "command_execution",
              command: "pnpm test",
              toolLifecycleStatus: "inProgress",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Running pnpm");
    expect(markup).not.toContain("tool call failed");
  });

  it("keeps canonical thinking fully visible through completion and display-mode changes", async () => {
    const { __setClientSettingsForTests, getClientSettings } =
      await import("../../hooks/useSettings");
    const originalSettings = getClientSettings();
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      showReasoning: true,
      betterT3Device: makeBetterT3SettingsV1("existing-install-migration"),
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const turnId = TurnId.make("canonical-thinking");
    const entries = ["**First thought**", "Second thought"].map((text, index) => {
      const entry = buildAssistantTimelineEntry(text);
      return {
        ...entry,
        id: `canonical-thinking-${index}`,
        message: {
          ...entry.message,
          id: MessageId.make(`canonical-thinking-${index}`),
          role: "reasoning" as const,
          turnId,
          streaming: index === 1,
        },
      };
    });
    const render = (isWorking: boolean) => (
      <ReasoningTimelineFixture
        {...buildProps()}
        isWorking={isWorking}
        runningTurnId={isWorking ? turnId : null}
        timelineEntries={entries}
      />
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(render(true));
      });
      const traces = () => renderer!.root.findAllByProps({ "data-reasoning-output": "true" });
      expect(traces()).toHaveLength(2);
      const firstTrace = traces()[0]!;
      expect(firstTrace.findAllByType("strong")).toHaveLength(1);
      expect(traces().flatMap((trace) => trace.findAllByType("button"))).toHaveLength(0);
      await act(() => {
        renderer!.update(render(false));
      });
      expect(traces()[0]).toBe(firstTrace);
      expect(traces()).toHaveLength(2);
      for (const mode of ["none", "working-dialog"] as const) {
        await act(() => {
          __setClientSettingsForTests({
            ...getClientSettings(),
            showReasoning: mode !== "none",
            betterT3Device: {
              ...getClientSettings().betterT3Device,
              flags: {
                ...getClientSettings().betterT3Device.flags,
                "agent.reasoningWorkingOverlay": mode === "working-dialog",
              },
            },
          });
          renderer!.update(render(false));
        });
        expect(traces()).toHaveLength(0);
      }
      await act(() => {
        __setClientSettingsForTests({
          ...getClientSettings(),
          showReasoning: true,
          betterT3Device: makeBetterT3SettingsV1("existing-install-migration"),
        });
        renderer!.update(render(false));
      });
      expect(traces()).toHaveLength(2);
      expect(traces()[0]!.findAllByType("strong")).toHaveLength(1);
    } finally {
      await act(() => renderer?.unmount());
      __setClientSettingsForTests(originalSettings);
    }
  });

  it.each(CHAT_VISUAL_MODES)(
    "keeps combined thinking in the latest response and updates it while streaming in %s",
    async (mode) => {
      const { __setClientSettingsForTests, getClientSettings } =
        await import("../../hooks/useSettings");
      const originalSettings = getClientSettings();
      const setDisplay = (display: "message" | "chat" | "none") =>
        __setClientSettingsForTests({
          ...DEFAULT_CLIENT_SETTINGS,
          showReasoning: display !== "none",
          betterT3Device: {
            ...makeBetterT3SettingsV1("existing-install-migration"),
            flags: {
              "agent.reasoningWorkingOverlay": false,
              "agent.reasoningInMessage": display === "message",
            },
          },
        });
      setDisplay("message");
      visualPreference.mode = mode;
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.stubGlobal("requestAnimationFrame", () => 0);
      vi.stubGlobal("cancelAnimationFrame", () => {});
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const turnId = TurnId.make("message-reasoning");
      const thought = (id: string, text: string) => {
        const base = buildAssistantTimelineEntry(text);
        return {
          ...base,
          id,
          message: {
            ...base.message,
            id: MessageId.make(id),
            role: "reasoning" as const,
            turnId,
            streaming: true,
          },
        };
      };
      const response = (id: string, text: string) => {
        const base = buildAssistantTimelineEntry(text);
        return { ...base, id, message: { ...base.message, id: MessageId.make(id), turnId } };
      };
      let entries: TimelineEntry[] = [
        buildUserTimelineEntry("First request"),
        thought("first-thought", "First reasoning paragraph"),
      ];
      const render = () => (
        <ReasoningTimelineFixture
          {...buildProps()}
          isWorking
          runningTurnId={turnId}
          timelineEntries={[...entries]}
        />
      );
      const disclosures = () => container.querySelectorAll(".better-chat-reasoning");
      try {
        await act(() => root.render(render()));
        expect(disclosures()).toHaveLength(1);
        expect(container.querySelector("[data-message-reasoning]")).toBeNull();
        await act(() => disclosures()[0]!.querySelector<HTMLButtonElement>("button")!.click());
        expect(container.textContent).toContain("First reasoning paragraph");

        entries.push(response("progress-response", "Checking the implementation."));
        await act(() => root.render(render()));
        expect(disclosures()).toHaveLength(1);
        expect(
          container.querySelector(
            "[data-timeline-row-id='progress-response'] [data-message-reasoning]",
          )?.textContent,
        ).toContain("First reasoning paragraph");

        entries.push(
          {
            id: "separate-tool",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "separate-tool",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              tone: "tool",
              label: "Read source",
              command: "cat source.ts",
              detail: "Tool output stays separate",
            },
          },
          {
            id: "legacy-thought",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "legacy-thought",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              tone: "thinking",
              sourceActivityKind: "reasoning.summary",
              label: "Thinking",
              detail: "Legacy reasoning paragraph",
            },
          },
          thought("streaming-thought", "New reasoning"),
          response("final-response", "Completed response"),
        );
        await act(() => root.render(render()));
        expect(disclosures()).toHaveLength(1);
        const finalRow = container.querySelector("[data-timeline-row-id='final-response']")!;
        const embedded = finalRow.querySelector("[data-message-reasoning]")!;
        expect(embedded.textContent).toContain("First reasoning paragraph");
        expect(embedded.textContent).toContain("Legacy reasoning paragraph");
        expect(embedded.textContent).toContain("New reasoning");
        expect(embedded.textContent).not.toContain("Tool output stays separate");
        expect(
          container.querySelector(
            "[data-timeline-row-id='progress-response'] [data-message-reasoning]",
          ),
        ).toBeNull();

        entries = entries.map((entry) =>
          entry.kind === "message" && entry.id === "streaming-thought"
            ? {
                ...entry,
                message: { ...entry.message, text: "New reasoning with a streamed ending" },
              }
            : entry,
        );
        await act(() => root.render(render()));
        expect(finalRow.querySelector("[data-message-reasoning]")).toBe(embedded);
        expect(embedded.textContent).toContain("New reasoning with a streamed ending");
        expect(embedded.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");

        const secondUser = buildUserTimelineEntry("Second request");
        entries.push(
          {
            ...secondUser,
            id: "second-user",
            message: { ...secondUser.message, id: MessageId.make("second-user") },
          },
          thought("second-request-thought", "Separate request reasoning"),
        );
        await act(() => root.render(render()));
        expect(disclosures()).toHaveLength(2);
        expect(embedded.textContent).not.toContain("Separate request reasoning");

        setDisplay("chat");
        await act(() => root.render(render()));
        expect(container.querySelector("[data-message-reasoning]")).toBeNull();
        expect(container.textContent).toContain("First reasoning paragraph");
        setDisplay("none");
        await act(() => root.render(render()));
        expect(disclosures()).toHaveLength(0);
        expect(container.textContent).not.toContain("First reasoning paragraph");
        expect(container.textContent).not.toContain("Legacy reasoning paragraph");
        setDisplay("message");
        await act(() => root.render(render()));
        expect(container.querySelector("[data-message-reasoning]")?.textContent).toContain(
          "New reasoning with a streamed ending",
        );
        expect(disclosures()).toHaveLength(2);
      } finally {
        await act(() => root.unmount());
        container.remove();
        __setClientSettingsForTests(originalSettings);
        visualPreference.mode = "current";
        vi.unstubAllGlobals();
      }
    },
  );

  it.each(["classic", "current"] as const)(
    "opens full Working thinking in the real dialog and retains it at completion in the %s layout",
    async (mode) => {
      const { __setClientSettingsForTests, getClientSettings } =
        await import("../../hooks/useSettings");
      const originalSettings = getClientSettings();
      __setClientSettingsForTests({
        ...DEFAULT_CLIENT_SETTINGS,
        showReasoning: true,
        betterT3Device: {
          ...makeBetterT3SettingsV1("existing-install-migration"),
          flags: { "agent.reasoningWorkingOverlay": true },
        },
      });
      visualPreference.mode = mode;
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.stubGlobal("requestAnimationFrame", () => 0);
      vi.stubGlobal("cancelAnimationFrame", () => {});
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const turnId = TurnId.make("working-dialog-dom");
      const base = buildAssistantTimelineEntry(
        "## Inspecting the change\n\nDetailed Thinking body\nSecond line",
      );
      const entry = {
        ...base,
        id: "working-dialog-dom",
        message: {
          ...base.message,
          id: MessageId.make("working-dialog-dom"),
          role: "reasoning" as const,
          turnId,
          streaming: true,
        },
      };
      const render = (message = entry.message, isWorking = true) => (
        <ReasoningTimelineFixture
          {...buildProps()}
          isWorking={isWorking}
          runningTurnId={isWorking ? turnId : null}
          streamingMotionEnabled={false}
          timelineEntries={[{ ...entry, message }]}
        />
      );
      try {
        await act(() => root.render(render()));
        const trigger = container.querySelector<HTMLButtonElement>("button[data-reasoning-log]");
        expect(trigger?.textContent).toBe("Inspecting the change");
        expect(container.textContent).not.toContain("Detailed Thinking body");
        expect(container.querySelector("[data-reasoning-output]")).toBeNull();
        expect(document.querySelector("[data-working-reasoning-content]")).toBeNull();
        await act(() => trigger!.click());
        const dialog = document.querySelector('[role="dialog"]');
        const content = dialog?.querySelector("[data-working-reasoning-content]");
        expect(content?.textContent).toContain("Detailed Thinking body");
        expect(content?.textContent).toContain("Second line");
        expect(content?.querySelector("[data-streaming]")).not.toBeNull();
        const completed = {
          ...entry.message,
          text: `${entry.message.text}\nFinal retained line`,
          streaming: false,
        };
        await act(() => root.render(render(completed, false)));
        expect(document.querySelector("[data-working-reasoning-content]")).toBe(content);
        expect(content?.textContent).toContain("Final retained line");
        expect(content?.querySelector("[data-streaming]")).toBeNull();
        await act(() => {
          __setClientSettingsForTests({ ...getClientSettings(), showReasoning: false });
          root.render(render(completed, false));
        });
        expect(document.querySelector("[data-working-reasoning-content]")).toBeNull();
        expect(entry.message.text).toBe(
          "## Inspecting the change\n\nDetailed Thinking body\nSecond line",
        );
      } finally {
        await act(() => root.unmount());
        container.remove();
        __setClientSettingsForTests(originalSettings);
        visualPreference.mode = "current";
      }
    },
  );

  it("keeps classic tool details and the Working dialog usable across layout changes", async () => {
    const { __setClientSettingsForTests, getClientSettings } =
      await import("../../hooks/useSettings");
    const originalSettings = getClientSettings();
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      showReasoning: true,
      betterT3Device: {
        ...makeBetterT3SettingsV1("existing-install-migration"),
        flags: { "agent.reasoningWorkingOverlay": true },
      },
    });
    visualPreference.mode = "classic";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const turnId = TurnId.make("classic-working-details");
    const thought = buildAssistantTimelineEntry(
      "**Inspecting files**\n\nFull Working trace remains available",
    );
    const timelineEntries: TimelineEntry[] = [
      {
        ...thought,
        message: { ...thought.message, role: "reasoning", turnId },
      },
      ...[1, 2].map((index) => ({
        kind: "work" as const,
        id: `working-tool-${index}`,
        createdAt: `2026-03-17T19:12:3${index}.000Z`,
        entry: {
          id: `working-tool-${index}`,
          turnId,
          createdAt: `2026-03-17T19:12:3${index}.000Z`,
          label: `Read file ${index}`,
          tone: "tool" as const,
          toolLifecycleStatus: "completed" as const,
          itemType: "command_execution" as const,
          command: `cat file-${index}.txt`,
          detail: `Output from file ${index}`,
        },
      })),
    ];
    const render = () => (
      <ReasoningTimelineFixture
        {...buildProps()}
        timelineEntries={[...timelineEntries]}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        runningTurnId={turnId}
        latestTurn={{
          turnId,
          state: "running",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: null,
        }}
        streamingMotionEnabled={false}
      />
    );
    try {
      await act(() => root.render(render()));
      expect(container.querySelectorAll("[data-timeline-row-kind='work']")).toHaveLength(1);
      expect(container.textContent).not.toContain("Full Working trace remains available");
      const latestTool = container.querySelector<HTMLElement>(
        "[data-timeline-row-kind='work'] [role='button']",
      );
      await act(() => latestTool!.click());
      expect(container.textContent).toContain("Output from file 2");
      expect(container.textContent).not.toContain("Output from file 1");
      const expandTools = container.querySelector<HTMLButtonElement>(
        "[data-timeline-row-kind='work-toggle'] button",
      );
      await act(() => expandTools!.click());
      expect(container.querySelectorAll("[data-timeline-row-kind='work']")).toHaveLength(2);
      const firstTool = container.querySelector<HTMLElement>(
        "[data-timeline-row-kind='work'] [role='button']",
      );
      await act(() => firstTool!.click());
      expect(container.textContent).toContain("Output from file 1");
      const reasoning = container.querySelector<HTMLButtonElement>("button[data-reasoning-log]");
      expect(reasoning?.textContent).toBe("Inspecting files");
      await act(() => reasoning!.click());
      const content = document.querySelector("[data-working-reasoning-content]");
      expect(content?.textContent).toContain("Full Working trace remains available");

      for (const mode of CHAT_VISUAL_MODES) {
        visualPreference.mode = mode;
        await act(() => root.render(render()));
        expect(document.querySelector("[data-working-reasoning-content]")).toBe(content);
        expect(container.querySelectorAll("[data-timeline-row-kind='work']")).toHaveLength(
          mode === "classic" ? 2 : 0,
        );
      }
      visualPreference.mode = "classic";
      await act(() => root.render(render()));
      expect(container.textContent).toContain("Output from file 1");
      expect(container.textContent).toContain("Output from file 2");
    } finally {
      await act(() => root.unmount());
      container.remove();
      __setClientSettingsForTests(originalSettings);
      visualPreference.mode = "current";
      vi.unstubAllGlobals();
    }
  });

  it("renders initial thinking as the shared live activity row", () => {
    const turnId = TurnId.make("turn-live");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        latestTurn={{
          turnId,
          state: "running",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: null,
        }}
        runningTurnId={turnId}
        timelineEntries={[]}
      />,
    );

    expect(markup).toContain("Thinking");
    expect(markup).toContain("lucide-brain");
    expect(markup).toContain('data-timeline-row-id="live-activity-row"');
  });

  it("settles a completed command and returns the shared activity row to Thinking", () => {
    const turnId = TurnId.make("turn-live");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        latestTurn={{
          turnId,
          state: "running",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: null,
        }}
        runningTurnId={turnId}
        timelineEntries={[
          {
            id: "entry-completed",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "work-completed",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              toolCallId: "call-completed",
              label: "Run lint",
              tone: "tool",
              itemType: "command_execution",
              command: "pnpm lint",
              toolLifecycleStatus: "completed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Ran pnpm");
    expect(markup).toContain("lucide-terminal");
    expect(markup).not.toContain("Running pnpm");
    expect(markup).toContain("Thinking");
    expect(markup).toContain('data-timeline-row-kind="thinking"');
  });

  it("renders review comment contexts as structured cards instead of raw tags", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-2"),
              role: "user",
              text: [
                '<review_comment sectionId="turn:2" sectionTitle="Turn 2" filePath="apps/web/src/lib/contextWindow.test.ts" startIndex="3" endIndex="14" rangeLabel="+47 to +58">',
                "Wadduo",
                "```diff",
                "@@ -0,0 +47,2 @@",
                '+  it("keeps valid zero-usage snapshots", () => {',
                "+    expect(snapshot).not.toBeNull();",
                "```",
                "</review_comment>",
              ].join("\n"),
              turnId: null,
              createdAt: "2026-03-17T19:12:28.000Z",
              updatedAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("contextWindow.test.ts +47 to +58");
    expect(markup).toContain("lucide-message-circle");
    expect(markup).not.toContain(">Review comment<");
    expect(markup).not.toContain("&lt;review_comment");
    expect(markup).not.toContain("&lt;/review_comment&gt;");
  });

  it("renders file review comments as source code instead of diffs", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-source-comment"),
              role: "user",
              text: [
                '<review_comment sectionId="file:docs/plan.md" sectionTitle="File comment" filePath="docs/plan.md" startIndex="0" endIndex="1" rangeLabel="L1 to L2">',
                "Clarify this.",
                "```md",
                "# Plan",
                "- Step one",
                "```",
                "</review_comment>",
              ].join("\n"),
              turnId: null,
              createdAt: "2026-03-17T19:12:28.000Z",
              updatedAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("plan.md L1 to L2");
    expect(markup).not.toContain("review_comment");
    expect(markup).not.toContain('data-testid="file-diff"');
  });

  it("renders attachment chips bound to server ids and hides their file rows", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-attachments",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-attachments"),
              role: "user",
              text: "See ![shot.png](t3-context://v1/image/img-1) and [notes.txt](t3-context://v1/file/file-1).",
              attachments: [
                {
                  type: "image",
                  id: "thread-1-aaa",
                  name: "shot.png",
                  mimeType: "image/png",
                  sizeBytes: 3,
                },
                {
                  type: "file",
                  id: "thread-1-bbb",
                  name: "notes.txt",
                  mimeType: "text/plain",
                  sizeBytes: 3,
                },
                {
                  type: "file",
                  id: "thread-1-ccc",
                  name: "legacy.txt",
                  mimeType: "text/plain",
                  sizeBytes: 3,
                },
              ],
              context: {
                version: 1,
                records: [
                  {
                    version: 1,
                    contextId: "img-1" as never,
                    kind: "image",
                    label: "shot.png",
                    attachmentId: "thread-1-aaa",
                    name: "shot.png",
                    mimeType: "image/png",
                    sizeBytes: 3,
                  },
                  {
                    version: 1,
                    contextId: "file-1" as never,
                    kind: "file",
                    label: "notes.txt",
                    attachmentId: "thread-1-bbb",
                    name: "notes.txt",
                    mimeType: "text/plain",
                    sizeBytes: 3,
                  },
                ],
              },
              turnId: null,
              createdAt: "2026-03-17T19:12:28.000Z",
              updatedAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    // Images report their size like every other attachment chip.
    expect(markup).toContain('aria-label="Image attachment, shot.png, 1 KB"');
    // Selection copy re-emits chips as their canonical links.
    expect(markup).toContain('data-markdown-copy="![shot.png](t3-context://v1/image/img-1)"');
    expect(markup).toContain('aria-label="File attachment, notes.txt, 1 KB"');
    expect(markup).toContain(">1 KB</span>");
    expect(markup).not.toContain('aria-label="Download notes.txt"');
    expect(markup).toContain("legacy.txt");
    expect(markup).not.toContain('href="t3-context://');
    // A picture keeps its tile even though it also has a chip: the chip names it, the tile is
    // the only way to see it. A plain file's row is what a chip replaces.
    expect(markup).toContain("grid-cols-2");
  });

  it("resolves an annotation screenshot through its image context record", () => {
    const image = {
      type: "image" as const,
      id: "thread-1-screenshot",
      name: "capture.png",
      mimeType: "image/png",
      sizeBytes: 42,
    };
    const annotation = {
      version: 1 as const,
      contextId: "annotation-1" as never,
      kind: "preview-annotation" as const,
      label: "Checkout button",
      annotationId: "producer-id",
      pageUrl: "https://example.test/checkout",
      pageTitle: "Checkout",
      comment: "This changed after clicking",
      targetSummary: "1 selected element",
      styleChanges: [],
      screenshotContextId: "screenshot-1" as never,
    };
    const screenshotRecord = {
      version: 1 as const,
      contextId: "screenshot-1" as never,
      kind: "image" as const,
      label: "capture.png",
      attachmentId: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
    };

    expect(
      resolvePreviewAnnotationImage({
        record: annotation,
        recordsById: new Map<string, ComposerContextRecord>([
          [annotation.contextId, annotation],
          [screenshotRecord.contextId, screenshotRecord],
        ]),
        userImages: [image],
        previewImages: [],
        annotationRecordIds: [annotation.contextId],
      }),
    ).toBe(image);
  });

  it("returns no annotation screenshot when its binding cannot be resolved", () => {
    expect(
      resolvePreviewAnnotationImage({
        record: {
          version: 1,
          contextId: "annotation-1" as never,
          kind: "preview-annotation",
          label: "Google",
          annotationId: "producer-id",
          pageUrl: "https://google.com",
          pageTitle: "Google",
          comment: "What is this?",
          targetSummary: "8 drawings",
          styleChanges: [],
          screenshotContextId: "missing-image" as never,
        },
        recordsById: new Map(),
        userImages: [],
        previewImages: [],
        annotationRecordIds: ["annotation-1"],
      }),
    ).toBeNull();
  });

  it("keeps pasted file chips between their surrounding words across presentation changes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const file = {
      type: "file" as const,
      id: "document-1",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
    };
    const entry = buildUserTimelineEntry(
      "Compare [notes.txt](t3-context://v1/file/document-context) with the latest changes.",
    );
    const timelineEntries: TimelineEntry[] = [
      {
        ...entry,
        message: {
          ...entry.message,
          attachments: [file],
          context: {
            version: 1,
            records: [
              {
                version: 1,
                contextId: ComposerContextId.make("document-context"),
                kind: "file",
                label: file.name,
                attachmentId: file.id,
                name: file.name,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
              },
            ],
          },
        },
      },
    ];
    const onFileOpen = vi.fn();
    let mountedChip: Element | null = null;
    try {
      for (const mode of ["current", "better-t3", "classic", "better-t3"] as const) {
        visualPreference.mode = mode;
        await act(() =>
          root.render(
            <MessagesTimeline
              {...buildProps()}
              timelineEntries={timelineEntries}
              onFileOpen={onFileOpen}
            />,
          ),
        );
        const body = container.querySelector("[data-user-message-body]");
        const chips = body?.querySelectorAll("button[data-markdown-copy]") ?? [];
        expect(chips).toHaveLength(1);
        const chip = chips[0]!;
        if (mountedChip) expect(chip).toBe(mountedChip);
        mountedChip = chip;
        const paragraph = chip.closest("p")!;
        expect(paragraph.textContent).toMatch(/^Compare notes.txt.* with the latest changes\.$/);
        expect(container.querySelector('button[aria-label="Preview notes.txt"]') !== null).toBe(
          mode === "better-t3",
        );
        await act(() => chip.dispatchEvent(new MouseEvent("click", { bubbles: true })));
        expect(onFileOpen).toHaveBeenLastCalledWith(file);
      }
    } finally {
      await act(() => root.unmount());
      container.remove();
      visualPreference.mode = "current";
      vi.unstubAllGlobals();
    }
  });

  it("renders structured context records as chips without reparsing text", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-structured",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-structured"),
              role: "user",
              text: "Compare [Terminal 1 line 4](t3-context://v1/terminal/ctx-t) with [gone](t3-context://v1/future/ctx-x).",
              context: {
                version: 1,
                records: [
                  {
                    version: 1,
                    contextId: "ctx-t" as never,
                    kind: "terminal",
                    label: "Terminal 1 line 4",
                    terminalId: "default",
                    terminalLabel: "Terminal 1",
                    lineStart: 4,
                    lineEnd: 4,
                    text: "boom",
                  },
                ],
              },
              turnId: null,
              createdAt: "2026-03-17T19:12:28.000Z",
              updatedAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("Terminal 1 line 4");
    expect(markup).toContain('data-context-unresolved="true"');
    expect(markup).toContain(">gone<");
    expect(markup).not.toContain('href="t3-context://');
  });

  it("keeps failed lifecycle entries discoverable in mixed activity summaries", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-info",
            kind: "work",
            createdAt: "2026-03-17T19:12:27.000Z",
            entry: {
              id: "work-info",
              createdAt: "2026-03-17T19:12:27.000Z",
              label: "Status updated",
              tone: "info",
            },
          },
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Glob",
              tone: "tool",
              toolLifecycleStatus: "failed",
              detail: "No files found",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Received 1 update and used 1 tool, tool call failed"');
    // Ordinary tool failures do not use destructive row styling.
    expect(markup).not.toContain("text-destructive");
  });

  it("keeps the red treatment for severe orchestration failures", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-info",
            kind: "work",
            createdAt: "2026-03-17T19:12:27.000Z",
            entry: {
              id: "work-info",
              createdAt: "2026-03-17T19:12:27.000Z",
              label: "Status updated",
              tone: "info",
            },
          },
          {
            id: "entry-turn-failed",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-turn-failed",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Provider turn start failed",
              tone: "error",
              sourceActivityKind: "provider.turn.start.failed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("lucide-circle-alert");
    expect(markup).toContain("text-destructive");
  });

  it("only withholds an expanded tool-call label click while text is selected", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <MessagesTimeline
            {...buildProps()}
            timelineEntries={[
              {
                id: "entry-standalone",
                kind: "work",
                createdAt: MESSAGE_CREATED_AT,
                entry: {
                  id: "work-standalone",
                  createdAt: MESSAGE_CREATED_AT,
                  toolCallId: "call-standalone",
                  label: "Run lint",
                  tone: "tool",
                  itemType: "command_execution",
                  command: "pnpm lint",
                  toolLifecycleStatus: "completed",
                },
              },
            ]}
          />,
        );
      });
      await act(() => renderer!.root.findByProps({ "aria-expanded": false }).props.onClick());
      const label = renderer!.root.findAll(
        (node) => node.type === "span" && String(node.props.className).includes("select-text"),
      )[0];
      const stopPropagation = vi.fn();
      // Only the click that ends a selection may be withheld from the row
      // toggle; the plain click has to reach it so the label can collapse.
      for (const isCollapsed of [false, true]) {
        label!.props.onClick({
          currentTarget: { ownerDocument: { getSelection: () => ({ isCollapsed }) } },
          stopPropagation,
        });
      }
      expect(stopPropagation).toHaveBeenCalledTimes(1);
    } finally {
      await act(() => renderer?.unmount());
    }
  });
});

it.each(CHAT_VISUAL_MODES)("edits both message roles in place in the %s layout", async (mode) => {
  visualPreference.mode = mode;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const user = buildUserTimelineEntry("Original user text");
  const assistant = buildAssistantTimelineEntry("Original assistant text");
  const initial = [
    user,
    {
      ...assistant,
      id: "assistant-entry",
      message: { ...assistant.message, id: MessageId.make("assistant-message") },
    },
  ];
  function Harness() {
    const [entries, setEntries] = useState<Extract<TimelineEntry, { kind: "message" }>[]>(initial);
    const [editing, setEditing] = useState<{
      id: MessageId;
      draftRef: { current: string };
    } | null>(null);
    return (
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={entries}
        editAction={{
          available: true,
          onEdit: (message) => setEditing({ id: message.id, draftRef: { current: message.text } }),
          editor: editing
            ? {
                messageId: editing.id,
                content: (
                  <InlineMessageEditor
                    draftRef={editing.draftRef}
                    available
                    onClose={() => setEditing(null)}
                    onSave={async (text) => {
                      setEntries((current) =>
                        current.map((entry) =>
                          entry.message.id === editing.id
                            ? { ...entry, message: { ...entry.message, text } }
                            : entry,
                        ),
                      );
                    }}
                  />
                ),
              }
            : null,
        }}
      />
    );
  }
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => {
      renderer = create(<Harness />);
    });
    for (const role of ["user", "assistant"] as const) {
      const row = () =>
        renderer.root.findByProps({
          "data-message-id": role === "user" ? user.message.id : "assistant-message",
        });
      await act(async () =>
        row()
          .findAllByType("button")
          .find((button) => button.props["aria-label"] === "Edit message")!
          .props.onClick({ nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() }),
      );
      expect(row().findAllByType("textarea")).toHaveLength(1);
      expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
      await act(async () =>
        row()
          .findByType("textarea")
          .props.onChange({
            target: { value: `Corrected ${role} text` },
            currentTarget: { value: `Corrected ${role} text` },
            nativeEvent: {},
          }),
      );
      const editor = row().findByType("textarea");
      visualPreference.mode = mode === "better-t3" ? "current" : "better-t3";
      await act(() => renderer.update(<Harness />));
      expect(row().findByType("textarea")).toBe(editor);
      expect(editor.props.value).toBe(`Corrected ${role} text`);
      visualPreference.mode = mode;
      await act(() => renderer.update(<Harness />));
      await act(async () => row().findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
      expect(row().findAllByType("textarea")).toHaveLength(0);
      expect(JSON.stringify(renderer.toJSON())).toContain(`Corrected ${role} text`);
      expect(
        renderer.root.findAll(
          (node) => node.type === "div" && node.props["data-message-role"] !== undefined,
        ),
      ).toHaveLength(2);
    }
  } finally {
    await act(async () => renderer?.unmount());
    visualPreference.mode = "current";
  }
});

it("restores complete Classic question histories and remembers explicit collapse across row remounts", async () => {
  visualPreference.mode = "current";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const entry: TimelineEntry = {
    id: "classic-answer-entry",
    kind: "work",
    createdAt: MESSAGE_CREATED_AT,
    entry: {
      id: "classic-answer-work",
      createdAt: MESSAGE_CREATED_AT,
      label: "Question answer submitted",
      tone: "info",
      questionAnswer: {
        requestId: ApprovalRequestId.make("classic-answer-request"),
        answers: { first: "Keep the current styling", second: "Restore the full details" },
        questionTextById: { first: "Which styling?", second: "Which details?" },
        attachmentsByQuestionId: {
          second: [
            {
              type: "file",
              id: "classic-spec",
              name: "classic-spec.txt",
              mimeType: "text/plain",
              sizeBytes: 4,
            },
          ],
        },
      },
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (entries: TimelineEntry[] = [entry]) => (
    <MessagesTimeline {...buildProps()} timelineEntries={entries} />
  );
  try {
    await act(() => root.render(render()));
    expect(container.textContent).not.toContain("Which details?");
    visualPreference.mode = "classic";
    await act(() => root.render(render()));
    expect(container.textContent).toContain("Which styling?");
    expect(container.textContent).toContain("Which details?");
    expect(container.textContent).toContain("Restore the full details");
    expect(container.textContent).toContain("classic-spec.txt");

    const toggle = () =>
      container.querySelector<HTMLElement>(
        '[role="button"][aria-label^="Question answer submitted"]',
      )!;
    const attachment = container.querySelector("a")!;
    await act(() =>
      attachment.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(container.textContent).toContain("Which details?");

    await act(() => toggle().click());
    expect(container.textContent).not.toContain("Which details?");
    await act(() => root.render(render([])));
    await act(() => root.render(render()));
    expect(container.textContent).not.toContain("Which details?");
    await act(() =>
      toggle().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(container.textContent).toContain("Which details?");
  } finally {
    await act(() => root.unmount());
    container.remove();
    visualPreference.mode = "current";
  }
});

it("restores an inline Classic annotation preview without duplicating its image and keeps zoom available", async () => {
  visualPreference.mode = "classic";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const annotationId = ComposerContextId.make("classic-annotation");
  const imageContextId = ComposerContextId.make("classic-screenshot");
  const image = {
    type: "image" as const,
    id: "classic-screenshot-attachment",
    name: "capture.png",
    mimeType: "image/png",
    sizeBytes: 42,
    previewUrl: "data:image/png;base64,Y2xhc3NpYw==",
  };
  const entry = buildUserTimelineEntry(
    `Fix [Checkout button](t3-context://v1/preview-annotation/${annotationId}).`,
  );
  const message = {
    ...entry.message,
    attachments: [image],
    context: {
      version: 1 as const,
      records: [
        {
          version: 1 as const,
          contextId: imageContextId,
          kind: "image" as const,
          label: image.name,
          attachmentId: image.id,
          name: image.name,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
        },
        {
          version: 1 as const,
          contextId: annotationId,
          kind: "preview-annotation" as const,
          label: "Checkout button",
          annotationId: "classic-producer",
          pageUrl: "https://example.test/checkout",
          pageTitle: "Checkout",
          comment: "Align the checkout button",
          targetSummary: "1 selected element",
          styleChanges: [],
          screenshotContextId: imageContextId,
        },
      ],
    },
  };
  const expand = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (text = message.text) => (
    <MessagesTimeline
      {...buildProps()}
      onImageExpand={expand}
      timelineEntries={[{ ...entry, message: { ...message, text } }]}
    />
  );
  try {
    await act(() => root.render(render()));
    const preview = container.querySelector("[data-classic-preview-annotations]")!;
    expect(preview.textContent).toContain("Align the checkout button");
    expect(preview.textContent).toContain("Checkout");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    const zoom = preview.querySelector<HTMLButtonElement>(
      'button[aria-label="Preview capture.png"]',
    )!;
    await act(() => zoom.click());
    expect(expand).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 0,
        images: expect.arrayContaining([expect.objectContaining({ src: image.previewUrl })]),
      }),
    );

    visualPreference.mode = "current";
    await act(() => root.render(render()));
    expect(container.querySelector("[data-classic-preview-annotations]")).toBeNull();
    expect(container.textContent).toContain("Checkout button");
    expect(container.textContent).not.toContain("Align the checkout button");

    visualPreference.mode = "classic";
    await act(() => root.render(render("Keep only the attached screenshot.")));
    expect(container.querySelector("[data-classic-preview-annotations]")).toBeNull();
    expect(container.textContent).not.toContain("Align the checkout button");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  } finally {
    await act(() => root.unmount());
    container.remove();
    visualPreference.mode = "current";
  }
});

it("keeps edit and fork in the Better T3 message header with keyboard access and metrics beneath", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const { __setClientSettingsForTests, getClientSettings } =
    await import("../../hooks/useSettings");
  const original = getClientSettings();
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    betterT3Device: {
      ...makeBetterT3SettingsV1("existing-install-migration"),
      flags: { "chat.presentationMotion": false },
    },
  });
  visualPreference.mode = "better-t3";
  const source = buildUserTimelineEntry("A finished response");
  const message = {
    ...source.message,
    role: "assistant" as const,
    turnId: TurnId.make("header-turn"),
  };
  const entry = { ...source, message };
  const onEdit = vi.fn();
  const onFork = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () => (
    <MessagesTimeline
      {...buildProps()}
      timelineEntries={[entry]}
      editAction={{ available: true, onEdit }}
      forkActions={{
        available: true,
        pendingBoundary: null,
        forkableMessageIds: new Set([message.id]),
        forkableProposedPlanIds: new Set(),
        onFork,
      }}
    />
  );
  try {
    await act(() => root.render(render()));
    const header = container.querySelector(".better-chat-actions")!;
    const edit = header.querySelector<HTMLButtonElement>("button[aria-label='Edit message']")!;
    const fork = header.querySelector<HTMLButtonElement>(
      "button[aria-label='Fork chat from here']",
    )!;
    expect(edit).not.toBeNull();
    expect(fork).not.toBeNull();
    await act(() => {
      edit.focus();
      edit.click();
    });
    expect(document.activeElement).toBe(edit);
    expect(onEdit).toHaveBeenCalledWith(message);
    await act(() => fork.click());
    expect(onFork).toHaveBeenCalledWith({ kind: "message", messageId: message.id });
    const meta = container.querySelector(".better-chat-meta")!;
    expect(meta).not.toBeNull();
    expect(meta.querySelector("button[aria-label='Edit message']")).toBeNull();
    expect(meta.closest("[data-presentation-bubble]")).toBeNull();
    visualPreference.mode = "current";
    await act(() => root.render(render()));
    expect(container.querySelector(".better-chat-actions")).toBeNull();
    expect(container.querySelector("button[aria-label='Edit message']")).not.toBeNull();
  } finally {
    await act(() => root.unmount());
    container.remove();
    visualPreference.mode = "current";
    __setClientSettingsForTests(original);
    vi.unstubAllGlobals();
  }
});

it.each(CHAT_VISUAL_MODES)(
  "avoids a duplicate composer working status in %s while retaining live work and distinct statuses",
  async (mode) => {
    const { __setClientSettingsForTests, getClientSettings } =
      await import("../../hooks/useSettings");
    const original = getClientSettings();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    visualPreference.mode = mode;
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      betterT3Device: {
        ...makeBetterT3SettingsV1("existing-install-migration"),
        flags: { "chat.presentationMotion": false },
      },
    });
    const turnId = TurnId.make("composer-working-status");
    const entries: TimelineEntry[] = [
      {
        kind: "work",
        id: "active-tool",
        createdAt: MESSAGE_CREATED_AT,
        entry: {
          id: "active-tool",
          turnId,
          createdAt: MESSAGE_CREATED_AT,
          tone: "tool",
          label: "Inspecting source",
          command: "cat source.ts",
          itemType: "command_execution",
          toolLifecycleStatus: "completed",
        },
      },
    ];
    const props = {
      ...buildProps(),
      routeThreadKey: `composer-status-${mode}`,
      isWorking: true,
      activeTurnStartedAt: MESSAGE_CREATED_AT,
      latestTurn: {
        turnId,
        state: "running" as const,
        startedAt: MESSAGE_CREATED_AT,
        completedAt: null,
      },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const workingRows = () => container.querySelectorAll('[data-timeline-row-kind="working"]');
    const render = (overrides: Partial<ComponentProps<typeof MessagesTimeline>>) => (
      <MessagesTimeline {...props} {...overrides} timelineEntries={entries} />
    );
    try {
      await act(() => root.render(render({ composerWorkingStatusVisible: false })));
      expect(workingRows()).toHaveLength(1);
      await act(() => root.render(render({ composerWorkingStatusVisible: true })));
      expect(workingRows()).toHaveLength(mode === "better-t3" ? 0 : 1);
      expect(container.textContent).toContain("cat");
      await act(() => container.querySelector<HTMLElement>('[aria-expanded="false"]')!.click());
      expect(container.textContent).toContain("source.ts");

      await act(() =>
        root.render(render({ composerWorkingStatusVisible: true, isCompacting: true })),
      );
      expect(workingRows()).toHaveLength(1);
      expect(workingRows()[0]!.textContent).toContain("Compacting");
      await act(() =>
        root.render(render({ composerWorkingStatusVisible: true, isPreparingWorktree: true })),
      );
      expect(workingRows()).toHaveLength(1);
      expect(workingRows()[0]!.textContent).toContain("Setting up worktree");
      await act(() => root.render(render({ composerWorkingStatusVisible: false })));
      expect(workingRows()).toHaveLength(1);
    } finally {
      await act(() => root.unmount());
      container.remove();
      visualPreference.mode = "current";
      __setClientSettingsForTests(original);
    }
  },
);

it("renders one Better T3 thinking block across tools, commentary, streaming updates, and mode switches", async () => {
  const { __setClientSettingsForTests, getClientSettings } =
    await import("../../hooks/useSettings");
  const original = getClientSettings();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  visualPreference.mode = "better-t3";
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    showReasoning: true,
    betterT3Device: {
      ...makeBetterT3SettingsV1("existing-install-migration"),
      flags: { "agent.reasoningWorkingOverlay": false, "chat.presentationMotion": false },
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const turnId = TurnId.make("rendered-reasoning");
  const message = (
    id: string,
    role: "user" | "assistant" | "reasoning",
    text: string,
    second: number,
    scope: TurnId | null = turnId,
  ): Extract<TimelineEntry, { kind: "message" }> => {
    const createdAt = new Date(Date.UTC(2026, 9, 26, 12, 0, second)).toISOString();
    return {
      id,
      kind: "message",
      createdAt,
      message: {
        id: MessageId.make(id),
        role,
        text,
        turnId: scope,
        streaming: role === "reasoning",
        createdAt,
        updatedAt: createdAt,
      },
    };
  };
  let entries: TimelineEntry[] = [
    message("request", "user", "Investigate the issue", 0),
    message("thought-1", "reasoning", "First private trace", 1),
    {
      id: "read-tool",
      kind: "work",
      createdAt: "2026-10-26T12:00:02.000Z",
      entry: {
        id: "read-tool",
        turnId,
        createdAt: "2026-10-26T12:00:02.000Z",
        tone: "tool",
        label: "Read source",
        command: "cat source.ts",
        detail: "Tool output",
        itemType: "command_execution",
        toolLifecycleStatus: "completed",
      },
    },
    message("thought-2", "reasoning", "Second private trace", 3, null),
    message("commentary", "assistant", "Checking the next file.", 4),
    message("thought-3", "reasoning", "Third private trace", 5, TurnId.make("continuation")),
    {
      id: "legacy-thought",
      kind: "work",
      createdAt: "2026-10-26T12:00:06.000Z",
      entry: {
        id: "legacy-thought",
        createdAt: "2026-10-26T12:00:06.000Z",
        turnId,
        tone: "thinking",
        label: "Thinking",
        sourceActivityKind: "reasoning.summary",
        detail: "Legacy private trace",
      },
    },
  ];
  const props = {
    ...buildProps(),
    routeThreadKey: "rendered-reasoning-regression",
    isWorking: true,
    activeTurnStartedAt: entries[0]!.createdAt,
    latestTurn: {
      turnId,
      state: "running" as const,
      startedAt: entries[0]!.createdAt,
      completedAt: null,
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () => <ReasoningTimelineFixture {...props} timelineEntries={[...entries]} />;
  const blocks = () => container.querySelectorAll<HTMLElement>(".better-chat-reasoning");
  try {
    await act(() => root.render(render()));
    expect(blocks()).toHaveLength(1);
    const firstBlock = blocks()[0]!;
    expect(firstBlock.textContent).not.toContain("private trace");
    await act(() => firstBlock.querySelector("button")!.click());
    for (const text of [
      "First private trace",
      "Second private trace",
      "Third private trace",
      "Legacy private trace",
    ]) {
      expect(firstBlock.textContent).toContain(text);
    }
    expect(firstBlock.textContent).not.toContain("Checking the next file.");
    expect(firstBlock.textContent).not.toContain("Tool output");
    expect(container.textContent).toContain("Checking the next file.");

    entries = entries.map((entry) =>
      entry.id === "thought-1"
        ? message("thought-1", "reasoning", "First private trace updated", 1)
        : entry,
    );
    await act(() => root.render(render()));
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toBe(firstBlock);
    expect(firstBlock.textContent).toContain("First private trace updated");

    entries = [...entries, message("thought-4", "reasoning", "Fourth private trace", 7)];
    await act(() => root.render(render()));
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toBe(firstBlock);
    expect(firstBlock.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    expect(firstBlock.textContent).toContain("First private trace updated");
    expect(firstBlock.textContent).toContain("Fourth private trace");

    visualPreference.mode = "current";
    await act(() => root.render(render()));
    expect(blocks()).toHaveLength(0);
    expect(container.textContent).toContain("Fourth private trace");
    visualPreference.mode = "better-t3";
    await act(() => root.render(render()));
    expect(blocks()).toHaveLength(1);

    entries = [
      ...entries,
      message("new-request", "user", "A separate request", 8),
      message("new-thought", "reasoning", "New request private trace", 9),
    ];
    await act(() =>
      root.render(<ReasoningTimelineFixture {...props} timelineEntries={[...entries]} />),
    );
    expect(blocks()).toHaveLength(2);
    await act(() => {
      __setClientSettingsForTests({ ...getClientSettings(), showReasoning: false });
      root.render(render());
    });
    expect(blocks()).toHaveLength(0);
    expect(container.textContent).not.toContain("private trace");
  } finally {
    await act(() => root.unmount());
    container.remove();
    visualPreference.mode = "current";
    __setClientSettingsForTests(original);
  }
});

it.each(["message", "work"] as const)(
  "preserves Better T3 %s reasoning disclosures while respecting visibility and overlay settings",
  async (kind) => {
    const { __setClientSettingsForTests, getClientSettings } =
      await import("../../hooks/useSettings");
    const original = getClientSettings();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    visualPreference.mode = "better-t3";
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      showReasoning: true,
      betterT3Device: {
        ...makeBetterT3SettingsV1("existing-install-migration"),
        flags: { "agent.reasoningWorkingOverlay": false, "chat.presentationMotion": false },
      },
    });
    const props = { ...buildProps(), routeThreadKey: `reasoning-disclosure-${kind}` };
    const trace = (detail: string): TimelineEntry =>
      kind === "message"
        ? {
            ...buildUserTimelineEntry(detail),
            message: {
              ...buildUserTimelineEntry(detail).message,
              role: "reasoning",
              turnId: TurnId.make("trace-turn"),
            },
          }
        : {
            kind: "work",
            id: "trace-work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "trace-work",
              createdAt: MESSAGE_CREATED_AT,
              turnId: TurnId.make("trace-turn"),
              tone: "thinking",
              label: "Reasoning",
              sourceActivityKind: "reasoning.summary",
              detail,
            },
          };
    const renderedText = (node: ReactTestInstance | string): string =>
      typeof node === "string" ? node : node.children.map(renderedText).join("");
    const detail = "**Inspecting changes**\n\nPrivate reasoning details";
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <ReasoningTimelineFixture {...props} timelineEntries={[trace(detail)]} />,
        );
      });
      const disclosure = () => renderer!.root.findByProps({ className: "better-chat-reasoning" });
      expect(disclosure().findAllByType("p").map(renderedText).join("")).not.toContain(
        "Private reasoning details",
      );
      await act(() => disclosure().findByType("button").props.onClick());
      expect(disclosure().findAllByType("p").map(renderedText).join("")).toContain(
        "Private reasoning details",
      );

      await act(() =>
        renderer!.update(
          <ReasoningTimelineFixture {...props} timelineEntries={[trace(detail + " updated")]} />,
        ),
      );
      expect(disclosure().findAllByType("p").map(renderedText).join("")).toContain(
        "Private reasoning details updated",
      );

      await act(() => {
        __setClientSettingsForTests({ ...getClientSettings(), showReasoning: false });
        renderer!.update(
          <ReasoningTimelineFixture {...props} timelineEntries={[trace(detail + " updated")]} />,
        );
      });
      expect(renderedText(renderer!.root)).not.toContain("Private reasoning");
      expect(renderedText(renderer!.root)).not.toContain("Inspecting changes");

      await act(() => {
        __setClientSettingsForTests({ ...getClientSettings(), showReasoning: true });
        renderer!.update(
          <ReasoningTimelineFixture {...props} timelineEntries={[trace(detail + " updated")]} />,
        );
      });
      expect(disclosure().findAllByType("p").map(renderedText).join("")).toContain(
        "Private reasoning details updated",
      );
      await act(() =>
        __setClientSettingsForTests({
          ...getClientSettings(),
          betterT3Device: {
            ...getClientSettings().betterT3Device,
            flags: {
              ...getClientSettings().betterT3Device.flags,
              "agent.reasoningWorkingOverlay": true,
            },
          },
        }),
      );
      await act(() =>
        renderer!.update(
          <ReasoningTimelineFixture {...props} timelineEntries={[trace(detail + " updated")]} />,
        ),
      );
      expect(renderer!.root.findAllByProps({ className: "better-chat-reasoning" })).toHaveLength(0);
    } finally {
      await act(() => renderer?.unmount());
      __setClientSettingsForTests(original);
      visualPreference.mode = "current";
    }
  },
);
