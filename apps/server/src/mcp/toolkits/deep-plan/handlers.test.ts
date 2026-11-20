import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it, vi } from "@effect/vitest";
import {
  CommandId,
  DeepPlanRunId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type DeepPlanActiveTurn,
  type DeepPlanExecutionContext,
  type DeepPlanRun,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { McpSchema } from "effect/ai";

import { CheckpointDiffQuery } from "../../../checkpointing/CheckpointDiffQuery.ts";
import { DeepPlanWorkflow } from "../../../deepPlanning/DeepPlanWorkflow.ts";
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2, type ProjectRow } from "../../../orchestration-v2/ProjectStore.ts";
import { ProjectionStoreV2 } from "../../../orchestration-v2/ProjectionStore.ts";
import * as WorkspacePaths from "../../../workspace/WorkspacePaths.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../McpInvocationContext.ts";
import {
  invokeDeepPlanPublish,
  invokeDeepPlanReviewContext,
  invokeDeepPlanReviewVerdict,
  invokeDeepPlanState,
  invokeDeepPlanSubmit,
} from "./handlers.ts";
import { DeepPlanToolkit } from "./tools.ts";

const ownerId = ThreadId.make("plan-owner");
const implementerId = ThreadId.make("plan-implementer");
const reviewerId = ThreadId.make("plan-reviewer");
const runId = DeepPlanRunId.make("run-current");
const environmentId = EnvironmentId.make("local");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test-model" };
const timestamp = "2026-10-16T10:00:00.000Z";
const target = { kind: "step", stepId: "step-1" } as const;
const finalTarget = { kind: "final" } as const;
const changes = ["src/parser.ts", "src/parser.test.ts"];
const pendingFinal = {
  status: "pending",
  submission: null,
  reviews: [],
  roundLimit: 3,
  unsubmittedTurns: 0,
} as const;

const draft = {
  goal: "Fix the parser",
  scope: ["Parser behavior"],
  nonGoals: [],
  decisions: [],
  affectedAreas: ["parser"],
  steps: [
    {
      id: target.stepId,
      title: "Fix parser",
      description: "Handle empty input",
      dependencies: [],
      acceptanceCriteria: [
        { id: "empty", description: "Empty input parses", checkMethod: "Run parser test" },
      ],
    },
  ],
  finalValidation: {
    description: "Parser works end to end",
    checkMethod: "Run the parser integration test",
  },
};
const planning: DeepPlanRun = {
  schemaVersion: 2,
  id: runId,
  threadId: ownerId,
  phase: "planning",
  revision: 3,
  chats: [
    {
      environmentId,
      threadId: ThreadId.make("planning-source"),
      projectId: ProjectId.make("project"),
    },
  ],
  includeProjectChats: false,
  plan: null,
  approval: null,
  approvalKey: null,
  steps: [],
  finalReview: pendingFinal,
  activeTurns: [],
  pause: null,
  operations: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const lane = { threadId: implementerId, laneId: "lane-1" };
const stepSubmission = {
  summary: "Handle empty input and add a regression test.",
  changedFiles: changes,
  turnCommandId: CommandId.make("implement-step"),
  at: timestamp,
};
const pendingReview = {
  round: 1,
  reviewThreadId: reviewerId,
  reviewer: modelSelection,
  diff: null,
  verdict: null,
  summary: null,
  findings: [],
  retries: 0,
  startedAt: timestamp,
  completedAt: null,
} as const;
const implementingTurn: DeepPlanActiveTurn = {
  kind: "implement",
  threadId: implementerId,
  commandId: stepSubmission.turnCommandId,
  stepId: target.stepId,
  laneId: lane.laneId,
  round: 1,
  attempt: 0,
  startedAt: timestamp,
};
const reviewingTurn: DeepPlanActiveTurn = {
  ...implementingTurn,
  kind: "review",
  threadId: reviewerId,
  commandId: CommandId.make("review-step"),
};
const approved: DeepPlanRun = {
  ...planning,
  phase: "implementing",
  plan: { ...draft, schemaVersion: 2, version: 1 },
  approvalKey: "approved-1",
  approval: {
    planVersion: 1,
    approvalKey: "approved-1",
    approvedAt: timestamp,
    implementation: modelSelection,
    reviewer: modelSelection,
    parallelism: 1,
    lanes: [lane],
    baseTurnCount: 0,
  },
  steps: [
    {
      stepId: target.stepId,
      status: "inReview",
      laneId: lane.laneId,
      baseTurnCount: 0,
      submission: stepSubmission,
      reviews: [pendingReview],
      roundLimit: 3,
      unsubmittedTurns: 0,
    },
  ],
  activeTurns: [implementingTurn, reviewingTurn],
};

const turnId = RunId.make("provider-run");
const grantBase = { runId, runThreadId: ownerId, modelSelection };
const planningGrant: DeepPlanExecutionContext = {
  ...grantBase,
  approvedPlanVersion: null,
  phase: "planning",
  readOnly: true,
};
const implementationGrant: DeepPlanExecutionContext = {
  ...grantBase,
  approvedPlanVersion: 1,
  phase: "execution",
  laneId: lane.laneId,
};
const reviewGrant: DeepPlanExecutionContext = {
  ...grantBase,
  approvedPlanVersion: 1,
  phase: "review",
  readOnly: true,
  review: { target, round: 1 },
};
const update = { expectedRunId: runId, expectedRevision: 3, operationId: "operation-1" };
const submit = { ...update, target, summary: stepSubmission.summary, changedFiles: changes };
const verdict = {
  ...update,
  target,
  round: 1,
  verdict: "approved",
  summary: "The parser checks passed.",
  findings: [],
} as const;

function harness(input: {
  readonly threadId: ThreadId;
  readonly run: DeepPlanRun;
  readonly grant: DeepPlanExecutionContext;
  readonly assignment?: DeepPlanActiveTurn;
  readonly binding?: DeepPlanExecutionContext;
  readonly ownerThreadId?: ThreadId;
  readonly status?: OrchestrationV2Run["status"];
  readonly off?: boolean;
}) {
  const { threadId, run, grant } = input;
  const actor = {
    id: threadId,
    projectId: planning.chats[0]!.projectId,
    worktreePath: null,
    archivedAt: null,
    deletedAt: null,
    activeRunId: turnId,
    ...(threadId === ownerId ? { deepPlan: run } : { deepPlanExecution: grant }),
  } as OrchestrationV2ThreadShell;
  const owner = { ...actor, id: ownerId, deepPlan: run };
  const turn = {
    id: turnId,
    threadId,
    status: input.status ?? "running",
    deepPlanRunId: run.id,
    userMessageId: MessageId.make(
      input.assignment === undefined ? "plan-request" : `${input.assignment.commandId}:message`,
    ),
  };
  const projections = {
    getThreadShell: (id: ThreadId) =>
      Effect.succeed(id === threadId ? actor : id === ownerId ? owner : null),
    getThreadRecords: (
      _id: ThreadId,
      _fields: unknown,
      filter: { readonly runIds?: readonly RunId[] },
    ) => Effect.succeed({ runs: filter.runIds?.includes(turnId) ? [turn] : [] }),
  } as unknown as ProjectionStoreV2["Service"];
  const invocation: McpInvocationScope = {
    thread: {
      threadId,
      providerSessionId: "test-session",
      providerInstanceId: modelSelection.instanceId,
    },
    ownerThreadId: input.ownerThreadId ?? threadId,
    workspaceContextThreadId: threadId,
    environmentId,
    issuedAt: 0,
    client: undefined,
    requestNamespace: "test-session",
    capabilities: new Set(input.off ? ["deep-plan-tools"] : ["deep-plan"]),
    deepPlan: input.binding ?? { ...grant, turnId },
  };
  const dispatch = vi.fn<DeepPlanWorkflow["Service"]["update"]>(() =>
    Effect.succeed({
      ...run,
      revision: run.revision + 1,
    }),
  );
  const workflow = Layer.mock(DeepPlanWorkflow)({ update: dispatch });
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(McpInvocationContext, invocation),
      Effect.provideService(ProjectionStoreV2, projections),
      Effect.provide(workflow),
    );
  return { actor, dispatch, provide };
}

const planner = {
  threadId: ownerId,
  run: planning,
  grant: planningGrant,
} as const;
const implementer = {
  threadId: implementerId,
  run: approved,
  grant: implementationGrant,
  assignment: implementingTurn,
} as const;
const reviewer = {
  threadId: reviewerId,
  run: approved,
  grant: reviewGrant,
  assignment: reviewingTurn,
} as const;

it.effect("publishes the planner's draft with its authenticated owner thread", () =>
  Effect.gen(function* () {
    const test = harness(planner);
    const receipt = yield* test.provide(invokeDeepPlanPublish({ ...update, plan: draft }));
    expect(receipt.revision).toBe(4);
    expect(test.dispatch).toHaveBeenCalledWith({
      threadId: ownerId,
      runId,
      expectedRevision: 3,
      operationId: update.operationId,
      byThreadId: ownerId,
      mutation: { type: "publish-plan", plan: draft },
    });
  }),
);

it.effect(
  "binds implementation submissions and review verdicts to their separate active turns",
  () =>
    Effect.gen(function* () {
      const build = harness(implementer);
      const review = harness(reviewer);
      yield* build.provide(invokeDeepPlanSubmit(submit));
      yield* review.provide(invokeDeepPlanReviewVerdict(verdict));
      expect(build.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: ownerId,
          byThreadId: implementerId,
          byTurnCommandId: implementingTurn.commandId,
          mutation: { type: "submit", target, summary: submit.summary, changedFiles: changes },
        }),
      );
      expect(review.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: ownerId,
          byThreadId: reviewerId,
          byTurnCommandId: reviewingTurn.commandId,
          mutation: {
            type: "review-verdict",
            target,
            summary: verdict.summary,
            verdict: "approved",
            round: 1,
            findings: [],
          },
        }),
      );
    }),
);

it.effect.each([
  {
    name: "no grant capability",
    input: { ...reviewer, off: true },
    expected: "credential-not-authorized",
  },
  {
    name: "delegated identity",
    input: { ...reviewer, ownerThreadId: ownerId },
    expected: "owner-mismatch",
  },
  { name: "implementer", input: implementer, expected: "phase-mismatch" },
  { name: "planner", input: planner, expected: "phase-mismatch" },
  {
    name: "forged grant",
    input: { ...implementer, binding: { ...reviewGrant, turnId } },
    expected: "stale-plan",
  },
  {
    name: "stale plan version",
    input: { ...reviewer, binding: { ...reviewGrant, turnId, approvedPlanVersion: 2 } },
    expected: "stale-plan",
  },
  {
    name: "stale provider turn",
    input: { ...reviewer, binding: { ...reviewGrant, turnId: RunId.make("old-turn") } },
    expected: "stale-plan",
  },
  {
    name: "completed turn",
    input: { ...reviewer, status: "completed" as const },
    expected: "stale-plan",
  },
  {
    name: "other run",
    input: reviewer,
    call: { ...verdict, expectedRunId: DeepPlanRunId.make("old-run") },
    expected: "stale-run",
  },
  {
    name: "other target",
    input: reviewer,
    call: { ...verdict, target: finalTarget },
    expected: "target-mismatch",
  },
  {
    name: "other round",
    input: reviewer,
    call: { ...verdict, round: 2 },
    expected: "target-mismatch",
  },
] as const)("denies a verdict from $name", (row) =>
  Effect.gen(function* () {
    const test = harness(row.input);
    const result = yield* test
      .provide(invokeDeepPlanReviewVerdict("call" in row ? row.call : verdict))
      .pipe(Effect.flip);
    expect(result).toMatchObject({ _tag: "DeepPlanToolScopeError", reason: row.expected });
    expect(test.dispatch).not.toHaveBeenCalled();
  }),
);

it.effect("keeps the review state scoped to the reviewer’s assigned target", () =>
  Effect.gen(function* () {
    const state = yield* harness(reviewer).provide(invokeDeepPlanState());
    expect(state).toEqual({
      id: runId,
      revision: 3,
      phase: "implementing",
      planVersion: 1,
      target,
      round: 1,
    });
    const plannerState = yield* harness(planner).provide(invokeDeepPlanState());
    expect(plannerState).toHaveProperty("chats", planning.chats);
  }),
);

it.effect("gives the first final reviewer all submitted paths even without Git checkpoints", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workspaceRoot = yield* fs.makeTempDirectoryScoped();
    yield* fs.makeDirectory(path.join(workspaceRoot, "src"));
    yield* fs.writeFileString(path.join(workspaceRoot, "AGENTS.md"), "Follow project rules.");
    yield* fs.writeFileString(
      path.join(workspaceRoot, "src", "CLAUDE.md"),
      "Follow parser conventions.",
    );
    const finalReviewingTurn = { ...reviewingTurn, kind: "finalReview", stepId: null } as const;
    const test = harness({
      ...reviewer,
      assignment: finalReviewingTurn,
      grant: { ...reviewGrant, review: { target: finalTarget, round: 1 } },
      run: {
        ...approved,
        phase: "finalReview",
        activeTurns: [finalReviewingTurn],
        finalReview: { ...pendingFinal, status: "inReview", reviews: [pendingReview] },
      },
    });
    const context = yield* test.provide(invokeDeepPlanReviewContext()).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(OrchestratorV2)({
            getThreadShell: () => Effect.succeed({ ...test.actor, worktreePath: workspaceRoot }),
          }),
          Layer.mock(ProjectStoreV2)({
            get: () =>
              Effect.succeedSome({
                projectId: test.actor.projectId,
                title: "Parser",
                workspaceRoot,
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                autoPull: false,
                faviconPath: null,
                projectIcon: null,
                pinnedAt: null,
                archivedAt: null,
                scripts: [],
                createdAt: timestamp,
                updatedAt: timestamp,
                deletedAt: null,
              } satisfies ProjectRow),
          }),
          Layer.mock(CheckpointDiffQuery)({
            getReviewDiff: () => Effect.die("Missing checkpoints should use submitted paths"),
          }),
          WorkspacePaths.layer,
        ),
      ),
    );
    expect(context.target).toEqual(finalTarget);
    expect(context.diff).toBeNull();
    expect(context.submission.changedFiles).toEqual(changes);
    expect(context.instructionPaths.toSorted()).toEqual(
      ["AGENTS.md", path.join("src", "CLAUDE.md")].toSorted(),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("advertises only reviewer tools to the review grant", () =>
  Effect.gen(function* () {
    const visibility = yield* harness(reviewer).provide(
      Effect.sync(() =>
        Object.values(DeepPlanToolkit.tools).flatMap((tool) =>
          Context.getOrUndefined(
            tool.annotations,
            McpSchema.EnabledWhen,
          )?.({ protocolVersion: "2025-06-18", capabilities: {} })
            ? [tool.name]
            : [],
        ),
      ),
    );
    expect(visibility.toSorted()).toEqual([
      "deep_plan_review_context",
      "deep_plan_review_verdict",
      "deep_plan_state",
    ]);
  }),
);
