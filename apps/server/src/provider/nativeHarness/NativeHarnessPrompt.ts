import { buildChatModeInstructions } from "../ChatModeInstructions.ts";
import {
  type ProviderInteractionMode,
  type ProviderSandboxMode,
  WORKSPACE_CONTEXT_MAX_QUERIES,
  WORKSPACE_CONTEXT_MAX_READS,
} from "@t3tools/contracts";
import {
  buildDeepPlanInstructions,
  type DeepPlanInstructionContext,
} from "../DeepPlanInstructions.ts";

export function nativeHarnessWorkspaceInstructions(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly fetchWorker: boolean;
  readonly deepPlan?: DeepPlanInstructionContext | undefined;
}): string {
  if (input.interactionMode === "chat") return buildChatModeInstructions("chat");
  const canEdit =
    input.interactionMode !== "plan" &&
    input.sandboxMode !== "read-only" &&
    !input.fetchWorker &&
    input.deepPlan?.readOnly !== true;
  const reads = `Prefer workspace_find for path or content searches and workspace_read for bounded line reads. Batch at most ${WORKSPACE_CONTEXT_MAX_QUERIES} queries or ${WORKSPACE_CONTEXT_MAX_READS} reads per call; split larger sets and use workspace_context only for mixed batches. Do not use shell text readers or searchers.`;
  const workspace = canEdit
    ? `${reads} Prefer workspace_edit for small UTF-8 edits; create new files with write mode create and prefer exact replacements for existing text. Use an available command tool for large edits, formatters, generators, binaries, large files, or permissions.`
    : reads;
  return [
    workspace,
    buildDeepPlanInstructions(input.deepPlan),
    buildChatModeInstructions(input.interactionMode),
  ]
    .filter(Boolean)
    .join("\n");
}

export function nativeHarnessTurnGuidance(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly deepPlan?: DeepPlanInstructionContext | undefined;
}): string {
  if (input.deepPlan?.phase === "review")
    return "Review mode is active: inspect the submission and run the relevant checks with the available tools, but do not modify files. Finish with deep_plan_review_verdict.";
  return input.interactionMode === "plan" || input.deepPlan?.readOnly === true
    ? "Plan mode is active: return a decision-complete plan without modifying the workspace."
    : "Carry the request through focused verification and preserve unrelated work.";
}
