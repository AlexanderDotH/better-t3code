import {
  CommandId,
  DeepPlanRunId,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanActiveTurn,
  type DeepPlanLegacyRun,
  type DeepPlanReview,
  type DeepPlanRun,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDeepPlanApproveCommand,
  formatDeepPlanForDisplay,
  getDeepPlanComposerChecklistExpiresAt,
  getDeepPlanProposalBlockReason,
  selectDeepPlanRunControls,
  selectDeepPlanStatus,
  selectDeepPlanSteps,
  selectDurableDeepPlan,
} from "./deepPlanning.ts";

const threadId = ThreadId.make("owner");
const implementationThreadId = ThreadId.make("implementation");
const otherLaneThreadId = ThreadId.make("other-lane");
const reviewThreadId = ThreadId.make("review");
const environmentId = EnvironmentId.make("environment");
const createdAt = "2026-10-16T08:00:00.000Z";
const implementation = { instanceId: ProviderInstanceId.make("provider"), model: "model" };
const english = createInterfaceTranslator({ language: "en", locale: "en-US" });
const approvedReview: DeepPlanReview = {
  round: 1,
  reviewThreadId,
  reviewer: implementation,
  diff: null,
  verdict: "approved",
  summary: "Checks passed",
  findings: [],
  retries: 0,
  startedAt: createdAt,
  completedAt: createdAt,
};

function run(overrides?: Partial<DeepPlanRun>): DeepPlanRun {
  return {
    schemaVersion: 2,
    id: DeepPlanRunId.make("run"),
    threadId,
    phase: "implementing",
    revision: 4,
    plan: {
      schemaVersion: 2,
      version: 2,
      goal: "Ship the complete workflow",
      scope: ["Both clients"],
      nonGoals: ["Provider changes"],
      decisions: [{ id: "decision", text: "Persist the approved version" }],
      affectedAreas: ["Client runtime"],
      steps: ["build", "verify", "document"].map((id) => ({
        id,
        title: id,
        description: "Implement the approved scope",
        dependencies: [],
        acceptanceCriteria: [
          { id: `${id}-check`, description: "Feature works", checkMethod: "Run focused tests" },
        ],
      })),
      finalValidation: {
        description: "Validate the entire implementation",
        checkMethod: "Run the final integration checks",
      },
    },
    approvalKey: "revision-2-key",
    approval: {
      planVersion: 2,
      approvalKey: "revision-2-key",
      approvedAt: createdAt,
      implementation,
      reviewer: implementation,
      parallelism: 2,
      lanes: [
        { laneId: "lane-1", threadId: implementationThreadId },
        { laneId: "lane-2", threadId: otherLaneThreadId },
      ],
      baseTurnCount: 0,
    },
    chats: [],
    includeProjectChats: false,
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
    ...overrides,
  };
}

const legacyRun: DeepPlanLegacyRun = {
  schemaVersion: 1,
  kind: "legacy",
  id: DeepPlanRunId.make("old-run"),
  threadId,
  goal: "Earlier plan",
  updatedAt: createdAt,
};

const implementationTurn: DeepPlanActiveTurn = {
  kind: "implement",
  threadId: implementationThreadId,
  commandId: CommandId.make("implement"),
  stepId: "build",
  laneId: "lane-1",
  round: 1,
  attempt: 1,
  startedAt: createdAt,
};

const reviewTurn: DeepPlanActiveTurn = {
  ...implementationTurn,
  kind: "review",
  threadId: reviewThreadId,
  commandId: CommandId.make("review"),
  round: 2,
};

const finalReviewTurn: DeepPlanActiveTurn = {
  ...reviewTurn,
  kind: "finalReview",
  stepId: null,
  laneId: null,
};

describe("Deep Plan durable client state", () => {
  it("expires finished composer checklists one minute after their durable update", () => {
    expect(
      getDeepPlanComposerChecklistExpiresAt({ phase: "completed", updatedAt: createdAt }),
    ).toBe(Date.parse("2026-10-16T08:01:00.000Z"));
    expect(
      getDeepPlanComposerChecklistExpiresAt({ phase: "cancelled", updatedAt: createdAt }),
    ).toBe(Date.parse("2026-10-16T08:01:00.000Z"));
    expect(
      getDeepPlanComposerChecklistExpiresAt({ phase: "completed", updatedAt: "invalid" }),
    ).toBe(0);
    expect(
      getDeepPlanComposerChecklistExpiresAt({ phase: "implementing", updatedAt: createdAt }),
    ).toBeNull();
  });

  it("resolves owners and additional lanes without crossing environments", () => {
    const plan = run();
    const owner = { id: threadId, environmentId, deepPlan: plan };
    expect(selectDurableDeepPlan(owner)).toBe(plan);
    expect(selectDurableDeepPlan({ id: otherLaneThreadId, environmentId }, [owner])).toBe(plan);
    expect(
      selectDurableDeepPlan({ id: otherLaneThreadId, environmentId: EnvironmentId.make("other") }, [
        owner,
      ]),
    ).toBeNull();
    expect(selectDurableDeepPlan({ id: ThreadId.make("unrelated"), deepPlan: plan })).toBeNull();
    expect(selectDurableDeepPlan({ ...owner, deepPlan: legacyRun })).toBe(legacyRun);
    const reviewer = {
      id: reviewThreadId,
      environmentId,
      deepPlanExecution: {
        phase: "review" as const,
        readOnly: true as const,
        review: { target: { kind: "step" as const, stepId: "build" }, round: 1 },
        runId: plan.id,
        runThreadId: threadId,
        approvedPlanVersion: 2,
        modelSelection: implementation,
      },
    };
    expect(selectDurableDeepPlan(reviewer, [owner])).toBe(plan);
    expect(
      selectDurableDeepPlan(
        {
          ...reviewer,
          deepPlanExecution: {
            ...reviewer.deepPlanExecution,
            runId: legacyRun.id,
          },
        },
        [owner],
      ),
    ).toBeNull();
  });

  it("requires a current approval key and keeps legacy proposals read-only", () => {
    const awaitingApproval = run({ phase: "awaitingApproval", approval: null });
    const proposal = { deepPlan: { runId: awaitingApproval.id, planVersion: 2 } };
    expect(getDeepPlanProposalBlockReason(proposal, awaitingApproval)).toBeNull();
    expect(
      getDeepPlanProposalBlockReason(proposal, { ...awaitingApproval, approvalKey: null }),
    ).toContain("approval key");
    expect(getDeepPlanProposalBlockReason(proposal, legacyRun)).toContain("earlier version");
  });

  it("binds approval to the proposal revision and leaves reviewer selection to the server", () => {
    const awaitingApproval = run({ phase: "awaitingApproval", approval: null });
    const input = {
      commandId: CommandId.make("approve"),
      operationId: "approve",
      createdAt,
      implementation,
      implementationThread: "new" as const,
      parallelism: 2,
    };
    expect(buildDeepPlanApproveCommand({ ...input, run: awaitingApproval })).toEqual({
      type: "thread.deep-plan.update",
      commandId: "approve",
      threadId: "owner",
      runId: "run",
      expectedRevision: 4,
      operationId: "approve",
      createdAt,
      mutation: {
        type: "approve",
        planVersion: 2,
        approvalKey: "revision-2-key",
        implementation,
        implementationThread: "new",
        parallelism: 2,
      },
    });
    expect(() => buildDeepPlanApproveCommand({ ...input, run: legacyRun })).toThrow(
      "earlier version",
    );
  });

  it("uses the latest review for the review link and the latest completed verdict for findings", () => {
    const review = {
      ...approvedReview,
      verdict: "changesRequested" as const,
      summary: "Fix the integration",
      findings: [
        {
          severity: "major" as const,
          title: "Missing integration",
          detail: "Connect both clients.",
        },
      ],
    };
    const nextReview = {
      ...review,
      round: 2,
      reviewThreadId: ThreadId.make("next-review"),
      verdict: null,
      summary: null,
      findings: [],
      completedAt: null,
    };
    expect(
      selectDeepPlanSteps(
        run({
          steps: [
            {
              stepId: "build",
              status: "inReview",
              laneId: "lane-1",
              baseTurnCount: 0,
              submission: null,
              reviews: [review, nextReview],
              roundLimit: 3,
              unsubmittedTurns: 0,
            },
          ],
        }),
      )[0],
    ).toMatchObject({ review: nextReview, verdict: review });
  });

  it.each([
    ["planning", null, true],
    ["awaitingApproval", null, true],
    ["implementing", "pause", true],
    ["finalReview", "pause", true],
    ["paused", "resume", true],
    ["completed", null, false],
    ["cancelled", null, false],
  ] as const)("offers run controls that mean something while %s", (phase, toggle, cancel) => {
    expect(selectDeepPlanRunControls(run({ phase }))).toEqual({ toggle, cancel });
    expect(selectDeepPlanRunControls(legacyRun)).toEqual({ toggle: null, cancel: false });
  });

  it("shows non-goals in the plan overview", () => {
    const text = formatDeepPlanForDisplay(run(), english, { includeImplementation: false });
    expect(text).toContain("Provider changes");
    expect(text).not.toContain("Run the final integration checks");
  });
});

describe("Deep Plan status", () => {
  it.each([
    { name: "planning", value: run({ phase: "planning" }), label: "Planning", tone: "info" },
    {
      name: "approval",
      value: run({ phase: "awaitingApproval" }),
      label: "Waiting for approval",
      tone: "neutral",
    },
    {
      name: "a step",
      value: run({ activeTurns: [implementationTurn] }),
      label: "Implementing step 1/3",
      tone: "info",
      stepId: "build",
      destination: implementationThreadId,
    },
    {
      name: "parallel lanes",
      value: run({
        activeTurns: [
          implementationTurn,
          {
            ...implementationTurn,
            stepId: "verify",
            laneId: "lane-2",
            threadId: otherLaneThreadId,
          },
        ],
      }),
      label: "2 active lanes · steps 1, 2",
      tone: "info",
    },
    {
      name: "step review",
      value: run({ activeTurns: [reviewTurn] }),
      label: "Reviewing step 1 (round 2/3)",
      tone: "info",
      stepId: "build",
      destination: reviewThreadId,
    },
    {
      name: "a fix",
      value: run({ activeTurns: [{ ...implementationTurn, kind: "fix" }] }),
      label: "Addressing findings for step 1",
      tone: "info",
      stepId: "build",
      destination: implementationThreadId,
    },
    {
      name: "final review",
      value: run({ phase: "finalReview", activeTurns: [finalReviewTurn] }),
      label: "Final review",
      tone: "info",
      destination: reviewThreadId,
    },
    {
      name: "a final fix",
      value: run({
        phase: "finalReview",
        activeTurns: [{ ...finalReviewTurn, kind: "finalFix", threadId: implementationThreadId }],
      }),
      label: "Addressing final review findings",
      tone: "info",
      destination: implementationThreadId,
    },
    {
      name: "paused",
      value: run({
        phase: "paused",
        pause: { kind: "blocked", reason: "A decision is needed", at: createdAt },
      }),
      label: "Paused · A decision is needed",
      tone: "warning",
    },
    ...(
      [
        ["by the user", "user", "Paused by you"],
        ["at the review limit", "reviewLimit", "Paused · Review limit reached"],
        ["after a failed turn", "turnFailed", "Paused · A turn failed"],
        [
          "while a thread is unavailable",
          "unavailable",
          "Paused · A thread or provider is unavailable",
        ],
      ] as const
    ).map(([name, kind, label]) => ({
      name: `paused ${name}`,
      value: run({
        phase: "paused",
        pause: { kind, reason: "English server text", at: createdAt },
      }),
      label,
      tone: "warning",
    })),
    {
      name: "paused with a known lane",
      value: run({
        phase: "paused",
        pause: { kind: "blocked", reason: "Check the lane", stepId: "verify", at: createdAt },
        steps: [
          {
            stepId: "verify",
            status: "implementing",
            laneId: "lane-2",
            baseTurnCount: 0,
            submission: null,
            reviews: [],
            roundLimit: 3,
            unsubmittedTurns: 0,
          },
        ],
      }),
      label: "Paused · Check the lane",
      tone: "warning",
      stepId: "verify",
      shells: [{ id: otherLaneThreadId }],
      destination: otherLaneThreadId,
    },
    { name: "idle", value: run(), label: "Waiting for the next step", tone: "neutral" },
    {
      name: "complete",
      value: run({
        phase: "completed",
        steps: ["build", "verify", "document"].map((stepId) => ({
          stepId,
          status: "verified" as const,
          laneId: "lane-1",
          baseTurnCount: 0,
          submission: null,
          reviews: [approvedReview],
          roundLimit: 3,
          unsubmittedTurns: 0,
        })),
        finalReview: {
          status: "approved",
          submission: null,
          reviews: [approvedReview],
          roundLimit: 3,
          unsubmittedTurns: 0,
        },
      }),
      label: "Complete · 3/3 verified",
      tone: "success",
    },
    { name: "cancelled", value: run({ phase: "cancelled" }), label: "Cancelled", tone: "neutral" },
    {
      name: "legacy",
      value: legacyRun,
      label: "This Deep Plan started in an earlier version. Start a new Deep Plan to continue.",
      tone: "neutral",
    },
  ])("shows $name from durable state", ({ value, label, tone, stepId, destination, shells }) => {
    expect(selectDeepPlanStatus(value, shells, english)).toEqual({
      label,
      tone,
      ...(stepId === undefined ? {} : { stepId }),
      ...(destination === undefined ? {} : { threadId: destination }),
    });
  });
});
