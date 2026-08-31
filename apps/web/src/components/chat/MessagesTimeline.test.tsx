import {
  CheckpointRef,
  EnvironmentId,
  MessageId,
  OrchestrationProposedPlanId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { codexFeedbackMessage } from "@t3tools/client-runtime/state/threads";
import { createRef, type ReactNode, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";
import { formatDayAwareTimestamp, formatShortTimestamp } from "../../timestampFormat";

const clientSettingsState = vi.hoisted(() => ({ showReasoning: false }));
const chatVisualModeState = vi.hoisted(() => ({ mode: "current" as "current" | "classic" }));

vi.mock("../../chatVisualModeSync", () => ({
  useChatVisualMode: () => chatVisualModeState.mode,
}));

vi.mock("../../hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/useSettings")>();
  return {
    ...actual,
    useClientSettings: <T,>(
      selector?: (
        settings: ReturnType<typeof actual.getClientSettings> & { showReasoning: boolean },
      ) => T,
    ) => {
      const settings = {
        ...actual.getClientSettings(),
        showReasoning: clientSettingsState.showReasoning,
      };
      return selector ? selector(settings) : settings;
    },
  };
});

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
    maintainScrollAtEnd?:
      | boolean
      | {
          animated?: boolean;
          on?: {
            dataChange?: boolean;
            itemLayout?: boolean;
            layout?: boolean;
          };
        };
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

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

let MessagesTimeline: typeof import("./MessagesTimeline").MessagesTimeline;
let resolveInitialStreamAnimation: typeof import("./MessagesTimeline").resolveInitialStreamAnimation;

beforeAll(async () => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });

  ({ MessagesTimeline, resolveInitialStreamAnimation } = await import("./MessagesTimeline"));
}, 30_000);

beforeEach(() => {
  clientSettingsState.showReasoning = false;
  chatVisualModeState.mode = "current";
});

const ACTIVE_THREAD_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const MESSAGE_CREATED_AT = "2026-03-17T19:12:28.000Z";

function buildProps() {
  return {
    isWorking: false,
    listRef: createRef<LegendListRef | null>(),
    latestTurn: null,
    runningTurnId: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: () => {},
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: () => {},
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

describe("MessagesTimeline", () => {
  it("offers a result-only retry only on the targeted user message", () => {
    const target = buildUserTimelineEntry("Retry this prompt");
    const older = {
      ...buildUserTimelineEntry("Older prompt"),
      id: "entry-older",
      message: {
        ...buildUserTimelineEntry("Older prompt").message,
        id: MessageId.make("message-older"),
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[older, target]}
        retryAction={{
          available: true,
          messageId: target.message.id,
          pending: false,
          onRetry: vi.fn(),
        }}
      />,
    );

    expect(markup.match(/aria-label="Retry response"/g)).toHaveLength(1);
    expect(markup).toContain("opacity-100");
  });

  it("disables and marks the result-only retry while it is pending", () => {
    const target = buildUserTimelineEntry("Retry once");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[target]}
        retryAction={{
          available: true,
          messageId: target.message.id,
          pending: true,
          onRetry: vi.fn(),
        }}
      />,
    );

    expect(markup).toContain('aria-label="Retrying response"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
  });

  it("offers a fork action only for committed user messages", () => {
    const committed = buildUserTimelineEntry("Committed prompt");
    const optimistic = {
      ...buildUserTimelineEntry("Optimistic prompt"),
      id: "entry-optimistic",
      message: {
        ...buildUserTimelineEntry("Optimistic prompt").message,
        id: MessageId.make("message-optimistic"),
      },
    };
    const forkableMessageIds = new Set([committed.message.id]);
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[committed, optimistic]}
        forkActions={{
          available: true,
          pendingBoundary: null,
          forkableMessageIds,
          forkableProposedPlanIds: new Set(),
          onFork: vi.fn(),
        }}
      />,
    );

    expect(markup.match(/aria-label="Fork chat from here"/g)).toHaveLength(1);
  });

  it("offers a fork action for a completed assistant response while its turn continues", () => {
    const turnId = TurnId.make("turn-still-running");
    const baseAssistantEntry = buildAssistantTimelineEntry("Intermediate response");
    const assistantEntry = {
      ...baseAssistantEntry,
      message: { ...baseAssistantEntry.message, turnId },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={{
          turnId,
          state: "running",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: null,
        }}
        runningTurnId={turnId}
        timelineEntries={[assistantEntry]}
        forkActions={{
          available: true,
          pendingBoundary: null,
          forkableMessageIds: new Set([assistantEntry.message.id]),
          forkableProposedPlanIds: new Set(),
          onFork: vi.fn(),
        }}
      />,
    );

    expect(markup).toContain('aria-label="Fork chat from here"');
  });

  it("hides fork actions for streaming messages and older servers", () => {
    const streamingEntry = buildAssistantTimelineEntry("Partial response");
    streamingEntry.message.streaming = true;
    const unsupportedMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[buildUserTimelineEntry("Hello")]} />,
    );
    const streamingMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[streamingEntry]}
        forkActions={{
          available: true,
          pendingBoundary: null,
          forkableMessageIds: new Set([streamingEntry.message.id]),
          forkableProposedPlanIds: new Set(),
          onFork: vi.fn(),
        }}
      />,
    );

    expect(unsupportedMarkup).not.toContain("Fork chat from here");
    expect(streamingMarkup).not.toContain("Fork chat from here");
  });

  it("keeps the capable-server action visible but disabled while disconnected", () => {
    const entry = buildUserTimelineEntry("Reconnect first");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[entry]}
        forkActions={{
          available: false,
          pendingBoundary: null,
          forkableMessageIds: new Set([entry.message.id]),
          forkableProposedPlanIds: new Set(),
          onFork: vi.fn(),
        }}
      />,
    );

    expect(markup).toContain('aria-label="Fork chat from here"');
    expect(markup).toContain("disabled");
  });

  it("disables duplicate fork dispatches and marks the selected action busy", () => {
    const entry = buildUserTimelineEntry("Fork once");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[entry]}
        forkActions={{
          available: true,
          pendingBoundary: { kind: "message", messageId: entry.message.id },
          forkableMessageIds: new Set([entry.message.id]),
          forkableProposedPlanIds: new Set(),
          onFork: vi.fn(),
        }}
      />,
    );

    expect(markup).toContain('aria-label="Forking chat"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
  });

  it("keeps inherited rows forkable while hiding their revert mutation", () => {
    const baseEntry = buildUserTimelineEntry("Frozen prompt");
    const entry = {
      ...baseEntry,
      message: {
        ...baseEntry.message,
        historyOrigin: {
          sourceThreadId: ThreadId.make("source-thread"),
          sourceId: MessageId.make("source-message"),
          ordinal: 0,
        },
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[entry]}
        revertTurnCountByUserMessageId={new Map([[entry.message.id, 1]])}
        forkActions={{
          available: true,
          pendingBoundary: null,
          forkableMessageIds: new Set([entry.message.id]),
          forkableProposedPlanIds: new Set(),
          onFork: vi.fn(),
        }}
      />,
    );

    expect(markup).toContain('aria-label="Fork chat from here"');
    expect(markup).not.toContain('aria-label="Revert to this message"');
  });

  it("renders fork provenance, the exact boundary divider, and a finalized-plan action", () => {
    const sourceThreadId = ThreadId.make("source-thread");
    const sourceMessageId = MessageId.make("source-message");
    const sourcePlanId = OrchestrationProposedPlanId.make("source-plan");
    const baseMessageEntry = buildUserTimelineEntry("Frozen prompt");
    const messageEntry = {
      ...baseMessageEntry,
      message: {
        ...baseMessageEntry.message,
        historyOrigin: {
          sourceThreadId,
          sourceId: sourceMessageId,
          ordinal: 0,
        },
      },
    };
    const proposedPlanId = OrchestrationProposedPlanId.make("destination-plan");
    const planEntry = {
      id: proposedPlanId,
      kind: "proposed-plan" as const,
      createdAt: "2026-03-17T19:12:29.000Z",
      proposedPlan: {
        id: proposedPlanId,
        turnId: null,
        planMarkdown: "# Frozen plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-03-17T19:12:29.000Z",
        updatedAt: "2026-03-17T19:12:29.000Z",
        historyOrigin: { sourceThreadId, sourceId: sourcePlanId, ordinal: 1 },
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[messageEntry, planEntry]}
        forkActions={{
          available: true,
          pendingBoundary: null,
          forkableMessageIds: new Set([messageEntry.message.id]),
          forkableProposedPlanIds: new Set([proposedPlanId]),
          onFork: vi.fn(),
        }}
        forkProvenance={{
          sourceTitle: "Original chat",
          boundary: { kind: "proposed-plan", planId: sourcePlanId },
          onOpenSource: vi.fn(),
        }}
      />,
    );

    expect(markup).toContain("Forked from");
    expect(markup).toContain("Original chat");
    expect(markup).toContain("Fork starts here");
    expect(markup).toContain('data-history-read-only="true"');
    expect(markup.match(/aria-label="Fork chat from here"/g)).toHaveLength(2);
  });

  it("keeps provenance without a link after the source thread disappears", () => {
    const sourceThreadId = ThreadId.make("deleted-source-thread");
    const sourceMessageId = MessageId.make("deleted-source-message");
    const baseEntry = buildUserTimelineEntry("Frozen prompt");
    const entry = {
      ...baseEntry,
      message: {
        ...baseEntry.message,
        historyOrigin: { sourceThreadId, sourceId: sourceMessageId, ordinal: 0 },
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[entry]}
        forkProvenance={{
          sourceTitle: "Deleted source",
          boundary: { kind: "message", messageId: sourceMessageId },
        }}
      />,
    );
    const provenanceStart = markup.indexOf('data-fork-provenance="true"');
    const provenanceEnd = markup.indexOf("</div>", provenanceStart);
    const provenanceMarkup = markup.slice(provenanceStart, provenanceEnd);

    expect(provenanceMarkup).toContain("Deleted source");
    expect(provenanceMarkup).not.toContain("<button");
    expect(markup).toContain("Fork starts here");
  });

  describe("initial assistant character motion eligibility", () => {
    const scopeId = "environment-local:thread-1";
    const runningTurnId = TurnId.make("turn-live");
    const input = {
      committedScopeId: scopeId,
      committedMessageIds: new Set(["message-existing"]),
      committedRunningTurnId: runningTurnId,
      currentScopeId: scopeId,
      messageId: "message-new",
      messageTurnId: runningTurnId,
      isStreaming: false,
    };

    it("animates a new completed assistant buffered from the previously running turn", () => {
      expect(resolveInitialStreamAnimation(input)).toBe(true);
    });

    it("does not animate a completed assistant from an unrelated turn", () => {
      expect(
        resolveInitialStreamAnimation({
          ...input,
          messageTurnId: TurnId.make("turn-unrelated"),
        }),
      ).toBe(false);
    });

    it("does not replay an old assistant already committed to the thread", () => {
      expect(
        resolveInitialStreamAnimation({
          ...input,
          messageId: "message-existing",
        }),
      ).toBe(false);
    });

    it("does not animate completed assistants during initial hydration", () => {
      expect(
        resolveInitialStreamAnimation({
          ...input,
          committedScopeId: null,
        }),
      ).toBe(false);
    });

    it("does not replay a completed assistant across a thread switch", () => {
      expect(
        resolveInitialStreamAnimation({
          ...input,
          currentScopeId: "environment-local:thread-2",
        }),
      ).toBe(false);
    });

    it("keeps a new legacy streaming assistant eligible without a matching turn", () => {
      expect(
        resolveInitialStreamAnimation({
          ...input,
          messageTurnId: TurnId.make("turn-unrelated"),
          isStreaming: true,
        }),
      ).toBe(true);
    });
  });

  it("renders a feedback command and its pending response as normal thread messages", () => {
    const submission = {
      id: MessageId.make("feedback-command"),
      command: "/feedback The agent stopped early.",
      createdAt: MESSAGE_CREATED_AT,
      status: "uploading" as const,
    };
    const messages = [
      codexFeedbackMessage(submission),
      codexFeedbackMessage(submission, "assistant"),
    ];
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={messages.map((message) => ({
          id: message.id,
          kind: "message" as const,
          createdAt: message.createdAt,
          message,
        }))}
      />,
    );

    expect(markup).toContain("/feedback The agent stopped early.");
    expect(markup).toContain("Sending feedback to OpenAI...");
  });

  it("renders the returned Codex thread ID in the feedback response", () => {
    const submission = {
      id: MessageId.make("feedback-command"),
      command: "/feedback The agent stopped early.",
      createdAt: MESSAGE_CREATED_AT,
      status: "sent" as const,
      feedbackId: "codex-thread-1",
    };
    const messages = [
      codexFeedbackMessage(submission),
      codexFeedbackMessage(submission, "assistant"),
    ];
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={messages.map((message) => ({
          id: message.id,
          kind: "message" as const,
          createdAt: message.createdAt,
          message,
        }))}
      />,
    );

    expect(markup).toContain("Feedback sent to OpenAI.");
    expect(markup).toContain("codex-thread-1");
  });

  it("renders the worked-for row at assistant response text size", () => {
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
    expect(markup).toContain("px-1 text-sm leading-relaxed text-muted-foreground");
  });

  it("renders the Classic worked-for row at the compact legacy text size", () => {
    chatVisualModeState.mode = "classic";
    const turnId = TurnId.make("turn-with-classic-fold");
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
            id: "classic-work-entry-with-fold",
            kind: "work",
            createdAt: "2026-03-17T19:12:22.000Z",
            entry: {
              id: "classic-work-with-fold",
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
    expect(markup).toContain("px-1 text-xs text-muted-foreground");
    expect(markup).not.toContain("px-1 text-sm leading-relaxed text-muted-foreground");
  });

  it("uses time-only message timestamps in Classic mode", () => {
    const timelineEntries = [buildUserTimelineEntry("Hello")];
    const shortTimestamp = formatShortTimestamp(MESSAGE_CREATED_AT, "12-hour");
    const dayAwareTimestamp = formatDayAwareTimestamp(MESSAGE_CREATED_AT, "12-hour");

    const currentMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timestampFormat="12-hour"
        timelineEntries={timelineEntries}
      />,
    );
    chatVisualModeState.mode = "classic";
    const classicMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timestampFormat="12-hour"
        timelineEntries={timelineEntries}
      />,
    );

    expect(currentMarkup).toContain(`>${dayAwareTimestamp}</p>`);
    expect(classicMarkup).toContain(`>${shortTimestamp}</p>`);
    expect(classicMarkup).not.toContain(`>${dayAwareTimestamp}</p>`);
  });

  it("keeps visible-content anchoring and end-follow behavior enabled in Classic mode", () => {
    chatVisualModeState.mode = "classic";
    const firstEntry = buildUserTimelineEntry("First prompt.");
    const anchoredMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        anchorMessageId={firstEntry.message.id}
        timelineEntries={[firstEntry]}
      />,
    );
    const followingMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[firstEntry]} />,
    );

    expect(anchoredMarkup).toContain('data-anchor-index="0"');
    expect(anchoredMarkup).toContain('data-maintain-visible-content-position-data="true"');
    expect(anchoredMarkup).toContain('data-maintain-visible-content-position-size="true"');
    expect(followingMarkup).toContain('data-maintain-scroll-at-end="enabled"');
  });

  it("uses the larger leading inset only when the top fade is enabled", () => {
    const timelineEntries = [buildUserTimelineEntry("Hello")];

    const compactMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} />,
    );
    const fadedMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} topFadeEnabled />,
    );

    expect(compactMarkup).toContain('class="h-3 sm:h-4"');
    expect(compactMarkup).not.toContain("topbar-scroll-fade");
    expect(fadedMarkup).toContain('class="h-10 sm:h-12"');
    expect(fadedMarkup).toContain("topbar-scroll-fade");
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
        turnDiffSummaryByAssistantMessageId={
          new Map([
            [
              assistantMessageId,
              {
                turnId,
                checkpointTurnCount: 1,
                checkpointRef: CheckpointRef.make("checkpoint-with-files"),
                status: "ready",
                files: [{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }],
                assistantMessageId,
                completedAt: MESSAGE_CREATED_AT,
              },
            ],
          ])
        }
      />,
    );

    expect(markup).toContain("sticky top-2 z-10");
    expect(markup).not.toContain("self-start");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("!size-[22px]");
    expect(markup).toContain("size-3");
    expect(markup).toContain('aria-label="Collapse all folders"');
    expect(markup).toContain('aria-label="Open diff"');
    expect(markup).toContain("1 changed file");
  });

  it("treats only the strict list end as the live edge", async () => {
    const {
      resolveTimelineIsAtEnd,
      resolveTimelineMinimapHasPersistentGutter,
      resolveTimelineMinimapHeightStyle,
      resolveTimelineMinimapHitStripWidth,
      resolveTimelineMinimapIndexFromPointer,
      resolveTimelineMinimapInteractiveWidth,
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
    // The composer inset is part of contentLength and must not count as
    // distance-to-end.
    expect(
      resolveTimelineIsAtEnd(
        { isAtEnd: false, contentLength: 2100, scroll: 1170, scrollLength: 800 },
        100,
      ),
    ).toBe(true);
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
    expect(resolveTimelineMinimapHasPersistentGutter(832)).toBe(false);
    expect(resolveTimelineMinimapHasPersistentGutter(863)).toBe(false);
    expect(resolveTimelineMinimapHasPersistentGutter(864)).toBe(true);

    // No usable gutter (zoomed in / narrow pane): the strip must go inert
    // instead of overlaying the centered content column.
    expect(resolveTimelineMinimapHitStripWidth(768)).toBe(0);
    expect(resolveTimelineMinimapHitStripWidth(792)).toBe(0);
    // Partial gutter: strip shrinks to what fits between the viewport edge
    // and the content column.
    expect(resolveTimelineMinimapHitStripWidth(820)).toBe(14);
    // Full gutter: unchanged 40px-wide strip.
    expect(resolveTimelineMinimapHitStripWidth(872)).toBe(40);
    expect(resolveTimelineMinimapHitStripWidth(1400)).toBe(40);
    expect(resolveTimelineMinimapHitStripWidth(0)).toBe(0);
    expect(resolveTimelineMinimapHitStripWidth(Number.NaN)).toBe(0);

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
    const firstEntry = {
      ...buildUserTimelineEntry("First prompt."),
      message: {
        ...buildUserTimelineEntry("First prompt.").message,
        attachments: [
          {
            type: "image" as const,
            id: "attachment-1",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 1,
            previewUrl: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
    };
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
    expect(markup).toContain('data-anchor-offset="16"');
    expect(markup).toContain('data-anchor-on-ready="true"');
    expect(markup).not.toContain("data-anchor-max-size=");
    expect(markup).toContain('data-content-inset-end="144"');
    expect(markup).toContain("[overflow-anchor:none]");
    expect(markup).not.toContain('data-maintain-scroll-at-end="enabled"');
    expect(markup).toContain('data-maintain-visible-content-position="object"');
    expect(markup).toContain('data-maintain-visible-content-position-data="true"');
    expect(markup).toContain('data-maintain-visible-content-position-size="true"');
    expect(markup).toContain('data-maintain-visible-content-position-restore="true"');
    expect(onAnchorReady).toHaveBeenCalledOnce();
    expect(onAnchorReady).toHaveBeenCalledWith(firstEntry.message.id, 0);
  });

  it("renders synchronized audio attachments with native playback controls", () => {
    const entry = {
      ...buildUserTimelineEntry("Imported voice note."),
      message: {
        ...buildUserTimelineEntry("Imported voice note.").message,
        attachments: [
          {
            type: "audio" as const,
            id: "audio-attachment-1",
            name: "voice-note.ogg",
            mimeType: "audio/ogg",
            sizeBytes: 5,
            previewUrl: "https://example.test/assets/voice-note.ogg",
          },
        ],
      },
    };

    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[entry]} />,
    );

    expect(markup).toContain("<audio");
    expect(markup).toContain('src="https://example.test/assets/voice-note.ogg"');
    expect(markup).toContain("voice-note.ogg");
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

  it("renders generic attachments as download links instead of image previews", () => {
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

    expect(markup).toContain(
      '<a href="https://environment.test/api/assets/report.pdf" download="report.pdf" class="flex min-w-0 items-center gap-2 rounded-md py-1 text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70">',
    );
    expect(markup).not.toContain('alt="report.pdf"');
  });

  it("renders a file download button without creating its URL in advance", () => {
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
          },
        ],
      },
    };

    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[entry]} />,
    );

    expect(markup).toContain(
      '<button type="button" aria-label="Download report.pdf" class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md py-1 text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70">',
    );
    expect(markup).not.toContain("href=");
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
    expect(markup).not.toContain("href=");
  });

  it("keeps reserved end space when tool work starts while reading history", () => {
    const turnId = TurnId.make("turn-with-active-tool");
    const firstEntry = buildUserTimelineEntry("Run the command.");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
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
    expect(markup).toContain("yoo what&#x27;s</p>");
    expect(markup).toContain('<span aria-hidden="true"> </span>');
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

    expect(markup).toContain('aria-label="Copy link"');
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
              label: "Context compacted",
              tone: "info",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Context compacted");
  });

  it("renders project-agent coordination activities as messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "coordination-activity",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "coordination-activity",
              createdAt: MESSAGE_CREATED_AT,
              label: "Received request from API agent",
              tone: "info",
              sourceActivityKind: "coordination.message.received",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Received request from API agent");
    expect(markup).toContain("lucide-message-circle");
  });

  it("renders subagent launches as informational status notifications", () => {
    const agentPanelModel = deriveAgentPanelModel({
      agents: foldSubagentActivities([
        {
          id: "activity-agent-started",
          tone: "info",
          kind: "task.started",
          summary: "Started subagent",
          payload: {
            taskId: "child-1",
            taskType: "local_agent",
            agentKind: "agent",
            title: "Explore the repository",
          },
          turnId: null,
          createdAt: MESSAGE_CREATED_AT,
        } as OrchestrationThreadActivity,
        {
          id: "activity-agent-usage",
          tone: "info",
          kind: "task.progress",
          summary: "Updated subagent usage",
          payload: {
            taskId: "child-1",
            agentKind: "agent",
            usageSnapshot: true,
            typedUsage: {
              totalTokens: 900,
              inputTokens: 700,
              outputTokens: 150,
            },
          },
          turnId: null,
          createdAt: MESSAGE_CREATED_AT,
        } as OrchestrationThreadActivity,
      ]),
    });
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        agentPanelModel={agentPanelModel}
        timelineEntries={[
          {
            id: "agent-spawn-notification",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "agent-spawn-notification",
              createdAt: MESSAGE_CREATED_AT,
              label: "Started subagents",
              tone: "info",
              agentSpawn: {
                workflowId: null,
                agentTaskIds: ["child-1", "child-2", "child-3", "child-4"],
              },
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-subagent-spawn-notification="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Kicked off 4 subagents");
    expect(markup).toContain("1 working");
    expect(markup).toContain("Input");
    expect(markup).toContain("700");
    expect(markup).toContain("Output");
    expect(markup).toContain("150");
    expect(markup).toContain("Total");
    expect(markup).toContain("900");
    expect(markup).not.toContain("Open Agents");
  });

  it("formats changed file paths from the workspace root", () => {
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
              label: "Run search",
              tone: "tool",
              itemType: "command_execution",
              toolLifecycleStatus: "failed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Ran 2 commands");
    expect(markup).not.toContain('aria-label="Tool call failed"');
  });

  it("renders completed Classic tool activity as compact heading-and-detail rows", () => {
    chatVisualModeState.mode = "classic";
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "classic-command-entry",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "classic-command",
              createdAt: MESSAGE_CREATED_AT,
              label: "Run tests complete",
              toolTitle: "Run tests",
              tone: "tool",
              itemType: "command_execution",
              command: "pnpm test",
              toolLifecycleStatus: "completed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Run tests");
    expect(markup).toContain("pnpm test");
    expect(markup).toContain("text-[12px] leading-5");
    expect(markup).toContain("lucide-chevron-down");
    expect(markup).toContain("lucide-check");
    expect(markup).not.toContain("Ran 1 command");
    expect(markup).not.toContain("live-activity-focus");
  });

  it("keeps Classic activity individual and uses the legacy previous-entry overflow toggle", () => {
    chatVisualModeState.mode = "classic";
    const timelineEntries = ["First", "Second", "Third"].map((ordinal, index) => ({
      id: `classic-overflow-entry-${index}`,
      kind: "work" as const,
      createdAt: `2026-03-17T19:12:${String(28 + index).padStart(2, "0")}.000Z`,
      entry: {
        id: `classic-overflow-work-${index}`,
        createdAt: `2026-03-17T19:12:${String(28 + index).padStart(2, "0")}.000Z`,
        label: `${ordinal} command complete`,
        toolTitle: `${ordinal} command`,
        tone: "tool" as const,
        itemType: "command_execution" as const,
        command: `command-${index + 1}`,
        toolLifecycleStatus: "completed" as const,
      },
    }));

    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} />,
    );

    expect(markup).toContain("Third command");
    expect(markup).toContain("+2 previous tool calls");
    expect(markup).not.toContain("First command");
    expect(markup).not.toContain("Second command");
    expect(markup).not.toContain("Ran 3 commands");
  });

  it("renders Classic tool failures with the compact failure status affordance", () => {
    chatVisualModeState.mode = "classic";
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "classic-failed-entry",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "classic-failed-work",
              createdAt: MESSAGE_CREATED_AT,
              label: "Run lint",
              tone: "tool",
              itemType: "command_execution",
              command: "pnpm lint",
              detail: "Exited with exit code 1",
              toolLifecycleStatus: "failed",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Run lint");
    expect(markup).toContain("lucide-x");
    expect(markup).toContain('aria-label="Tool call failed"');
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
    expect(markup).toContain("tool call failed");
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

  it("shows the animated one-line label for a live tool group", () => {
    const turnId = TurnId.make("turn-live");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
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

    expect(markup).toContain("Running pnpm");
    expect(markup).toContain("live-activity-focus");
  });

  it("scopes a live row failure to the tool named by the row", () => {
    const turnId = TurnId.make("turn-live");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
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

  it("keeps terminal command copy live while the parent turn is active", () => {
    const turnId = TurnId.make("turn-live");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
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
        ]}
      />,
    );

    expect(markup).toContain("Running pnpm");
    expect(markup).toContain("tool call failed");
  });

  it("renders the Classic three-dot working row without Thinking or a live sweep", () => {
    chatVisualModeState.mode = "classic";
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        workingStepLabel="Run focused tests"
        timelineEntries={[]}
      />,
    );

    expect(markup).toContain("Working for");
    expect(markup).toContain("Run focused tests");
    expect(markup).toContain("text-[11px]");
    expect(markup.match(/animate-status-pulse/g)).toHaveLength(3);
    expect(markup).not.toContain("Thinking");
    expect(markup).not.toContain("live-activity-focus");
  });

  it("keeps active Classic tools behind the compact working indicator", () => {
    chatVisualModeState.mode = "classic";
    const turnId = TurnId.make("classic-active-turn");
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
            id: "classic-active-entry",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "classic-active-work",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              toolCallId: "classic-active-call",
              label: "Run focused tests",
              toolTitle: "Run focused tests",
              tone: "tool",
              itemType: "command_execution",
              command: "pnpm test MessagesTimeline",
              toolLifecycleStatus: "inProgress",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Working for");
    expect(markup.match(/animate-status-pulse/g)).toHaveLength(3);
    expect(markup).not.toContain("Run focused tests");
    expect(markup).not.toContain("pnpm test MessagesTimeline");
    expect(markup).not.toContain("Running pnpm");
    expect(markup).not.toContain("Thinking");
    expect(markup).not.toContain("live-activity-focus");
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

    expect(markup).toContain("contextWindow.test.ts");
    expect(markup).toContain("Wadduo");
    expect(markup).toContain('data-testid="file-diff"');
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

    expect(markup).toContain("plan.md");
    expect(markup).toContain("Clarify this.");
    expect(markup).toContain("# Plan");
    expect(markup).not.toContain('data-testid="file-diff"');
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
    // Ordinary tool failures render muted, not red.
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

    expect(markup).toContain("lucide-x");
    expect(markup).toContain("text-destructive");
  });

  it("renders opted-in provider reasoning as expanded, unboxed chat content", () => {
    const timelineEntries = [
      {
        id: "reasoning-entry",
        kind: "work" as const,
        createdAt: MESSAGE_CREATED_AT,
        entry: {
          id: "reasoning-1",
          createdAt: MESSAGE_CREATED_AT,
          label: "Thinking",
          tone: "thinking" as const,
          sourceActivityKind: "reasoning.text",
          detail: "Inspecting the repository before editing.",
        },
      },
    ];

    const defaultMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} />,
    );
    clientSettingsState.showReasoning = true;
    const optedInMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} />,
    );
    chatVisualModeState.mode = "classic";
    const classicMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} />,
    );

    expect(defaultMarkup).not.toContain('data-reasoning-output="true"');
    expect(optedInMarkup).toContain('data-reasoning-output="true"');
    expect(optedInMarkup).toContain('aria-expanded="true"');
    expect(optedInMarkup).toContain('aria-label="Collapse reasoning"');
    expect(optedInMarkup).toContain("Inspecting the repository before editing.");
    expect(optedInMarkup).not.toContain("border-s");
    expect(optedInMarkup).not.toContain("rounded-md");
    expect(classicMarkup).toContain('data-reasoning-output="true"');
    expect(classicMarkup).toContain("Inspecting the repository before editing.");
  });
});
