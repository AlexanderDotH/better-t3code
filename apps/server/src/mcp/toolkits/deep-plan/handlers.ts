import {
  DeepPlanReviewTarget,
  type AgentDeepPlanMutation,
  type DeepPlanExecutionContext,
  type DeepPlanRun,
  type DeepPlanRunId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CheckpointDiffQuery } from "../../../checkpointing/CheckpointDiffQuery.ts";
import { DeepPlanExploration } from "../../../deepPlanning/DeepPlanExploration.ts";
import {
  deepPlanGrantMatches,
  resolveLiveDeepPlan,
} from "../../../deepPlanning/DeepPlanProviderContext.ts";
import { DeepPlanWorkflow } from "../../../deepPlanning/DeepPlanWorkflow.ts";
import { reviewTarget } from "../../../deepPlanning/deepPlanNextAction.ts";
import { WorkspacePaths } from "../../../workspace/WorkspacePaths.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { resolveWorkspaceMcpScope } from "../../WorkspaceMcpScope.ts";
import {
  DeepPlanToolkit,
  DeepPlanToolScopeError,
  type DeepPlanBlockInput,
  type DeepPlanExploreInput,
  type DeepPlanPublishInput,
  type DeepPlanReviewVerdictInput,
  type DeepPlanSubmitInput,
} from "./tools.ts";

const sameTarget = Schema.toEquivalence(DeepPlanReviewTarget);

const loadBoundRun = Effect.fn("DeepPlanToolkit.loadBoundRun")(function* (
  expectedRunId?: DeepPlanRunId,
) {
  const { thread, ownerThreadId, messageReply, capabilities, deepPlan } =
    yield* McpInvocationContext;
  if (
    thread === undefined ||
    !capabilities.has("deep-plan") ||
    deepPlan === undefined ||
    deepPlan.turnId === undefined
  ) {
    return yield* new DeepPlanToolScopeError({
      reason: "credential-not-authorized",
      detail: "This credential has no active Deep Plan turn grant.",
    });
  }
  if (ownerThreadId !== thread.threadId || messageReply !== undefined) {
    return yield* new DeepPlanToolScopeError({
      reason: "owner-mismatch",
      detail: "Deep Plan tools require the authenticated thread assigned to the turn.",
    });
  }
  if (expectedRunId !== undefined && expectedRunId !== deepPlan.runId) {
    return yield* new DeepPlanToolScopeError({
      reason: "stale-run",
      detail: "The request names a different Deep Plan run. Refresh the bound context.",
    });
  }
  if (thread.providerInstanceId !== deepPlan.modelSelection.instanceId) {
    return yield* new DeepPlanToolScopeError({
      reason: "stale-plan",
      detail: "The provider does not match the Deep Plan turn grant.",
    });
  }

  const live = yield* resolveLiveDeepPlan({
    threadId: thread.threadId,
    turnId: deepPlan.turnId,
    modelSelection: deepPlan.modelSelection,
    interactionMode: deepPlan.phase === "planning" ? "plan" : "default",
  }).pipe(
    Effect.mapError(
      () =>
        new DeepPlanToolScopeError({
          reason: "stale-run",
          detail: "The bound Deep Plan turn is unavailable.",
        }),
    ),
  );
  if (live === undefined || !deepPlanGrantMatches(live.grant, deepPlan)) {
    return yield* new DeepPlanToolScopeError({
      reason: "stale-plan",
      detail: "The grant no longer matches the active Deep Plan turn.",
    });
  }

  return { ...live, actorId: thread.threadId };
});

type BoundRun = Effect.Success<ReturnType<typeof loadBoundRun>>;
type Phase = DeepPlanExecutionContext["phase"];

const requireRole = Effect.fn("DeepPlanToolkit.requireRole")(function* <Role extends Phase>(
  roles: readonly Role[],
  expectedRunId?: DeepPlanRunId,
) {
  const bound = yield* loadBoundRun(expectedRunId);
  if (!roles.some((role) => bound.grant.phase === role)) {
    return yield* new DeepPlanToolScopeError({
      reason: "phase-mismatch",
      detail: "This tool is unavailable to the role assigned to this Deep Plan turn.",
    });
  }
  return { ...bound, grant: bound.grant as DeepPlanExecutionContext & { readonly phase: Role } };
});

const reviewerState = (
  run: DeepPlanRun,
  grant: Extract<DeepPlanExecutionContext, { readonly phase: "review" }>,
) => ({
  id: run.id,
  revision: run.revision,
  phase: run.phase,
  planVersion: grant.approvedPlanVersion!,
  ...grant.review,
});

export const invokeDeepPlanState = Effect.fn("DeepPlanToolkit.state")(function* () {
  const { run, grant, assignment } = yield* loadBoundRun();
  return grant.phase === "review"
    ? reviewerState(run, grant)
    : {
        ...run,
        target: assignment === undefined ? null : reviewTarget(assignment),
        round: assignment?.round ?? null,
      };
});

const updateRun = Effect.fn("DeepPlanToolkit.updateRun")(function* (
  bound: BoundRun,
  input: { readonly expectedRevision: number; readonly operationId: string },
  mutation: AgentDeepPlanMutation,
) {
  const workflow = yield* DeepPlanWorkflow;
  const updated = yield* workflow.update({
    threadId: bound.run.threadId,
    runId: bound.run.id,
    expectedRevision: input.expectedRevision,
    operationId: input.operationId,
    byThreadId: bound.actorId,
    ...(bound.assignment === undefined ? {} : { byTurnCommandId: bound.assignment.commandId }),
    mutation,
  });
  return {
    runId: updated.id,
    revision: updated.revision,
    phase: updated.phase,
    planVersion: updated.plan?.version ?? null,
  };
});

export const invokeDeepPlanPublish = Effect.fn("DeepPlanToolkit.publish")(function* (
  input: DeepPlanPublishInput,
) {
  const bound = yield* requireRole(["planning"], input.expectedRunId);
  return yield* updateRun(bound, input, { type: "publish-plan", plan: input.plan });
});

const invokeDeepPlanExplore = Effect.fn("DeepPlanToolkit.explore")(function* (
  input: DeepPlanExploreInput,
) {
  const { actorId, run } = yield* requireRole(["planning"], input.expectedRunId);
  const exploration = yield* DeepPlanExploration;
  return yield* exploration.explore({ threadId: actorId, run, assignments: input.assignments });
});

export const invokeDeepPlanSubmit = Effect.fn("DeepPlanToolkit.submit")(function* (
  input: DeepPlanSubmitInput,
) {
  const bound = yield* requireRole(["execution"], input.expectedRunId);
  const { target, summary, changedFiles } = input;
  if (bound.assignment === undefined || !sameTarget(target, reviewTarget(bound.assignment))) {
    return yield* new DeepPlanToolScopeError({
      reason: "target-mismatch",
      detail: "Submit the target assigned to this implementation turn.",
    });
  }
  return yield* updateRun(bound, input, { type: "submit", target, summary, changedFiles });
});

const invokeDeepPlanBlock = Effect.fn("DeepPlanToolkit.block")(function* (
  input: DeepPlanBlockInput,
) {
  const bound = yield* requireRole(["planning", "execution"], input.expectedRunId);
  return yield* updateRun(bound, input, { type: "block", reason: input.reason });
});

const instructionPathsForFiles = Effect.fn("DeepPlanToolkit.instructionPathsForFiles")(function* (
  threadId: BoundRun["actorId"],
  files: ReadonlyArray<string>,
) {
  const { workspaceRoot } = yield* resolveWorkspaceMcpScope(threadId);
  const fileSystem = yield* FileSystem.FileSystem;
  const paths = yield* WorkspacePaths;
  const path = yield* Path.Path;
  const folders = new Set(["."]);
  for (const relativePath of files) {
    const resolved = yield* paths
      .resolveRelativePathWithinRoot({ workspaceRoot, relativePath })
      .pipe(Effect.orElseSucceed(() => undefined));
    if (resolved === undefined) continue;
    let directory = path.dirname(resolved.relativePath);
    while (!folders.has(directory)) {
      folders.add(directory);
      directory = path.dirname(directory);
    }
  }
  const candidates = [...folders].flatMap((directory) =>
    ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md"].map((file) => path.join(directory, file)),
  );
  return yield* Effect.filter(
    candidates,
    (candidate) =>
      fileSystem.stat(path.join(workspaceRoot, candidate)).pipe(
        Effect.map((stat) => stat.type === "File"),
        Effect.orElseSucceed(() => false),
      ),
    { concurrency: 8 },
  );
});

export const invokeDeepPlanReviewContext = Effect.fn("DeepPlanToolkit.reviewContext")(function* () {
  const { actorId, run, grant } = yield* requireRole(["review"]);
  const { target, round } = grant.review;
  const state =
    target.kind === "step"
      ? run.steps.find((step) => step.stepId === target.stepId)
      : run.finalReview;
  const plan = run.plan;
  const step =
    target.kind === "step" ? plan?.steps.find((step) => step.id === target.stepId) : null;
  const review = state?.reviews.find(
    (entry) => entry.round === round && entry.reviewThreadId === actorId,
  );
  if (!plan || !state || review === undefined || step === undefined) {
    return yield* new DeepPlanToolScopeError({
      reason: "target-mismatch",
      detail: "The submission assigned to this review is unavailable.",
    });
  }
  const submission =
    target.kind === "step"
      ? state.submission
      : {
          summary:
            state.submission?.summary ??
            "Review the combined changes for all steps against the final acceptance criteria.",
          changedFiles: Array.from(
            new Set([
              ...run.steps.flatMap((state) => state.submission?.changedFiles ?? []),
              ...(state.submission?.changedFiles ?? []),
            ]),
          ),
        };
  if (submission === null) {
    return yield* new DeepPlanToolScopeError({
      reason: "target-mismatch",
      detail: "The submission assigned to this review is unavailable.",
    });
  }
  const diffQuery = yield* CheckpointDiffQuery;
  const diff =
    review.diff === null
      ? null
      : yield* diffQuery.getReviewDiff(
          review.diff,
          target.kind === "step" && (run.approval?.parallelism ?? 1) > 1
            ? submission.changedFiles
            : undefined,
        );
  const changedPaths = [
    ...submission.changedFiles,
    ...(diff?.files.flatMap((file) =>
      file.previousPath === undefined ? [file.path] : [file.previousPath, file.path],
    ) ?? []),
  ];
  return {
    ...reviewerState(run, grant),
    goal: plan.goal,
    scope: plan.scope,
    step,
    finalCriteria: target.kind === "final" ? plan.finalValidation : null,
    submission,
    priorFindings: state.reviews
      .filter((entry) => entry.round < round)
      .flatMap((entry) => entry.findings),
    instructionPaths: yield* instructionPathsForFiles(actorId, changedPaths),
    diff,
  };
});

export const invokeDeepPlanReviewVerdict = Effect.fn("DeepPlanToolkit.reviewVerdict")(function* (
  input: DeepPlanReviewVerdictInput,
) {
  const bound = yield* requireRole(["review"], input.expectedRunId);
  const { target, round, verdict, summary, findings } = input;
  const review = bound.grant.review;
  if (round !== review.round || !sameTarget(target, review.target)) {
    return yield* new DeepPlanToolScopeError({
      reason: "target-mismatch",
      detail: "Record a verdict for the target and round assigned to this review.",
    });
  }
  return yield* updateRun(bound, input, {
    type: "review-verdict",
    target,
    round,
    verdict,
    summary,
    findings,
  });
});

export const DeepPlanToolkitHandlersLive = McpToolAccess.toLayer(DeepPlanToolkit, {
  deep_plan_state: McpToolAccess.readsAsCaller(invokeDeepPlanState),
  deep_plan_publish: McpToolAccess.actsAsCaller(invokeDeepPlanPublish),
  deep_plan_explore: McpToolAccess.actsAsCaller(invokeDeepPlanExplore),
  deep_plan_submit: McpToolAccess.actsAsCaller(invokeDeepPlanSubmit),
  deep_plan_block: McpToolAccess.actsAsCaller(invokeDeepPlanBlock),
  deep_plan_review_context: McpToolAccess.readsAsCaller(invokeDeepPlanReviewContext),
  deep_plan_review_verdict: McpToolAccess.actsAsCaller(invokeDeepPlanReviewVerdict),
});
