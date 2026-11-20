import {
  CommandId,
  type DeepPlanActiveTurn,
  type DeepPlanMutation,
  type DeepPlanPlanDraft,
  DeepPlanRunId,
  deriveDeepPlanRunId,
  EventId,
  isDeepPlanRun,
  type OrchestrationV2Run,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { checkpointCaptureCommandId } from "../orchestration-v2/CheckpointCaptureService.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { DeepPlanChatReferences } from "./DeepPlanChatReferences.ts";
import { DeepPlanConductor, DeepPlanConductorLive } from "./DeepPlanConductor.ts";
import { DeepPlanWorkflow, DeepPlanWorkflowLive } from "./DeepPlanWorkflow.ts";

const instanceId = ProviderInstanceId.make("codex");
const implementation = { instanceId, model: "implementation-model" };
const reviewer = { instanceId, model: "review-model" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" } as const),
  openSession: () => Effect.die("The test controls provider lifecycle through persisted events"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const conductorLayer = DeepPlanConductorLive.pipe(
  Layer.provide(
    Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({
      hasReviewDiff: () => Effect.succeed(true),
    }),
  ),
);

const layerTest = conductorLayer.pipe(
  Layer.provideMerge(
    ProviderReplayHarness.layerWithRegistry(
      { name: "deep-plan-conductor" },
      ProviderAdapterRegistry.layerFromAdapters([adapter]),
      { runEffectWorker: false },
    ),
  ),
);

const workflowLayer = DeepPlanWorkflowLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      NodeCrypto.layer,
      Layer.mock(ThreadManagementService)({ hasReceipt: () => Effect.succeed(false) }),
      Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
      Layer.mock(DeepPlanChatReferences)({}),
      ServerSettings.layerTest(),
    ),
  ),
);

const plan = {
  goal: "Review two independent changes",
  scope: ["Preserve project behavior"],
  nonGoals: [],
  decisions: [],
  affectedAreas: ["Workspace"],
  steps: ["first", "second"].map((id) => ({
    id,
    title: `Implement ${id}`,
    description: `Update ${id}.ts`,
    dependencies: [],
    acceptanceCriteria: [
      { id: `check-${id}`, description: "Behavior is covered", checkMethod: "Run tests" },
    ],
  })),
  finalValidation: { description: "The changes work together", checkMethod: "Run the suite" },
} satisfies DeepPlanPlanDraft;

const start = Effect.fn("DeepPlanConductorTest.start")(function* (parallelism: number) {
  const engine = yield* Orchestrator.OrchestratorV2;
  const events = yield* EventSink.EventSinkV2;
  const testScope = yield* Scope.Scope;
  let conductor = yield* DeepPlanConductor;
  let conductorScope = yield* Scope.fork(testScope);
  const owner = ThreadId.make("deep-plan-conductor-owner");
  const startCommandId = CommandId.make("deep-plan-conductor-start");
  const runId: DeepPlanRunId = deriveDeepPlanRunId(startCommandId);
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make("deep-plan-conductor-create"),
    threadId: owner,
    projectId: ProjectId.make("deep-plan-conductor-project"),
    title: "Deep Plan",
    modelSelection: implementation,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  yield* engine.dispatch({
    type: "thread.deep-plan.start",
    commandId: startCommandId,
    threadId: owner,
    chats: [],
    includeProjectChats: false,
    createdAt: DateTime.formatIso(yield* DateTime.now),
  });

  const getRun = Effect.fn("DeepPlanConductorTest.getRun")(function* () {
    const run = (yield* engine.getThreadShell(owner))?.deepPlan;
    if (!isDeepPlanRun(run)) return assert.fail("Expected the v2 Deep Plan to be saved");
    return run;
  });
  const update = Effect.fn("DeepPlanConductorTest.update")(function* (
    mutation: DeepPlanMutation,
    actor?: ThreadId | DeepPlanActiveTurn,
  ) {
    const run = yield* getRun();
    const commandId = CommandId.make(`conductor-test:${run.revision}:${mutation.type}`);
    return yield* engine.dispatch({
      type: "thread.deep-plan.update",
      commandId,
      threadId: owner,
      runId,
      expectedRevision: run.revision,
      operationId: commandId,
      mutation,
      ...(typeof actor === "string"
        ? { byThreadId: actor }
        : actor && {
            byThreadId: actor.threadId,
            byTurnCommandId: actor.commandId,
          }),
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
  });
  const writeStatus = Effect.fn("DeepPlanConductorTest.writeStatus")(function* (
    turn: DeepPlanActiveTurn,
    status: Extract<
      OrchestrationV2Run["status"],
      "running" | "completed" | "interrupted" | "cancelled"
    >,
  ) {
    const projection = yield* engine.getThreadProjection(turn.threadId);
    const run = projection.runs.find((run) => run.userMessageId === `${turn.commandId}:message`);
    if (!run) return assert.fail(`Expected a dispatch for ${turn.kind}`);
    const now = yield* DateTime.now;
    const commandId =
      status === "completed"
        ? checkpointCaptureCommandId(run.id)
        : status === "cancelled"
          ? CommandId.make(`command:runtime-reconcile:startup:${run.id}`)
          : undefined;
    const stored = yield* events.write({
      ...(commandId === undefined ? {} : { commandId }),
      events: [
        {
          id: EventId.make(`${run.id}:${status}`),
          type: "run.updated",
          threadId: turn.threadId,
          runId: run.id,
          occurredAt: now,
          payload: {
            ...run,
            status,
            startedAt: run.startedAt ?? now,
            completedAt: status === "running" ? null : now,
          },
        },
      ],
    });
    return stored[0]!.sequence;
  });
  const setStatus = Effect.fn("DeepPlanConductorTest.setStatus")(function* (
    turn: DeepPlanActiveTurn,
    status: Extract<OrchestrationV2Run["status"], "running" | "completed" | "interrupted">,
  ) {
    yield* conductor.drainThrough(yield* writeStatus(turn, status));
  });
  const restartDuring = Effect.fn("DeepPlanConductorTest.restartDuring")(function* (
    turn: DeepPlanActiveTurn,
  ) {
    yield* Scope.close(conductorScope, Exit.void);
    const recovered = yield* writeStatus(turn, "cancelled");
    conductorScope = yield* Scope.fork(testScope);
    const services = yield* Layer.buildWithScope(Layer.fresh(conductorLayer), conductorScope);
    conductor = Context.get(services, DeepPlanConductor);
    yield* conductor.start().pipe(Scope.provide(conductorScope));
    yield* conductor.drainThrough(recovered);
  });
  const submit = Effect.fn("DeepPlanConductorTest.submit")(function* (turn: DeepPlanActiveTurn) {
    const target =
      turn.stepId === null
        ? { kind: "final" as const }
        : { kind: "step" as const, stepId: turn.stepId };
    const result = yield* update(
      {
        type: "submit",
        target,
        summary: "Implemented change",
        changedFiles: [`${turn.stepId}.ts`],
      },
      turn,
    );
    yield* conductor.drainThrough(result.sequence);
    yield* setStatus(turn, "completed");
  });
  const review = Effect.fn("DeepPlanConductorTest.review")(function* (
    turn: DeepPlanActiveTurn,
    verdict: "approved" | "changesRequested",
  ) {
    const target =
      turn.stepId === null
        ? { kind: "final" as const }
        : { kind: "step" as const, stepId: turn.stepId };
    const result = yield* update(
      {
        type: "review-verdict",
        target,
        round: turn.round,
        verdict,
        summary: verdict === "approved" ? "Checks passed" : "The acceptance check still fails",
        findings:
          verdict === "approved"
            ? []
            : [
                {
                  severity: "blocking",
                  title: "Missing coverage",
                  detail: "Exercise the affected behavior.",
                },
              ],
      },
      turn,
    );
    yield* conductor.drainThrough(result.sequence);
    yield* setStatus(turn, "completed");
  });

  yield* update({ type: "publish-plan", plan }, owner);
  const published = yield* getRun();
  const approval = yield* update({
    type: "approve",
    planVersion: published.plan!.version,
    approvalKey: published.approvalKey!,
    implementation,
    reviewer,
    implementationThread: "current",
    parallelism,
  });
  yield* conductor.start().pipe(Scope.provide(conductorScope));
  yield* conductor.drainThrough(approval.sequence);
  return {
    engine,
    owner,
    getRun,
    update,
    setStatus,
    restartDuring,
    submit,
    review,
    drainThrough: (sequence: number) => conductor.drainThrough(sequence),
  };
});

it.effect("seeds an approved run and waits for both parallel lanes before final review", () =>
  Effect.gen(function* () {
    const test = yield* start(2);
    const seeded = yield* test.getRun();
    assert.lengthOf(seeded.activeTurns, 1);
    const first = seeded.activeTurns[0]!;
    yield* test.setStatus(first, "running");
    const parallel = yield* test.getRun();
    const second = parallel.activeTurns.find((turn) => turn.stepId === "second")!;
    assert.isDefined(second);
    assert.notEqual(first.threadId, second.threadId);

    yield* test.submit(first);
    const firstReview = (yield* test.getRun()).activeTurns.find((turn) => turn.kind === "review")!;
    assert.isDefined(firstReview);
    assert.notEqual(firstReview.threadId, first.threadId);
    yield* test.review(firstReview, "approved");
    const between = yield* test.getRun();
    assert.equal(between.phase, "implementing");
    assert.deepEqual(between.activeTurns, [second]);
    assert.lengthOf((yield* test.engine.getThreadProjection(test.owner)).runs, 1);

    yield* test.submit(second);
    const secondReview = (yield* test.getRun()).activeTurns[0]!;
    yield* test.review(secondReview, "approved");
    const checking = yield* test.getRun();
    assert.equal(checking.phase, "finalReview");
    assert.equal(checking.activeTurns[0]?.kind, "finalReview");
    assert.deepEqual(checking.finalReview.reviews[0]?.diff, {
      threadId: first.threadId,
      toThreadId: second.threadId,
      fromTurnCount: 0,
      toTurnCount: 1,
    });
    yield* test.review(checking.activeTurns[0]!, "changesRequested");
    const fix = (yield* test.getRun()).activeTurns[0]!;
    assert.equal(fix.kind, "finalFix");
    yield* test.submit(fix);
    const rechecking = yield* test.getRun();
    assert.equal(rechecking.activeTurns[0]?.kind, "finalReview");
    assert.deepEqual(rechecking.finalReview.reviews[1]?.diff, {
      threadId: first.threadId,
      fromTurnCount: 0,
      toTurnCount: 2,
    });
    yield* test.review(rechecking.activeTurns[0]!, "approved");
    const completed = yield* test.getRun();
    assert.equal(completed.phase, "completed");
    assert.isEmpty(completed.activeTurns);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "nudges once for an unsubmitted turn and pauses with a reason when it happens again",
  () =>
    Effect.gen(function* () {
      const test = yield* start(1);
      const first = (yield* test.getRun()).activeTurns[0]!;
      yield* test.setStatus(first, "completed");
      const retry = (yield* test.getRun()).activeTurns[0]!;
      assert.equal(retry.kind, "implement");
      assert.notEqual(retry.commandId, first.commandId);
      yield* test.setStatus(retry, "completed");
      const paused = yield* test.getRun();
      assert.equal(paused.phase, "paused");
      assert.equal(paused.pause?.kind, "turnFailed");
      assert.isNotEmpty(paused.pause?.reason ?? "");
      assert.lengthOf((yield* test.engine.getThreadProjection(test.owner)).runs, 2);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("pauses after three rejected reviews and grants three additional rounds on resume", () =>
  Effect.gen(function* () {
    const test = yield* start(1);
    for (const round of [1, 2, 3]) {
      const work = (yield* test.getRun()).activeTurns[0]!;
      assert.equal(work.kind, round === 1 ? "implement" : "fix");
      yield* test.submit(work);
      const review = (yield* test.getRun()).activeTurns[0]!;
      assert.equal(review.round, round);
      yield* test.review(review, "changesRequested");
    }
    const paused = yield* test.getRun();
    assert.equal(paused.phase, "paused");
    assert.equal(paused.pause?.kind, "reviewLimit");
    const resumed = yield* test.update({ type: "resume" });
    yield* test.drainThrough(resumed.sequence);
    const continuing = yield* test.getRun();
    assert.equal(continuing.steps[0]?.roundLimit, 6);
    assert.equal(continuing.activeTurns[0]?.kind, "fix");
    assert.equal(continuing.activeTurns[0]?.round, 4);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("re-dispatches a turn cut by server restarts without spending its one retry", () =>
  Effect.gen(function* () {
    const test = yield* start(1);
    let turn = (yield* test.getRun()).activeTurns[0]!;
    for (const _restart of [1, 2]) {
      yield* test.setStatus(turn, "running");
      yield* test.restartDuring(turn);
      const resumed = (yield* test.getRun()).activeTurns[0]!;
      assert.notEqual(resumed.commandId, turn.commandId);
      assert.include(resumed, { kind: "implement", stepId: "first", attempt: 0 });
      turn = resumed;
    }
    yield* test.setStatus(turn, "interrupted");
    const retry = yield* test.getRun();
    assert.equal(retry.phase, "implementing");
    assert.equal(retry.activeTurns[0]?.attempt, 1);
    yield* test.setStatus(retry.activeTurns[0]!, "interrupted");
    const paused = yield* test.getRun();
    assert.equal(paused.phase, "paused");
    assert.equal(paused.pause?.kind, "turnFailed");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps a recorded verdict when the reviewer's provider run is interrupted", () =>
  Effect.gen(function* () {
    const test = yield* start(1);
    yield* test.submit((yield* test.getRun()).activeTurns[0]!);
    const review = (yield* test.getRun()).activeTurns[0]!;
    assert.equal(review.kind, "review");
    const recorded = yield* test.update(
      {
        type: "review-verdict",
        target: { kind: "step", stepId: "first" },
        round: review.round,
        verdict: "approved",
        summary: "Checks passed",
        findings: [],
      },
      review,
    );
    yield* test.drainThrough(recorded.sequence);
    yield* test.setStatus(review, "interrupted");
    const next = yield* test.getRun();
    assert.equal(next.phase, "implementing");
    assert.equal(next.steps[0]?.status, "verified");
    assert.equal(next.steps[0]?.reviews.at(-1)?.verdict, "approved");
    assert.deepInclude(next.activeTurns[0], { kind: "implement", stepId: "second" });
  }).pipe(Effect.provide(layerTest)),
);

it.effect("pauses on a user stop and does not retry the stopped turn", () =>
  Effect.gen(function* () {
    const test = yield* start(1);
    const turn = (yield* test.getRun()).activeTurns[0]!;
    yield* test.setStatus(turn, "running");
    yield* (yield* DeepPlanWorkflow).pauseForStop(turn.threadId);
    yield* test.setStatus(turn, "interrupted");
    const stopped = yield* test.getRun();
    assert.equal(stopped.phase, "paused");
    assert.equal(stopped.pause?.kind, "user");
    assert.deepEqual(stopped.activeTurns, [turn]);
    assert.lengthOf((yield* test.engine.getThreadProjection(test.owner)).runs, 1);
  }).pipe(Effect.provide(workflowLayer.pipe(Layer.provideMerge(layerTest)))),
);

it.effect("leaves a legacy Deep Plan alone until a new start replaces it", () =>
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const events = yield* EventSink.EventSinkV2;
    const conductor = yield* DeepPlanConductor;
    const threadId = ThreadId.make("deep-plan-legacy-owner");
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("deep-plan-legacy-create"),
      threadId,
      projectId: ProjectId.make("deep-plan-conductor-project"),
      title: "Old Deep Plan",
      modelSelection: implementation,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    const { thread } = yield* engine.getThreadProjection(threadId);
    const now = yield* DateTime.now;
    const [legacy] = yield* events.write({
      events: [
        {
          id: EventId.make("deep-plan-legacy-run"),
          type: "thread.deep-plan-updated",
          threadId,
          occurredAt: now,
          payload: {
            ...thread,
            deepPlan: {
              schemaVersion: 1,
              kind: "legacy",
              id: DeepPlanRunId.make("deep-plan-legacy"),
              threadId,
              goal: "Finish the old plan",
              updatedAt: DateTime.formatIso(now),
            },
          },
        },
      ],
    });
    yield* conductor.start();
    yield* conductor.drainThrough(legacy!.sequence);
    assert.isEmpty((yield* engine.getThreadProjection(threadId)).runs);

    const restarted = yield* engine.dispatch({
      type: "thread.deep-plan.start",
      commandId: CommandId.make("deep-plan-legacy-replacement"),
      threadId,
      chats: [],
      includeProjectChats: false,
      createdAt: DateTime.formatIso(now),
    });
    yield* conductor.drainThrough(restarted.sequence);
    const replaced = (yield* engine.getThreadShell(threadId))?.deepPlan;
    if (!isDeepPlanRun(replaced)) return assert.fail("Expected a new Deep Plan to replace it");
    assert.equal(replaced.phase, "planning");
    assert.isEmpty((yield* engine.getThreadProjection(threadId)).runs);
  }).pipe(Effect.provide(layerTest)),
);
