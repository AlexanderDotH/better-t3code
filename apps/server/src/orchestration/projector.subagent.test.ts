import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const createdAt = "2026-07-30T10:00:00.000Z";
const discoveredAt = "2026-07-30T10:00:01.000Z";
const progressedAt = "2026-07-30T10:00:02.000Z";
const threadId = ThreadId.make("thread-subagents");
const subagentId = SubagentId.make("agent-contracts");

function makeEvent(
  sequence: number,
  type: OrchestrationEvent["type"],
  occurredAt: string,
  payload: unknown,
): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.make(`event-subagent-${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    type,
    occurredAt,
    commandId: CommandId.make(`command-subagent-${sequence}`),
    causationEventId: null,
    correlationId: CommandId.make(`command-subagent-${sequence}`),
    metadata: {},
    payload: payload as never,
  } as OrchestrationEvent;
}

function createThread() {
  return projectEvent(
    createEmptyReadModel(createdAt),
    makeEvent(1, "thread.created", createdAt, {
      threadId,
      projectId: ProjectId.make("project-subagents"),
      title: "Subagents",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-codex",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt,
      updatedAt: createdAt,
    }),
  );
}

function makeSubagent(
  overrides: Partial<OrchestrationSubagentSummary> = {},
): OrchestrationSubagentSummary {
  return {
    id: subagentId,
    providerThreadId: "provider-thread-contracts",
    parentId: null,
    path: "/root/contracts",
    name: "contracts",
    nickname: "contracts",
    role: "worker",
    task: "Implement orchestration support",
    model: "gpt-5.6-codex",
    reasoningEffort: "ultra",
    depth: 1,
    status: "running",
    statusMessage: "Adding tests",
    latestProgress: null,
    latestTurn: null,
    startedAt: createdAt,
    updatedAt: discoveredAt,
    completedAt: null,
    ...overrides,
  };
}

describe("subagent orchestration projection", () => {
  it.effect("initializes threads and keeps child transcript out of the root", () =>
    Effect.gen(function* () {
      const model = yield* createThread();
      expect(model.threads[0]?.subagents).toEqual([]);

      const childMessage = yield* projectEvent(
        model,
        makeEvent(2, "thread.message-sent", progressedAt, {
          threadId,
          subagentId,
          messageId: "message-agent",
          role: "assistant",
          text: "Child output",
          turnId: null,
          streaming: false,
          createdAt: progressedAt,
          updatedAt: progressedAt,
        }),
      );
      expect(childMessage.threads[0]?.messages).toEqual([]);
    }),
  );

  it.effect("enriches a placeholder without regressing newer lifecycle state", () =>
    Effect.gen(function* () {
      const model = yield* createThread();
      const waiting = yield* projectEvent(
        model,
        makeEvent(2, "thread.subagent-state-set", progressedAt, {
          threadId,
          subagentId,
          status: "waiting",
          statusMessage: "Waiting for input",
          updatedAt: progressedAt,
        }),
      );
      expect(waiting.threads[0]?.subagents[0]).toMatchObject({
        id: subagentId,
        providerThreadId: subagentId,
        name: "Agent agent-co",
        status: "waiting",
        updatedAt: progressedAt,
      });

      const discovered = yield* projectEvent(
        waiting,
        makeEvent(3, "thread.subagent-upserted", progressedAt, {
          threadId,
          subagent: makeSubagent(),
        }),
      );
      expect(discovered.threads[0]?.subagents).toHaveLength(1);
      expect(discovered.threads[0]?.subagents[0]).toMatchObject({
        providerThreadId: "provider-thread-contracts",
        path: "/root/contracts",
        status: "waiting",
        updatedAt: progressedAt,
      });
    }),
  );
});
