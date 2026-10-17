import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderOptionSelections } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const DEEP_PLAN_VERSION = 1;
export const DEEP_PLAN_MAX_PAGE_SIZE = 200;
export const DEEP_PLAN_MAX_CHUNK_RECORDS = 100;
export const DEEP_PLAN_MAX_RECORD_BYTES = 128 * 1024;
export const DEEP_PLAN_MAX_ATTACHMENT_CHUNK_CHARS = 32_000;
export const DEEP_PLAN_MAX_CONTENT_CHUNK_CHARS = 32_000;

export const DeepPlanRunId = TrimmedNonEmptyString.pipe(Schema.brand("DeepPlanRunId"));
export type DeepPlanRunId = typeof DeepPlanRunId.Type;
export const DeepPlanSourceId = TrimmedNonEmptyString.pipe(Schema.brand("DeepPlanSourceId"));
export type DeepPlanSourceId = typeof DeepPlanSourceId.Type;
export const DeepPlanExportId = TrimmedNonEmptyString.pipe(Schema.brand("DeepPlanExportId"));
export type DeepPlanExportId = typeof DeepPlanExportId.Type;
export const DeepPlanStepId = TrimmedNonEmptyString;
export type DeepPlanStepId = typeof DeepPlanStepId.Type;
export const DeepPlanContentHash = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type DeepPlanContentHash = typeof DeepPlanContentHash.Type;

export const DeepPlanEnvironmentCapability = Schema.Struct({
  version: Schema.Literal(DEEP_PLAN_VERSION),
  sourceExport: Schema.Boolean,
  sourceImport: Schema.Boolean,
});
export type DeepPlanEnvironmentCapability = typeof DeepPlanEnvironmentCapability.Type;

export const DeepPlanProviderCapability = Schema.Struct({
  version: Schema.Literal(DEEP_PLAN_VERSION),
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

export const DeepPlanSourceCatalogEntry = Schema.Struct({
  origin: DeepPlanSourceRef,
  projectTitle: TrimmedNonEmptyString,
  threadTitle: TrimmedNonEmptyString,
  archived: Schema.Boolean,
  messageCount: NonNegativeInt,
  activityCount: NonNegativeInt,
  attachmentCount: Schema.optional(NonNegativeInt),
  forkOrigin: Schema.NullOr(DeepPlanSourceRef),
  updatedAt: Schema.optional(IsoDateTime),
});
export type DeepPlanSourceCatalogEntry = typeof DeepPlanSourceCatalogEntry.Type;

export const DeepPlanSourceSnapshot = Schema.Struct({
  sourceId: DeepPlanSourceId,
  origin: DeepPlanSourceRef,
  environmentLabel: Schema.optional(TrimmedNonEmptyString),
  projectTitle: TrimmedNonEmptyString,
  threadTitle: TrimmedNonEmptyString,
  archived: Schema.Boolean,
  capturedAt: IsoDateTime,
  contentVersion: TrimmedNonEmptyString,
  contentHash: DeepPlanContentHash,
  messageCount: NonNegativeInt,
  activityCount: NonNegativeInt,
  attachmentCount: NonNegativeInt,
  recordCount: NonNegativeInt,
  forkOrigin: Schema.NullOr(DeepPlanSourceRef),
});
export type DeepPlanSourceSnapshot = typeof DeepPlanSourceSnapshot.Type;

export const DeepPlanSourceSummary = Schema.Struct({
  requirements: Schema.Array(TrimmedNonEmptyString),
  decisions: Schema.Array(TrimmedNonEmptyString),
  openIssues: Schema.Array(TrimmedNonEmptyString),
  rejectedApproaches: Schema.Array(TrimmedNonEmptyString),
  conflicts: Schema.Array(TrimmedNonEmptyString),
  citedRecordIds: Schema.Array(TrimmedNonEmptyString),
});
export type DeepPlanSourceSummary = typeof DeepPlanSourceSummary.Type;

export const DeepPlanSourceCoverageStatus = Schema.Literals([
  "pending",
  "importing",
  "ready",
  "summarized",
  "unavailable",
  "failed",
]);
export type DeepPlanSourceCoverageStatus = typeof DeepPlanSourceCoverageStatus.Type;

export const DeepPlanSourceCoverage = Schema.Struct({
  sourceId: DeepPlanSourceId,
  status: DeepPlanSourceCoverageStatus,
  importedRecordCount: NonNegativeInt,
  readRecordCount: NonNegativeInt,
  summary: Schema.NullOr(DeepPlanSourceSummary),
  error: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type DeepPlanSourceCoverage = typeof DeepPlanSourceCoverage.Type;

export const DeepPlanSourceCitation = Schema.Struct({
  sourceId: DeepPlanSourceId,
  recordIds: Schema.Array(TrimmedNonEmptyString),
});
export type DeepPlanSourceCitation = typeof DeepPlanSourceCitation.Type;

export const DeepPlanAcceptanceCriterion = Schema.Struct({
  id: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  checkMethod: TrimmedNonEmptyString,
  sources: Schema.optional(Schema.Array(DeepPlanSourceCitation)),
});
export type DeepPlanAcceptanceCriterion = typeof DeepPlanAcceptanceCriterion.Type;

export const DeepPlanStep = Schema.Struct({
  id: DeepPlanStepId,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  dependencies: Schema.Array(DeepPlanStepId),
  sources: Schema.optional(Schema.Array(DeepPlanSourceCitation)),
  acceptanceCriteria: Schema.Array(DeepPlanAcceptanceCriterion).check(Schema.isMinLength(1)),
});
export type DeepPlanStep = typeof DeepPlanStep.Type;

export const DeepPlanDecision = Schema.Struct({
  id: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString,
  rationale: Schema.optional(TrimmedNonEmptyString),
  sources: Schema.optional(Schema.Array(DeepPlanSourceCitation)),
});
export type DeepPlanDecision = typeof DeepPlanDecision.Type;

export const DeepPlanValidationRequirement = Schema.Struct({
  description: TrimmedNonEmptyString,
  checkMethod: TrimmedNonEmptyString,
});
export type DeepPlanValidationRequirement = typeof DeepPlanValidationRequirement.Type;

const DeepPlanDocumentWire = Schema.Struct({
  schemaVersion: Schema.Literal(DEEP_PLAN_VERSION),
  version: PositiveInt,
  goal: TrimmedNonEmptyString,
  scope: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
  decisions: Schema.Array(DeepPlanDecision),
  affectedAreas: Schema.Array(TrimmedNonEmptyString),
  steps: Schema.Array(DeepPlanStep).check(Schema.isMinLength(1)),
  finalValidation: DeepPlanValidationRequirement,
});

export const DeepPlanDocument = DeepPlanDocumentWire.check(
  Schema.makeFilter((plan) => {
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
  }),
);
export type DeepPlanDocument = typeof DeepPlanDocument.Type;

export const DeepPlanModelSelection = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optional(ProviderOptionSelections),
});
export type DeepPlanModelSelection = typeof DeepPlanModelSelection.Type;

export const DeepPlanActor = Schema.Struct({
  implementerId: TrimmedNonEmptyString,
  model: DeepPlanModelSelection,
});
export type DeepPlanActor = typeof DeepPlanActor.Type;

export const DeepPlanApproval = Schema.Struct({
  planVersion: PositiveInt,
  approvalKey: TrimmedNonEmptyString,
  approvedAt: IsoDateTime,
  approvedBy: TrimmedNonEmptyString,
  implementation: DeepPlanModelSelection,
  requestedParallelism: Schema.optional(PositiveInt),
  implementationThreadId: ThreadId,
  implementerId: TrimmedNonEmptyString,
});
export type DeepPlanApproval = typeof DeepPlanApproval.Type;

export const DeepPlanEvidence = Schema.Struct({
  kind: Schema.Literals(["test", "inspection", "command", "artifact", "note"]),
  summary: TrimmedNonEmptyString,
  reference: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type DeepPlanEvidence = typeof DeepPlanEvidence.Type;

export const DeepPlanStepStatus = Schema.Literals([
  "pending",
  "inProgress",
  "implemented",
  "verified",
  "failed",
  "blocked",
]);
export type DeepPlanStepStatus = typeof DeepPlanStepStatus.Type;

export const DeepPlanStepState = Schema.Struct({
  stepId: DeepPlanStepId,
  status: DeepPlanStepStatus,
  evidence: Schema.Array(DeepPlanEvidence),
  updatedAt: IsoDateTime,
}).check(
  Schema.makeFilter(
    (step) =>
      step.status !== "verified" ||
      step.evidence.length > 0 ||
      "Verified Deep Plan steps require evidence.",
  ),
);
export type DeepPlanStepState = typeof DeepPlanStepState.Type;

export const DeepPlanFinalValidationStatus = Schema.Literals([
  "pending",
  "inProgress",
  "passed",
  "failed",
]);
export type DeepPlanFinalValidationStatus = typeof DeepPlanFinalValidationStatus.Type;

export const DeepPlanFinalValidation = Schema.Struct({
  status: DeepPlanFinalValidationStatus,
  evidence: Schema.Array(DeepPlanEvidence),
  updatedAt: Schema.NullOr(IsoDateTime),
  attempt: NonNegativeInt,
  requestId: Schema.NullOr(TrimmedNonEmptyString),
  turnId: Schema.NullOr(TurnId),
}).check(
  Schema.makeFilter(
    (validation) =>
      validation.status !== "passed" ||
      validation.evidence.length > 0 ||
      "Passed Deep Plan final validation requires evidence.",
  ),
);
export type DeepPlanFinalValidation = typeof DeepPlanFinalValidation.Type;

export const DeepPlanProcedureAdjustment = Schema.Struct({
  id: TrimmedNonEmptyString,
  planVersion: PositiveInt,
  reason: TrimmedNonEmptyString,
  changes: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
  actor: DeepPlanActor,
  createdAt: IsoDateTime,
});
export type DeepPlanProcedureAdjustment = typeof DeepPlanProcedureAdjustment.Type;

export const DeepPlanRunPhase = Schema.Literals([
  "collecting",
  "planning",
  "awaitingApproval",
  "implementing",
  "validating",
  "completed",
  "paused",
  "failed",
  "blocked",
]);
export type DeepPlanRunPhase = typeof DeepPlanRunPhase.Type;

export const DeepPlanOperation = Schema.Struct({
  operationId: TrimmedNonEmptyString,
  fingerprint: TrimmedNonEmptyString,
  revision: NonNegativeInt,
});
export type DeepPlanOperation = typeof DeepPlanOperation.Type;

export const DeepPlanRun = Schema.Struct({
  id: DeepPlanRunId,
  threadId: ThreadId,
  phase: DeepPlanRunPhase,
  revision: NonNegativeInt,
  plan: Schema.NullOr(DeepPlanDocument),
  approval: Schema.NullOr(DeepPlanApproval),
  approvalKey: Schema.NullOr(TrimmedNonEmptyString),
  sources: Schema.Array(DeepPlanSourceSnapshot),
  sourceCoverage: Schema.Array(DeepPlanSourceCoverage),
  stepStates: Schema.Array(DeepPlanStepState),
  finalValidation: DeepPlanFinalValidation,
  procedureAdjustments: Schema.Array(DeepPlanProcedureAdjustment),
  operations: Schema.Array(DeepPlanOperation).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  pauseReason: Schema.NullOr(TrimmedNonEmptyString),
}).check(
  Schema.makeFilter((run) => {
    if (new Set(run.stepStates.map((step) => step.stepId)).size !== run.stepStates.length) {
      return "Deep Plan step states must have unique step IDs.";
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
    const states = new Map(run.stepStates.map((step) => [step.stepId, step.status]));
    return (
      (states.size === run.plan.steps.length &&
        run.plan.steps.every((step) => states.get(step.id) === "verified") &&
        run.finalValidation.status === "passed") ||
      "Completed Deep Plans require all steps verified and final validation passed."
    );
  }),
);
export type DeepPlanRun = typeof DeepPlanRun.Type;

export const DeepPlanPublishPlanMutation = Schema.Struct({
  type: Schema.Literal("publish-plan"),
  plan: DeepPlanDocument,
});
export const DeepPlanApproveMutation = Schema.Struct({
  type: Schema.Literal("approve"),
  planVersion: PositiveInt,
  approvalKey: TrimmedNonEmptyString,
  implementation: DeepPlanModelSelection,
  requestedParallelism: Schema.optional(PositiveInt),
  implementationThreadId: ThreadId,
  implementerId: TrimmedNonEmptyString,
});
export const DeepPlanStepUpdateMutation = Schema.Struct({
  type: Schema.Literal("step-update"),
  stepId: DeepPlanStepId,
  status: DeepPlanStepStatus,
  evidence: Schema.Array(DeepPlanEvidence),
  actor: DeepPlanActor,
});
export const DeepPlanValidationStartMutation = Schema.Struct({
  type: Schema.Literal("validation-start"),
  requestId: TrimmedNonEmptyString,
  turnId: Schema.optional(TurnId),
  actor: DeepPlanActor,
});
export const DeepPlanValidationCompleteMutation = Schema.Struct({
  type: Schema.Literal("validation-complete"),
  requestId: TrimmedNonEmptyString,
  status: Schema.Literals(["passed", "failed"]),
  evidence: Schema.Array(DeepPlanEvidence),
  actor: DeepPlanActor,
});
export const DeepPlanProcedureAdjustMutation = Schema.Struct({
  type: Schema.Literal("procedure-adjust"),
  reason: TrimmedNonEmptyString,
  changes: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
  actor: DeepPlanActor,
});
export const DeepPlanPauseMutation = Schema.Struct({
  type: Schema.Literal("pause"),
  reason: Schema.optional(TrimmedNonEmptyString),
});
export const DeepPlanResumeMutation = Schema.Struct({
  type: Schema.Literal("resume"),
});
export const DeepPlanBlockMutation = Schema.Struct({
  type: Schema.Literal("block"),
  reason: TrimmedNonEmptyString,
});

export const ClientDeepPlanMutation = Schema.Union([
  DeepPlanApproveMutation,
  DeepPlanPauseMutation,
  DeepPlanResumeMutation,
]);
export type ClientDeepPlanMutation = typeof ClientDeepPlanMutation.Type;

export const AgentDeepPlanMutation = Schema.Union([
  DeepPlanPublishPlanMutation,
  DeepPlanStepUpdateMutation,
  DeepPlanValidationStartMutation,
  DeepPlanValidationCompleteMutation,
  DeepPlanProcedureAdjustMutation,
  DeepPlanBlockMutation,
]);
export type AgentDeepPlanMutation = typeof AgentDeepPlanMutation.Type;

export const DeepPlanSourcesSetMutation = Schema.Struct({
  type: Schema.Literal("sources-set"),
  sources: Schema.Array(DeepPlanSourceSnapshot),
});
export const DeepPlanSourceCoverageMutation = Schema.Struct({
  type: Schema.Literal("source-coverage"),
  coverage: Schema.Array(DeepPlanSourceCoverage),
});
export const DeepPlanMutation = Schema.Union([
  ClientDeepPlanMutation,
  AgentDeepPlanMutation,
  DeepPlanSourcesSetMutation,
  DeepPlanSourceCoverageMutation,
]);
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
export const DeepPlanGetRunResult = Schema.NullOr(DeepPlanRun);
export type DeepPlanGetRunResult = typeof DeepPlanGetRunResult.Type;

export class DeepPlanError extends Schema.TaggedError<DeepPlanError>()("DeepPlanError", {
  code: Schema.Literals([
    "run-not-found",
    "stale-revision",
    "stale-plan",
    "invalid-transition",
    "approval-required",
    "actor-mismatch",
    "sources-incomplete",
    "operation-conflict",
    "validation-required",
    "storage-failed",
  ]),
  message: TrimmedNonEmptyString,
}) {}
