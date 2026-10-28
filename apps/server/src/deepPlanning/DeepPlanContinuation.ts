import {
  MessageId,
  type CommandId,
  type DeepPlanRun,
  type OrchestrationThreadShell,
  type OrchestrationCommand,
  type ProviderInteractionMode,
} from "@t3tools/contracts";

export function canContinueDeepPlan(
  run: DeepPlanRun,
  interactionMode: ProviderInteractionMode,
): boolean {
  if (interactionMode === "chat") return false;
  if (run.approval === null && interactionMode !== "plan") return false;
  return (
    run.phase === "planning" ||
    run.phase === "implementing" ||
    (run.phase === "validating" && run.finalValidation.status === "inProgress")
  );
}

export function deepPlanContinuationCommand(input: {
  readonly run: DeepPlanRun;
  readonly target: OrchestrationThreadShell;
  readonly commandId: CommandId;
  readonly createdAt: string;
}): Extract<OrchestrationCommand, { type: "thread.turn.start" }> {
  const { run, target, commandId, createdAt } = input;
  const selection = run.approval?.implementation ?? target.modelSelection;
  const text = [
    `Continue Deep Plan ${run.id}, owned by thread ${run.threadId}, from its durable state.`,
    "Read deep_plan_state and the saved source summaries, plan, step evidence, and final validation before continuing.",
    run.approval
      ? `Continue approved plan version ${run.approval.planVersion} in implementation thread ${run.approval.implementationThreadId} using the approved provider and model. Preserve verified steps and reuse existing subagents and their results; do not launch duplicate implementation batches.`
      : "Continue reading and summarizing every frozen source, then publish the complete structured plan with deep_plan_publish. Do not omit unavailable sources or begin implementation before approval.",
    run.approval
      ? `Keep the approved parallelism of ${run.approval.requestedParallelism ?? 1}. Use deep_plan_step_update to record work and concrete verification evidence. Finish remaining steps and the separate final validation within the approved scope.`
      : "",
    run.phase === "validating"
      ? `Continue final validation request ${run.finalValidation.requestId}. Preserve completed checks, fix failures, and record the result with deep_plan_validation using the same requestId.`
      : "",
    "Keep required user decisions and external prerequisites visible. Resuming does not verify a blocked criterion or change the approved plan.",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    type: "thread.turn.start",
    commandId,
    threadId: target.id,
    message: {
      messageId: MessageId.make(commandId + ":message"),
      role: "user",
      text,
      attachments: [],
    },
    background: { runId: run.id },
    idleGuard: { latestTurnId: target.latestTurn?.turnId ?? null },
    modelSelection: {
      instanceId: selection.instanceId,
      model: selection.model,
      ...(selection.options === undefined ? {} : { options: selection.options }),
    },
    runtimeMode: target.runtimeMode,
    interactionMode: run.approval ? "default" : "plan",
    createdAt,
  };
}
