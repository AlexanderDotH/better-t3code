import {
  DeepPlanError,
  type DeepPlanMutation,
  type DeepPlanRun,
  type DeepPlanRunId,
  type DeepPlanSourceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { GeneralSubagentCoordinator } from "../../../subagents/GeneralSubagentCoordinator.ts";
import { GeneralSubagentError } from "../../../subagents/GeneralSubagentProtocol.ts";
import {
  DEEP_PLAN_SOURCE_BATCH_SIZE,
  DEEP_PLAN_PARALLEL_SOURCE_BATCHES,
} from "../../../deepPlanning/DeepPlanSourceBatches.ts";

import { DeepPlanSources } from "../../../deepPlanning/DeepPlanSources.ts";
import { DeepPlanWorkflow } from "../../../deepPlanning/DeepPlanWorkflow.ts";
import { finalValidationRequestId } from "../../../deepPlanning/DeepPlanValidationReactor.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import {
  DeepPlanToolkit,
  DeepPlanToolScopeError,
  type DeepPlanAdjustProcedureInput,
  type DeepPlanAnalyzeSourcesInput,
  type DeepPlanPublishInput,
  type DeepPlanReadSourceInput,
  type DeepPlanStepUpdateInput,
  type DeepPlanSummarizeInput,
  type DeepPlanValidationInput,
} from "./tools.ts";

const loadBoundRun = Effect.fn("DeepPlanToolkit.loadBoundRun")(function* (
  expectedRunId?: DeepPlanRunId,
) {
  const invocation = yield* McpInvocationContext;
  const binding = invocation.deepPlan;
  if (!invocation.capabilities.has("deep-plan") || !binding) {
    return yield* new DeepPlanToolScopeError({
      reason: "credential-not-authorized",
      detail: "This credential is not bound to a Deep Plan run.",
    });
  }
  const sourceAnalysis = binding.sourceAnalysis;
  const authorizedOwner = sourceAnalysis
    ? invocation.ownerThreadId === sourceAnalysis.workerThreadId &&
      invocation.threadId === binding.runThreadId &&
      binding.phase === "planning" &&
      binding.approvedPlanVersion === null
    : invocation.ownerThreadId === invocation.threadId;
  if (!authorizedOwner || invocation.messageReply) {
    return yield* new DeepPlanToolScopeError({
      reason: "owner-mismatch",
      detail:
        "Deep Plan tools require the authenticated owner agent, not a delegated thread or reply topic.",
    });
  }
  if (expectedRunId !== undefined && expectedRunId !== binding.runId) {
    return yield* new DeepPlanToolScopeError({
      reason: "stale-run",
      detail:
        "The tool call belongs to an earlier or different Deep Plan run. Refresh deep_plan_state.",
    });
  }
  const workflow = yield* DeepPlanWorkflow;
  const run = yield* workflow.getRun({ threadId: binding.runThreadId, runId: binding.runId });
  if (!run || run.id !== binding.runId || run.threadId !== binding.runThreadId) {
    return yield* new DeepPlanToolScopeError({
      reason: "stale-run",
      detail: "The credential's Deep Plan run is no longer current.",
    });
  }
  if (binding.approvedPlanVersion === null) {
    if (run.threadId !== invocation.threadId || run.approval !== null) {
      return yield* new DeepPlanToolScopeError({
        reason: "owner-mismatch",
        detail: "This planning credential does not own the current run.",
      });
    }
  } else if (
    run.approval?.planVersion !== binding.approvedPlanVersion ||
    run.plan?.version !== binding.approvedPlanVersion ||
    run.approval.implementationThreadId !== invocation.threadId
  ) {
    return yield* new DeepPlanToolScopeError({
      reason: "stale-plan",
      detail: "This credential is not bound to the current approved plan and implementing thread.",
    });
  }
  return { invocation, binding, workflow, run };
});

const requirePlanningRun = Effect.fn("DeepPlanToolkit.requirePlanningRun")(function* (
  expectedRunId: DeepPlanRunId,
  allowSourceAnalysis = false,
) {
  const bound = yield* loadBoundRun(expectedRunId);
  if (bound.binding.sourceAnalysis && !allowSourceAnalysis) {
    return yield* new DeepPlanToolScopeError({
      reason: "owner-mismatch",
      detail: "Source-analysis workers may only read and summarize their assigned sources.",
    });
  }
  if (
    bound.binding.phase !== "planning" ||
    bound.binding.approvedPlanVersion !== null ||
    !["collecting", "planning", "awaitingApproval"].includes(bound.run.phase)
  ) {
    return yield* new DeepPlanToolScopeError({
      reason: "phase-mismatch",
      detail:
        "Source summaries and proposed plans can only be changed during planning, before user approval.",
    });
  }
  return bound;
});

const requireImplementationRun = Effect.fn("DeepPlanToolkit.requireImplementationRun")(function* (
  expectedRunId: DeepPlanRunId,
) {
  const bound = yield* loadBoundRun(expectedRunId);
  if (bound.binding.phase === "planning" || bound.binding.approvedPlanVersion === null) {
    return yield* new DeepPlanToolScopeError({
      reason: "phase-mismatch",
      detail: "Execution evidence requires the user's approval of this exact plan version.",
    });
  }
  if (bound.binding.modelSelection.instanceId !== bound.invocation.providerInstanceId) {
    return yield* new DeepPlanError({
      code: "actor-mismatch",
      message: "The current provider does not match this run's bound implementing model.",
    });
  }
  return {
    ...bound,
    actor: {
      implementerId: `thread:${bound.invocation.threadId}`,
      model: bound.binding.modelSelection,
    },
  };
});

type WorkflowUpdate = { readonly expectedRevision: number; readonly operationId: string };

const updateRun = (
  bound: Effect.Success<ReturnType<typeof loadBoundRun>>,
  input: WorkflowUpdate,
  mutation: DeepPlanMutation,
) =>
  bound.workflow.update({
    threadId: bound.binding.runThreadId,
    runId: bound.binding.runId,
    expectedRevision: input.expectedRevision,
    operationId: input.operationId,
    mutation,
  });

const withBoundRunLock = Effect.fn("DeepPlanToolkit.withRunLock")(function* <A, E, R>(
  expectedRunId: DeepPlanRunId,
  effect: Effect.Effect<A, E, R>,
) {
  const { workflow, binding } = yield* loadBoundRun(expectedRunId);
  return yield* workflow.withRunLock(binding.runId, effect);
});

export const invokeDeepPlanState = Effect.fn("DeepPlanToolkit.state")(function* () {
  const { binding, run } = yield* loadBoundRun();
  const grant = binding.sourceAnalysis;
  return grant
    ? {
        ...run,
        sources: run.sources.filter((source) => grant.sourceIds.includes(source.sourceId)),
        sourceCoverage: run.sourceCoverage.filter((coverage) =>
          grant.sourceIds.includes(coverage.sourceId),
        ),
      }
    : run;
});

export const invokeDeepPlanSources = Effect.fn("DeepPlanToolkit.sources")(function* () {
  const { binding } = yield* loadBoundRun();
  const sources = yield* DeepPlanSources;
  const result = yield* sources.listSources({
    threadId: binding.runThreadId,
    runId: binding.runId,
  });
  const grant = binding.sourceAnalysis;
  return grant
    ? {
        ...result,
        sources: result.sources.filter((source) => grant.sourceIds.includes(source.sourceId)),
        coverage: result.coverage.filter((coverage) => grant.sourceIds.includes(coverage.sourceId)),
      }
    : result;
});

const requireGrantedSource = (
  binding: import("../../McpInvocationContext.ts").McpDeepPlanContext,
  sourceId: DeepPlanSourceId,
) =>
  binding.sourceAnalysis && !binding.sourceAnalysis.sourceIds.includes(sourceId)
    ? Effect.fail(
        new DeepPlanToolScopeError({
          reason: "owner-mismatch",
          detail: "This source is outside the worker's assigned batch.",
        }),
      )
    : Effect.void;

export const invokeDeepPlanAnalyzeSources = Effect.fn("DeepPlanToolkit.analyzeSources")(function* (
  input: DeepPlanAnalyzeSourcesInput,
) {
  const { workflow, binding, invocation } = yield* requirePlanningRun(input.expectedRunId);
  const optionalCoordinator = yield* Effect.serviceOption(GeneralSubagentCoordinator);
  if (Option.isNone(optionalCoordinator)) {
    return yield* new GeneralSubagentError({
      reason: "operation-failed",
      detail: "Parallel source analysis is unavailable on this server.",
    });
  }
  const coordinator = optionalCoordinator.value;
  const sources = yield* DeepPlanSources;
  const caller = {
    parentThreadId: binding.runThreadId,
    callerProviderInstanceId: invocation.providerInstanceId,
  };
  const agents = yield* workflow.withRunLock(
    binding.runId,
    Effect.gen(function* () {
      yield* requirePlanningRun(input.expectedRunId);
      const frozen = yield* sources.listSources({
        threadId: binding.runThreadId,
        runId: binding.runId,
      });
      const ready = frozen.sources.filter((source) =>
        frozen.coverage.some(
          (coverage) => coverage.sourceId === source.sourceId && coverage.status === "ready",
        ),
      );
      return yield* coordinator.analyzeDeepPlanSources({ ...caller, binding, sources: ready });
    }),
  );
  // Workers need this same run lock to save summaries while the parent waits.
  const waited =
    agents.length > 0 && (input.waitSeconds ?? 30) > 0
      ? yield* coordinator.wait({
          ...caller,
          agentIds: agents.map((agent) => agent.agentId),
          timeoutSeconds: input.waitSeconds ?? 30,
        })
      : null;
  const frozen = yield* workflow.withRunLock(
    binding.runId,
    Effect.gen(function* () {
      const bound = yield* requirePlanningRun(input.expectedRunId);
      const frozen = yield* sources.listSources({
        threadId: binding.runThreadId,
        runId: binding.runId,
      });
      const previousCoverage = new Map(
        bound.run.sourceCoverage.map((entry) => [entry.sourceId, entry]),
      );
      const readProgressChanged = frozen.coverage.some(
        (entry) => entry.readRecordCount !== previousCoverage.get(entry.sourceId)?.readRecordCount,
      );
      if (bound.run.plan === null && readProgressChanged) {
        yield* updateRun(
          bound,
          {
            expectedRevision: bound.run.revision,
            operationId: `source-read-progress:${bound.run.revision}`,
          },
          { type: "source-coverage", coverage: frozen.coverage },
        );
      }
      return frozen;
    }),
  );
  const remainingSourceCount = frozen.sources.filter(
    (source) =>
      !frozen.coverage.some(
        (coverage) => coverage.sourceId === source.sourceId && coverage.status === "summarized",
      ),
  ).length;
  return {
    runId: binding.runId,
    batchSize: DEEP_PLAN_SOURCE_BATCH_SIZE,
    maxParallelBatches: DEEP_PLAN_PARALLEL_SOURCE_BATCHES,
    agents: agents.map((agent) => {
      const observed = waited?.agents.find((entry) => entry.agentId === agent.agentId);
      return {
        agentId: agent.agentId,
        status: observed?.status ?? agent.status,
        sourceIds: agent.sourceIds,
        outcome: observed?.result?.outcome ?? null,
      };
    }),
    remainingSourceCount,
    complete: remainingSourceCount === 0 && (agents.length === 0 || waited?.allTerminal === true),
  };
});

const readSource = Effect.fn("DeepPlanToolkit.readSource")(function* (
  input: DeepPlanReadSourceInput,
) {
  const { binding, run } = yield* loadBoundRun(input.expectedRunId);
  yield* requireGrantedSource(binding, input.sourceId);
  if (run.phase === "paused" || run.phase === "blocked" || run.phase === "failed") {
    return yield* new DeepPlanToolScopeError({
      reason: "phase-mismatch",
      detail: "Resume this Deep Plan run before reading more source pages.",
    });
  }
  const sources = yield* DeepPlanSources;
  return yield* sources.readSourceChunk({
    threadId: binding.runThreadId,
    runId: binding.runId,
    sourceId: input.sourceId,
    includeBodies: input.includeBodies ?? false,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
});

const summarizeSource = Effect.fn("DeepPlanToolkit.summarizeSource")(function* (
  input: DeepPlanSummarizeInput,
) {
  const bound = yield* requirePlanningRun(input.expectedRunId, true);
  yield* requireGrantedSource(bound.binding, input.sourceId);
  if (
    !bound.binding.sourceAnalysis &&
    bound.run.revision !== input.expectedRevision &&
    !bound.run.operations.some((operation) => operation.operationId === input.operationId)
  ) {
    return yield* new DeepPlanError({
      code: "stale-revision",
      message: "Refresh deep_plan_state before summarizing this source.",
    });
  }
  const sources = yield* DeepPlanSources;
  const coverage = yield* sources.summarizeSource({
    threadId: bound.binding.runThreadId,
    runId: bound.binding.runId,
    sourceId: input.sourceId,
    expectedContentHash: input.expectedContentHash,
    summary: input.summary,
  });
  const allSources = yield* sources.listSources({
    threadId: bound.binding.runThreadId,
    runId: bound.binding.runId,
  });
  yield* updateRun(
    bound,
    {
      ...input,
      expectedRevision: bound.binding.sourceAnalysis ? bound.run.revision : input.expectedRevision,
    },
    { type: "source-coverage", coverage: allSources.coverage },
  );
  return coverage;
});

const publish = Effect.fn("DeepPlanToolkit.publish")(function* (input: DeepPlanPublishInput) {
  const { deepPlan } = yield* McpInvocationContext;
  const bound = yield* deepPlan?.approvedPlanVersion == null
    ? requirePlanningRun(input.expectedRunId)
    : requireImplementationRun(input.expectedRunId);
  const sources = yield* DeepPlanSources;
  yield* sources.assertCompleteCoverage(bound.binding.runId);
  return yield* updateRun(bound, input, { type: "publish-plan", plan: input.plan });
});

const stepUpdate = Effect.fn("DeepPlanToolkit.stepUpdate")(function* (
  input: DeepPlanStepUpdateInput,
) {
  const bound = yield* requireImplementationRun(input.expectedRunId);
  return yield* updateRun(bound, input, {
    type: "step-update",
    stepId: input.stepId,
    status: input.status,
    evidence: input.evidence,
    actor: bound.actor,
  });
});

const adjustProcedure = Effect.fn("DeepPlanToolkit.adjustProcedure")(function* (
  input: DeepPlanAdjustProcedureInput,
) {
  const bound = yield* requireImplementationRun(input.expectedRunId);
  return yield* updateRun(bound, input, {
    type: "procedure-adjust",
    reason: input.reason,
    changes: input.changes,
    actor: bound.actor,
  });
});

const validation = Effect.fn("DeepPlanToolkit.validation")(function* (
  input: DeepPlanValidationInput,
) {
  const bound = yield* requireImplementationRun(input.expectedRunId);
  const requestId = finalValidationRequestId(bound.run);
  if (input.type === "start" && input.requestId !== undefined && input.requestId !== requestId) {
    return yield* new DeepPlanError({
      code: "validation-required",
      message:
        "Use the server-scheduled validation request. Omit requestId when starting validation.",
    });
  }
  return yield* updateRun(
    bound,
    input,
    input.type === "start"
      ? { type: "validation-start", requestId, actor: bound.actor }
      : {
          type: "validation-complete",
          requestId: input.requestId,
          status: input.status,
          evidence: input.evidence,
          actor: bound.actor,
        },
  );
});

export const invokeDeepPlanReadSource = (input: DeepPlanReadSourceInput) =>
  withBoundRunLock(input.expectedRunId, readSource(input));
export const invokeDeepPlanSummarizeSource = (input: DeepPlanSummarizeInput) =>
  withBoundRunLock(input.expectedRunId, summarizeSource(input));

const updateReceipt = (run: DeepPlanRun) => ({
  runId: run.id,
  revision: run.revision,
  phase: run.phase,
  planVersion: run.plan?.version ?? null,
  approvedPlanVersion: run.approval?.planVersion ?? null,
  finalValidation: run.finalValidation,
});

export const invokeDeepPlanPublish = (input: DeepPlanPublishInput) =>
  withBoundRunLock(input.expectedRunId, publish(input)).pipe(Effect.map(updateReceipt));
export const invokeDeepPlanStepUpdate = (input: DeepPlanStepUpdateInput) =>
  withBoundRunLock(input.expectedRunId, stepUpdate(input)).pipe(Effect.map(updateReceipt));
const invokeDeepPlanAdjustProcedure = (input: DeepPlanAdjustProcedureInput) =>
  withBoundRunLock(input.expectedRunId, adjustProcedure(input)).pipe(Effect.map(updateReceipt));
export const invokeDeepPlanValidation = (input: DeepPlanValidationInput) =>
  withBoundRunLock(input.expectedRunId, validation(input)).pipe(Effect.map(updateReceipt));

export const DeepPlanToolkitHandlersLive = DeepPlanToolkit.toLayer({
  deep_plan_state: invokeDeepPlanState,
  deep_plan_sources: invokeDeepPlanSources,
  deep_plan_analyze_sources: invokeDeepPlanAnalyzeSources,
  deep_plan_read_source: invokeDeepPlanReadSource,
  deep_plan_summarize_source: invokeDeepPlanSummarizeSource,
  deep_plan_publish: invokeDeepPlanPublish,
  deep_plan_step_update: invokeDeepPlanStepUpdate,
  deep_plan_adjust_procedure: invokeDeepPlanAdjustProcedure,
  deep_plan_validation: invokeDeepPlanValidation,
});
