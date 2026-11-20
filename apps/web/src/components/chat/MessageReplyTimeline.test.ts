import {
  CheckpointRef,
  MessageId,
  ProviderTurnId,
  ProviderDriverKind,
  ProviderThreadId,
  RunId,
  SubagentId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import {
  deriveTimelineEntriesFromVisibleTurnItems,
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
} from "../../session-logic";
import type { ChatMessage } from "../../types";
import {
  deriveMessagesTimelineRows,
  insertInlineReplyMessageRows,
  timelineMessageMatchesReplySource,
} from "./MessagesTimeline.logic";

function message(
  id: string,
  role: ChatMessage["role"],
  second: number,
  topic?: string,
): ChatMessage {
  const createdAt = `2026-10-01T12:00:${String(second).padStart(2, "0")}.000Z`;
  return {
    id: MessageId.make(topic ? `${id}:reply:${topic}` : id),
    role,
    text: `${role} ${topic ?? "root"}`,
    runId: RunId.make(topic ? `reply-run:${topic}` : "root-run"),
    createdAt,
    updatedAt: createdAt,
    streaming: false,
    ...(role === "user" ? { inputIntent: "turn_start" as const } : {}),
    ...(topic
      ? {
          replyTopicId: SubagentId.make(topic),
          replyTo: {
            messageId: MessageId.make("quoted-root-message"),
            role: "assistant" as const,
            text: "Captured quote",
          },
        }
      : {}),
  };
}

function projectedMessage(value: ChatMessage, position: number): OrchestrationV2ProjectedTurnItem {
  const threadId = ThreadId.make(
    value.replyTopicId ? `child:${value.replyTopicId}` : "root-thread",
  );
  const base = {
    id: TurnItemId.make(`item:${value.id}`),
    threadId,
    runId: value.runId,
    nodeId: null,
    providerThreadId: ProviderThreadId.make(
      value.replyTopicId ? `provider-thread:${value.replyTopicId}` : "provider-thread:root",
    ),
    providerTurnId: ProviderTurnId.make(
      value.replyTopicId ? `provider-turn:${value.replyTopicId}` : "provider-turn:root",
    ),
    nativeItemRef: {
      driver: ProviderDriverKind.make("codex"),
      nativeId: value.id.replace(/:reply:.*/, ""),
      strength: "strong" as const,
    },
    parentItemId: null,
    ordinal: position + 1,
    status: value.streaming ? ("running" as const) : ("completed" as const),
    title: null,
    startedAt: DateTime.makeUnsafe(value.createdAt),
    completedAt: DateTime.makeUnsafe(value.updatedAt),
    updatedAt: DateTime.makeUnsafe(value.updatedAt),
    messageId: value.id,
    text: value.text,
    ...(value.replyTo ? { replyTo: value.replyTo } : {}),
    ...(value.replyTopicId ? { replyTopicId: value.replyTopicId } : {}),
  };
  const item: OrchestrationV2TurnItem =
    value.role === "user"
      ? {
          ...base,
          type: "user_message",
          createdBy: "user",
          creationSource: "server",
          inputIntent: "turn_start",
          attachments: [],
        }
      : { ...base, type: "assistant_message", streaming: value.streaming };
  return { item, sourceThreadId: threadId, sourceItemId: item.id, position, visibility: "local" };
}

describe("inline reply timeline", () => {
  it("keeps equal native message references isolated while a reply streams and preserves its quote", () => {
    const root = projectedMessage(message("same-native-message", "assistant", 1), 0);
    const first = projectedMessage(
      { ...message("same-native-message", "assistant", 2, "first"), streaming: true },
      1,
    );
    const second = projectedMessage(message("same-native-message", "assistant", 3, "second"), 2);
    const initial = deriveTimelineEntriesFromVisibleTurnItemsWithState({
      visibleTurnItems: [root, first, second],
      optimisticMessages: [],
    });
    if (first.item.type !== "assistant_message") throw new Error("Expected assistant reply");
    const advanced = { ...first, item: { ...first.item, text: "First topic progressed" } };
    const next = deriveTimelineEntriesFromVisibleTurnItemsWithState(
      { visibleTurnItems: [root, advanced, second], optimisticMessages: [] },
      initial,
    );
    expect(new Set(next.entries.map(({ id }) => id)).size).toBe(3);
    expect(next.entries[1]).toMatchObject({
      message: {
        text: "First topic progressed",
        replyTopicId: "first",
        replyTo: { text: "Captured quote" },
      },
    });
    expect(next.entries[0]).toBe(initial.entries[0]);
    expect(next.entries[2]).toBe(initial.entries[2]);
  });

  it.each(["current", "classic"] as const)(
    "keeps %s reply turns visible alongside a folded parent turn and its checkpoint",
    (chatVisualMode) => {
      const rootUser = message("user", "user", 1);
      const topicUser = message("user", "user", 2, "reply");
      const rootAssistant = message("assistant", "assistant", 4);
      const topicAssistant = message("assistant", "assistant", 5, "reply");
      const workId = "parent-command";
      const workTime = "2026-10-01T12:00:03.000Z";
      const project = (messages: ReadonlyArray<ChatMessage>) =>
        deriveTimelineEntriesFromVisibleTurnItems({
          visibleTurnItems: messages.map(projectedMessage),
          optimisticMessages: [],
        });
      const parentRows = deriveMessagesTimelineRows({
        chatVisualMode,
        timelineEntries: project([rootUser, rootAssistant]).toSpliced(1, 0, {
          kind: "work",
          id: workId,
          createdAt: workTime,
          entry: {
            id: workId,
            createdAt: workTime,
            runId: rootUser.runId,
            label: "Ran command",
            tone: "tool",
            itemType: "command_execution",
            toolLifecycleStatus: "completed",
          },
        }),
        latestRun: {
          runId: rootAssistant.runId!,
          status: "completed",
          startedAt: rootUser.createdAt,
          completedAt: rootAssistant.updatedAt,
          turnEnded: true,
        },
        expandedRunIds: new Set(),
        isWorking: false,
        activeTurnStartedAt: null,
        supportsConversationRollback: true,
        threadStartCheckpointReady: true,
        turnDiffSummaries: [
          {
            runId: rootAssistant.runId!,
            assistantMessageId: rootAssistant.id,
            checkpointTurnCount: 2,
            checkpointRef: CheckpointRef.make("root-checkpoint"),
            status: "ready",
            completedAt: rootAssistant.updatedAt,
            files: [],
          },
        ],
      });
      const rows = insertInlineReplyMessageRows(parentRows, project([topicUser, topicAssistant]));
      const [fold] = rows.filter((row) => row.kind === "turn-fold");
      expect(fold).toMatchObject({ runId: rootUser.runId, expanded: false });
      expect(rows.some((row) => row.id === workId)).toBe(false);
      const messages = rows.filter((row) => row.kind === "message");
      expect(messages.map(({ message }) => message.id)).toEqual([
        rootUser.id,
        topicUser.id,
        rootAssistant.id,
        topicAssistant.id,
      ]);
      expect(
        messages.find((row) => row.message.id === topicAssistant.id)?.inlineReplyThreadId,
      ).toBe("child:reply");
      const matching = messages.filter(({ message }) =>
        timelineMessageMatchesReplySource(message, {
          messageId: topicAssistant.id,
          ...(topicAssistant.replyTopicId ? { replyTopicId: topicAssistant.replyTopicId } : {}),
        }),
      );
      expect(matching.map(({ message }) => message)).toEqual([topicAssistant]);
      expect(
        timelineMessageMatchesReplySource(topicAssistant, { messageId: topicAssistant.id }),
      ).toBe(false);
      expect(messages.find((row) => row.id === rootUser.id)?.revertTurnCount).toBe(0);
      expect(
        messages.find((row) => row.message.id === topicUser.id)?.revertTurnCount,
      ).toBeUndefined();
      expect(
        messages.find((row) => row.id === rootAssistant.id)?.assistantTurnDiffSummary
          ?.checkpointRef,
      ).toBe("root-checkpoint");
      expect(messages.find((row) => row.message.id === topicAssistant.id)).toMatchObject({
        showAssistantMeta: true,
      });
      expect(
        messages.find((row) => row.message.id === topicAssistant.id)?.assistantTurnDiffSummary,
      ).toBeUndefined();
    },
  );
});
