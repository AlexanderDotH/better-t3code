import {
  MessageId,
  type CommandId,
  type DeepPlanRun,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2Command,
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
  readonly target: OrchestrationV2ThreadShell;
  readonly commandId: CommandId;
  readonly createdAt: string;
}): Extract<OrchestrationV2Command, { type: "message.dispatch" }> {
  const { run, target, commandId } = input;
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
    type: "message.dispatch",
    commandId,
    threadId: target.id,
    messageId: MessageId.make(commandId + ":message"),
    text,
    attachments: [],
    createdBy: "agent",
    creationSource: "server",
    deepPlanRunId: run.id,
    idleGuard: { latestRunId: target.latestRunId },
    modelSelection: {
      instanceId: selection.instanceId,
      model: selection.model,
      ...(selection.options === undefined ? {} : { options: selection.options }),
    },
    dispatchMode: { type: "start_immediately" },
  };
}
