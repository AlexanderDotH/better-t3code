import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const DEEP_PLAN_MAX_CHATS = 20;
export const DEEP_PLAN_MAX_PARALLELISM = 4;
export const DEEP_PLAN_MAX_OPERATIONS = 50;
export const DEEP_PLAN_REVIEW_ROUND_LIMIT = 3;
export const DEEP_PLAN_VERSION_TEXT = "2";
export const DEEP_PLAN_VERSION_QUERY_PARAM = "deepPlanVersion";
const MAX_SUMMARY_LENGTH = 4_000;

export const DeepPlanRunId = TrimmedNonEmptyString.pipe(Schema.brand("DeepPlanRunId"));
export type DeepPlanRunId = typeof DeepPlanRunId.Type;
export const DeepPlanStepId = TrimmedNonEmptyString;
export type DeepPlanStepId = typeof DeepPlanStepId.Type;
export const DeepPlanLaneId = TrimmedNonEmptyString;
export type DeepPlanLaneId = typeof DeepPlanLaneId.Type;

export function deriveDeepPlanRunId(commandId: CommandId): DeepPlanRunId {
  return DeepPlanRunId.make(`deep-plan:${encodeURIComponent(commandId)}`);
}

export function deriveDeepPlanImplementationThreadId(
  runId: DeepPlanRunId,
  planVersion: number,
): ThreadId {
  return ThreadId.make(
    `thread:deep-plan:implementation:${encodeURIComponent(runId)}:${planVersion}`,
  );
}

export const DeepPlanEnvironmentCapability = Schema.Struct({ version: Schema.Literal(2) });
export type DeepPlanEnvironmentCapability = typeof DeepPlanEnvironmentCapability.Type;

export const DeepPlanProviderCapability = Schema.Struct({
  version: Schema.Literal(1),
  structuredPlans: Schema.Boolean,
  durableExecution: Schema.Boolean,
});
export type DeepPlanProviderCapability = typeof DeepPlanProviderCapability.Type;

export const DeepPlanSourceRef = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
  threadId: ThreadId,
});
export type DeepPlanSourceRef = typeof DeepPlanSourceRef.Type;

const DeepPlanChats = Schema.Array(DeepPlanSourceRef).check(
  Schema.isMaxLength(DEEP_PLAN_MAX_CHATS),
);

export const DeepPlanAcceptanceCriterion = Schema.Struct({
  id: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  checkMethod: TrimmedNonEmptyString,
});
export type DeepPlanAcceptanceCriterion = typeof DeepPlanAcceptanceCriterion.Type;

export const DeepPlanStep = Schema.Struct({
  id: DeepPlanStepId,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  dependencies: Schema.Array(DeepPlanStepId),
  acceptanceCriteria: Schema.Array(DeepPlanAcceptanceCriterion).check(Schema.isMinLength(1)),
});
export type DeepPlanStep = typeof DeepPlanStep.Type;

export const DeepPlanDecision = Schema.Struct({
  id: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString,
  rationale: Schema.optional(TrimmedNonEmptyString),
});
export type DeepPlanDecision = typeof DeepPlanDecision.Type;

export const DeepPlanValidationRequirement = Schema.Struct({
  description: TrimmedNonEmptyString,
  checkMethod: TrimmedNonEmptyString,
});
export type DeepPlanValidationRequirement = typeof DeepPlanValidationRequirement.Type;

const DeepPlanDraftWire = Schema.Struct({
  goal: TrimmedNonEmptyString,
  scope: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
  nonGoals: Schema.Array(TrimmedNonEmptyString),
  decisions: Schema.Array(DeepPlanDecision),
  affectedAreas: Schema.Array(TrimmedNonEmptyString),
  steps: Schema.Array(DeepPlanStep).check(Schema.isMinLength(1)),
  finalValidation: DeepPlanValidationRequirement,
});

const planGraph = Schema.makeFilter((plan: typeof DeepPlanDraftWire.Type) => {
  const steps = new Map(plan.steps.map((step) => [step.id, step]));
  if (steps.size !== plan.steps.length) return "Deep Plan step IDs must be unique.";
  const criterionIds = plan.steps.flatMap((step) =>
    step.acceptanceCriteria.map((criterion) => criterion.id),
  );
  if (new Set(criterionIds).size !== criterionIds.length) {
    return "Deep Plan acceptance criterion IDs must be unique.";
  }
  if (new Set(plan.decisions.map((decision) => decision.id)).size !== plan.decisions.length) {
    return "Deep Plan decision IDs must be unique.";
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): boolean => {
    if (visiting.has(stepId)) return false;
    if (visited.has(stepId)) return true;
    const step = steps.get(stepId);
    if (!step) return false;
    visiting.add(stepId);
    for (const dependency of step.dependencies) {
      if (!visit(dependency)) return false;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return true;
  };
  return (
    plan.steps.every((step) => visit(step.id)) ||
    "Deep Plan dependencies must reference existing steps without cycles."
  );
});

export const DeepPlanPlanDraft = DeepPlanDraftWire.check(planGraph);
export type DeepPlanPlanDraft = typeof DeepPlanPlanDraft.Type;

export const DeepPlanDocument = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  version: PositiveInt,
  ...DeepPlanDraftWire.fields,
}).check(planGraph);
export type DeepPlanDocument = typeof DeepPlanDocument.Type;

export const DeepPlanModelSelection = ModelSelection;
export type DeepPlanModelSelection = ModelSelection;

export const DeepPlanParallelism = PositiveInt.check(
  Schema.isLessThanOrEqualTo(DEEP_PLAN_MAX_PARALLELISM),
);
export type DeepPlanParallelism = typeof DeepPlanParallelism.Type;

export const DeepPlanLane = Schema.Struct({ laneId: DeepPlanLaneId, threadId: ThreadId });
export type DeepPlanLane = typeof DeepPlanLane.Type;

export const DeepPlanApproval = Schema.Struct({
  planVersion: PositiveInt,
  approvalKey: TrimmedNonEmptyString,
  approvedAt: IsoDateTime,
  implementation: DeepPlanModelSelection,
  reviewer: DeepPlanModelSelection,
  parallelism: DeepPlanParallelism,
  lanes: Schema.Array(DeepPlanLane).check(Schema.isMaxLength(DEEP_PLAN_MAX_PARALLELISM)),
  baseTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (approval) =>
      (approval.lanes.length === approval.parallelism &&
        new Set(approval.lanes.map((lane) => lane.laneId)).size === approval.lanes.length &&
        new Set(approval.lanes.map((lane) => lane.threadId)).size === approval.lanes.length) ||
      "Deep Plan approval requires a unique lane and thread for each requested lane.",
  ),
);
export type DeepPlanApproval = typeof DeepPlanApproval.Type;

export const DeepPlanReviewTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("step"), stepId: DeepPlanStepId }),
  Schema.Struct({ kind: Schema.Literal("final") }),
]);
export type DeepPlanReviewTarget = typeof DeepPlanReviewTarget.Type;

const DeepPlanSummary = TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_SUMMARY_LENGTH));
const DeepPlanChangedFiles = Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(100));

export const DeepPlanSubmission = Schema.Struct({
  summary: DeepPlanSummary,
  changedFiles: DeepPlanChangedFiles,
  turnCommandId: CommandId,
  at: IsoDateTime,
});
export type DeepPlanSubmission = typeof DeepPlanSubmission.Type;

export const DeepPlanReviewDiff = Schema.Struct({
  threadId: ThreadId,
  toThreadId: Schema.optionalKey(ThreadId),
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (diff) =>
      (diff.toThreadId !== undefined && diff.toThreadId !== diff.threadId) ||
      diff.toTurnCount >= diff.fromTurnCount ||
      "Deep Plan checkpoint ranges within one thread must be ascending.",
  ),
);
export type DeepPlanReviewDiff = typeof DeepPlanReviewDiff.Type;

export const DeepPlanReviewVerdict = Schema.Literals(["approved", "changesRequested"]);
export type DeepPlanReviewVerdict = typeof DeepPlanReviewVerdict.Type;

export const DeepPlanReviewFinding = Schema.Struct({
  severity: Schema.Literals(["blocking", "major", "minor"]),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  detail: DeepPlanSummary,
  file: Schema.optionalKey(TrimmedNonEmptyString),
  line: Schema.optionalKey(PositiveInt),
  rule: Schema.optionalKey(TrimmedNonEmptyString),
});
export type DeepPlanReviewFinding = typeof DeepPlanReviewFinding.Type;

const DeepPlanReviewFindings = Schema.Array(DeepPlanReviewFinding).check(Schema.isMaxLength(20));

export const DeepPlanReview = Schema.Struct({
  round: PositiveInt,
  reviewThreadId: ThreadId,
  reviewer: DeepPlanModelSelection,
  diff: Schema.NullOr(DeepPlanReviewDiff),
  verdict: Schema.NullOr(DeepPlanReviewVerdict),
  summary: Schema.NullOr(DeepPlanSummary),
  findings: DeepPlanReviewFindings,
  retries: NonNegativeInt,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type DeepPlanReview = typeof DeepPlanReview.Type;

const DeepPlanReviews = Schema.Array(DeepPlanReview).check(
  Schema.makeFilter(
    (reviews) =>
      reviews.every((review, index) => index === 0 || review.round > reviews[index - 1]!.round) ||
      "Deep Plan reviews must be ordered by increasing round.",
  ),
);

const DeepPlanReviewStateFields = {
  submission: Schema.NullOr(DeepPlanSubmission),
  reviews: DeepPlanReviews,
  roundLimit: PositiveInt,
  unsubmittedTurns: NonNegativeInt,
};

export const DeepPlanStepStatus = Schema.Literals([
  "pending",
  "implementing",
  "inReview",
  "changesRequested",
  "verified",
]);
export type DeepPlanStepStatus = typeof DeepPlanStepStatus.Type;

export const DeepPlanStepState = Schema.Struct({
  stepId: DeepPlanStepId,
  status: DeepPlanStepStatus,
  laneId: Schema.NullOr(DeepPlanLaneId),
  baseTurnCount: Schema.NullOr(NonNegativeInt),
  ...DeepPlanReviewStateFields,
});
export type DeepPlanStepState = typeof DeepPlanStepState.Type;

export const DeepPlanFinalReviewStatus = Schema.Literals([
  "pending",
  "inReview",
  "changesRequested",
  "approved",
]);
export type DeepPlanFinalReviewStatus = typeof DeepPlanFinalReviewStatus.Type;

export const DeepPlanFinalReview = Schema.Struct({
  status: DeepPlanFinalReviewStatus,
  ...DeepPlanReviewStateFields,
});
export type DeepPlanFinalReview = typeof DeepPlanFinalReview.Type;

export const DeepPlanActiveTurnKind = Schema.Literals([
  "implement",
  "fix",
  "review",
  "finalReview",
  "finalFix",
]);
export type DeepPlanActiveTurnKind = typeof DeepPlanActiveTurnKind.Type;

const DeepPlanTurnFields = {
  kind: DeepPlanActiveTurnKind,
  threadId: ThreadId,
  stepId: Schema.NullOr(DeepPlanStepId),
  laneId: Schema.NullOr(DeepPlanLaneId),
  round: PositiveInt,
  attempt: NonNegativeInt,
};

export const DeepPlanActiveTurn = Schema.Struct({
  ...DeepPlanTurnFields,
  commandId: CommandId,
  startedAt: IsoDateTime,
});
export type DeepPlanActiveTurn = typeof DeepPlanActiveTurn.Type;

export const DeepPlanPauseKind = Schema.Literals([
  "user",
  "blocked",
  "reviewLimit",
  "turnFailed",
  "unavailable",
]);
export type DeepPlanPauseKind = typeof DeepPlanPauseKind.Type;

const DeepPlanPauseFields = {
  kind: DeepPlanPauseKind,
  reason: TrimmedNonEmptyString,
  stepId: Schema.optionalKey(DeepPlanStepId),
};

export const DeepPlanPause = Schema.Struct({ ...DeepPlanPauseFields, at: IsoDateTime });
export type DeepPlanPause = typeof DeepPlanPause.Type;

export const DeepPlanRunPhase = Schema.Literals([
  "planning",
  "awaitingApproval",
  "implementing",
  "finalReview",
  "paused",
  "completed",
  "cancelled",
]);
export type DeepPlanRunPhase = typeof DeepPlanRunPhase.Type;

export const DeepPlanOperation = Schema.Struct({
  operationId: TrimmedNonEmptyString,
  fingerprint: TrimmedNonEmptyString,
  revision: NonNegativeInt,
});
export type DeepPlanOperation = typeof DeepPlanOperation.Type;

function hasIndependentApproval(
  reviews: ReadonlyArray<DeepPlanReview>,
  implementationThreads: ReadonlySet<ThreadId>,
): boolean {
  const latest = reviews.at(-1);
  return (
    latest?.verdict === "approved" &&
    latest.completedAt !== null &&
    !implementationThreads.has(latest.reviewThreadId)
  );
}

export const DeepPlanRun = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  id: DeepPlanRunId,
  threadId: ThreadId,
  phase: DeepPlanRunPhase,
  revision: NonNegativeInt,
  chats: DeepPlanChats,
  includeProjectChats: Schema.Boolean,
  plan: Schema.NullOr(DeepPlanDocument),
  approvalKey: Schema.NullOr(TrimmedNonEmptyString),
  approval: Schema.NullOr(DeepPlanApproval),
  steps: Schema.Array(DeepPlanStepState),
  finalReview: DeepPlanFinalReview,
  activeTurns: Schema.Array(DeepPlanActiveTurn),
  pause: Schema.NullOr(DeepPlanPause),
  operations: Schema.Array(DeepPlanOperation).check(Schema.isMaxLength(DEEP_PLAN_MAX_OPERATIONS)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
}).check(
  Schema.makeFilter((run) => {
    const steps = new Map(run.steps.map((step) => [step.stepId, step]));
    if (steps.size !== run.steps.length) return "Deep Plan step states must have unique step IDs.";

    const lanes = run.approval?.lanes ?? [];
    const laneIds = new Set(lanes.map((lane) => lane.laneId));
    const laneThreadIds = new Set(lanes.map((lane) => lane.threadId));
    for (const step of run.steps) {
      if (
        step.status === "verified" &&
        (step.laneId === null ||
          !laneIds.has(step.laneId) ||
          !hasIndependentApproval(step.reviews, laneThreadIds))
      ) {
        return "Verified Deep Plan steps require the latest review to approve from an independent thread.";
      }
    }
    if (
      run.finalReview.status === "approved" &&
      !hasIndependentApproval(run.finalReview.reviews, laneThreadIds)
    ) {
      return "Approved Deep Plans require the latest final review to approve from an independent thread.";
    }
    if (run.phase !== "completed") return true;
    if (
      !run.plan ||
      !run.approval ||
      run.approval.planVersion !== run.plan.version ||
      run.approval.approvalKey !== run.approvalKey
    ) {
      return "Completed Deep Plans require approval for the current plan version.";
    }
    return (
      (steps.size === run.plan.steps.length &&
        run.plan.steps.every((step) => steps.get(step.id)?.status === "verified") &&
        run.finalReview.status === "approved") ||
      "Completed Deep Plans require all steps verified and the final review approved."
    );
  }),
);
export type DeepPlanRun = typeof DeepPlanRun.Type;

export const DeepPlanLegacyRun = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("legacy"),
  id: DeepPlanRunId,
  threadId: ThreadId,
  goal: Schema.NullOr(DeepPlanSummary),
  // Absent on legacy runs normalized before this flag existed.
  finished: Schema.optionalKey(Schema.Boolean),
  updatedAt: IsoDateTime,
});
export type DeepPlanLegacyRun = typeof DeepPlanLegacyRun.Type;

const LegacyDeepPlanPayload = Schema.Struct({
  schemaVersion: Schema.optionalKey(Schema.Literal(1)),
  id: DeepPlanRunId,
  threadId: ThreadId,
  updatedAt: IsoDateTime,
  plan: Schema.NullOr(Schema.Struct({ schemaVersion: Schema.Literal(1), goal: Schema.String })),
  stepStates: Schema.Array(Schema.Unknown),
  finalValidation: Schema.Struct({
    status: Schema.Literals(["pending", "inProgress", "passed", "failed"]),
  }),
}).pipe(
  Schema.decodeTo(
    DeepPlanLegacyRun,
    new SchemaTransformation.Transformation(
      SchemaGetter.transform(
        ({ id, threadId, plan, finalValidation, updatedAt }): typeof DeepPlanLegacyRun.Encoded => ({
          schemaVersion: 1,
          kind: "legacy",
          id,
          threadId,
          goal: plan?.goal.trim().slice(0, MAX_SUMMARY_LENGTH).trim() || null,
          finished: finalValidation.status === "passed",
          updatedAt,
        }),
      ),
      SchemaGetter.forbiddenEncoding,
    ),
  ),
);

export const StoredDeepPlanRun = Schema.Union([
  DeepPlanRun,
  DeepPlanLegacyRun,
  LegacyDeepPlanPayload,
]);
export type StoredDeepPlanRun = typeof StoredDeepPlanRun.Type;

export function isDeepPlanRun(run: StoredDeepPlanRun | null | undefined): run is DeepPlanRun {
  return run?.schemaVersion === 2;
}

export const DeepPlanPublishPlanMutation = Schema.Struct({
  type: Schema.Literal("publish-plan"),
  plan: DeepPlanPlanDraft,
});
export const DeepPlanApproveMutation = Schema.Struct({
  type: Schema.Literal("approve"),
  planVersion: PositiveInt,
  approvalKey: TrimmedNonEmptyString,
  implementation: DeepPlanModelSelection,
  implementationThread: Schema.Literals(["current", "new"]),
  parallelism: DeepPlanParallelism,
  reviewer: Schema.optionalKey(DeepPlanModelSelection),
});
export const DeepPlanPauseMutation = Schema.Struct({
  type: Schema.Literal("pause"),
  reason: Schema.optionalKey(TrimmedNonEmptyString),
});
export const DeepPlanResumeMutation = Schema.Struct({ type: Schema.Literal("resume") });
export const DeepPlanCancelMutation = Schema.Struct({ type: Schema.Literal("cancel") });
export const DeepPlanSubmitMutation = Schema.Struct({
  type: Schema.Literal("submit"),
  target: DeepPlanReviewTarget,
  summary: DeepPlanSummary,
  changedFiles: DeepPlanChangedFiles,
});
export const DeepPlanBlockMutation = Schema.Struct({
  type: Schema.Literal("block"),
  reason: TrimmedNonEmptyString,
});
export const DeepPlanReviewVerdictMutation = Schema.Struct({
  type: Schema.Literal("review-verdict"),
  target: DeepPlanReviewTarget,
  round: PositiveInt,
  verdict: DeepPlanReviewVerdict,
  summary: DeepPlanSummary,
  findings: DeepPlanReviewFindings,
});

export const ClientDeepPlanMutation = Schema.Union([
  DeepPlanApproveMutation,
  DeepPlanPauseMutation,
  DeepPlanResumeMutation,
  DeepPlanCancelMutation,
]);
export type ClientDeepPlanMutation = typeof ClientDeepPlanMutation.Type;
const isClientDeepPlanMutation = Schema.is(ClientDeepPlanMutation);

export const AgentDeepPlanMutation = Schema.Union([
  DeepPlanPublishPlanMutation,
  DeepPlanSubmitMutation,
  DeepPlanBlockMutation,
  DeepPlanReviewVerdictMutation,
]);
export type AgentDeepPlanMutation = typeof AgentDeepPlanMutation.Type;

export const DeepPlanMutation = Schema.Union([ClientDeepPlanMutation, AgentDeepPlanMutation]);
export type DeepPlanMutation = typeof DeepPlanMutation.Type;

export const DeepPlanRunReference = Schema.Struct({
  runId: DeepPlanRunId,
  planVersion: Schema.optional(PositiveInt),
});
export type DeepPlanRunReference = typeof DeepPlanRunReference.Type;

export const DeepPlanGetRunInput = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.optional(DeepPlanRunId),
});
export type DeepPlanGetRunInput = typeof DeepPlanGetRunInput.Type;
export const DeepPlanGetRunResult = Schema.NullOr(StoredDeepPlanRun);
export type DeepPlanGetRunResult = typeof DeepPlanGetRunResult.Type;

export const DEEP_PLAN_WS_METHODS = { getRun: "deepPlan.getRun" } as const;

export class DeepPlanError extends Schema.TaggedError<DeepPlanError>()("DeepPlanError", {
  code: Schema.Literals([
    "run-not-found",
    "stale-revision",
    "stale-plan",
    "invalid-transition",
    "approval-required",
    "actor-mismatch",
    "operation-conflict",
    "target-busy",
    "target-unavailable",
    "storage-failed",
  ]),
  message: TrimmedNonEmptyString,
}) {}

export const ThreadDeepPlanStartCommand = Schema.Struct({
  type: Schema.Literal("thread.deep-plan.start"),
  commandId: CommandId,
  threadId: ThreadId,
  chats: DeepPlanChats,
  includeProjectChats: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type ThreadDeepPlanStartCommand = typeof ThreadDeepPlanStartCommand.Type;

export const ClientThreadDeepPlanUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.deep-plan.update"),
  commandId: CommandId,
  threadId: ThreadId,
  runId: DeepPlanRunId,
  expectedRevision: NonNegativeInt,
  operationId: TrimmedNonEmptyString,
  mutation: ClientDeepPlanMutation,
  createdAt: IsoDateTime,
});

export const ThreadDeepPlanUpdateCommand = Schema.Struct({
  ...ClientThreadDeepPlanUpdateCommand.fields,
  mutation: DeepPlanMutation,
  byThreadId: Schema.optionalKey(ThreadId),
  byTurnCommandId: Schema.optionalKey(CommandId),
  defaultReviewer: Schema.optionalKey(ModelSelection),
}).check(
  Schema.makeFilter(
    (command) =>
      command.byThreadId !== undefined ||
      isClientDeepPlanMutation(command.mutation) ||
      "Agent Deep Plan mutations require a caller thread.",
  ),
);
export type ThreadDeepPlanUpdateCommand = typeof ThreadDeepPlanUpdateCommand.Type;

export const DeepPlanAdvanceTransition = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("start-turn"),
    turn: Schema.Struct(DeepPlanTurnFields),
    latestRunId: Schema.NullOr(RunId),
    prompt: TrimmedNonEmptyString,
    baseTurnCount: Schema.optionalKey(NonNegativeInt),
    diff: Schema.optionalKey(Schema.NullOr(DeepPlanReviewDiff)),
    replaces: Schema.optionalKey(CommandId),
    retryReason: Schema.optionalKey(Schema.Literals(["failed", "missingResult", "restarted"])),
  }),
  Schema.Struct({ type: Schema.Literal("settle-turn"), turnCommandId: CommandId }),
  Schema.Struct({ type: Schema.Literal("pause"), pause: Schema.Struct(DeepPlanPauseFields) }),
]);
export type DeepPlanAdvanceTransition = typeof DeepPlanAdvanceTransition.Type;

export const ThreadDeepPlanAdvanceCommand = Schema.Struct({
  type: Schema.Literal("thread.deep-plan.advance"),
  commandId: CommandId,
  threadId: ThreadId,
  runId: DeepPlanRunId,
  expectedRevision: NonNegativeInt,
  transition: DeepPlanAdvanceTransition,
  createdAt: IsoDateTime,
});
export type ThreadDeepPlanAdvanceCommand = typeof ThreadDeepPlanAdvanceCommand.Type;

const DeepPlanExecutionContextFields = {
  runId: DeepPlanRunId,
  runThreadId: ThreadId,
  approvedPlanVersion: Schema.NullOr(NonNegativeInt),
  laneId: Schema.optionalKey(DeepPlanLaneId),
  modelSelection: ModelSelection,
  turnId: Schema.optionalKey(RunId),
  // Old source-worker contexts must not decode as current planning grants.
  sourceAnalysis: Schema.optionalKey(Schema.Never),
};

export const DeepPlanExecutionContext = Schema.Union([
  Schema.Struct({
    ...DeepPlanExecutionContextFields,
    phase: Schema.Literals(["planning", "execution"]),
    readOnly: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    ...DeepPlanExecutionContextFields,
    phase: Schema.Literal("review"),
    readOnly: Schema.Literal(true),
    review: Schema.Struct({ target: DeepPlanReviewTarget, round: PositiveInt }),
  }),
]);
export type DeepPlanExecutionContext = typeof DeepPlanExecutionContext.Type;
