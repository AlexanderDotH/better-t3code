import {
  EventId,
  MessageId,
  OrchestrationProposedPlanId,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionThreadSubagentRepository } from "../Services/ProjectionThreadSubagents.ts";
import { ProjectionThreadSubagentActivityRepository } from "../Services/ProjectionThreadSubagentActivities.ts";
import { ProjectionThreadSubagentMessageRepository } from "../Services/ProjectionThreadSubagentMessages.ts";
import { ProjectionThreadSubagentProposedPlanRepository } from "../Services/ProjectionThreadSubagentProposedPlans.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionThreadSubagentRepositoryLive } from "./ProjectionThreadSubagents.ts";
import { ProjectionThreadSubagentActivityRepositoryLive } from "./ProjectionThreadSubagentActivities.ts";
import { ProjectionThreadSubagentMessageRepositoryLive } from "./ProjectionThreadSubagentMessages.ts";
import { ProjectionThreadSubagentProposedPlanRepositoryLive } from "./ProjectionThreadSubagentProposedPlans.ts";

const layer = it.layer(
  Layer.mergeAll(
    ProjectionThreadSubagentRepositoryLive,
    ProjectionThreadSubagentMessageRepositoryLive,
    ProjectionThreadSubagentProposedPlanRepositoryLive,
    ProjectionThreadSubagentActivityRepositoryLive,
  ).pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadSubagent repositories", (it) => {
  it.effect("upserts complete summary metadata and isolates it by root thread", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadSubagentRepository;
      const threadId = ThreadId.make("thread-subagents");
      const otherThreadId = ThreadId.make("thread-subagents-other");
      const subagentId = SubagentId.make("agent-research");
      const startedAt = "2026-07-30T12:00:00.000Z";

      yield* repository.upsert({
        threadId,
        id: subagentId,
        origin: "t3-fetch",
        providerInstanceId: ProviderInstanceId.make("claude-work"),
        providerDriver: "claudeAgent",
        providerThreadId: "provider-agent-research",
        parentId: null,
        path: "/root/research",
        name: "research",
        nickname: "Researcher",
        role: "explorer",
        task: "Inspect the persistence boundary",
        model: "gpt-5.6",
        reasoningEffort: "ultra",
        depth: 1,
        status: "running",
        statusMessage: "Inspecting repositories",
        latestProgress: {
          kind: "tool",
          summary: "Reading projection repositories",
          detail: "ProjectionThreadMessages.ts",
          createdAt: "2026-07-30T12:00:01.000Z",
        },
        latestTurn: {
          turnId: TurnId.make("turn-research"),
          state: "running",
          requestedAt: startedAt,
          startedAt,
          completedAt: null,
          assistantMessageId: null,
        },
        startedAt,
        updatedAt: "2026-07-30T12:00:01.000Z",
        completedAt: null,
      });

      yield* repository.upsert({
        threadId,
        id: subagentId,
        origin: "t3-fetch",
        providerInstanceId: ProviderInstanceId.make("claude-work"),
        providerDriver: "claudeAgent",
        providerThreadId: "provider-agent-research",
        parentId: null,
        path: "/root/research",
        name: "research",
        nickname: "Researcher",
        role: "explorer",
        task: "Inspect the persistence boundary",
        model: "gpt-5.6",
        reasoningEffort: "ultra",
        depth: 1,
        status: "completed",
        statusMessage: null,
        latestProgress: {
          kind: "completed",
          summary: "Persistence review complete",
          detail: null,
          createdAt: "2026-07-30T12:02:00.000Z",
        },
        latestTurn: {
          turnId: TurnId.make("turn-research"),
          state: "completed",
          requestedAt: startedAt,
          startedAt,
          completedAt: "2026-07-30T12:02:00.000Z",
          assistantMessageId: MessageId.make("message-research"),
        },
        startedAt,
        updatedAt: "2026-07-30T12:02:00.000Z",
        completedAt: "2026-07-30T12:02:00.000Z",
      });

      const persisted = yield* repository.getById({ threadId, subagentId });
      assert.equal(persisted._tag, "Some");
      assert.equal(Option.getOrThrow(persisted).status, "completed");
      assert.equal(Option.getOrThrow(persisted).origin, "t3-fetch");
      assert.equal(Option.getOrThrow(persisted).providerInstanceId, "claude-work");
      assert.equal(Option.getOrThrow(persisted).providerDriver, "claudeAgent");
      assert.equal(
        Option.getOrThrow(persisted).latestProgress?.summary,
        "Persistence review complete",
      );
      assert.equal(Option.getOrThrow(persisted).latestTurn?.state, "completed");

      const summaries = yield* repository.listByThreadId({ threadId });
      assert.equal(summaries.length, 1);

      const otherThreadSummaries = yield* repository.listByThreadId({
        threadId: otherThreadId,
      });
      assert.deepStrictEqual(otherThreadSummaries, []);
    }),
  );

  it.effect("round trips one selected agent transcript in deterministic order", () =>
    Effect.gen(function* () {
      const messages = yield* ProjectionThreadSubagentMessageRepository;
      const proposedPlans = yield* ProjectionThreadSubagentProposedPlanRepository;
      const activities = yield* ProjectionThreadSubagentActivityRepository;
      const threadId = ThreadId.make("thread-transcript");
      const subagentId = SubagentId.make("agent-transcript");
      const otherSubagentId = SubagentId.make("agent-other");

      yield* messages.upsert({
        threadId,
        subagentId,
        messageId: MessageId.make("message-second"),
        turnId: TurnId.make("turn-transcript"),
        role: "assistant",
        text: "Second",
        attachments: [
          {
            type: "image",
            id: "attachment-1",
            name: "result.png",
            mimeType: "image/png",
            sizeBytes: 42,
          },
        ],
        isStreaming: false,
        createdAt: "2026-07-30T12:01:00.000Z",
        updatedAt: "2026-07-30T12:01:00.000Z",
      });
      yield* messages.upsert({
        threadId,
        subagentId,
        messageId: MessageId.make("message-first"),
        turnId: TurnId.make("turn-transcript"),
        role: "user",
        text: "First",
        isStreaming: false,
        createdAt: "2026-07-30T12:00:00.000Z",
        updatedAt: "2026-07-30T12:00:00.000Z",
      });
      yield* messages.upsert({
        threadId,
        subagentId: otherSubagentId,
        messageId: MessageId.make("message-other"),
        turnId: null,
        role: "assistant",
        text: "Other agent",
        isStreaming: false,
        createdAt: "2026-07-30T11:59:00.000Z",
        updatedAt: "2026-07-30T11:59:00.000Z",
      });

      yield* proposedPlans.upsert({
        threadId,
        subagentId,
        planId: OrchestrationProposedPlanId.make("plan-transcript"),
        turnId: TurnId.make("turn-transcript"),
        planMarkdown: "# Agent plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-07-30T12:00:30.000Z",
        updatedAt: "2026-07-30T12:00:30.000Z",
      });

      yield* activities.upsert({
        threadId,
        subagentId,
        activityId: EventId.make("activity-later"),
        turnId: TurnId.make("turn-transcript"),
        tone: "tool",
        kind: "command",
        summary: "Ran tests",
        payload: { command: "vp test", exitCode: 0 },
        sequence: 2,
        createdAt: "2026-07-30T12:01:30.000Z",
      });
      yield* activities.upsert({
        threadId,
        subagentId,
        activityId: EventId.make("activity-earlier"),
        turnId: TurnId.make("turn-transcript"),
        tone: "info",
        kind: "reasoning",
        summary: "Planned tests",
        payload: { phase: "red" },
        sequence: 1,
        createdAt: "2026-07-30T12:00:30.000Z",
      });

      const persistedMessages = yield* messages.listBySubagentId({ threadId, subagentId });
      const persistedPlans = yield* proposedPlans.listBySubagentId({ threadId, subagentId });
      const persistedActivities = yield* activities.listBySubagentId({ threadId, subagentId });

      assert.deepStrictEqual(
        persistedMessages.map(({ messageId }) => messageId),
        ["message-first", "message-second"],
      );
      assert.deepStrictEqual(persistedMessages[1]?.attachments, [
        {
          type: "image",
          id: "attachment-1",
          name: "result.png",
          mimeType: "image/png",
          sizeBytes: 42,
        },
      ]);
      assert.deepStrictEqual(
        persistedPlans.map(({ planId }) => planId),
        ["plan-transcript"],
      );
      assert.deepStrictEqual(
        persistedActivities.map(({ activityId }) => activityId),
        ["activity-earlier", "activity-later"],
      );
      assert.deepStrictEqual(persistedActivities[1]?.payload, {
        command: "vp test",
        exitCode: 0,
      });
    }),
  );

  it.effect("deletes one agent transcript without removing sibling agents", () =>
    Effect.gen(function* () {
      const messages = yield* ProjectionThreadSubagentMessageRepository;
      const threadId = ThreadId.make("thread-delete-agent");
      const removedSubagentId = SubagentId.make("agent-remove");
      const retainedSubagentId = SubagentId.make("agent-retain");

      for (const subagentId of [removedSubagentId, retainedSubagentId]) {
        yield* messages.upsert({
          threadId,
          subagentId,
          messageId: MessageId.make(`message-${subagentId}`),
          turnId: null,
          role: "assistant",
          text: String(subagentId),
          isStreaming: false,
          createdAt: "2026-07-30T12:00:00.000Z",
          updatedAt: "2026-07-30T12:00:00.000Z",
        });
      }

      yield* messages.deleteBySubagentId({
        threadId,
        subagentId: removedSubagentId,
      });

      assert.deepStrictEqual(
        yield* messages.listBySubagentId({ threadId, subagentId: removedSubagentId }),
        [],
      );
      assert.equal(
        (yield* messages.listBySubagentId({ threadId, subagentId: retainedSubagentId })).length,
        1,
      );
    }),
  );
});
