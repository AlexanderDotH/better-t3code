import {
  CheckpointRef,
  MessageId,
  SubagentId,
  TurnId,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { messageCheckpoints } from "./changed-files-summary";
import type { ThreadFeedEntry } from "../../lib/threadActivity";

const turnId = TurnId.make("turn");
const message = (id: string, reply = false): ThreadFeedEntry => ({
  type: "message",
  id,
  createdAt: "2026-10-26T12:00:00Z",
  message: {
    id: MessageId.make(id),
    turnId,
    role: "assistant",
    text: "Answer",
    streaming: false,
    createdAt: "2026-10-26T12:00:00Z",
    updatedAt: "2026-10-26T12:00:00Z",
    ...(reply ? { replyTopicId: SubagentId.make("subagent") } : {}),
  },
});
const checkpoint: OrchestrationCheckpointSummary = {
  turnId,
  checkpointTurnCount: 1,
  checkpointRef: CheckpointRef.make("checkpoint"),
  status: "ready",
  assistantMessageId: MessageId.make("answer"),
  completedAt: "2026-10-26T12:00:01Z",
  files: [{ path: "src/index.ts", kind: "modified", additions: 2, deletions: 1 }],
};

it("attaches checkpoint changes to their answer without repeating them on subagent replies", () => {
  const feed = [message("first"), message("answer"), message("subagent-answer", true)];
  expect([...messageCheckpoints(feed, [checkpoint])]).toEqual([["answer", checkpoint]]);
  const withoutMessageId = { ...checkpoint, assistantMessageId: null };
  expect([...messageCheckpoints(feed, [withoutMessageId])]).toEqual([["answer", withoutMessageId]]);
});

it("does not invent results for unavailable, empty or paginated-away checkpoints", () => {
  expect(messageCheckpoints([message("answer")], [{ ...checkpoint, status: "missing" }]).size).toBe(
    0,
  );
  expect(messageCheckpoints([message("answer")], [{ ...checkpoint, status: "error" }]).size).toBe(
    0,
  );
  expect(messageCheckpoints([message("answer")], [{ ...checkpoint, files: [] }]).size).toBe(0);
  expect(messageCheckpoints([message("older")], [checkpoint]).size).toBe(0);
});
