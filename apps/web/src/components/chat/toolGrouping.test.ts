import { describe, expect, it } from "vite-plus/test";
import { ApprovalRequestId, MessageId, TurnId } from "@t3tools/contracts";
import { deriveTimelineEntries, type WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import {
  deriveMessagesTimelineRows,
  deriveMessagesTimelineRowsWithState,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";

const turnId = TurnId.make("combined-tools");
const timestamp = (second: number) => new Date(Date.UTC(2026, 9, 27, 14, 0, second)).toISOString();
const message = (
  id: string,
  role: ChatMessage["role"],
  second: number,
  text = id,
): ChatMessage => ({
  id: MessageId.make(id),
  role,
  text,
  turnId,
  streaming: role === "reasoning",
  createdAt: timestamp(second),
  updatedAt: timestamp(second),
});
const tool = (id: string, second: number, extra: Partial<WorkLogEntry> = {}): WorkLogEntry => ({
  id,
  toolCallId: id,
  turnId,
  createdAt: timestamp(second),
  tone: "tool",
  label: "Run command",
  command: `echo ${id}`,
  toolLifecycleStatus: "completed",
  ...extra,
});
function input(messages: ChatMessage[], entries: WorkLogEntry[]) {
  return {
    chatVisualMode: "better-t3" as const,
    showReasoning: true,
    hideWorkingIndicator: true,
    timelineEntries: deriveTimelineEntries(messages, [], entries),
    isWorking: false,
    activeTurnStartedAt: timestamp(0),
    turnDiffSummaries: [],
    expandedTurnIds: new Set([turnId, TurnId.make("continuation")]),
    supportsConversationRollback: false,
  };
}
function toolsIn(row: MessagesTimelineRow): WorkLogEntry[] {
  return row.kind === "work-toggle"
    ? (row.detailEntries ?? [])
    : row.kind === "work" || row.kind === "work-live"
      ? row.groupedEntries
      : [];
}
const toolRows = (rows: MessagesTimelineRow[]) => rows.filter((row) => toolsIn(row).length > 0);

describe("Better T3 tool groups between messages", () => {
  it("combines calls across reasoning, continuation turns and orphan traces without losing their order", () => {
    const rows = deriveMessagesTimelineRows(
      input(
        [
          message("request", "user", 0),
          message("first-thought", "reasoning", 2),
          { ...message("orphan-thought", "reasoning", 4), turnId: null },
        ],
        [
          tool("first", 1),
          tool("second", 3, { turnId: TurnId.make("continuation") }),
          tool("third", 5),
        ],
      ),
    );
    expect(toolRows(rows)).toHaveLength(1);
    expect(toolRows(rows)[0]?.kind).toBe("work-toggle");
    expect(toolsIn(toolRows(rows)[0]!).map((entry) => entry.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(rows.filter((row) => row.kind === "activity-group")).toHaveLength(1);
  });

  it("starts a new tool group at a visible assistant or user message", () => {
    const rows = deriveMessagesTimelineRows(
      input(
        [
          message("request", "user", 0),
          message("thought-a", "reasoning", 2),
          message("commentary", "assistant", 4),
          message("thought-b", "reasoning", 6),
          message("next-request", "user", 8),
        ],
        [tool("a", 1), tool("b", 3), tool("c", 5), tool("d", 7), tool("e", 9)],
      ),
    );
    expect(toolRows(rows).map((row) => toolsIn(row).map((entry) => entry.id))).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });

  it("keeps the latest running call and the combined disclosure stable through completion", () => {
    const messages = [
      message("request", "user", 0),
      message("thought-a", "reasoning", 2),
      message("thought-b", "reasoning", 4),
    ];
    const entries = [
      tool("first", 1),
      tool("second", 3),
      tool("running", 5, { toolLifecycleStatus: "inProgress" }),
    ];
    const activeInput = {
      ...input(messages, entries),
      isWorking: true,
      latestTurn: { turnId, state: "running" as const, startedAt: timestamp(0), completedAt: null },
    };
    const live = toolRows(deriveMessagesTimelineRows(activeInput));
    expect(live).toHaveLength(1);
    const running = live[0]!;
    expect(running).toMatchObject({ kind: "work-live", entry: { id: "running" } });
    if (running.kind !== "work-live") throw new Error("Expected live tools");
    expect(toolsIn(running)).toHaveLength(3);
    const completeInput = input(
      messages.map((item) => ({ ...item, streaming: false })),
      entries.map((item) => ({ ...item, toolLifecycleStatus: "completed" })),
    );
    const completed = toolRows(
      deriveMessagesTimelineRows({
        ...completeInput,
        expandedWorkGroupIds: new Set([running.groupId]),
      }),
    )[0]!;
    expect(completed).toMatchObject({
      id: running.id,
      kind: "work-toggle",
      groupId: running.groupId,
      expanded: true,
    });
    expect(toolsIn(completed).map((entry) => entry.id)).toEqual(["first", "second", "running"]);
    expect(
      toolRows(
        deriveMessagesTimelineRows({
          ...completeInput,
          expandedWorkGroupIds: new Set(),
        }),
      )[0],
    ).toMatchObject({ expanded: false });
  });

  it("regroups when an empty streaming placeholder becomes a visible message", () => {
    const placeholder = { ...message("answer", "assistant", 2, ""), streaming: true };
    const initialInput = input(
      [message("request", "user", 0), placeholder],
      [tool("first", 1), tool("second", 3)],
    );
    const before = deriveMessagesTimelineRowsWithState(initialInput);
    expect(toolRows(before.rows)).toHaveLength(1);
    const updatedInput = {
      ...initialInput,
      timelineEntries: initialInput.timelineEntries.map((entry) =>
        entry.kind === "message" && entry.message.id === placeholder.id
          ? { ...entry, message: { ...placeholder, text: "I found the file." } }
          : entry,
      ),
    };
    const after = deriveMessagesTimelineRowsWithState(updatedInput, before);
    expect(toolRows(after.rows)).toHaveLength(2);
    expect(after.rows).toEqual(deriveMessagesTimelineRows(updatedInput));
  });

  it.each(["error", "answer"] as const)("keeps %s visible as its own boundary", (kind) => {
    const boundary = tool(
      kind,
      4,
      kind === "error"
        ? {
            tone: "error",
            sourceActivityKind: "runtime.error",
            label: "Connection failed",
          }
        : {
            questionAnswer: {
              requestId: ApprovalRequestId.make("question"),
              answers: { choice: "Yes" },
              attachmentsByQuestionId: {},
            },
          },
    );
    const rows = deriveMessagesTimelineRows(
      input(
        [
          message("request", "user", 0),
          message("thought-a", "reasoning", 2),
          message("thought-b", "reasoning", 6),
        ],
        [tool("a", 1), tool("b", 3), boundary, tool("c", 5), tool("d", 7)],
      ),
    );
    expect(toolRows(rows).map((row) => toolsIn(row).map((entry) => entry.id))).toEqual([
      ["a", "b"],
      [kind],
      ["c", "d"],
    ]);
  });

  it("does not change grouping in Current and Classic modes", () => {
    const base = input(
      [message("request", "user", 0), message("thought", "reasoning", 2)],
      [tool("first", 1), tool("second", 3)],
    );
    for (const chatVisualMode of ["current", "classic"] as const) {
      expect(toolRows(deriveMessagesTimelineRows({ ...base, chatVisualMode }))).toHaveLength(2);
    }
  });
});
