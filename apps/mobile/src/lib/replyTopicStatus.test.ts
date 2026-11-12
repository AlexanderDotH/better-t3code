import { MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { deriveReplyTopics, type ReplyTopicThread } from "./replyTopicStatus";

const source = ThreadId.make("source");
const prompt = MessageId.make("prompt");
const thread = (id: string, status: string, createdAt = "2026-01-01"): ReplyTopicThread => ({
  id: ThreadId.make(id),
  title: id,
  createdAt,
  messageReply: { sourceThreadId: source, messageId: prompt },
  latestRun: { status, runId: RunId.make(`run-${id}`), assistantMessageId: null },
  source: {
    latestVisibleMessage: { id: MessageId.make("retry"), role: "user" },
    lastError: "failure",
  },
});

describe("reply topic summaries", () => {
  it("counts replies per source and reports the newest topic with pending input taking precedence", () => {
    const topics = deriveReplyTopics(
      [
        thread("new", "running", "2026-02-01"),
        thread("old", "completed"),
        {
          ...thread("other", "failed"),
          messageReply: { sourceThreadId: ThreadId.make("elsewhere"), messageId: prompt },
        },
      ],
      source,
    );
    expect(topics.get(prompt)).toMatchObject({
      threadId: "new",
      count: 2,
      status: "running",
      retry: null,
    });
    expect(
      deriveReplyTopics(
        [{ ...thread("waiting", "running"), hasPendingApprovals: true }],
        source,
      ).get(prompt)?.status,
    ).toBe("waiting");
  });
  it("offers retry only for a failed or stopped topic with an unanswered user prompt", () => {
    for (const status of ["failed", "interrupted", "cancelled"]) {
      const topic = thread("topic", status);
      expect(deriveReplyTopics([topic], source).get(prompt)?.retry).toEqual({
        messageId: "retry",
        runId: "run-topic",
      });
      expect(
        deriveReplyTopics(
          [
            {
              ...topic,
              latestRun: { ...topic.latestRun!, assistantMessageId: MessageId.make("answer") },
            },
          ],
          source,
        ).get(prompt)?.retry,
      ).toBeNull();
    }
    expect(deriveReplyTopics([thread("done", "completed")], source).get(prompt)?.retry).toBeNull();
  });
});
