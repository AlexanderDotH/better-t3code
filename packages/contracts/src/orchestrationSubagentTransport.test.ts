import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ORCHESTRATION_WS_METHODS,
  OrchestrationSubagentDetailSnapshot,
  OrchestrationSubagentStreamItem,
  OrchestrationSubscribeSubagentInput,
  OrchestrationThreadStreamItem,
} from "./orchestration.ts";

const decodeThreadStreamItem = Schema.decodeUnknownSync(OrchestrationThreadStreamItem);
const decodeSubagentStreamItem = Schema.decodeUnknownSync(OrchestrationSubagentStreamItem);

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
  it("registers a dedicated subagent subscription method", () => {
    expect(ORCHESTRATION_WS_METHODS.subscribeSubagent).toBe("orchestration.subscribeSubagent");
  });

  it("decodes a paged subagent detail snapshot with its routing identity", () => {
    const decode = Schema.decodeUnknownSync(OrchestrationSubagentDetailSnapshot);

    const snapshot = decode({
      snapshotSequence: 42,
      threadId: "thread-transport",
      subagent,
      page: {
        beforeCursor: "older-activities",
        hasMore: true,
        snapshotSequence: 42,
        threadSequence: 40,
      },
    });

    expect(snapshot.snapshotSequence).toBe(42);
    expect(snapshot.threadId).toBe("thread-transport");
    expect(snapshot.subagent.id).toBe("agent-contracts");
    expect(snapshot.page).toEqual({
      beforeCursor: "older-activities",
      hasMore: true,
      snapshotSequence: 42,
      threadSequence: 40,
    });
  });

  it("decodes resumable subagent subscription input", () => {
    const decode = Schema.decodeUnknownSync(OrchestrationSubscribeSubagentInput);

    expect(
      decode({
        threadId: "thread-transport",
        subagentId: "agent-contracts",
        afterSequence: 42,
        activityLimit: 100,
      }),
    ).toMatchObject({
      threadId: "thread-transport",
      subagentId: "agent-contracts",
      afterSequence: 42,
      activityLimit: 100,
    });
  });

  it("accepts cursor-only advancement in thread and subagent streams", () => {
    const cursor = { kind: "cursor", sequence: 43 } as const;

    expect(decodeThreadStreamItem(cursor)).toEqual(cursor);
    expect(decodeSubagentStreamItem(cursor)).toEqual(cursor);
  });

  it("decodes a subagent snapshot stream frame", () => {
    const decode = Schema.decodeUnknownSync(OrchestrationSubagentStreamItem);
    const snapshot = {
      snapshotSequence: 42,
      threadId: "thread-transport",
      subagent,
    } as const;

    expect(decode({ kind: "snapshot", snapshot })).toEqual({
      kind: "snapshot",
      snapshot: {
        ...snapshot,
        subagent: {
          ...subagent,
          origin: "provider-native",
          providerInstanceId: null,
          providerDriver: null,
        },
      },
    });
  });
});
