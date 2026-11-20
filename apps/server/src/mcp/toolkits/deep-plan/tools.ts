import {
  DeepPlanBlockMutation,
  DeepPlanError,
  DeepPlanPublishPlanMutation,
  DeepPlanReviewFinding,
  DeepPlanReviewTarget,
  DeepPlanReviewVerdictMutation,
  DeepPlanRun,
  DeepPlanRunId,
  DeepPlanRunPhase,
  DeepPlanStep,
  DeepPlanSubmitMutation,
  DeepPlanValidationRequirement,
  NonNegativeInt,
  OrchestratorMcpFailure,
  PositiveInt,
  TrimmedNonEmptyString,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import { CheckpointDiffQuery } from "../../../checkpointing/CheckpointDiffQuery.ts";
import { DeepPlanExploration } from "../../../deepPlanning/DeepPlanExploration.ts";
import { DeepPlanWorkflow } from "../../../deepPlanning/DeepPlanWorkflow.ts";
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../../../orchestration-v2/ProjectStore.ts";
import { ProjectionStoreV2 } from "../../../orchestration-v2/ProjectionStore.ts";
import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
import { WorkspacePaths } from "../../../workspace/WorkspacePaths.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { isDeepPlanToolForPhase } from "./toolNames.ts";

export class DeepPlanToolScopeError extends Schema.TaggedError<DeepPlanToolScopeError>()(
  "DeepPlanToolScopeError",
  {
    reason: Schema.Literals([
      "credential-not-authorized",
      "owner-mismatch",
      "stale-run",
      "stale-plan",
      "phase-mismatch",
      "target-mismatch",
    ]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const RunAssertion = { expectedRunId: DeepPlanRunId };
const UpdateFields = {
  ...RunAssertion,
  expectedRevision: NonNegativeInt,
  operationId: TrimmedNonEmptyString,
};

export const DeepPlanPublishInput = Schema.Struct({
  ...UpdateFields,
  plan: DeepPlanPublishPlanMutation.fields.plan,
});
export type DeepPlanPublishInput = typeof DeepPlanPublishInput.Type;

export const DeepPlanExploreInput = Schema.Struct({
  ...RunAssertion,
  assignments: Schema.Array(
    Schema.Struct({
      scope: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
      questions: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(2_000))).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(8),
      ),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
});
export type DeepPlanExploreInput = typeof DeepPlanExploreInput.Type;

export const DeepPlanSubmitInput = Schema.Struct({
  ...UpdateFields,
  target: DeepPlanSubmitMutation.fields.target,
  summary: DeepPlanSubmitMutation.fields.summary,
  changedFiles: DeepPlanSubmitMutation.fields.changedFiles,
});
export type DeepPlanSubmitInput = typeof DeepPlanSubmitInput.Type;

export const DeepPlanBlockInput = Schema.Struct({
  ...UpdateFields,
  reason: DeepPlanBlockMutation.fields.reason,
});
export type DeepPlanBlockInput = typeof DeepPlanBlockInput.Type;

export const DeepPlanReviewVerdictInput = Schema.Struct({
  ...UpdateFields,
  target: DeepPlanReviewVerdictMutation.fields.target,
  round: DeepPlanReviewVerdictMutation.fields.round,
  verdict: DeepPlanReviewVerdictMutation.fields.verdict,
  summary: DeepPlanReviewVerdictMutation.fields.summary,
  findings: DeepPlanReviewVerdictMutation.fields.findings,
});
export type DeepPlanReviewVerdictInput = typeof DeepPlanReviewVerdictInput.Type;

const StateFields = {
  id: DeepPlanRunId,
  revision: NonNegativeInt,
  phase: DeepPlanRunPhase,
};
const ReviewBindingFields = {
  planVersion: PositiveInt,
  target: DeepPlanReviewTarget,
  round: PositiveInt,
};
const ReviewerState = Schema.Struct({ ...StateFields, ...ReviewBindingFields });
const FullState = Schema.Struct({
  ...DeepPlanRun.fields,
  target: Schema.NullOr(DeepPlanReviewTarget),
  round: Schema.NullOr(PositiveInt),
});
const ReviewContext = Schema.Struct({
  ...ReviewerState.fields,
  goal: TrimmedNonEmptyString,
  scope: Schema.Array(TrimmedNonEmptyString),
  step: Schema.NullOr(DeepPlanStep),
  finalCriteria: Schema.NullOr(DeepPlanValidationRequirement),
  submission: Schema.Struct({
    summary: Schema.String,
    changedFiles: Schema.Array(TrimmedNonEmptyString),
  }),
  priorFindings: Schema.Array(DeepPlanReviewFinding),
  instructionPaths: Schema.Array(TrimmedNonEmptyString),
  diff: Schema.NullOr(
    Schema.Struct({
      files: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          previousPath: Schema.optionalKey(Schema.String),
          additions: NonNegativeInt,
          deletions: NonNegativeInt,
        }),
      ),
      patch: Schema.String,
    }),
  ),
});
const UpdateReceipt = Schema.Struct({
  runId: DeepPlanRunId,
  revision: NonNegativeInt,
  phase: DeepPlanRunPhase,
  planVersion: Schema.NullOr(PositiveInt),
});
const ExplorationResult = Schema.Struct({
  runId: Schema.String,
  status: Schema.Literals(["skipped", "completed", "cancelled", "unavailable"]),
  context: Schema.optionalKey(Schema.String),
  warnings: Schema.Array(Schema.String),
  plannedWorkers: NonNegativeInt,
  completedWorkers: NonNegativeInt,
  successfulWorkers: NonNegativeInt,
});

const failure = Schema.Union([
  OrchestratorMcpFailure,
  DeepPlanToolScopeError,
  DeepPlanError,
  WorkspaceContextUnavailableError,
]);
const bindingDependencies = [ThreadManagementService, McpInvocationContext, ProjectionStoreV2];
const updateDependencies = [...bindingDependencies, DeepPlanWorkflow];

const listedForDeepPlan = (tool: string) => (): boolean => {
  const fiber = Fiber.getCurrent();
  const scope = fiber && Context.getOrUndefined(fiber.context, McpInvocationContext);
  if (scope?.thread === undefined) return false;
  if (scope.deepPlan?.phase === "review") return isDeepPlanToolForPhase("review", tool);
  // Providers may cache tool discovery before a later turn binds a different Deep Plan role.
  if (scope.capabilities.has("deep-plan-tools")) return true;
  return (
    scope.capabilities.has("deep-plan") &&
    scope.deepPlan !== undefined &&
    isDeepPlanToolForPhase(scope.deepPlan.phase, tool)
  );
};

const DeepPlanStateTool = Tool.make("deep_plan_state", {
  description:
    "Read the bound Deep Plan's run ID, revision, plan, selected chats and assigned target. Reviewer credentials see only their target and round.",
  parameters: Schema.Struct({}),
  success: Schema.Union([FullState, ReviewerState]),
  failure,
  dependencies: bindingDependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, listedForDeepPlan("deep_plan_state"));

const DeepPlanPublishTool = Tool.make("deep_plan_publish", {
  description:
    "Propose or revise the plan for the planning run. Give each acceptance criterion a concrete checkMethod. The server assigns the plan version and waits for the user's approval.",
  parameters: DeepPlanPublishInput,
  success: UpdateReceipt,
  failure,
  dependencies: updateDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, listedForDeepPlan("deep_plan_publish"));

const DeepPlanExploreTool = Tool.make("deep_plan_explore", {
  description:
    "Investigate the workspace and selected chats through up to six read-only explorers. Give each a separate scope and specific questions. Returns their findings and any failures.",
  parameters: DeepPlanExploreInput,
  success: ExplorationResult,
  failure,
  dependencies: [...bindingDependencies, DeepPlanExploration],
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, listedForDeepPlan("deep_plan_explore"));

const DeepPlanSubmitTool = Tool.make("deep_plan_submit", {
  description:
    "Submit the implementation or fixes for the assigned target for independent review. Name every changed file with a workspace-relative path. Verification comes from the reviewer.",
  parameters: DeepPlanSubmitInput,
  success: UpdateReceipt,
  failure,
  dependencies: updateDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, listedForDeepPlan("deep_plan_submit"));

const DeepPlanBlockTool = Tool.make("deep_plan_block", {
  description:
    "Pause the bound planning or implementation run with a concrete blocker for the user.",
  parameters: DeepPlanBlockInput,
  success: UpdateReceipt,
  failure,
  dependencies: updateDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, listedForDeepPlan("deep_plan_block"));

const DeepPlanReviewContextTool = Tool.make("deep_plan_review_context", {
  description:
    "Read the bound review target, acceptance criteria, submission, prior findings, project instruction paths and checkpoint diff. An unavailable diff is null.",
  parameters: Schema.Struct({}),
  success: ReviewContext,
  failure,
  dependencies: [
    ...bindingDependencies,
    CheckpointDiffQuery,
    OrchestratorV2,
    ProjectStoreV2,
    WorkspacePaths,
    FileSystem.FileSystem,
    Path.Path,
  ],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, listedForDeepPlan("deep_plan_review_context"));

const DeepPlanReviewVerdictTool = Tool.make("deep_plan_review_verdict", {
  description:
    "Record the independent verdict for the current review target and round. Approve work that meets the criteria or request changes with concrete findings and applicable project rules.",
  parameters: DeepPlanReviewVerdictInput,
  success: UpdateReceipt,
  failure,
  dependencies: updateDependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, listedForDeepPlan("deep_plan_review_verdict"));

export const DeepPlanToolkit = Toolkit.make(
  DeepPlanStateTool,
  DeepPlanPublishTool,
  DeepPlanExploreTool,
  DeepPlanSubmitTool,
  DeepPlanBlockTool,
  DeepPlanReviewContextTool,
  DeepPlanReviewVerdictTool,
);
