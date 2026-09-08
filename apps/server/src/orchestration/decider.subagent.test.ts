import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const createdAt = "2026-07-30T10:00:00.000Z";
const updatedAt = "2026-07-30T10:00:01.000Z";
const threadId = ThreadId.make("thread-subagents");
const subagentId = SubagentId.make("agent-contracts");

const subagent = {
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
  updatedAt,
  completedAt: null,
} as const;

const seedReadModel = projectEvent(createEmptyReadModel(createdAt), {
  sequence: 1,
  eventId: EventId.make("event-thread-subagents"),
  aggregateKind: "thread",
  aggregateId: threadId,
  type: "thread.created",
  occurredAt: createdAt,
  commandId: CommandId.make("command-thread-subagents"),
  causationEventId: null,
  correlationId: CommandId.make("command-thread-subagents"),
  metadata: {},
  payload: {
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
  },
});

it.layer(NodeServices.layer)("subagent orchestration decisions", (it) => {
  it.effect("emits a subagent summary upsert event", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;

      const decided = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.subagent.upsert",
          commandId: CommandId.make("command-agent-upsert"),
          threadId,
          subagent,
          createdAt: updatedAt,
        },
      });

      expect(Array.isArray(decided)).toBe(false);
      const event = Array.isArray(decided) ? decided[0] : decided;
      expect(event?.type).toBe("thread.subagent-upserted");
      if (event?.type !== "thread.subagent-upserted") return;
      expect(event.payload).toEqual({ threadId, subagent });
      expect(event.occurredAt).toBe(updatedAt);
    }),
  );

  it.effect("emits a subagent state event with the supplied lifecycle timestamp", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;

      const decided = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.subagent.state.set",
          commandId: CommandId.make("command-agent-state"),
          threadId,
          subagentId,
          status: "waiting",
          statusMessage: "Waiting for input",
          updatedAt,
        },
      });

      const event = Array.isArray(decided) ? decided[0] : decided;
      expect(event?.type).toBe("thread.subagent-state-set");
      if (event?.type !== "thread.subagent-state-set") return;
      expect(event.payload).toEqual({
        threadId,
        subagentId,
        status: "waiting",
        statusMessage: "Waiting for input",
        updatedAt,
      });
      expect(event.occurredAt).toBe(updatedAt);
    }),
  );

  it.effect("emits a nullable subagent progress event", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const progress = {
        kind: "test",
        summary: "Running focused tests",
        detail: null,
        createdAt: updatedAt,
      } as const;

      const decided = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.subagent.progress.set",
          commandId: CommandId.make("command-agent-progress"),
          threadId,
          subagentId,
          progress,
          updatedAt,
        },
      });

      const event = Array.isArray(decided) ? decided[0] : decided;
      expect(event?.type).toBe("thread.subagent-progress-set");
      if (event?.type !== "thread.subagent-progress-set") return;
      expect(event.payload).toEqual({ threadId, subagentId, progress, updatedAt });
    }),
  );

  it.effect("preserves subagent routing on transcript events", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const message = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.message.assistant.delta",
          commandId: CommandId.make("command-agent-message"),
          threadId,
          subagentId,
          messageId: MessageId.make("message-agent"),
          delta: "Working",
          createdAt: updatedAt,
        },
      });
      const plan = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.proposed-plan.upsert",
          commandId: CommandId.make("command-agent-plan"),
          threadId,
          subagentId,
          proposedPlan: {
            id: "plan-agent",
            turnId: null,
            planMarkdown: "# Agent plan",
            createdAt: updatedAt,
            updatedAt,
          },
          createdAt: updatedAt,
        },
      });
      const activity = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.activity.append",
          commandId: CommandId.make("command-agent-activity"),
          threadId,
          subagentId,
          activity: {
            id: "activity-agent",
            tone: "tool",
            kind: "tool.started",
            summary: "Running tests",
            payload: {},
            turnId: null,
            createdAt: updatedAt,
          },
          createdAt: updatedAt,
        },
      });

      expect(Array.isArray(message)).toBe(false);
      expect(Array.isArray(plan)).toBe(false);
      expect(Array.isArray(activity)).toBe(false);
      expect((message as { payload: { subagentId?: SubagentId } }).payload.subagentId).toBe(
        subagentId,
      );
      expect((plan as { payload: { subagentId?: SubagentId } }).payload.subagentId).toBe(
        subagentId,
      );
      expect((activity as { payload: { subagentId?: SubagentId } }).payload.subagentId).toBe(
        subagentId,
      );
    }),
  );
});
