import { describe, expect, it } from "vite-plus/test";
import { codexFeedbackMessage } from "@t3tools/client-runtime/state/threads";

import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProposedPlan,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

import {
  buildPendingUserInputAnswers,
  buildThreadFeed,
  derivePendingApprovals,
  deriveThreadFeedPresentation,
  formatThreadFeedTimestamp,
  isPendingUserInputOptionSelected,
  resolveThreadFeedChromeRowHeight,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type ThreadFeedActivity,
  type ThreadFeedEntry,
} from "./threadActivity";

describe("Codex feedback pseudo-messages", () => {
  it("keeps pending and completed feedback messages in the mobile thread body", () => {
    const pending = {
      id: MessageId.make("feedback-command"),
      command: "/feedback The agent stopped early.",
      createdAt: "2026-08-23T00:00:00.000Z",
      status: "uploading" as const,
    };
    const entries = [codexFeedbackMessage(pending), codexFeedbackMessage(pending, "assistant")].map(
      (message) => ({
        type: "message" as const,
        id: message.id,
        createdAt: message.createdAt,
        message,
      }),
    );

    expect(deriveThreadFeedPresentation(entries, null, new Set(), "current")).toEqual(entries);
    expect(entries[1]?.message.text).toBe("Sending feedback to OpenAI...");

    const completed = codexFeedbackMessage(
      { ...pending, status: "sent", feedbackId: "codex-thread-1" },
      "assistant",
    );
    expect(completed.text).toContain("codex-thread-1");
  });
});

const singleSelectQuestion = {
  id: "runtime",
  header: "Runtime",
  question: "Which runtime should be used?",
  options: [
    { label: "Go", description: "One binary" },
    { label: "Node.js", description: "Reuse TypeScript" },
  ],
  multiSelect: false,
} as const;

const multiSelectQuestion = {
  id: "scope",
  header: "Scope",
  question: "Which data should be collected?",
  options: [
    { label: "Orders", description: "Receipts" },
    { label: "Listings", description: "Inventory" },
  ],
  multiSelect: true,
} as const;

describe("pending user input answers", () => {
  it("replaces single-select options and toggles multi-select options", () => {
    expect(
      togglePendingUserInputOptionSelection(
        singleSelectQuestion,
        { selectedOptionLabels: ["Go"] },
        "Node.js",
      ),
    ).toEqual({ customAnswer: "", selectedOptionLabels: ["Node.js"] });

    const orders = togglePendingUserInputOptionSelection(multiSelectQuestion, undefined, "Orders");
    const ordersAndListings = togglePendingUserInputOptionSelection(
      multiSelectQuestion,
      orders,
      "Listings",
    );
    expect(ordersAndListings).toEqual({
      customAnswer: "",
      selectedOptionLabels: ["Orders", "Listings"],
    });
    expect(
      togglePendingUserInputOptionSelection(multiSelectQuestion, ordersAndListings, "Orders"),
    ).toEqual({ customAnswer: "", selectedOptionLabels: ["Listings"] });

    const paddedOrders = togglePendingUserInputOptionSelection(
      multiSelectQuestion,
      undefined,
      "  Orders  ",
    );
    expect(paddedOrders).toEqual({ customAnswer: "", selectedOptionLabels: ["Orders"] });
    expect(
      togglePendingUserInputOptionSelection(multiSelectQuestion, paddedOrders, "  Orders  "),
    ).toEqual({ customAnswer: "" });
  });

  it("builds array answers for multi-select questions", () => {
    expect(
      buildPendingUserInputAnswers([singleSelectQuestion, multiSelectQuestion], {
        runtime: { selectedOptionLabels: ["Go"] },
        scope: { selectedOptionLabels: ["Orders", "Listings"] },
      }),
    ).toEqual({
      runtime: "Go",
      scope: ["Orders", "Listings"],
    });
  });

  it("clears selected options while a custom answer is active", () => {
    expect(
      setPendingUserInputCustomAnswer(
        { selectedOptionLabels: ["Orders", "Listings"] },
        "Orders first",
      ),
    ).toEqual({ customAnswer: "Orders first" });
  });

  it("matches selected chips against normalized option labels", () => {
    expect(
      isPendingUserInputOptionSelected({ selectedOptionLabels: ["Orders"] }, "  Orders  "),
    ).toBe(true);
    expect(
      isPendingUserInputOptionSelected(
        { selectedOptionLabels: ["Orders"], customAnswer: "Orders first" },
        "  Orders  ",
      ),
    ).toBe(false);
  });
});

describe("frozen inherited requests", () => {
  it("does not expose inherited approval requests as live controls", () => {
    const sourceThreadId = ThreadId.make("thread-source");
    const activities = [
      makeActivity({
        id: EventId.make("approval-history"),
        kind: "approval.requested",
        summary: "Approve command",
        createdAt: "2026-04-01T00:00:01.000Z",
        payload: { requestId: "request-history", requestKind: "command" },
        historyOrigin: { sourceThreadId, sourceId: "source-approval", ordinal: 1 },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });
});

describe("pending approvals", () => {
  it("keeps app access approvals and persistence choices from remote environments", () => {
    const options = [
      { decision: "decline", label: "Decline" },
      { decision: "acceptAlways", label: "Always allow Safari" },
      { decision: "accept", label: "Approve" },
    ];
    const activity = makeActivity({
      id: EventId.make("approval-safari"),
      kind: "approval.requested",
      summary: "App access approval requested",
      createdAt: "2026-08-24T00:00:00.000Z",
      payload: {
        requestId: "req-safari",
        requestType: "mcp_elicitation_approval",
        detail: "Allow ChatGPT to use Safari?",
        appName: "Safari",
        options,
      },
    });

    expect(derivePendingApprovals([activity])).toEqual([
      {
        requestId: "req-safari",
        requestKind: "mcp-elicitation",
        createdAt: "2026-08-24T00:00:00.000Z",
        detail: "Allow ChatGPT to use Safari?",
        appName: "Safari",
        options,
      },
    ]);
  });

  it("removes an app access approval after a remote client rejects it", () => {
    const requested = makeActivity({
      id: EventId.make("approval-safari-open"),
      kind: "approval.requested",
      summary: "App access approval requested",
      createdAt: "2026-08-24T00:00:00.000Z",
      payload: { requestId: "req-safari", requestKind: "mcp-elicitation" },
    });
    const resolved = makeActivity({
      id: EventId.make("approval-safari-resolved"),
      kind: "approval.resolved",
      summary: "Approval resolved",
      createdAt: "2026-08-24T00:00:01.000Z",
      payload: { requestId: "req-safari", decision: "decline" },
    });

    expect(derivePendingApprovals([requested, resolved])).toEqual([]);
  });
});

function makeActivity(
  input: Partial<OrchestrationThreadActivity> &
    Pick<OrchestrationThreadActivity, "id" | "kind" | "summary" | "createdAt">,
): OrchestrationThreadActivity {
  return {
    tone: "info",
    payload: {},
    turnId: null,
    ...input,
  };
}

function makeThread(
  input: Partial<OrchestrationThread> & Pick<OrchestrationThread, "id" | "projectId" | "title">,
): OrchestrationThread {
  return {
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    subagents: [],
    checkpoints: [],
    session: null,
    ...input,
    settledOverride: input.settledOverride ?? null,
    settledAt: input.settledAt ?? null,
  };
}

describe("buildThreadFeed", () => {
  it("preserves inherited history order through activity grouping and turn folding", () => {
    const sourceThreadId = ThreadId.make("thread-source");
    const turnId = TurnId.make("turn-history");
    const thread = makeThread({
      id: ThreadId.make("thread-fork"),
      projectId: ProjectId.make("project-1"),
      title: "Forked thread",
      messages: [
        {
          id: MessageId.make("assistant-history"),
          role: "assistant",
          text: "Inherited answer",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:03.000Z",
          updatedAt: "2026-04-01T00:00:03.000Z",
          historyOrigin: { sourceThreadId, sourceId: "source-message", ordinal: 3 },
        },
      ],
      activities: [
        makeActivity({
          id: EventId.make("activity-history"),
          kind: "runtime.warning",
          summary: "Inherited work",
          turnId,
          createdAt: "2026-04-01T00:00:02.000Z",
          historyOrigin: { sourceThreadId, sourceId: "source-activity", ordinal: 2 },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    expect(feed[0]).toMatchObject({
      type: "activity-group",
      activities: [{ historyOrigin: { sourceId: "source-activity", ordinal: 2 } }],
    });
    expect(
      deriveThreadFeedPresentation(feed, null, new Set([turnId]), "current").map((entry) => ({
        id: entry.id,
        historyOrigin: "historyOrigin" in entry ? entry.historyOrigin : undefined,
      })),
    ).toContainEqual({
      id: "turn-fold:turn-history",
      historyOrigin: { sourceThreadId, sourceId: "source-message", ordinal: 3 },
    });
  });

  it("does not present inherited in-progress work as live", () => {
    const sourceThreadId = ThreadId.make("thread-source");
    const turnId = TurnId.make("turn-history");
    const thread = makeThread({
      id: ThreadId.make("thread-fork"),
      projectId: ProjectId.make("project-1"),
      title: "Forked thread",
      activities: [
        makeActivity({
          id: EventId.make("tool-history"),
          kind: "tool.updated",
          tone: "tool",
          summary: "Ran command",
          turnId,
          createdAt: "2026-04-01T00:00:02.000Z",
          payload: {
            itemType: "command_execution",
            status: "inProgress",
            detail: "pnpm test",
          },
          historyOrigin: { sourceThreadId, sourceId: "source-tool", ordinal: 2 },
        }),
      ],
    });

    expect(
      deriveThreadFeedPresentation(
        buildThreadFeed(thread),
        {
          turnId,
          state: "running",
          startedAt: "2026-04-01T00:00:01.000Z",
          completedAt: null,
        },
        new Set(),
        "current",
      ),
    ).toMatchObject([{ type: "work-summary", live: false }]);
  });

  it("places proposed plans in timeline order and preserves their implementation state", () => {
    const proposedPlan: OrchestrationProposedPlan = {
      id: "plan-1",
      turnId: TurnId.make("turn-1"),
      planMarkdown: "# Mobile parity\n\n- Add plan cards\n- Add subagents",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: "2026-04-01T00:00:02.000Z",
      updatedAt: "2026-04-01T00:00:02.000Z",
    };
    const thread = makeThread({
      id: ThreadId.make("thread-plan"),
      projectId: ProjectId.make("project-1"),
      title: "Plan thread",
      messages: [
        {
          id: MessageId.make("before-plan"),
          role: "assistant",
          text: "I made a plan.",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: "2026-04-01T00:00:01.000Z",
          updatedAt: "2026-04-01T00:00:01.000Z",
        },
      ],
      proposedPlans: [proposedPlan],
    });

    expect(buildThreadFeed(thread)).toMatchObject([
      { type: "message", id: "before-plan" },
      { type: "proposed-plan", id: "plan-1", proposedPlan },
    ]);
  });

  it("keeps older local feedback before newer messages returned by the server", () => {
    const submission = {
      id: MessageId.make("feedback-command-ordering"),
      command: "/feedback The agent stopped early.",
      createdAt: "2026-08-23T00:00:01.000Z",
      status: "sent" as const,
      feedbackId: "codex-thread-1",
    };
    const laterMessage = {
      id: MessageId.make("later-server-message"),
      role: "assistant" as const,
      text: "Newer server response",
      turnId: null,
      createdAt: "2026-08-23T00:00:02.000Z",
      updatedAt: "2026-08-23T00:00:02.000Z",
      streaming: false,
    };
    const thread = makeThread({
      id: ThreadId.make("thread-feedback-ordering"),
      projectId: ProjectId.make("project-1"),
      title: "Feedback ordering",
      messages: [laterMessage],
    });

    const feed = buildThreadFeed(thread, {
      localMessages: [
        codexFeedbackMessage(submission),
        codexFeedbackMessage(submission, "assistant"),
      ],
    });

    expect(feed.map((entry) => entry.id)).toEqual([
      "feedback-command-ordering",
      "feedback-command-ordering:feedback",
      "later-server-message",
    ]);
  });

  it("keeps historic work entries attributed to their turns", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Runtime warning thread",
      latestTurn: {
        turnId: TurnId.make("turn-latest"),
        state: "running",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("activity-old"),
          kind: "runtime.warning",
          summary: "Runtime warning",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId: TurnId.make("turn-old"),
          payload: {
            message: "Old warning",
          },
        }),
        makeActivity({
          id: EventId.make("activity-latest"),
          kind: "runtime.warning",
          summary: "Runtime warning",
          createdAt: "2026-04-01T00:00:03.000Z",
          turnId: TurnId.make("turn-latest"),
          payload: {
            message: "Latest warning",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    expect(feed).toMatchObject([
      {
        type: "activity-group",
        turnId: "turn-old",
        activities: [{ id: "activity-old", turnId: "turn-old" }],
      },
      {
        type: "activity-group",
        turnId: "turn-latest",
        activities: [{ id: "activity-latest", turnId: "turn-latest" }],
      },
    ]);
  });

  it("drops runtime warnings with no displayable content", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-noise"),
      projectId: ProjectId.make("project-1"),
      title: "Warning noise thread",
      activities: [
        makeActivity({
          id: EventId.make("activity-noise"),
          kind: "runtime.warning",
          summary: "Claude system message 'background_tasks_changed' (no displayable text content)",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId: TurnId.make("turn-1"),
        }),
        makeActivity({
          id: EventId.make("activity-signal"),
          kind: "runtime.warning",
          summary: "Reconnecting... 2/5",
          createdAt: "2026-04-01T00:00:03.000Z",
          turnId: TurnId.make("turn-1"),
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    expect(feed).toMatchObject([
      {
        type: "activity-group",
        activities: [{ id: "activity-signal" }],
      },
    ]);
  });

  it("collapses matching tool lifecycle rows like desktop", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-2"),
      projectId: ProjectId.make("project-1"),
      title: "Collapsed tools",
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:03.000Z",
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("tool-updated"),
          kind: "tool.updated",
          tone: "tool",
          summary: "Run tests",
          createdAt: "2026-04-01T00:00:01.000Z",
          turnId: TurnId.make("turn-1"),
          payload: {
            title: "Run tests",
            itemType: "command_execution",
            detail: "/bin/zsh -lc 'bun run test'",
          },
        }),
        makeActivity({
          id: EventId.make("tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Run tests completed",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId: TurnId.make("turn-1"),
          payload: {
            title: "Run tests",
            itemType: "command_execution",
            detail: "/bin/zsh -lc 'bun run test'",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const group = feed[0];

    expect(group).toMatchObject({
      type: "activity-group",
    });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities).toHaveLength(1);
    expect(group.activities[0]).toMatchObject({
      id: "tool-completed",
      createdAt: "2026-04-01T00:00:02.000Z",
      turnId: "turn-1",
      summary: "Run tests",
      detail: "bun run test",
      canExpand: true,
      icon: "command",
      toolLike: true,
      status: "success",
      toolLifecycleStatus: "completed",
    });
    expect(group.activities[0]?.getFullDetail()).toBe("/bin/zsh -lc 'bun run test'");
    expect(group.activities[0]?.getCopyText()).toBe(
      "Run tests\nbun run test\n/bin/zsh -lc 'bun run test'",
    );
  });

  it("keeps MCP inputs available to expanded mobile work rows", () => {
    const turnId = TurnId.make("turn-mcp");
    const thread = makeThread({
      id: ThreadId.make("thread-mcp"),
      projectId: ProjectId.make("project-1"),
      title: "Expandable MCP call",
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:03.000Z",
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("mcp-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Call repository tool",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId,
          payload: {
            title: "Call repository tool",
            itemType: "mcp_tool_call",
            detail: "repository.search",
            status: "completed",
            data: {
              item: {
                server: "repository",
                tool: "search",
                arguments: { query: "work log" },
              },
            },
          },
        }),
      ],
    });

    const group = buildThreadFeed(thread)[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities[0]?.icon).toBe("wrench");
    expect(group.activities[0]?.getFullDetail()).toContain('"query": "work log"');
    expect(group.activities[0]?.getFullDetail()).toContain("repository.search");
  });

  it("renders project-agent coordination activities as messages", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-coordination"),
      projectId: ProjectId.make("project-1"),
      title: "Coordinating agent",
      activities: [
        makeActivity({
          id: EventId.make("coordination-received"),
          kind: "coordination.message.received",
          summary: "Received request from API agent",
          createdAt: "2026-04-01T00:00:02.000Z",
        }),
      ],
    });

    const group = buildThreadFeed(thread)[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities[0]).toMatchObject({
      summary: "Received request from API agent",
      icon: "message",
      toolLike: false,
      status: null,
    });
  });

  it("defers large tool output expansion until a work row is opened or copied", () => {
    let serializedToolOutputs = 0;
    const activities = Array.from({ length: 5_000 }, (_, index) =>
      makeActivity({
        id: EventId.make(`large-tool-${index}`),
        kind: "tool.completed",
        tone: "tool",
        summary: `Tool ${index}`,
        createdAt: new Date(Date.UTC(2026, 3, 1, 0, 0, index)).toISOString(),
        payload: {
          title: `Tool ${index}`,
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            item: {
              toJSON: () => {
                serializedToolOutputs += 1;
                return { output: "x".repeat(32_768) };
              },
            },
          },
        },
      }),
    );
    const thread = makeThread({
      id: ThreadId.make("thread-large-tools"),
      projectId: ProjectId.make("project-1"),
      title: "Large tools",
      activities,
    });

    const feed = buildThreadFeed(thread);
    expect(serializedToolOutputs).toBe(0);

    const group = feed[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities).toHaveLength(5_000);
    expect(group.activities[0]?.getFullDetail()).toContain('"output"');
    expect(serializedToolOutputs).toBe(1);
    expect(group.activities[0]?.getCopyText()).toContain('"output"');
    expect(serializedToolOutputs).toBe(1);
  });

  it("keeps the first and terminal assistant messages visible around settled work", () => {
    const turnId = TurnId.make("turn-1");
    const thread = makeThread({
      id: ThreadId.make("thread-3"),
      projectId: ProjectId.make("project-1"),
      title: "Folded work",
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:18.000Z",
        assistantMessageId: MessageId.make("assistant-final"),
      },
      messages: [
        {
          id: MessageId.make("assistant-first"),
          role: "assistant",
          text: "Synthetic deployment checklist\n1. Confirm the deployment is ready.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:02.000Z",
          updatedAt: "2026-04-01T00:00:03.000Z",
        },
        {
          id: MessageId.make("assistant-final"),
          role: "assistant",
          text: "Done.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:17.000Z",
          updatedAt: "2026-04-01T00:00:18.000Z",
        },
      ],
      activities: [
        makeActivity({
          id: EventId.make("tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Read files",
          createdAt: "2026-04-01T00:00:05.000Z",
          turnId,
          payload: {
            title: "Read files",
            itemType: "file_read",
            status: "completed",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const collapsed = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set(), "classic");
    expect(collapsed.map((entry) => entry.id)).toEqual([
      "assistant-first",
      "turn-fold:turn-1",
      "assistant-final",
    ]);
    expect(collapsed[1]).toMatchObject({
      type: "turn-fold",
      label: "Worked for 17s",
      expanded: false,
    });

    const expanded = deriveThreadFeedPresentation(
      feed,
      thread.latestTurn,
      new Set([turnId]),
      "classic",
    );
    expect(expanded.map((entry) => entry.id)).toEqual([
      "assistant-first",
      "turn-fold:turn-1",
      "tool-completed",
      "assistant-final",
    ]);
  });

  it("folds assistant messages between the first and terminal messages", () => {
    const turnId = TurnId.make("turn-1");
    const thread = makeThread({
      id: ThreadId.make("thread-middle-message"),
      projectId: ProjectId.make("project-1"),
      title: "Bounded narration",
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:06.000Z",
        assistantMessageId: MessageId.make("assistant-final"),
      },
      messages: [
        {
          id: MessageId.make("assistant-first"),
          role: "assistant",
          text: "The main result is ready.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:01.000Z",
          updatedAt: "2026-04-01T00:00:02.000Z",
        },
        {
          id: MessageId.make("assistant-middle"),
          role: "assistant",
          text: "I am checking one more detail.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:03.000Z",
          updatedAt: "2026-04-01T00:00:04.000Z",
        },
        {
          id: MessageId.make("assistant-final"),
          role: "assistant",
          text: "Verification finished.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:05.000Z",
          updatedAt: "2026-04-01T00:00:06.000Z",
        },
      ],
    });

    const feed = buildThreadFeed(thread);
    const rows = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set(), "current");

    expect(rows.map((entry) => entry.id)).toEqual([
      "assistant-first",
      "turn-fold:turn-1",
      "assistant-final",
    ]);
  });

  it("measures a steer-superseded turn from its user boundary through trailing work", () => {
    const firstTurnId = TurnId.make("turn-1");
    const secondTurnId = TurnId.make("turn-2");
    const thread = makeThread({
      id: ThreadId.make("thread-steered"),
      projectId: ProjectId.make("project-1"),
      title: "Steered work",
      latestTurn: {
        turnId: secondTurnId,
        state: "running",
        requestedAt: "2026-04-01T00:00:14.000Z",
        startedAt: "2026-04-01T00:00:14.000Z",
        completedAt: null,
        assistantMessageId: MessageId.make("assistant-next"),
      },
      messages: [
        {
          id: MessageId.make("user-1"),
          role: "user",
          text: "Do it once more.",
          turnId: null,
          streaming: false,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        {
          id: MessageId.make("assistant-commentary"),
          role: "assistant",
          text: "Kicking off call 1.",
          turnId: firstTurnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:09.000Z",
          updatedAt: "2026-04-01T00:00:09.000Z",
        },
        {
          id: MessageId.make("user-2"),
          role: "user",
          text: "Actually do 15.",
          turnId: null,
          streaming: false,
          createdAt: "2026-04-01T00:00:14.000Z",
          updatedAt: "2026-04-01T00:00:14.000Z",
        },
        {
          id: MessageId.make("assistant-next"),
          role: "assistant",
          text: "One down - adjusting.",
          turnId: secondTurnId,
          streaming: true,
          createdAt: "2026-04-01T00:00:17.000Z",
          updatedAt: "2026-04-01T00:00:17.000Z",
        },
      ],
      activities: [
        makeActivity({
          id: EventId.make("work-1"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Ran command",
          createdAt: "2026-04-01T00:00:12.000Z",
          turnId: firstTurnId,
          payload: {
            title: "Ran command",
            itemType: "command_execution",
            status: "completed",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const collapsed = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set(), "classic");
    expect(collapsed.find((entry) => entry.type === "turn-fold")).toMatchObject({
      turnId: firstTurnId,
      label: "Worked for 12s",
    });
  });

  it("keeps an active turn expanded and classifies error-shaped tool output", () => {
    const turnId = TurnId.make("turn-running");
    const thread = makeThread({
      id: ThreadId.make("thread-4"),
      projectId: ProjectId.make("project-1"),
      title: "Running work",
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("tool-failed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Run command",
          createdAt: "2026-04-01T00:00:05.000Z",
          turnId,
          payload: {
            title: "Run command",
            itemType: "command_execution",
            detail: "zsh: command not found: nope",
            status: "completed",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    expect(deriveThreadFeedPresentation(feed, thread.latestTurn, new Set(), "classic")).toEqual(
      feed,
    );
    expect(feed[0]).toMatchObject({
      type: "activity-group",
      activities: [{ status: "failure" }],
    });
  });

  it("appends active work as a normal timeline row", () => {
    const startedAt = "2026-04-01T00:00:01.000Z";
    const presented = deriveThreadFeedPresentation(
      [],
      null,
      new Set(),
      "classic",
      new Set(),
      startedAt,
    );

    expect(presented).toEqual([
      {
        type: "working",
        id: "working-indicator-row",
        createdAt: startedAt,
      },
    ]);
    expect(deriveThreadFeedPresentation(presented, null, new Set(), "classic")).toEqual([]);
  });

  it("models work-log overflow as list rows", () => {
    const activity = (
      id: string,
      createdAt: string,
      status: ThreadFeedActivity["status"] = "success",
    ): ThreadFeedActivity => ({
      id,
      createdAt,
      turnId: null,
      summary: `Tool ${id}`,
      detail: null,
      canExpand: false,
      getFullDetail: () => null,
      getCopyText: () => id,
      icon: "command",
      toolLike: true,
      status,
    });
    const feed: ThreadFeedEntry[] = [
      {
        type: "activity-group",
        id: "work-group-1",
        createdAt: "2026-04-01T00:00:01.000Z",
        turnId: null,
        activities: [
          activity("activity-1", "2026-04-01T00:00:01.000Z"),
          activity("activity-neutral", "2026-04-01T00:00:02.000Z", "neutral"),
          activity("activity-2", "2026-04-01T00:00:03.000Z"),
          activity("activity-3", "2026-04-01T00:00:04.000Z"),
        ],
      },
    ];

    const collapsed = deriveThreadFeedPresentation(feed, null, new Set(), "classic");
    expect(collapsed.map((entry) => entry.id)).toEqual(["activity-3", "work-toggle:work-group-1"]);
    expect(collapsed[1]).toMatchObject({
      type: "work-toggle",
      groupId: "work-group-1",
      hiddenCount: 2,
      expanded: false,
    });

    const expanded = deriveThreadFeedPresentation(
      feed,
      null,
      new Set(),
      "classic",
      new Set(["work-group-1"]),
    );
    expect(expanded.map((entry) => entry.id)).toEqual([
      "activity-1",
      "activity-2",
      "activity-3",
      "work-toggle:work-group-1",
    ]);
    expect(expanded.at(-1)).toMatchObject({
      type: "work-toggle",
      expanded: true,
    });
  });

  it("keeps the compact overflow rows in Classic and summarizes completed tools in Current", () => {
    const activity = (
      id: string,
      icon: ThreadFeedActivity["icon"],
      status: ThreadFeedActivity["status"],
    ): ThreadFeedActivity => ({
      id,
      createdAt: `2026-04-01T00:00:0${id.at(-1)}.000Z`,
      turnId: null,
      summary: `Tool ${id}`,
      detail: null,
      canExpand: false,
      getFullDetail: () => null,
      getCopyText: () => id,
      icon,
      toolLike: true,
      status,
    });
    const feed: ThreadFeedEntry[] = [
      {
        type: "activity-group",
        id: "work-group-current",
        createdAt: "2026-04-01T00:00:01.000Z",
        turnId: null,
        activities: [
          activity("command-1", "command", "success"),
          activity("command-2", "command", "success"),
          activity("read-3", "eye", "success"),
        ],
      },
    ];

    const classic = deriveThreadFeedPresentation(feed, null, new Set(), "classic", new Set(), null);
    expect(classic.map((entry) => entry.id)).toEqual(["read-3", "work-toggle:work-group-current"]);

    const current = deriveThreadFeedPresentation(feed, null, new Set(), "current", new Set(), null);
    expect(current).toEqual([
      expect.objectContaining({
        type: "work-summary",
        id: "work-summary:work-group-current",
        groupId: "work-group-current",
        summary: "Ran 2 commands and read 1 file",
        expanded: false,
        live: false,
        hasFailure: false,
      }),
    ]);

    const expanded = deriveThreadFeedPresentation(
      feed,
      null,
      new Set(),
      "current",
      new Set(["work-group-current"]),
      null,
    );
    expect(expanded[0]).toMatchObject({
      type: "work-summary",
      expanded: true,
      activities: [{ id: "command-1" }, { id: "command-2" }, { id: "read-3" }],
    });
  });

  it("keeps an in-progress Current tool summary visible and announces failures explicitly", () => {
    const activity = (
      id: string,
      summary: string,
      status: ThreadFeedActivity["status"],
      toolLifecycleStatus: ThreadFeedActivity["toolLifecycleStatus"],
    ): ThreadFeedActivity => ({
      id,
      createdAt: `2026-04-01T00:00:0${id.at(-1)}.000Z`,
      turnId: null,
      summary,
      detail: null,
      canExpand: false,
      getFullDetail: () => null,
      getCopyText: () => id,
      icon: "command",
      toolLike: true,
      status,
      toolLifecycleStatus,
    });
    const feed: ThreadFeedEntry[] = [
      {
        type: "activity-group",
        id: "work-group-live",
        createdAt: "2026-04-01T00:00:01.000Z",
        turnId: null,
        activities: [
          activity("tool-1", "Ran setup", "success", "completed"),
          activity("tool-2", "Running tests", "neutral", "inProgress"),
        ],
      },
      {
        type: "activity-group",
        id: "work-group-failed",
        createdAt: "2026-04-01T00:00:03.000Z",
        turnId: null,
        activities: [activity("tool-3", "Ran checks", "failure", "failed")],
      },
      {
        type: "activity-group",
        id: "work-group-mixed",
        createdAt: "2026-04-01T00:00:04.000Z",
        turnId: null,
        activities: [
          activity("tool-4", "Ran passing check", "success", "completed"),
          activity("tool-5", "Ran failing check", "failure", "failed"),
        ],
      },
    ];

    const current = deriveThreadFeedPresentation(feed, null, new Set(), "current", new Set(), null);

    expect(current).toEqual([
      expect.objectContaining({
        type: "work-summary",
        summary: "Running tests",
        live: true,
        hasFailure: false,
      }),
      expect.objectContaining({
        type: "work-summary",
        summary: "Ran 1 command",
        live: false,
        hasFailure: true,
      }),
      expect.objectContaining({
        type: "work-summary",
        summary: "Ran 2 commands",
        live: false,
        hasFailure: false,
      }),
    ]);
  });

  it("uses day-aware Current timestamps while Classic remains time-only", () => {
    const sameDay = new Date(2026, 3, 2, 14, 30);
    const previousDay = new Date(2026, 3, 1, 14, 30);

    const classic = formatThreadFeedTimestamp(
      previousDay.toISOString(),
      "classic",
      sameDay,
      "en-US",
    );
    expect(formatThreadFeedTimestamp(sameDay.toISOString(), "current", sameDay, "en-US")).toBe(
      formatThreadFeedTimestamp(sameDay.toISOString(), "classic", sameDay, "en-US"),
    );
    expect(formatThreadFeedTimestamp(previousDay.toISOString(), "current", sameDay, "en-US")).toBe(
      `Apr 1, ${classic}`,
    );
    expect(formatThreadFeedTimestamp("not-a-date", "current", sameDay, "en-US")).toBe("");
  });

  it("fixes only collapsed chrome row heights for each visual mode", () => {
    const currentSummary = {
      type: "work-summary",
      expanded: false,
    } as ThreadFeedEntry;
    const expandedSummary = {
      type: "work-summary",
      expanded: true,
    } as ThreadFeedEntry;

    expect(
      resolveThreadFeedChromeRowHeight({ type: "turn-fold" } as ThreadFeedEntry, "classic", 41, 49),
    ).toBe(56);
    expect(
      resolveThreadFeedChromeRowHeight({ type: "turn-fold" } as ThreadFeedEntry, "current", 41, 49),
    ).toBe(64);
    expect(
      resolveThreadFeedChromeRowHeight({ type: "working" } as ThreadFeedEntry, "classic", 41, 49),
    ).toBe(41);
    expect(
      resolveThreadFeedChromeRowHeight({ type: "working" } as ThreadFeedEntry, "current", 41, 49),
    ).toBe(49);
    expect(resolveThreadFeedChromeRowHeight(currentSummary, "current", 41, 49)).toBe(40);
    expect(resolveThreadFeedChromeRowHeight(expandedSummary, "current", 41, 49)).toBeUndefined();
  });
});

describe("quiet timeline: nested agents", () => {
  it("keeps a nested agent's terminal row but hides its background work", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-nested"),
      projectId: ProjectId.make("project-1"),
      title: "Nested agents",
      activities: [
        // A subagent's own shell: internal, covered by the owner's liveness.
        makeActivity({
          id: EventId.make("shell-done"),
          kind: "task.completed",
          summary: "Task completed",
          createdAt: "2026-04-01T00:00:02.000Z",
          payload: { taskId: "sh-1", agentId: "owner", agentKind: "background" },
        }),
        // A nested AGENT's completion: mobile has no Agents sheet, so this
        // terminal row is the only signal it ever finished.
        makeActivity({
          id: EventId.make("nested-done"),
          kind: "task.completed",
          summary: "Task completed",
          createdAt: "2026-04-01T00:00:03.000Z",
          payload: { taskId: "n-1", agentId: "owner", agentKind: "agent" },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const ids = feed.flatMap((entry) =>
      entry.type === "activity-group" ? entry.activities.map((row) => row.id) : [],
    );
    expect(ids).toContain("nested-done");
    expect(ids).not.toContain("shell-done");
  });
});
