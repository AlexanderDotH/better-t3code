import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  makeBetterT3SettingsV1,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionProjectAgentCoordinationRepositoryLive } from "../../persistence/Layers/ProjectionProjectAgentCoordination.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import {
  ProjectAgentCoordinator,
  ProjectAgentCoordinatorLive,
} from "../../projectAgent/ProjectAgentCoordinator.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const occurredAt = "2026-08-09T20:00:00.000Z";
const projectId = ProjectId.make("project-agent-concurrency");
const firstThreadId = ThreadId.make("agent-first");
const secondThreadId = ThreadId.make("agent-second");
const firstTurnId = TurnId.make("turn-first");
const secondTurnId = TurnId.make("turn-second");
const providerInstanceId = ProviderInstanceId.make("codex");
const offlineProjectId = ProjectId.make("project-agent-offline-message");
const senderThreadId = ThreadId.make("agent-offline-message-sender");
const offlineThreadId = ThreadId.make("agent-offline-message-recipient");
const senderTurnId = TurnId.make("turn-offline-message-sender");
const toggleProjectId = ProjectId.make("project-agent-feature-toggle");
const toggleThreadId = ThreadId.make("agent-feature-toggle");
const toggleTurnId = TurnId.make("turn-feature-toggle");

const config = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-project-agent-coordination-test-",
});
const orchestrationLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provideMerge(config),
  Layer.provideMerge(NodeServices.layer),
);
const TestLayer = ProjectAgentCoordinatorLive.pipe(
  Layer.provideMerge(orchestrationLayer),
  Layer.provideMerge(
    ProjectionProjectAgentCoordinationRepositoryLive.pipe(
      Layer.provideMerge(SqlitePersistenceMemory),
    ),
  ),
  Layer.provideMerge(
    ServerSettingsService.layerTest({
      betterT3Environment: makeBetterT3SettingsV1("existing-install-migration"),
    }),
  ),
);

it.layer(TestLayer)("project-agent coordination", (it) => {
  it.effect("releases active claims when disabled and remains reversible", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const coordinator = yield* ProjectAgentCoordinator;
      const settings = yield* ServerSettingsService;

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("create-feature-toggle-project"),
        projectId: toggleProjectId,
        title: "Toggle coordination",
        workspaceRoot: "/tmp/project-agent-toggle",
        defaultModelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
        createdAt: occurredAt,
      });
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("create-feature-toggle-thread"),
        threadId: toggleThreadId,
        projectId: toggleProjectId,
        title: "Toggle agent",
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: occurredAt,
      });
      yield* engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("activate-feature-toggle-thread"),
        threadId: toggleThreadId,
        session: {
          threadId: toggleThreadId,
          status: "running",
          providerName: "codex",
          providerInstanceId,
          runtimeSessionId: null,
          runtimeMode: "full-access",
          activeTurnId: toggleTurnId,
          abortState: null,
          lastError: null,
          updatedAt: occurredAt,
        },
        createdAt: occurredAt,
      });
      const claimed = yield* coordinator.claim(toggleThreadId, {
        action: "set",
        summary: "Editing the toggled project",
        claims: [{ kind: "path", path: "apps/server/src/projectAgent" }],
      });
      expect(claimed.accepted).toBe(true);

      const releasedFiber = yield* engine.streamDomainEvents.pipe(
        Stream.filter((event) => event.type === "project.agent-claim-released"),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* settings.updateSettings({
        betterT3Environment: { flags: { "agent.projectCoordination": false } },
      });
      const rejected = yield* Effect.exit(coordinator.list(toggleThreadId));
      expect(rejected._tag).toBe("Failure");
      if (rejected._tag === "Failure") {
        expect(String(rejected.cause)).toContain("disabled in Better T3 settings");
      }
      expect(Option.isSome(yield* Fiber.join(releasedFiber))).toBe(true);

      yield* settings.updateSettings({
        betterT3Environment: { flags: { "agent.projectCoordination": true } },
      });
      expect((yield* coordinator.list(toggleThreadId)).peers).toHaveLength(1);
    }),
  );

  it.effect("allows exactly one concurrent overlapping claim", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshots = yield* ProjectionSnapshotQuery;

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("create-project"),
        projectId,
        title: "Concurrent coordination",
        workspaceRoot: "/tmp/project-agent-concurrency",
        defaultModelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
        createdAt: occurredAt,
      });

      yield* Effect.forEach(
        [
          [firstThreadId, "First agent"],
          [secondThreadId, "Second agent"],
        ] as const,
        ([threadId, title]) =>
          engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`create-${threadId}`),
            threadId,
            projectId,
            title,
            modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: occurredAt,
          }),
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        [
          [firstThreadId, firstTurnId],
          [secondThreadId, secondTurnId],
        ] as const,
        ([threadId, turnId]) =>
          engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(`activate-${threadId}`),
            threadId,
            session: {
              threadId,
              status: "running",
              providerName: "codex",
              providerInstanceId,
              runtimeSessionId: null,
              runtimeMode: "full-access",
              activeTurnId: turnId,
              abortState: null,
              lastError: null,
              updatedAt: occurredAt,
            },
            createdAt: occurredAt,
          }),
        { concurrency: 1, discard: true },
      );

      const claims = yield* Effect.all(
        [
          Effect.result(
            engine.dispatch({
              type: "project.agent.claim.set",
              commandId: CommandId.make("claim-first"),
              projectId,
              threadId: firstThreadId,
              turnId: firstTurnId,
              summary: "Editing the server MCP surface",
              claims: [{ kind: "path", path: "apps/server/src/mcp" }],
              claimedAt: occurredAt,
            }),
          ),
          Effect.result(
            engine.dispatch({
              type: "project.agent.claim.set",
              commandId: CommandId.make("claim-second"),
              projectId,
              threadId: secondThreadId,
              turnId: secondTurnId,
              summary: "Editing an overlapping MCP handler",
              claims: [{ kind: "path", path: "apps/server/src/mcp/toolkits" }],
              claimedAt: occurredAt,
            }),
          ),
        ],
        { concurrency: "unbounded" },
      );

      expect(claims.filter((result) => result._tag === "Success")).toHaveLength(1);
      expect(claims.filter((result) => result._tag === "Failure")).toHaveLength(1);

      const snapshot = yield* snapshots.getSnapshot();
      const project = snapshot.projects.find((candidate) => candidate.id === projectId);
      expect(project?.coordinationClaims).toHaveLength(1);
    }),
  );

  it.effect("lists an inactive peer and wakes its existing thread on direct send", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const coordinator = yield* ProjectAgentCoordinator;

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("create-offline-message-project"),
        projectId: offlineProjectId,
        title: "Offline coordination",
        workspaceRoot: "/tmp/project-agent-offline-message",
        defaultModelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
        createdAt: occurredAt,
      });

      yield* Effect.forEach(
        [
          [senderThreadId, "Active agent"],
          [offlineThreadId, "Offline agent"],
        ] as const,
        ([threadId, title]) =>
          engine.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`create-offline-message-${threadId}`),
            threadId,
            projectId: offlineProjectId,
            title,
            modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6" },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: occurredAt,
          }),
        { concurrency: 1, discard: true },
      );

      yield* engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("activate-offline-message-sender"),
        threadId: senderThreadId,
        session: {
          threadId: senderThreadId,
          status: "running",
          providerName: "codex",
          providerInstanceId,
          runtimeSessionId: null,
          runtimeMode: "full-access",
          activeTurnId: senderTurnId,
          abortState: null,
          lastError: null,
          updatedAt: occurredAt,
        },
        createdAt: occurredAt,
      });

      const listed = yield* coordinator.list(senderThreadId);
      expect(listed.peers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            threadId: offlineThreadId,
            title: "Offline agent",
            phase: "offline",
          }),
        ]),
      );

      const sent = yield* coordinator.send(senderThreadId, {
        target: { threadId: offlineThreadId },
        kind: "request",
        body: "Please continue the shared investigation.",
      });
      expect(sent.recipientThreadIds).toEqual([offlineThreadId]);

      const events = Array.from(yield* Stream.runCollect(engine.readEvents(0, 100)));
      expect(events.map(({ type }) => type)).toEqual(
        expect.arrayContaining([
          "project.agent-message-sent",
          "thread.message-sent",
          "thread.turn-start-requested",
        ]),
      );
      expect(
        events.find(
          (event) =>
            event.type === "thread.turn-start-requested" &&
            event.payload.threadId === offlineThreadId,
        ),
      ).toBeDefined();
    }),
  );
});
