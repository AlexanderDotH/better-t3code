import {
  MessageId,
  RunId,
  type OrchestrationV2Run,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { v2Now, v2Projection } from "./orchestrationV2TestFixtures.ts";
import { resolveInterruptedTurnRetryTarget } from "./threadRetry.ts";

const run: OrchestrationV2Run = {
  id: RunId.make("interrupted"),
  threadId: v2Projection.thread.id,
  ordinal: 1,
  providerInstanceId: v2Projection.thread.providerInstanceId,
  modelSelection: v2Projection.thread.modelSelection,
  providerThreadId: null,
  userMessageId: MessageId.make("user"),
  rootNodeId: null,
  activeAttemptId: null,
  status: "interrupted",
  requestedAt: v2Now,
  startedAt: v2Now,
  completedAt: v2Now,
  checkpointId: null,
  contextHandoffId: null,
};
const user: OrchestrationV2ConversationMessage = {
  id: run.userMessageId,
  threadId: run.threadId,
  runId: run.id,
  nodeId: null,
  createdBy: "user",
  creationSource: "web",
  role: "user",
  text: "Retry this",
  attachments: [],
  streaming: false,
  createdAt: v2Now,
  updatedAt: v2Now,
};

describe("interrupted V2 retry", () => {
  it("offers the original message only for a stopped result-less run without pending work", () => {
    const projection = { ...v2Projection, runs: [run], messages: [user] };
    expect(resolveInterruptedTurnRetryTarget({ projection })).toEqual({
      messageId: user.id,
      runId: run.id,
    });
    for (const status of [
      "preparing",
      "queued",
      "starting",
      "running",
      "waiting",
      "completed",
    ] as const) {
      expect(
        resolveInterruptedTurnRetryTarget({
          projection: { ...projection, runs: [{ ...run, status }] },
        }),
      ).toBeNull();
    }
    expect(
      resolveInterruptedTurnRetryTarget({
        projection: {
          ...projection,
          messages: [
            user,
            { ...user, id: MessageId.make("assistant"), role: "assistant", text: "Partial result" },
          ],
        },
      }),
    ).toBeNull();
    expect(
      resolveInterruptedTurnRetryTarget({ projection: { ...projection, messages: [] } }),
    ).toBeNull();
  });
});
