import {
  CommandId,
  DeepPlanRunId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type DeepPlanExecutionContext,
  type DeepPlanRun,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { deepPlanProviderContext, resolveLiveDeepPlan } from "./DeepPlanProviderContext.ts";

const owner = ThreadId.make("deep-owner");
const implementer = ThreadId.make("deep-implementer");
const reviewer = ThreadId.make("deep-reviewer");
const laneId = "lane-1";
const selectedModel = {
  instanceId: ProviderInstanceId.make("selected-provider"),
  model: "selected-model",
};
const approvedModel = {
  instanceId: ProviderInstanceId.make("approved-provider"),
  model: "approved-model",
};
const reviewModel = {
  instanceId: ProviderInstanceId.make("review-provider"),
  model: "review-model",
};
const createdAt = "2026-10-16T08:00:00.000Z";
const planningRun: DeepPlanRun = {
  schemaVersion: 2,
  id: DeepPlanRunId.make("deep-run"),
  threadId: owner,
  phase: "planning",
  revision: 1,
  chats: [],
  includeProjectChats: false,
  plan: null,
  approval: null,
  approvalKey: null,
  steps: [],
  finalReview: {
    status: "pending",
    submission: null,
    reviews: [],
    roundLimit: 3,
    unsubmittedTurns: 0,
  },
  activeTurns: [],
  pause: null,
  operations: [],
  createdAt,
  updatedAt: createdAt,
};
const approvedRun: DeepPlanRun = {
  ...planningRun,
  phase: "implementing",
  plan: {
    schemaVersion: 2,
    version: 1,
    goal: "Preserve the selected mode",
    scope: ["Provider permission handling"],
    nonGoals: [],
    decisions: [],
    affectedAreas: ["Provider"],
    steps: [
      {
        id: "preserve-mode",
        title: "Preserve the selected mode",
        description: "Honor explicit read-only turns during approved implementation.",
        dependencies: [],
        acceptanceCriteria: [
          {
            id: "plan-is-readonly",
            description: "An explicit Plan turn stays read-only.",
            checkMethod: "Inspect the bound provider context.",
          },
        ],
      },
    ],
    finalValidation: {
      description: "Check permission transitions",
      checkMethod: "Run the provider regression tests",
    },
  },
  approvalKey: "approved-plan",
  approval: {
    planVersion: 1,
    approvalKey: "approved-plan",
    approvedAt: createdAt,
    implementation: approvedModel,
    reviewer: reviewModel,
    parallelism: 1,
    lanes: [{ laneId, threadId: implementer }],
    baseTurnCount: 0,
  },
};
const stepId = "preserve-mode";
const implementationAssignment = {
  kind: "implement",
  stepId,
  threadId: implementer,
  laneId,
  commandId: CommandId.make("implement"),
  round: 1,
  attempt: 0,
  startedAt: createdAt,
} as const;
const reviewAssignment = {
  ...implementationAssignment,
  kind: "review",
  threadId: reviewer,
  commandId: CommandId.make("review"),
} as const;
const planningTurn = {
  id: RunId.make("planning-turn"),
  threadId: owner,
  status: "running",
  userMessageId: MessageId.make("planning-message"),
  deepPlanRunId: planningRun.id,
} as const;
const implementationTurn = {
  ...planningTurn,
  id: RunId.make("implementation-turn"),
  threadId: implementer,
  userMessageId: MessageId.make("implement:message"),
};
const reviewTurn = {
  ...planningTurn,
  id: RunId.make("review-turn"),
  threadId: reviewer,
  userMessageId: MessageId.make("review:message"),
};
const implementationGrant = {
  runId: planningRun.id,
  runThreadId: owner,
  approvedPlanVersion: 1,
  phase: "execution",
  modelSelection: approvedModel,
  laneId,
} as const satisfies DeepPlanExecutionContext;
const reviewGrant = {
  runId: planningRun.id,
  runThreadId: owner,
  approvedPlanVersion: 1,
  phase: "review",
  modelSelection: reviewModel,
  readOnly: true,
  review: { target: { kind: "step", stepId }, round: 1 },
} as const satisfies DeepPlanExecutionContext;

describe("deepPlanProviderContext", () => {
  it.each(["planning", "awaitingApproval", "paused"] as const)(
    "binds %s only during a Deep Plan planning turn",
    (phase) => {
      const run = { ...planningRun, phase };
      for (const interactionMode of ["default", "chat"] as const) {
        expect(
          deepPlanProviderContext({
            run,
            turn: planningTurn,
            modelSelection: selectedModel,
            interactionMode,
          }),
        ).toBeUndefined();
      }
      expect(
        deepPlanProviderContext({
          run,
          turn: planningTurn,
          modelSelection: selectedModel,
          interactionMode: "plan",
        }),
      ).toEqual({
        phase: "planning",
        runId: run.id,
        runThreadId: owner,
        approvedPlanVersion: null,
        turnId: planningTurn.id,
        readOnly: true,
        modelSelection: selectedModel,
      });
    },
  );

  it.each([
    { name: "no assigned turn", run: approvedRun, turn: implementationTurn },
    {
      name: "old attempt",
      run: { ...approvedRun, activeTurns: [implementationAssignment] },
      turn: { ...implementationTurn, userMessageId: MessageId.make("old-attempt:message") },
    },
    {
      name: "finished attempt",
      run: { ...approvedRun, activeTurns: [implementationAssignment] },
      turn: { ...implementationTurn, status: "completed" as const },
    },
    {
      name: "different Deep Plan",
      run: { ...approvedRun, activeTurns: [implementationAssignment] },
      turn: { ...implementationTurn, deepPlanRunId: DeepPlanRunId.make("other") },
    },
  ])("rejects an implementing credential with $name", ({ run, turn }) => {
    expect(
      deepPlanProviderContext({
        run,
        turn,
        modelSelection: approvedModel,
        interactionMode: "default",
        threadGrant: implementationGrant,
      }),
    ).toBeUndefined();
  });

  it("binds the assigned implementing lane to its approved model and current turn", () => {
    expect(
      deepPlanProviderContext({
        run: { ...approvedRun, activeTurns: [implementationAssignment] },
        turn: implementationTurn,
        modelSelection: selectedModel,
        interactionMode: "default",
        threadGrant: implementationGrant,
      }),
    ).toEqual({ ...implementationGrant, turnId: implementationTurn.id });
  });

  it("binds an independent reviewer to its exact round, target, model and turn", () => {
    const input = {
      run: { ...approvedRun, activeTurns: [reviewAssignment] },
      turn: reviewTurn,
      modelSelection: selectedModel,
      interactionMode: "default",
      threadGrant: reviewGrant,
    } as const;
    expect(deepPlanProviderContext(input)).toEqual({ ...reviewGrant, turnId: reviewTurn.id });
    for (const threadGrant of [
      undefined,
      implementationGrant,
      { ...reviewGrant, approvedPlanVersion: 2 },
      { ...reviewGrant, review: { ...reviewGrant.review, round: 2 } },
      { ...reviewGrant, review: { ...reviewGrant.review, target: { kind: "final" } as const } },
    ]) {
      expect(
        deepPlanProviderContext({
          ...input,
          threadGrant,
        }),
      ).toBeUndefined();
    }
  });

  it.effect.each([
    { name: "completed", previous: { ...approvedRun, phase: "completed" as const } },
    { name: "cancelled", previous: { ...approvedRun, phase: "cancelled" as const } },
    { name: "replaced", previous: { ...planningRun, id: DeepPlanRunId.make("replacement") } },
  ])("lets a former lane plan its own Deep Plan after the $name run", ({ previous }) => {
    const ownRun = { ...planningRun, id: DeepPlanRunId.make("own-run"), threadId: implementer };
    const shell = (thread: Partial<OrchestrationV2ThreadShell>) =>
      ({
        archivedAt: null,
        deletedAt: null,
        activeRunId: null,
        ...thread,
      }) as OrchestrationV2ThreadShell;
    const threads = new Map([
      [
        implementer,
        shell({
          id: implementer,
          activeRunId: planningTurn.id,
          deepPlan: ownRun,
          deepPlanExecution: implementationGrant,
        }),
      ],
      [owner, shell({ id: owner, deepPlan: previous })],
    ]);
    const turn = { ...planningTurn, threadId: implementer, deepPlanRunId: ownRun.id };
    const projections = {
      getThreadShell: (id: typeof owner) => Effect.succeed(threads.get(id) ?? null),
      getThreadRecords: () => Effect.succeed({ runs: [turn] }),
    } as unknown as ProjectionStoreV2["Service"];
    return Effect.gen(function* () {
      const live = yield* resolveLiveDeepPlan({
        threadId: implementer,
        modelSelection: selectedModel,
        interactionMode: "plan",
      }).pipe(Effect.provideService(ProjectionStoreV2, projections));
      expect(live?.grant).toEqual({
        phase: "planning",
        runId: ownRun.id,
        runThreadId: implementer,
        approvedPlanVersion: null,
        turnId: planningTurn.id,
        readOnly: true,
        modelSelection: selectedModel,
      });
    });
  });

  it("does not bind a legacy plan", () => {
    expect(
      deepPlanProviderContext({
        run: {
          schemaVersion: 1,
          kind: "legacy",
          id: planningRun.id,
          threadId: owner,
          goal: "Old plan",
          updatedAt: createdAt,
        },
        turn: planningTurn,
        modelSelection: selectedModel,
        interactionMode: "plan",
      }),
    ).toBeUndefined();
  });
});
