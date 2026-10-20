import {
  CommandId,
  DeepPlanRunId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type DeepPlanDocument,
  type DeepPlanMutation,
  type DeepPlanRun,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionThreadRepositoryLive } from "../persistence/Layers/ProjectionThreads.ts";
import { ProjectionTurnRepositoryLive } from "../persistence/Layers/ProjectionTurns.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import { OrchestrationCommandReceiptRepository } from "../persistence/Services/OrchestrationCommandReceipts.ts";
import { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import { deepPlanApprovalKey } from "./deepPlanDecision.ts";
import {
  DeepPlanValidationDispatcher,
  DeepPlanValidationReactor,
  DeepPlanValidationReactorLive,
  finalValidationRequestId,
} from "./DeepPlanValidationReactor.ts";
import { pendingDeepPlanTurnRequests } from "./pendingDeepPlanTurnRequests.ts";

const createdAt = "2026-10-16T08:00:00.000Z";
const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const plan: DeepPlanDocument = {
  schemaVersion: 1,
  version: 1,
  goal: "Keep work across restarts",
  scope: ["Persist the approved work"],
  decisions: [],
  affectedAreas: ["Persistence"],
  steps: [
    {
      id: "persist",
      title: "Persist the work",
      description: "Persist every state transition.",
      dependencies: [],
      acceptanceCriteria: [
        {
          id: "restore",
          description: "Restore the approved run",
          checkMethod: "Recreate the engine",
        },
      ],
    },
  ],
  finalValidation: {
    description: "Check the restored work",
    checkMethod: "Run the focused integration check",
  },
};

const baseLayer = Layer.mergeAll(
  SqlitePersistenceMemory,
  ServerConfig.layerTest("/tmp/deep-plan-persistence", { prefix: "t3-deep-plan-" }),
  ThreadBackgroundLiveness.layer,
  ThreadPlanProgress.layer,
  Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
).pipe(Layer.provideMerge(NodeServices.layer));

const systemLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
  ProjectionThreadRepositoryLive,
  ProjectionTurnRepositoryLive,
).pipe(
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
);

const prepareRun = Effect.fn("prepareDeepPlanPersistenceRun")(function* (
  name: string,
  newThread = false,
) {
  const engine = yield* OrchestrationEngineService;
  const repository = yield* ProjectionThreadRepository;
  const projectId = ProjectId.make(`${name}-project`);
  const threadId = ThreadId.make(`${name}-planning`);
  const implementationThreadId = newThread ? ThreadId.make(`${name}-implementation`) : threadId;
  const runId = DeepPlanRunId.make(`${name}-run`);
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make(`${name}-project`),
    projectId,
    title: name,
    workspaceRoot: `/tmp/${name}`,
    createdAt,
  });
  for (const id of newThread ? [threadId, implementationThreadId] : [threadId]) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`${id}-create`),
      threadId: id,
      projectId,
      title: name,
      modelSelection: model,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt,
    });
  }
  yield* engine.dispatch({
    type: "thread.deep-plan.start",
    commandId: CommandId.make(`${name}-start`),
    threadId,
    runId,
    createdAt,
  });
  let operation = 0;
  const readRun = Effect.gen(function* () {
    const row = Option.getOrThrow(yield* repository.getById({ threadId }));
    if (row.deepPlan == null) return yield* Effect.die("Expected a persisted Deep Plan");
    return row.deepPlan;
  });
  const update = Effect.fn("updatePersistedDeepPlan")(function* (mutation: DeepPlanMutation) {
    const run = yield* readRun;
    const operationId = `${name}-operation-${operation++}`;
    const command = {
      type: "thread.deep-plan.update" as const,
      commandId: CommandId.make(operationId),
      threadId,
      runId,
      expectedRevision: run.revision,
      operationId,
      mutation,
      createdAt,
    };
    yield* engine.dispatch(command);
    return yield* readRun;
  });
  yield* update({ type: "sources-set", sources: [] });
  yield* update({ type: "publish-plan", plan });
  yield* update({
    type: "approve",
    planVersion: plan.version,
    approvalKey: deepPlanApprovalKey(plan),
    implementation: model,
    implementationThreadId,
    implementerId: `thread:${implementationThreadId}`,
    requestedParallelism: 2,
  });
  return { threadId, implementationThreadId, runId, update, readRun };
});

it.layer(baseLayer)("durable Deep Plan orchestration", (it) => {
  it.effect("keeps an approved run in projections, events and a recreated command model", () =>
    Effect.gen(function* () {
      const saved = yield* Effect.gen(function* () {
        const fixture = yield* prepareRun("restart");
        const actor = { implementerId: `thread:${fixture.threadId}`, model };
        yield* fixture.update({
          type: "step-update",
          stepId: "persist",
          status: "inProgress",
          evidence: [],
          actor,
        });
        const run = yield* fixture.readRun;
        const query = yield* ProjectionSnapshotQuery;
        expect(
          Option.getOrThrow(yield* query.getThreadDetailById(fixture.threadId)).deepPlan,
        ).toEqual(run);
        expect(
          (yield* query.getCommandReadModel()).threads.find(
            (thread) => thread.id === fixture.threadId,
          )?.deepPlan,
        ).toEqual(run);
        return run;
      }).pipe(Effect.provide(Layer.fresh(systemLayer)));

      yield* Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        const restored = Option.getOrThrow(
          yield* query.getThreadDetailById(saved.threadId),
        ).deepPlan;
        expect(restored).toEqual(saved);
        yield* engine.dispatch({
          type: "thread.deep-plan.update",
          commandId: CommandId.make("restart-after-recreation"),
          threadId: saved.threadId,
          runId: saved.id,
          expectedRevision: saved.revision,
          operationId: "after-recreation",
          mutation: {
            type: "step-update",
            stepId: "persist",
            status: "implemented",
            evidence: [],
            actor: { implementerId: `thread:${saved.threadId}`, model },
          },
          createdAt,
        });
        const run = Option.getOrThrow(yield* query.getThreadDetailById(saved.threadId)).deepPlan;
        expect(run?.stepStates[0]?.status).toBe("implemented");
        expect(run?.approval?.requestedParallelism).toBe(2);
        expect(run?.phase).toBe("implementing");
      }).pipe(Effect.provide(Layer.fresh(systemLayer)));
    }),
  );

  it.effect("resolves new-thread implementation to one canonical persisted run", () =>
    Effect.gen(function* () {
      const fixture = yield* prepareRun("new-thread", true);
      const repository = yield* ProjectionThreadRepository;
      const query = yield* ProjectionSnapshotQuery;
      const canonical = yield* fixture.readRun;
      expect(
        Option.getOrThrow(
          yield* repository.getDeepPlanByImplementationThreadId(fixture.implementationThreadId),
        ),
      ).toEqual(canonical);
      expect(
        Option.getOrThrow(yield* query.getThreadDetailById(fixture.implementationThreadId))
          .deepPlan,
      ).toEqual(canonical);
      expect(
        Option.getOrThrow(yield* query.getThreadShellById(fixture.implementationThreadId)).deepPlan,
      ).toEqual(canonical);
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        readonly count: number;
      }>`SELECT COUNT(*) AS count FROM projection_threads WHERE deep_plan_json IS NOT NULL AND project_id = 'new-thread-project'`;
      expect(rows[0]?.count).toBe(1);
      const proposedPlan = Option.getOrThrow(yield* query.getThreadDetailById(fixture.threadId))
        .proposedPlans[0];
      expect(proposedPlan?.deepPlan).toEqual({ runId: fixture.runId, planVersion: 1 });
      expect(proposedPlan?.implementationThreadId).toBe(fixture.implementationThreadId);

      if (canonical.approval === null) return yield* Effect.die("Expected an approved run");
      const target = Option.getOrThrow(
        yield* repository.getById({ threadId: fixture.implementationThreadId }),
      );
      const evidence = [{ kind: "test" as const, summary: "Earlier work passed", createdAt }];
      yield* repository.upsert({
        ...target,
        deepPlan: {
          ...canonical,
          id: DeepPlanRunId.make("older-completed-local-run"),
          threadId: fixture.implementationThreadId,
          phase: "completed",
          approval: {
            ...canonical.approval,
            implementationThreadId: fixture.implementationThreadId,
          },
          stepStates: canonical.stepStates.map((step) => ({
            ...step,
            status: "verified",
            evidence,
          })),
          finalValidation: { ...canonical.finalValidation, status: "passed", evidence },
          updatedAt: "2026-10-15T08:00:00.000Z",
        },
      });
      expect(
        Option.getOrThrow(yield* query.getThreadDetailById(fixture.implementationThreadId))
          .deepPlan,
      ).toEqual(canonical);
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect("does not finish the durable run when its assistant turn settles", () =>
    Effect.gen(function* () {
      const fixture = yield* prepareRun("turn-settlement");
      const engine = yield* OrchestrationEngineService;
      const before: DeepPlanRun = yield* fixture.readRun;
      yield* engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("settled-assistant-turn"),
        threadId: fixture.threadId,
        createdAt,
        session: {
          threadId: fixture.threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          runtimeSessionId: null,
          abortState: null,
          lastError: null,
          updatedAt: createdAt,
        },
      });
      expect(yield* fixture.readRun).toEqual(before);
      const stale = yield* engine
        .dispatch({
          type: "thread.deep-plan.update",
          commandId: CommandId.make("stale-persisted-revision"),
          threadId: fixture.threadId,
          runId: fixture.runId,
          expectedRevision: before.revision - 1,
          operationId: "stale-persisted-revision",
          mutation: { type: "pause" },
          createdAt,
        })
        .pipe(Effect.flip);
      expect(stale._tag).toBe("OrchestrationCommandInvariantError");
      expect(yield* fixture.readRun).toEqual(before);
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect(
    "blocks automatic settlement of unfinished work and still allows manual settlement",
    () =>
      Effect.gen(function* () {
        const fixture = yield* prepareRun("manual-settlement");
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        const original = yield* fixture.readRun;
        const failure = yield* engine
          .dispatch({
            type: "thread.auto-settle",
            commandId: CommandId.make("unfinished-auto-settlement"),
            threadId: fixture.threadId,
            snapshotSequence: yield* engine.latestSequence,
            settledAt: createdAt,
          })
          .pipe(Effect.flip);
        expect(failure._tag).toBe("OrchestrationThreadSettleBlockedError");
        yield* engine.dispatch({
          type: "thread.settle",
          commandId: CommandId.make("unfinished-manual-settlement"),
          threadId: fixture.threadId,
        });
        expect(
          Option.getOrThrow(yield* query.getThreadDetailById(fixture.threadId)).settledOverride,
        ).toBe("settled");
        expect(yield* fixture.readRun).toEqual(original);
      }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect(
    "recovers a persisted validation request until the provider turn adopts its pending message",
    () =>
      Effect.gen(function* () {
        const fixture = yield* prepareRun("queued-validation");
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        const receipts = yield* OrchestrationCommandReceiptRepository;
        const turns = yield* ProjectionTurnRepository;
        const actor = { implementerId: `thread:${fixture.threadId}`, model };
        yield* fixture.update({
          type: "step-update",
          stepId: "persist",
          status: "inProgress",
          evidence: [],
          actor,
        });
        yield* fixture.update({
          type: "step-update",
          stepId: "persist",
          status: "implemented",
          evidence: [],
          actor,
        });
        const verified = yield* fixture.update({
          type: "step-update",
          stepId: "persist",
          status: "verified",
          evidence: [{ kind: "test", summary: "Restoration check passed", createdAt }],
          actor,
        });
        const requestId = finalValidationRequestId(verified);
        yield* fixture.update({ type: "validation-start", requestId, actor });
        const result = yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(requestId),
          threadId: fixture.threadId,
          modelSelection: model,
          runtimeMode: "full-access",
          interactionMode: "default",
          message: {
            messageId: MessageId.make(requestId + ":message"),
            role: "user",
            text: "Perform final validation",
            attachments: [],
          },
          createdAt,
        });
        const recover = Effect.gen(function* () {
          return yield* pendingDeepPlanTurnRequests({
            readModel: yield* query.getCommandReadModel(),
            receipts,
            turns,
            engine,
          });
        });
        const recovered = yield* recover;
        expect(recovered).toHaveLength(1);
        expect(recovered[0]).toMatchObject({
          sequence: result.sequence,
          commandId: requestId,
          type: "thread.turn-start-requested",
          payload: { messageId: requestId + ":message" },
        });
        expect(yield* engine.latestSequence).toBe(result.sequence);
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("queued-validation-adopted"),
          threadId: fixture.threadId,
          session: {
            threadId: fixture.threadId,
            status: "running",
            providerName: "codex",
            activeTurnId: TurnId.make("queued-validation-provider-turn"),
            runtimeSessionId: null,
            runtimeMode: "full-access",
            abortState: null,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        expect(yield* recover).toEqual([]);
      }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect("rejects reusing another thread's durable run identity", () =>
    Effect.gen(function* () {
      const fixture = yield* prepareRun("foreign-identity");
      const engine = yield* OrchestrationEngineService;
      const query = yield* ProjectionSnapshotQuery;
      const foreignId = ThreadId.make("foreign-identity-other-thread");
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("foreign-thread-create"),
        threadId: foreignId,
        projectId: ProjectId.make("foreign-identity-project"),
        title: "Other thread",
        modelSelection: model,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      });
      const failure = yield* engine
        .dispatch({
          type: "thread.deep-plan.start",
          commandId: CommandId.make("foreign-run-start"),
          threadId: foreignId,
          runId: fixture.runId,
          createdAt,
        })
        .pipe(Effect.flip);
      expect(failure._tag).toBe("OrchestrationCommandInvariantError");
      expect(
        Option.getOrThrow(yield* query.getThreadDetailById(foreignId)).deepPlan,
      ).toBeUndefined();
      expect((yield* fixture.readRun).phase).toBe("implementing");
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect(
    "automatically dispatches final validation after all step checks and retries a busy turn",
    () =>
      Effect.gen(function* () {
        const fixture = yield* prepareRun("validation-queue");
        const engine = yield* OrchestrationEngineService;
        const actor = { implementerId: `thread:${fixture.threadId}`, model };
        const requests: string[] = [];
        let busy = true;
        const dispatcher = Layer.succeed(DeepPlanValidationDispatcher, {
          dispatch: (_run, requestId) =>
            Effect.sync(() => {
              if (_run.id !== fixture.runId) return "deferred" as const;
              requests.push(requestId);
              return busy ? ("deferred" as const) : ("dispatched" as const);
            }),
        });
        yield* Effect.gen(function* () {
          const reactor = yield* DeepPlanValidationReactor;
          yield* reactor.start();
          yield* fixture.update({
            type: "step-update",
            stepId: "persist",
            status: "inProgress",
            evidence: [],
            actor,
          });
          yield* fixture.update({
            type: "step-update",
            stepId: "persist",
            status: "implemented",
            evidence: [],
            actor,
          });
          yield* reactor.drainThrough(yield* engine.latestSequence);
          expect(requests).toEqual([]);
          const run = yield* fixture.update({
            type: "step-update",
            stepId: "persist",
            status: "verified",
            evidence: [{ kind: "test", summary: "Restored the persisted run", createdAt }],
            actor,
          });
          yield* reactor.drainThrough(yield* engine.latestSequence);
          expect(requests).toEqual([finalValidationRequestId(run)]);
          expect((yield* fixture.readRun).phase).toBe("validating");

          busy = false;
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("validation-queue-idle"),
            threadId: fixture.threadId,
            createdAt,
            session: {
              threadId: fixture.threadId,
              status: "ready",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              runtimeSessionId: null,
              abortState: null,
              lastError: null,
              updatedAt: createdAt,
            },
          });
          yield* reactor.drainThrough(yield* engine.latestSequence);
          expect(requests).toEqual([finalValidationRequestId(run), finalValidationRequestId(run)]);
          yield* fixture.update({
            type: "step-update",
            stepId: "persist",
            status: "verified",
            evidence: [{ kind: "test", summary: "Restored the persisted run again", createdAt }],
            actor,
          });
          yield* reactor.drainThrough(yield* engine.latestSequence);
          expect(requests).toHaveLength(2);
        }).pipe(Effect.provide(DeepPlanValidationReactorLive.pipe(Layer.provide(dispatcher))));
      }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );

  it.effect("recovers final validation on startup using the same durable request identity", () =>
    Effect.gen(function* () {
      const fixture = yield* prepareRun("validation-recovery");
      const engine = yield* OrchestrationEngineService;
      const actor = { implementerId: `thread:${fixture.threadId}`, model };
      yield* fixture.update({
        type: "step-update",
        stepId: "persist",
        status: "inProgress",
        evidence: [],
        actor,
      });
      yield* fixture.update({
        type: "step-update",
        stepId: "persist",
        status: "implemented",
        evidence: [],
        actor,
      });
      const run = yield* fixture.update({
        type: "step-update",
        stepId: "persist",
        status: "verified",
        evidence: [{ kind: "test", summary: "Restart check passed", createdAt }],
        actor,
      });
      const requests: string[] = [];
      const dispatcher = Layer.succeed(DeepPlanValidationDispatcher, {
        dispatch: (candidate, requestId) =>
          Effect.gen(function* () {
            if (candidate.id !== run.id) return "deferred" as const;
            requests.push(requestId);
            yield* engine.dispatch({
              type: "thread.deep-plan.update",
              commandId: CommandId.make(`${requestId}:start`),
              threadId: run.threadId,
              runId: run.id,
              expectedRevision: run.revision,
              operationId: `${requestId}:start`,
              mutation: { type: "validation-start", requestId, actor },
              createdAt,
            });
            return "dispatched" as const;
          }).pipe(Effect.orDie),
      });
      for (let restart = 0; restart < 2; restart += 1) {
        yield* Effect.gen(function* () {
          const reactor = yield* DeepPlanValidationReactor;
          yield* reactor.start();
          yield* reactor.drainThrough(yield* engine.latestSequence);
        }).pipe(
          Effect.provide(
            Layer.fresh(DeepPlanValidationReactorLive.pipe(Layer.provide(dispatcher))),
          ),
        );
      }
      expect(requests).toEqual([finalValidationRequestId(run), finalValidationRequestId(run)]);
      const restored = yield* fixture.readRun;
      expect(restored.revision).toBe(run.revision + 1);
      expect(restored.finalValidation.status).toBe("inProgress");
      expect(restored.phase).toBe("validating");
    }).pipe(Effect.provide(Layer.fresh(systemLayer))),
  );
});
