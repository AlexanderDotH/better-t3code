import type {
  ClientOrchestrationCommand,
  CommandId,
  DeepPlanDocument,
  DeepPlanEvidence,
  DeepPlanRun,
  DeepPlanRunReference,
  DeepPlanModelSelection,
  DeepPlanSourceSnapshot,
  DeepPlanSourceCitation,
  DeepPlanStep,
  DeepPlanStepStatus,
  EnvironmentId,
  ThreadId,
  OrchestrationProposedPlan,
} from "@t3tools/contracts";

import {
  buildPlanImplementationPrompt,
  type BuildPlanImplementationPromptOptions,
} from "./planImplementation.ts";

type DeepPlanThread = {
  readonly id: ThreadId;
  readonly environmentId?: EnvironmentId | undefined;
  readonly deepPlan?: DeepPlanRun | null | undefined;
};

export function selectDurableDeepPlan(
  thread: DeepPlanThread | null | undefined,
  environmentThreads: ReadonlyArray<DeepPlanThread> = [],
): DeepPlanRun | null {
  if (!thread) return null;
  if (
    thread.deepPlan?.threadId === thread.id ||
    thread.deepPlan?.approval?.implementationThreadId === thread.id
  )
    return thread.deepPlan ?? null;
  for (const owner of environmentThreads) {
    if (thread.environmentId && owner.environmentId !== thread.environmentId) continue;
    if (owner.deepPlan?.approval?.implementationThreadId === thread.id) return owner.deepPlan;
  }
  return null;
}

export function isDeepPlanSourceSummarized(
  run: DeepPlanRun,
  source: DeepPlanSourceSnapshot,
): boolean {
  const coverage = run.sourceCoverage.find((entry) => entry.sourceId === source.sourceId);
  return (
    coverage?.status === "summarized" &&
    coverage.importedRecordCount === source.recordCount &&
    coverage.readRecordCount === source.recordCount &&
    coverage.summary !== null &&
    (source.recordCount === 0 || coverage.summary.citedRecordIds.length > 0)
  );
}

export function getDeepPlanApprovalBlockReason(run: DeepPlanRun | null | undefined): string | null {
  if (!run?.plan) return "DeepPlan has not published a plan yet.";
  if (run.phase !== "awaitingApproval") return "DeepPlan is not waiting for approval.";
  if (!run.approvalKey)
    return "The current plan is missing its approval key. Refresh before approving.";
  if (!run.sources.every((source) => isDeepPlanSourceSummarized(run, source))) {
    return "Every selected chat must be fully read and summarized before approval.";
  }
  return null;
}

export function getDeepPlanProposalBlockReason(
  proposal: Pick<OrchestrationProposedPlan, "deepPlan"> | null | undefined,
  run: DeepPlanRun | null | undefined,
): string | null {
  if (!proposal?.deepPlan) return null;
  if (run?.id !== proposal.deepPlan.runId || run.plan?.version !== proposal.deepPlan.planVersion) {
    return "Deep Plan changed. Review the latest version before implementing it.";
  }
  return getDeepPlanApprovalBlockReason(run);
}

function requireApprovedDeepPlan(run: DeepPlanRun) {
  const { plan, approval } = run;
  if (
    !plan ||
    !approval ||
    approval.planVersion !== plan.version ||
    approval.approvalKey !== run.approvalKey
  ) {
    throw new Error("Approve the current DeepPlan revision before implementing it.");
  }
  if (!run.sources.every((source) => isDeepPlanSourceSummarized(run, source))) {
    throw new Error(
      "DeepPlan source context is incomplete. Complete source collection before implementing.",
    );
  }
  return { plan, approval, reference: { runId: run.id, planVersion: plan.version } };
}

export function getApprovedDeepPlanReference(run: DeepPlanRun): DeepPlanRunReference {
  return requireApprovedDeepPlan(run).reference;
}

export async function approveDeepPlanImplementation(input: {
  readonly run: DeepPlanRun;
  readonly implementation: DeepPlanModelSelection;
  readonly implementationThreadId: ThreadId;
  readonly requestedParallelism?: number;
  readonly commandId: CommandId;
  readonly operationId: string;
  readonly createdAt: string;
  readonly getRun: (input: {
    readonly threadId: ThreadId;
    readonly runId: DeepPlanRun["id"];
  }) => Promise<DeepPlanRun | null>;
  readonly dispatchCommand: (command: ClientOrchestrationCommand) => Promise<unknown>;
}): Promise<DeepPlanRun> {
  const current = await input.getRun({ threadId: input.run.threadId, runId: input.run.id });
  if (
    !current ||
    current.id !== input.run.id ||
    !current.plan ||
    current.plan.version !== input.run.plan?.version ||
    current.approvalKey !== input.run.approvalKey
  ) {
    throw new Error("DeepPlan changed. Review the latest plan before approving it.");
  }
  const matchesApproval = (run: DeepPlanRun) =>
    run.approval?.implementationThreadId === input.implementationThreadId &&
    run.approval.implementation.instanceId === input.implementation.instanceId &&
    run.approval.implementation.model === input.implementation.model &&
    JSON.stringify(run.approval.implementation.options ?? []) ===
      JSON.stringify(input.implementation.options ?? []) &&
    (run.approval.requestedParallelism ?? 1) === (input.requestedParallelism ?? 1);
  if (current.approval) {
    getApprovedDeepPlanReference(current);
    if (!matchesApproval(current))
      throw new Error(
        "DeepPlan is already approved for another implementation. Revise the plan before approving it again.",
      );
    if (current.phase !== "implementing")
      throw new Error("DeepPlan is not waiting for implementation.");
    return current;
  }
  const reason = getDeepPlanApprovalBlockReason(current);
  if (reason) throw new Error(reason);
  const approvalKey = current.approvalKey;
  if (!approvalKey)
    throw new Error("The current plan is missing its approval key. Refresh before approving.");
  await input.dispatchCommand({
    type: "thread.deep-plan.update",
    commandId: input.commandId,
    threadId: current.threadId,
    runId: current.id,
    expectedRevision: current.revision,
    operationId: input.operationId,
    createdAt: input.createdAt,
    mutation: {
      type: "approve",
      planVersion: current.plan.version,
      approvalKey,
      implementation: input.implementation,
      implementationThreadId: input.implementationThreadId,
      implementerId: `thread:${input.implementationThreadId}`,
      ...(input.requestedParallelism === undefined
        ? {}
        : { requestedParallelism: input.requestedParallelism }),
    },
  });
  const approved = await input.getRun({ threadId: current.threadId, runId: current.id });
  if (!approved || !matchesApproval(approved))
    throw new Error("DeepPlan approval was not confirmed. Refresh before implementing.");
  getApprovedDeepPlanReference(approved);
  return approved;
}

export interface DeepPlanStepPresentation {
  readonly step: DeepPlanStep;
  readonly status: DeepPlanStepStatus;
  readonly evidence: ReadonlyArray<DeepPlanEvidence>;
  readonly blockedByDependencies: ReadonlyArray<string>;
  readonly canStart: boolean;
}

export function selectDeepPlanSteps(
  run: DeepPlanRun | null | undefined,
): ReadonlyArray<DeepPlanStepPresentation> {
  if (!run?.plan) return [];
  const states = new Map(run.stepStates.map((state) => [state.stepId, state]));
  const approved =
    run.approval?.planVersion === run.plan.version && run.approval.approvalKey === run.approvalKey;
  return run.plan.steps.map((step) => {
    const state = states.get(step.id);
    const status = state?.status ?? "pending";
    const blockedByDependencies = step.dependencies.filter((dependency) => {
      const dependencyState = states.get(dependency);
      return dependencyState?.status !== "verified" || dependencyState.evidence.length === 0;
    });
    return {
      step,
      status,
      evidence: state?.evidence ?? [],
      blockedByDependencies,
      canStart:
        approved &&
        run.phase === "implementing" &&
        blockedByDependencies.length === 0 &&
        (status === "pending" || status === "blocked" || status === "failed"),
    };
  });
}

export function selectDeepPlanProgress(run: DeepPlanRun | null | undefined) {
  const steps = selectDeepPlanSteps(run);
  const verifiedSteps = steps.filter(
    (entry) => entry.status === "verified" && entry.evidence.length > 0,
  ).length;
  const allStepsVerified = steps.length > 0 && verifiedSteps === steps.length;
  const approvalCurrent = Boolean(
    run?.plan &&
    run.approval?.planVersion === run.plan.version &&
    run.approval.approvalKey === run.approvalKey,
  );
  return {
    totalSteps: steps.length,
    verifiedSteps,
    implementedSteps: steps.filter(
      (entry) => entry.status === "implemented" || entry.status === "verified",
    ).length,
    inProgressSteps: steps.filter((entry) => entry.status === "inProgress").length,
    blockedSteps: steps.filter((entry) => entry.status === "blocked" || entry.status === "failed")
      .length,
    percentComplete: steps.length > 0 ? Math.round((verifiedSteps / steps.length) * 100) : 0,
    allStepsVerified,
    completed: Boolean(
      run &&
      approvalCurrent &&
      allStepsVerified &&
      run.phase === "completed" &&
      run.finalValidation.status === "passed" &&
      run.finalValidation.evidence.length > 0,
    ),
    sourceCount: run?.sources.length ?? 0,
    summarizedSourceCount:
      run?.sources.filter((source) => isDeepPlanSourceSummarized(run, source)).length ?? 0,
  };
}

function formatSourceCitations(sources: ReadonlyArray<DeepPlanSourceCitation> | undefined): string {
  if (!sources?.length) return "";
  return ` Sources: ${sources.map((source) => `${source.sourceId}${source.recordIds.length ? ` (${source.recordIds.join(", ")})` : ""}`).join("; ")}.`;
}

export function formatDeepPlanMarkdown(plan: DeepPlanDocument): string {
  const decisions = plan.decisions.map(
    (decision) =>
      `- ${decision.text}${decision.rationale ? ` — ${decision.rationale}` : ""}${formatSourceCitations(decision.sources)}`,
  );
  const steps = plan.steps.flatMap((step, index) => [
    `### ${index + 1}. ${step.title} (${step.id})`,
    "",
    `${step.description}${formatSourceCitations(step.sources)}`,
    ...(step.dependencies.length > 0 ? ["", `Dependencies: ${step.dependencies.join(", ")}`] : []),
    "",
    ...step.acceptanceCriteria.map(
      (criterion) =>
        `- [ ] ${criterion.description} (${criterion.id})\n  Check: ${criterion.checkMethod}${formatSourceCitations(criterion.sources)}`,
    ),
    "",
  ]);
  return (
    [
      `# DeepPlan — revision ${plan.version}`,
      "",
      "## Goal",
      "",
      plan.goal,
      "",
      "## Scope",
      "",
      ...plan.scope.map((item) => `- ${item}`),
      ...(decisions.length ? ["", "## Decisions", "", ...decisions] : []),
      ...(plan.affectedAreas.length
        ? ["", "## Affected areas", "", ...plan.affectedAreas.map((area) => `- ${area}`)]
        : []),
      "",
      "## Implementation",
      "",
      ...steps,
      "## Final validation",
      "",
      plan.finalValidation.description,
      "",
      `Check: ${plan.finalValidation.checkMethod}`,
    ]
      .join("\n")
      .trimEnd() + "\n"
  );
}

function deepPlanExecutionBinding(
  run: DeepPlanRun,
  approved: ReturnType<typeof requireApprovedDeepPlan>,
): string {
  const { reference, approval } = approved;
  return [
    `DEEPPLAN EXECUTION: run ${reference.runId}, approved plan version ${reference.planVersion}.`,
    `Owner thread: ${run.threadId}. Implementation thread: ${approval.implementationThreadId}.`,
    `Use the approved provider ${approval.implementation.instanceId} and model ${approval.implementation.model} for implementation and final validation.`,
    "Use deep_plan_state before every mutation to obtain the current revision; provide expectedRunId, expectedRevision, and a unique operationId.",
    "Keep the same operationId when retrying an identical update after a connection failure.",
    "Read the complete approved plan and follow its scope, decisions, dependencies, and acceptance criteria.",
    "Use deep_plan_step_update to record inProgress, then implemented, then verified with concrete check evidence for every step. Never mark a step verified only because its files changed.",
    "Wait until dependencies are verified before starting dependent steps. Report blockers with a blocked step status; never silently omit a step.",
    "Use deep_plan_adjust_procedure for procedural changes. Scope or acceptance changes require publishing a new plan revision and renewed human approval before implementation continues.",
    "After all steps are verified, perform a separate final validation using the approved final-validation requirement and deep_plan_validation. Completion requires the durable final validation to pass with evidence.",
  ].join("\n");
}

export function buildDeepPlanImplementationPrompt(
  run: DeepPlanRun,
  options?: BuildPlanImplementationPromptOptions,
): string {
  const approved = requireApprovedDeepPlan(run);
  const binding = deepPlanExecutionBinding(run, approved);
  return `${buildPlanImplementationPrompt(formatDeepPlanMarkdown(approved.plan), options)}\n\n${binding}`;
}

export function buildDeepPlanFinalValidationPrompt(run: DeepPlanRun): string {
  const approved = requireApprovedDeepPlan(run);
  const binding = deepPlanExecutionBinding(run, approved);
  if (!selectDeepPlanProgress(run).allStepsVerified) {
    throw new Error("Verify every DeepPlan step before starting final validation.");
  }
  return [
    "PERFORM THE SEPARATE FINAL VALIDATION FOR THIS APPROVED DEEPPLAN.",
    "",
    binding,
    "",
    "Use deep_plan_state and the durable step evidence to inspect the complete implementation. Execute every final-validation check; report concrete results and any regression.",
    "Use deep_plan_validation with type start before running the final checks. Omit requestId so the server selects its durable validation request. Read the returned finalValidation.requestId, then use type complete with the same requestId, status passed or failed, and concrete evidence after the checks finish.",
    "If a check fails, record failed validation and return to the relevant steps; do not claim the run is complete.",
    "",
    formatDeepPlanMarkdown(approved.plan),
  ].join("\n");
}
