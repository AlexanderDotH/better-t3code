import {
  CommandId,
  DeepPlanError,
  DeepPlanRunId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type DeepPlanDocument,
  type DeepPlanRun,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { DeepPlanValidationDispatcherLive } from "./DeepPlanValidationDispatcher.ts";
import {
  DeepPlanValidationDispatcher,
  finalValidationRequestId,
} from "./DeepPlanValidationReactor.ts";
import { DeepPlanWorkflow } from "./DeepPlanWorkflow.ts";
import { deepPlanApprovalKey, updateDeepPlanRun } from "./deepPlanDecision.ts";

const createdAt = "2026-10-16T09:00:00.000Z";
const ownerId = ThreadId.make("validation-dispatch-owner");
const targetId = ThreadId.make("validation-dispatch-target");
const model = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
  options: [{ id: "reasoningEffort", value: "high" }],
};
const plan: DeepPlanDocument = {
  schemaVersion: 1,
  version: 2,
  goal: "Restore durable work",
  scope: ["Preserve approved work across reconnects"],
  decisions: [],
  affectedAreas: ["Persistence"],
  steps: [
    {
      id: "restore",
      title: "Restore the work",
      description: "Restore persisted state",
      dependencies: [],
      acceptanceCriteria: [
        {
          id: "round-trip",
          description: "State survives restart",
          checkMethod: "Restart the engine",
        },
      ],
    },
  ],
  finalValidation: {
    description: "Check integration and regressions",
    checkMethod: "Run the focused integration checks",
  },
};

function makeFixture() {
  let run: DeepPlanRun = {
    id: DeepPlanRunId.make("validation-dispatch-run"),
    threadId: ownerId,
    phase: "validating",
    revision: 6,
    plan,
    approvalKey: deepPlanApprovalKey(plan),
    approval: {
      planVersion: 2,
      approvalKey: deepPlanApprovalKey(plan),
      approvedAt: createdAt,
      approvedBy: "user",
      implementation: model,
      implementationThreadId: targetId,
      implementerId: `thread:${targetId}`,
    },
    sources: [],
    sourceCoverage: [],
    stepStates: [
      {
        stepId: "restore",
        status: "verified",
        evidence: [{ kind: "test", summary: "Restart test passed", createdAt }],
        updatedAt: createdAt,
      },
    ],
    finalValidation: {
      status: "pending",
      evidence: [],
      updatedAt: null,
      attempt: 3,
      requestId: null,
      turnId: null,
    },
    procedureAdjustments: [],
    operations: [],
    createdAt,
    updatedAt: createdAt,
    pauseReason: null,
  };
  let target: OrchestrationThreadShell = {
    id: targetId,
    projectId: ProjectId.make("validation-project"),
    title: "Implementation",
    modelSelection: { instanceId: ProviderInstanceId.make("other"), model: "different-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
  let failDispatch = false;
  const attempts: Array<Extract<OrchestrationCommand, { type: "thread.turn.start" }>> = [];
  const accepted = new Set<string>();
  const layer = DeepPlanValidationDispatcherLive.pipe(
    Layer.provide(
      Layer.mock(OrchestrationEngineService)({
        dispatch: (command) =>
          Effect.gen(function* () {
            if (command.type !== "thread.turn.start")
              return yield* Effect.die("Unexpected validation command");
            attempts.push(command);
            if (failDispatch) {
              failDispatch = false;
              return yield* new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "Dispatch interrupted before persistence",
              });
            }
            accepted.add(command.commandId);
            return { sequence: accepted.size };
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: () => Effect.succeed(Option.some(target)),
      }),
    ),
    Layer.provide(
      Layer.mock(DeepPlanWorkflow)({
        getRun: () => Effect.succeed(run),
        withRunLock: (_runId, effect) => effect,
        update: (input) =>
          updateDeepPlanRun(run, {
            ...input,
            type: "thread.deep-plan.update",
            commandId: CommandId.make(input.operationId),
            createdAt,
          }).pipe(
            Effect.tap((next) =>
              Effect.sync(() => {
                run = next;
              }),
            ),
            Effect.mapError(
              (error) => new DeepPlanError({ code: "invalid-transition", message: error.detail }),
            ),
          ),
      }),
    ),
  );
  return {
    layer,
    attempts,
    accepted,
    getRun: () => run,
    pause: () => {
      run = { ...run, phase: "paused" };
    },
    busy: () => {
      target = {
        ...target,
        session: {
          threadId: targetId,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("implementation-turn"),
          runtimeSessionId: null,
          abortState: null,
          lastError: null,
          updatedAt: createdAt,
        },
      };
    },
    failNextDispatch: () => {
      failDispatch = true;
    },
  };
}

it.effect(
  "schedules explicit overall validation on the implementing thread with the approved model",
  () => {
    const fixture = makeFixture();
    return Effect.gen(function* () {
      const dispatcher = yield* DeepPlanValidationDispatcher;
      const requestId = finalValidationRequestId(fixture.getRun());
      expect(yield* dispatcher.dispatch(fixture.getRun(), requestId)).toBe("dispatched");
      expect(fixture.getRun().phase).toBe("validating");
      expect(fixture.getRun().finalValidation).toMatchObject({
        status: "inProgress",
        attempt: 3,
        requestId,
      });
      expect(fixture.attempts[0]).toMatchObject({
        threadId: targetId,
        commandId: requestId,
        modelSelection: model,
        interactionMode: "default",
        message: { messageId: requestId + ":message" },
      });
      expect(fixture.attempts[0]?.message.text).toContain("explicit final overall validation");
      expect(fixture.attempts[0]?.message.text).toContain("State survives restart");
    }).pipe(Effect.provide(fixture.layer));
  },
);

it.effect("defers validation while an implementing turn is running", () => {
  const fixture = makeFixture();
  fixture.busy();
  return Effect.gen(function* () {
    const dispatcher = yield* DeepPlanValidationDispatcher;
    expect(
      yield* dispatcher.dispatch(fixture.getRun(), finalValidationRequestId(fixture.getRun())),
    ).toBe("deferred");
    expect(fixture.attempts).toEqual([]);
    expect(fixture.getRun().finalValidation.status).toBe("pending");
  }).pipe(Effect.provide(fixture.layer));
});

it.effect("keeps an explicitly paused run paused", () => {
  const fixture = makeFixture();
  fixture.pause();
  return Effect.gen(function* () {
    const dispatcher = yield* DeepPlanValidationDispatcher;
    expect(
      yield* dispatcher.dispatch(fixture.getRun(), finalValidationRequestId(fixture.getRun())),
    ).toBe("deferred");
    expect(fixture.attempts).toEqual([]);
    expect(fixture.getRun().phase).toBe("paused");
  }).pipe(Effect.provide(fixture.layer));
});

it.effect(
  "recovers a reserved validation request after turn dispatch fails without changing its identity",
  () => {
    const fixture = makeFixture();
    fixture.failNextDispatch();
    return Effect.gen(function* () {
      const dispatcher = yield* DeepPlanValidationDispatcher;
      const requestId = finalValidationRequestId(fixture.getRun());
      const failure = yield* dispatcher.dispatch(fixture.getRun(), requestId).pipe(Effect.flip);
      expect(failure._tag).toBe("DeepPlanValidationDispatchError");
      const revisionAfterReservation = fixture.getRun().revision;
      expect(fixture.getRun().finalValidation.status).toBe("inProgress");
      expect(yield* dispatcher.dispatch(fixture.getRun(), requestId)).toBe("dispatched");
      expect(yield* dispatcher.dispatch(fixture.getRun(), requestId)).toBe("dispatched");
      expect(fixture.attempts.map((command) => command.commandId)).toEqual([
        requestId,
        requestId,
        requestId,
      ]);
      expect(fixture.accepted.size).toBe(1);
      expect(fixture.getRun().revision).toBe(revisionAfterReservation);
      expect(fixture.getRun().phase).toBe("validating");
    }).pipe(Effect.provide(fixture.layer));
  },
);
