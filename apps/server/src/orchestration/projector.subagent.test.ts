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
const completedAt = "2026-07-30T10:00:03.000Z";
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

function createThread(): Effect.Effect<OrchestrationReadModel, unknown> {
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
  it.effect("initializes new threads with an empty subagent list", () =>
    Effect.gen(function* () {
      const model = yield* createThread();

      expect(model.threads[0]?.subagents).toEqual([]);
    }),
  );

  it.effect("upserts a summary by id without duplicating it", () =>
    Effect.gen(function* () {
      const model = yield* createThread();
      const first = yield* projectEvent(
        model,
        makeEvent(2, "thread.subagent-upserted", discoveredAt, {
          threadId,
          subagent: makeSubagent(),
        }),
      );
      const enriched = makeSubagent({
        nickname: "domain",
        statusMessage: "Projecting events",
        updatedAt: progressedAt,
      });

      const replayed = yield* projectEvent(
        first,
        makeEvent(3, "thread.subagent-upserted", progressedAt, {
          threadId,
          subagent: enriched,
        }),
      );

      expect(replayed.threads[0]?.subagents).toEqual([enriched]);
      expect(replayed.threads[0]?.updatedAt).toBe(progressedAt);
    }),
  );

  it.effect("creates a deterministic placeholder when state arrives before discovery", () =>
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
      const placeholder = waiting.threads[0]?.subagents[0];

      expect(placeholder).toMatchObject({
        id: subagentId,
        providerThreadId: subagentId,
        parentId: null,
        path: null,
        name: "Agent agent-co",
        depth: 0,
        status: "waiting",
        statusMessage: "Waiting for input",
        startedAt: progressedAt,
        updatedAt: progressedAt,
        completedAt: null,
      });
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

      const discovered = yield* projectEvent(
        waiting,
        makeEvent(3, "thread.subagent-upserted", completedAt, {
          threadId,
          subagent: makeSubagent({ updatedAt: discoveredAt }),
        }),
      );

      expect(discovered.threads[0]?.subagents[0]).toMatchObject({
        providerThreadId: "provider-thread-contracts",
        path: "/root/contracts",
        name: "contracts",
        nickname: "contracts",
        status: "waiting",
        statusMessage: "Waiting for input",
        startedAt: createdAt,
        updatedAt: progressedAt,
      });
      expect(discovered.threads[0]?.updatedAt).toBe(completedAt);
    }),
  );

  it.effect("sets and clears terminal completion timestamps as an agent resumes", () =>
    Effect.gen(function* () {
      const model = yield* createThread();
      const discovered = yield* projectEvent(
        model,
        makeEvent(2, "thread.subagent-upserted", discoveredAt, {
          threadId,
          subagent: makeSubagent(),
        }),
      );
      const completed = yield* projectEvent(
        discovered,
        makeEvent(3, "thread.subagent-state-set", completedAt, {
          threadId,
          subagentId,
          status: "completed",
          statusMessage: "Done",
          updatedAt: completedAt,
        }),
      );
      const resumedAt = "2026-07-30T10:00:04.000Z";

      const resumed = yield* projectEvent(
        completed,
        makeEvent(4, "thread.subagent-state-set", resumedAt, {
          threadId,
          subagentId,
          status: "running",
          statusMessage: "Handling follow-up",
          updatedAt: resumedAt,
        }),
      );

      expect(completed.threads[0]?.subagents[0]?.completedAt).toBe(completedAt);
      expect(resumed.threads[0]?.subagents[0]).toMatchObject({
        status: "running",
        statusMessage: "Handling follow-up",
        updatedAt: resumedAt,
        completedAt: null,
      });
    }),
  );

  it.effect("creates and updates progress without duplicating a placeholder", () =>
    Effect.gen(function* () {
      const model = yield* createThread();
      const progress = {
        kind: "test",
        summary: "Running focused tests",
        detail: null,
        createdAt: progressedAt,
      } as const;

      const progressed = yield* projectEvent(
        model,
        makeEvent(2, "thread.subagent-progress-set", progressedAt, {
          threadId,
          subagentId,
          progress,
          updatedAt: progressedAt,
        }),
      );
      const replayed = yield* projectEvent(
        progressed,
        makeEvent(3, "thread.subagent-progress-set", progressedAt, {
          threadId,
          subagentId,
          progress,
          updatedAt: progressedAt,
        }),
      );

      expect(replayed.threads[0]?.subagents).toHaveLength(1);
      expect(replayed.threads[0]?.subagents[0]).toMatchObject({
        status: "starting",
        latestProgress: progress,
        updatedAt: progressedAt,
      });
    }),
  );

  it.effect("keeps routed subagent transcript events out of the root transcript", () =>
    Effect.gen(function* () {
      const model = yield* createThread();
      const message = yield* projectEvent(
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
      const plan = yield* projectEvent(
        message,
        makeEvent(3, "thread.proposed-plan-upserted", progressedAt, {
          threadId,
          subagentId,
          proposedPlan: {
            id: "plan-agent",
            turnId: null,
            planMarkdown: "# Child plan",
            createdAt: progressedAt,
            updatedAt: progressedAt,
          },
        }),
      );
      const activity = yield* projectEvent(
        plan,
        makeEvent(4, "thread.activity-appended", progressedAt, {
          threadId,
          subagentId,
          activity: {
            id: "activity-agent",
            tone: "tool",
            kind: "tool.completed",
            summary: "Child tool completed",
            payload: {},
            turnId: null,
            createdAt: progressedAt,
          },
        }),
      );

      expect(activity.threads[0]).toMatchObject({
        messages: [],
        proposedPlans: [],
        activities: [],
      });
    }),
  );
});
