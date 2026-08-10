import {
  ProviderInstanceId,
  SubagentId,
  TurnId,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { settleSubagentAfterRuntimeLoss } from "./subagentLifecycle.ts";

const startedAt = "2026-08-08T10:00:00.000Z";
const settledAt = "2026-08-08T10:05:00.000Z";

function activeFetchWorker(): OrchestrationSubagentSummary {
  return {
    id: SubagentId.make("fetch:thread-parent:run-1:0"),
    origin: "t3-fetch",
    providerInstanceId: ProviderInstanceId.make("claude-work"),
    providerDriver: "claudeAgent",
    providerThreadId: "fetch:thread-parent:run-1:0",
    parentId: null,
    path: "/root/fetch-0",
    name: "fetch-0",
    nickname: null,
    role: "explorer",
    task: "Inspect provider persistence",
    model: "claude-opus-4-1",
    reasoningEffort: "high",
    depth: 1,
    status: "running",
    statusMessage: "Inspecting",
    latestProgress: null,
    latestTurn: {
      turnId: TurnId.make("fetch-turn-1"),
      state: "running",
      requestedAt: startedAt,
      startedAt,
      completedAt: null,
      assistantMessageId: null,
    },
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
  };
}

describe("subagent runtime-loss reconciliation", () => {
  it("marks an orphaned active Fetch worker interrupted without losing routing metadata", () => {
    expect(settleSubagentAfterRuntimeLoss(activeFetchWorker(), settledAt)).toMatchObject({
      origin: "t3-fetch",
      providerInstanceId: "claude-work",
      providerDriver: "claudeAgent",
      model: "claude-opus-4-1",
      reasoningEffort: "high",
      status: "interrupted",
      statusMessage: null,
      latestProgress: {
        kind: "state.interrupted",
        summary: "Interrupted",
        createdAt: settledAt,
      },
      latestTurn: {
        state: "interrupted",
        completedAt: settledAt,
      },
      updatedAt: settledAt,
      completedAt: settledAt,
    });
  });
});
