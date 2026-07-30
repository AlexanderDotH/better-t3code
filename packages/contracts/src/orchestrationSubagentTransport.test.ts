import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ORCHESTRATION_WS_METHODS,
  OrchestrationRpcSchemas,
  OrchestrationSubagentDetailSnapshot,
  OrchestrationSubagentStreamItem,
  OrchestrationSubscribeSubagentInput,
} from "./orchestration.ts";

const subagent = {
  id: "agent-contracts",
  providerThreadId: "provider-agent-contracts",
  parentId: null,
  path: "/root/contracts",
  name: "contracts",
  nickname: null,
  role: "worker",
  task: "Implement transport contracts",
  model: "gpt-5.6-codex",
  reasoningEffort: "ultra",
  depth: 1,
  status: "running",
  statusMessage: "Adding stream contracts",
  latestProgress: {
    kind: "tool",
    summary: "Editing orchestration.ts",
    detail: null,
    createdAt: "2026-07-30T12:00:00.000Z",
  },
  latestTurn: null,
  startedAt: "2026-07-30T11:59:00.000Z",
  updatedAt: "2026-07-30T12:00:00.000Z",
  completedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
} as const;

describe("subagent transport contracts", () => {
  it("registers a dedicated snapshot-first subagent subscription", () => {
    expect(ORCHESTRATION_WS_METHODS.subscribeSubagent).toBe("orchestration.subscribeSubagent");
    expect(OrchestrationRpcSchemas.subscribeSubagent.input).toBe(
      OrchestrationSubscribeSubagentInput,
    );
    expect(OrchestrationRpcSchemas.subscribeSubagent.output).toBe(OrchestrationSubagentStreamItem);
  });

  it("decodes a subagent subscription using only thread and subagent identities", () => {
    const decode = Schema.decodeUnknownSync(OrchestrationSubscribeSubagentInput);

    expect(
      decode({
        threadId: "thread-transport",
        subagentId: "agent-contracts",
      }),
    ).toEqual({
      threadId: "thread-transport",
      subagentId: "agent-contracts",
    });
  });

  it("decodes a subagent detail snapshot with its routing identity", () => {
    const decode = Schema.decodeUnknownSync(OrchestrationSubagentDetailSnapshot);

    const snapshot = decode({
      snapshotSequence: 42,
      threadId: "thread-transport",
      subagent,
    });

    expect(snapshot.snapshotSequence).toBe(42);
    expect(snapshot.threadId).toBe("thread-transport");
    expect(snapshot.subagent.id).toBe("agent-contracts");
  });

  it("decodes snapshot and event stream frames without cursor frames", () => {
    const decode = Schema.decodeUnknownSync(OrchestrationSubagentStreamItem);
    const snapshot = {
      snapshotSequence: 42,
      threadId: "thread-transport",
      subagent,
    } as const;

    expect(decode({ kind: "snapshot", snapshot })).toEqual({
      kind: "snapshot",
      snapshot,
    });
    expect(() => decode({ kind: "cursor", sequence: 43 })).toThrow();
  });
});
