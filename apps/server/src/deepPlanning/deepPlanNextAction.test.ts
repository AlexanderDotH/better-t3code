import {
  CommandId,
  DeepPlanRunId,
  DeepPlanStepId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type { DeepPlanActiveTurn, DeepPlanRun } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { decideNext, type DeepPlanObservation } from "./deepPlanNextAction.ts";

const primary = ThreadId.make("thread:deep-plan:primary");
const secondary = ThreadId.make("thread:deep-plan:secondary");
const reviewThread = ThreadId.make("thread:deep-plan:review");
const firstStep = DeepPlanStepId.make("first");
const secondStep = DeepPlanStepId.make("second");
const at = "2026-11-19T12:00:00.000Z";
const model = { instanceId: ProviderInstanceId.make("replay"), model: "replay" };
const turn: DeepPlanActiveTurn = {
  kind: "implement",
  commandId: CommandId.make("deep-plan:turn"),
  threadId: primary,
  stepId: firstStep,
  laneId: "lane-one",
  round: 1,
  attempt: 0,
  startedAt: at,
};

function run(overrides: Partial<DeepPlanRun> = {}): DeepPlanRun {
  const planSteps = [firstStep, secondStep].map((id) => ({
    id,
    title: id,
    description: id,
    dependencies: [],
    acceptanceCriteria: [{ id: id + "-works", description: "Works", checkMethod: "Run tests" }],
  }));
  return {
    schemaVersion: 2,
    id: DeepPlanRunId.make("deep-plan:actions"),
    threadId: primary,
    phase: "implementing",
    revision: 1,
    chats: [],
    includeProjectChats: false,
    plan: {
      schemaVersion: 2,
      version: 1,
      goal: "Complete two steps",
      scope: ["Test workspace"],
      nonGoals: [],
      decisions: [],
      affectedAreas: [],
      steps: planSteps,
      finalValidation: { description: "Works together", checkMethod: "Run tests" },
    },
    approvalKey: "test-key",
    approval: {
      planVersion: 1,
      approvalKey: "test-key",
      approvedAt: at,
      implementation: model,
      reviewer: model,
      parallelism: 2,
      lanes: [
        { laneId: "lane-one", threadId: primary },
        { laneId: "lane-two", threadId: secondary },
      ],
      baseTurnCount: 0,
    },
    steps: [firstStep, secondStep].map((stepId) => ({
      stepId,
      status: "pending",
      laneId: null,
      baseTurnCount: null,
      submission: null,
      reviews: [],
      roundLimit: 3,
      unsubmittedTurns: 0,
    })),
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
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function withActiveTurn(
  activeTurn = turn,
  stepOverrides: Partial<DeepPlanRun["steps"][number]> = {},
) {
  const current = run({ activeTurns: [activeTurn] });
  return {
    ...current,
    steps: [
      {
        ...current.steps[0]!,
        status: "implementing" as const,
        laneId: turn.laneId,
        ...stepOverrides,
      },
      current.steps[1]!,
    ],
  };
}

function observe(
  status?: DeepPlanObservation["runs"][number]["status"],
  commandId = turn.commandId,
  threadId = primary,
) {
  const latestRunId = status ? RunId.make("run:implementation") : null;
  return new Map([
    [primary, { latestRunId: null, availability: "idle" as const, runs: [] }],
    [
      threadId,
      {
        latestRunId,
        availability:
          status === "running" || status === "waiting" ? ("busy" as const) : ("idle" as const),
        runs:
          status && latestRunId
            ? [
                {
                  id: latestRunId,
                  ordinal: 1,
                  userMessageId: MessageId.make(commandId + ":message"),
                  status,
                },
              ]
            : [],
      },
    ],
  ]) as ReadonlyMap<ThreadId, DeepPlanObservation>;
}

describe("Deep Plan next action", () => {
  it("holds the second lane until the primary turn has established its baseline", () => {
    const current = withActiveTurn();

    expect(decideNext(current, observe("starting"))).toBeNull();
    expect(decideNext(current, observe("running"))).toMatchObject({
      type: "start-turn",
      turn: { kind: "implement", threadId: secondary, stepId: secondStep },
    });
  });

  it("matches the persisted user message and keeps a waiting provider run active", () => {
    const current = withActiveTurn();
    const singleLane = {
      ...current,
      approval: {
        ...current.approval!,
        parallelism: 1,
        lanes: current.approval!.lanes.slice(0, 1),
      },
    };

    expect(decideNext(singleLane, observe("completed", CommandId.make("unrelated")))).toBeNull();
    expect(decideNext(singleLane, observe("waiting"))).toBeNull();
  });

  it.each([
    {
      status: "completed",
      attempt: 0,
      unsubmittedTurns: 0,
      expected: { type: "start-turn", retryReason: "missingResult", turn: { attempt: 1 } },
    },
    {
      status: "completed",
      attempt: 1,
      unsubmittedTurns: 1,
      expected: { type: "pause", pause: { kind: "turnFailed" } },
    },
    {
      status: "interrupted",
      attempt: 0,
      unsubmittedTurns: 0,
      expected: { type: "start-turn", retryReason: "failed", turn: { attempt: 1 } },
    },
    {
      status: "failed",
      attempt: 1,
      unsubmittedTurns: 0,
      expected: { type: "pause", pause: { kind: "turnFailed" } },
    },
    {
      status: "completed",
      attempt: 1,
      unsubmittedTurns: 0,
      expected: { type: "start-turn", retryReason: "missingResult", turn: { attempt: 2 } },
    },
    {
      status: "cancelled",
      attempt: 1,
      unsubmittedTurns: 0,
      expected: { type: "start-turn", retryReason: "restarted", turn: { attempt: 1 } },
    },
  ] as const)(
    "handles $status with $attempt replacements and $unsubmittedTurns nudges",
    ({ status, attempt, unsubmittedTurns, expected }) => {
      const current = withActiveTurn({ ...turn, attempt }, { unsubmittedTurns });

      expect(decideNext(current, observe(status))).toMatchObject(expected);
    },
  );

  it.each(["completed", "interrupted", "failed", "cancelled"] as const)(
    "settles the implementation once its own submission is durable and the %s run ended",
    (status) => {
      const current = withActiveTurn(turn, {
        submission: {
          summary: "Implemented first",
          changedFiles: ["first.ts"],
          turnCommandId: turn.commandId,
          at,
        },
      });

      expect(decideNext(current, observe("running"))).toMatchObject({
        type: "start-turn",
        turn: { stepId: secondStep },
      });
      expect(decideNext(current, observe(status))).toEqual({
        type: "settle-turn",
        turnCommandId: turn.commandId,
      });
    },
  );

  it("waits for the reviewer turn before making a verified step available as a dependency", () => {
    const review: DeepPlanActiveTurn = { ...turn, kind: "review", threadId: reviewThread };
    const current = withActiveTurn(review, {
      status: "verified",
      reviews: [
        {
          round: 1,
          reviewThreadId: reviewThread,
          reviewer: model,
          diff: null,
          verdict: "approved",
          summary: "Verified",
          findings: [],
          retries: 0,
          startedAt: at,
          completedAt: at,
        },
      ],
    });
    const dependent = {
      ...current,
      plan: {
        ...current.plan!,
        steps: [current.plan!.steps[0]!, { ...current.plan!.steps[1]!, dependencies: [firstStep] }],
      },
    };
    const waiting = observe("waiting", review.commandId, reviewThread);
    const runningFirstLane = observe("completed");

    expect(decideNext(dependent, new Map([...waiting, ...runningFirstLane]))).toBeNull();
    for (const status of ["completed", "interrupted"] as const) {
      expect(decideNext(dependent, observe(status, review.commandId, reviewThread))).toMatchObject({
        type: "settle-turn",
      });
    }
  });

  it("pauses at the review limit before starting another fix", () => {
    const current = run();
    const limited = {
      ...current,
      steps: [
        {
          ...current.steps[0]!,
          laneId: turn.laneId,
          status: "changesRequested" as const,
          reviews: [
            {
              round: 3,
              reviewThreadId: reviewThread,
              reviewer: model,
              diff: null,
              verdict: "changesRequested" as const,
              summary: "Still broken",
              findings: [],
              retries: 0,
              startedAt: at,
              completedAt: at,
            },
          ],
        },
        current.steps[1]!,
      ],
    };

    expect(decideNext(limited, observe())).toMatchObject({
      type: "pause",
      pause: { kind: "reviewLimit", stepId: firstStep },
    });
  });
});
