import { CheckpointRef, MessageId, SubagentId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  deriveTimelineEntries,
  deriveTimelineEntriesWithState,
  timelineMessageKey,
} from "../../session-logic";
import type { ChatMessage } from "../../types";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";

function message(
  id: string,
  role: ChatMessage["role"],
  second: number,
  topic?: string,
): ChatMessage {
  const createdAt = `2026-10-01T12:00:${String(second).padStart(2, "0")}.000Z`;
  return {
    id: MessageId.make(id),
    role,
    text: `${role} ${topic ?? "root"}`,
    turnId: TurnId.make("same-provider-turn"),
    createdAt,
    updatedAt: createdAt,
    streaming: false,
    ...(topic ? { replyTopicId: SubagentId.make(topic) } : {}),
  };
}

describe("inline reply timeline", () => {
  it("keeps identical provider message IDs isolated during streamed updates", () => {
    const root = message("same-message", "assistant", 1);
    const first = { ...message("same-message", "assistant", 2, "first"), streaming: true };
    const second = message("same-message", "assistant", 3, "second");
    const initial = deriveTimelineEntriesWithState([root, first, second], [], []);
    const next = deriveTimelineEntriesWithState(
      [root, { ...first, text: "First topic progressed" }, second],
      [],
      [],
      initial,
    );
    expect(new Set(next.entries.map(({ id }) => id)).size).toBe(3);
    expect(next.entries.find(({ id }) => id === timelineMessageKey(first))).toMatchObject({
      message: { text: "First topic progressed" },
    });
    expect(next.entries.find(({ id }) => id === root.id)).toBe(initial.entries[0]);
    expect(next.entries.find(({ id }) => id === timelineMessageKey(second))).toBe(
      initial.entries[2],
    );
  });

  it.each(["current", "classic"] as const)(
    "preserves root checkpoints and durations with interleaved %s replies",
    (chatVisualMode) => {
      const rootUser = message("user", "user", 1);
      const topicUser = message("user", "user", 2, "reply");
      const rootAssistant = message("assistant", "assistant", 4);
      const topicAssistant = message("assistant", "assistant", 5, "reply");
      const rows = deriveMessagesTimelineRows({
        chatVisualMode,
        timelineEntries: deriveTimelineEntries(
          [rootUser, topicUser, rootAssistant, topicAssistant],
          [],
          [],
        ),
        latestTurn: {
          turnId: rootAssistant.turnId!,
          state: "completed",
          startedAt: rootUser.createdAt,
          completedAt: rootAssistant.updatedAt,
        },
        isWorking: false,
        activeTurnStartedAt: null,
        supportsConversationRollback: true,
        turnDiffSummaries: [
          {
            turnId: rootAssistant.turnId!,
            assistantMessageId: rootAssistant.id,
            checkpointTurnCount: 2,
            checkpointRef: CheckpointRef.make("root-checkpoint"),
            status: "ready",
            completedAt: rootAssistant.updatedAt,
            files: [],
          },
        ],
      });
      const messages = rows.filter((row) => row.kind === "message");
      expect(messages.find((row) => row.id === rootUser.id)?.revertTurnCount).toBe(1);
      expect(
        messages.find((row) => row.id === timelineMessageKey(topicUser))?.revertTurnCount,
      ).toBeUndefined();
      expect(messages.find((row) => row.id === rootAssistant.id)?.durationStart).toBe(
        rootUser.createdAt,
      );
      expect(messages.find((row) => row.id === timelineMessageKey(topicAssistant))).toMatchObject({
        durationStart: topicUser.createdAt,
        showAssistantMeta: true,
        assistantTurnDiffSummary: undefined,
      });
    },
  );
});
