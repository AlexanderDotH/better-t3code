import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  OrchestrationReadModel,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  makeBetterT3SettingsV1,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  makeReplySummary,
  replyCreatedAt,
  replyProviderInstanceId,
  replyTopicId,
  replyTurnId,
} from "../mcp/testFixtures/messageReply.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionProjectAgentCoordinationRepository } from "../persistence/Services/ProjectionProjectAgentCoordination.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProjectAgentCoordinator, ProjectAgentCoordinatorLive } from "./ProjectAgentCoordinator.ts";

const decodeReadModel = Schema.decodeUnknownSync(OrchestrationReadModel);
const threadId = ThreadId.make("reply-parent");
const replyActor = {
  replyTopicId,
  turnId: replyTurnId,
  providerInstanceId: replyProviderInstanceId,
};

function fixture(options: { readonly replyCompleted?: boolean } = {}) {
  return decodeReadModel({
    snapshotSequence: 1,
    updatedAt: replyCreatedAt,
    projects: [
      {
        id: "project",
        title: "Project",
        workspaceRoot: "/workspace",
        defaultModelSelection: null,
        scripts: [],
        createdAt: replyCreatedAt,
        updatedAt: replyCreatedAt,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: threadId,
        projectId: "project",
        title: "Main conversation",
        modelSelection: { instanceId: "codex", model: "gpt-6" },
        runtimeMode: "approval-required",
        interactionMode: "plan",
        branch: null,
        worktreePath: "/workspace/new",
        latestTurn: null,
        createdAt: replyCreatedAt,
        updatedAt: replyCreatedAt,
        archivedAt: null,
        settledAt: null,
        settledOverride: null,
        deletedAt: null,
        messages: [],
        activities: [],
        subagents: [
          { ...makeReplySummary(), ...(options.replyCompleted ? { status: "completed" } : {}) },
        ],
        checkpoints: [],
        session: null,
      },
    ],
  });
}

function harness(options: { readonly replyCompleted?: boolean } = {}) {
  const commands: OrchestrationCommand[] = [];
  const readModel = fixture(options);
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getCommandReadModel: () => Effect.succeed(readModel),
      getShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 1,
          projects: [],
          threads: [],
          updatedAt: replyCreatedAt,
        }),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: commands.length };
        }),
    }),
    Layer.mock(ProjectionProjectAgentCoordinationRepository)({
      listUnreadCountsByProjectId: () => Effect.succeed(new Map()),
      readInbox: () =>
        Effect.succeed({ messages: [], cursor: 0, hasMore: false, minRetainedSequence: null }),
    }),
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.succeed({
        ...DEFAULT_SERVER_SETTINGS,
        betterT3Environment: makeBetterT3SettingsV1("clean-install", {
          "agent.projectCoordination": true,
        }),
      }),
      streamChanges: Stream.never,
    }),
    Layer.succeed(HostProcessPlatform, "darwin"),
    NodeServices.layer,
  );
  return { commands, layer: ProjectAgentCoordinatorLive.pipe(Layer.provide(dependencies)) };
}

it.effect("keeps coordination claims on the reply turn after the parent main turn finishes", () => {
  const test = harness();
  return Effect.gen(function* () {
    const coordinator = yield* ProjectAgentCoordinator;
    const result = yield* coordinator.claim(
      threadId,
      {
        action: "set",
        summary: "Reply implementation",
        claims: [{ kind: "path", path: "src/reply.ts" }],
      },
      replyActor,
    );
    expect(result.accepted).toBe(true);
    expect(test.commands).toEqual([
      expect.objectContaining({
        type: "project.agent.claim.set",
        threadId,
        turnId: replyTurnId,
      }),
    ]);
    const peers = yield* coordinator.list(threadId, replyActor);
    expect(peers.peers[0]).toMatchObject({ threadId, self: true, phase: "working" });
  }).pipe(Effect.provide(test.layer));
});

it.effect("does not grant an idle root access merely because a reply is active", () => {
  const test = harness();
  return Effect.gen(function* () {
    const coordinator = yield* ProjectAgentCoordinator;
    const error = yield* coordinator.list(threadId).pipe(Effect.flip);
    expect(error).toMatchObject({ reason: "thread_unavailable" });
  }).pipe(Effect.provide(test.layer));
});

it.effect("rejects stale reply turn and provider identities", () =>
  Effect.gen(function* () {
    for (const actor of [
      { ...replyActor, turnId: TurnId.make("old-reply-turn") },
      { ...replyActor, providerInstanceId: ProviderInstanceId.make("other-instance") },
    ]) {
      const test = harness();
      const result = yield* Effect.gen(function* () {
        const coordinator = yield* ProjectAgentCoordinator;
        return yield* coordinator.list(threadId, actor).pipe(Effect.flip);
      }).pipe(Effect.provide(test.layer));
      expect(result).toMatchObject({ reason: "thread_unavailable" });
      expect(test.commands).toEqual([]);
    }
  }),
);

it.effect("rejects ended reply topics while retaining their history", () => {
  const test = harness({ replyCompleted: true });
  return Effect.gen(function* () {
    const coordinator = yield* ProjectAgentCoordinator;
    expect(yield* coordinator.list(threadId, replyActor).pipe(Effect.flip)).toMatchObject({
      reason: "thread_unavailable",
    });
  }).pipe(Effect.provide(test.layer));
});
