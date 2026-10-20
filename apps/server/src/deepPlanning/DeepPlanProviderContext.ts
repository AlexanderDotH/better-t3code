import type {
  DeepPlanRun,
  ModelSelection,
  ProviderInteractionMode,
  ThreadId,
} from "@t3tools/contracts";
import type { McpDeepPlanContext } from "../mcp/McpInvocationContext.ts";

export function deepPlanProviderContext(
  run: DeepPlanRun | null | undefined,
  threadId: ThreadId,
  modelSelection: ModelSelection,
  interactionMode?: ProviderInteractionMode,
): McpDeepPlanContext | undefined {
  if (
    run == null ||
    run.phase === "completed" ||
    run.phase === "failed" ||
    run.phase === "paused" ||
    run.phase === "blocked"
  )
    return undefined;
  const approval = run.approval;
  if (
    approval !== null &&
    approval.implementationThreadId === threadId &&
    approval.planVersion === run.plan?.version
  ) {
    return {
      runId: run.id,
      runThreadId: run.threadId,
      approvedPlanVersion: approval.planVersion,
      phase: run.phase === "validating" ? "validation" : "execution",
      readOnly: interactionMode === "plan",
      modelSelection: {
        instanceId: approval.implementation.instanceId,
        model: approval.implementation.model,
        ...(approval.implementation.options === undefined
          ? {}
          : { options: approval.implementation.options }),
      },
    };
  }
  if (
    interactionMode !== "plan" ||
    run.threadId !== threadId ||
    (run.phase !== "collecting" && run.phase !== "planning" && run.phase !== "awaitingApproval")
  )
    return undefined;
  return {
    runId: run.id,
    runThreadId: run.threadId,
    approvedPlanVersion: null,
    phase: "planning",
    readOnly: true,
    modelSelection,
  };
}
