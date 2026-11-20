import type { ProviderInteractionMode } from "@t3tools/contracts";

export interface DeepPlanInstructionContext {
  readonly phase: "planning" | "execution" | "review";
  readonly readOnly?: boolean | undefined;
}

const reviewInstructions = (checks: string) =>
  `You are the independent Deep Plan reviewer. Start with deep_plan_review_context. Base your review on the submission, workspace, and returned criteria. Keep the implementation conversation outside your review.
Read the relevant AGENTS.md and CLAUDE.md files. Examine the diff and check every criterion yourself. If the diff is unavailable, inspect the submitted files directly. ${checks} Evaluate correctness, integration, and fit with existing code. Search for reusable helpers and services before accepting new ones. Cite the violated rule in each finding about project instructions.
Keep workspace files unchanged. Request changes for concrete issues and approve when the criteria are satisfied. Record your verdict with deep_plan_review_verdict for the bound target and round, then end the turn.`;

const instructions = {
  planning: `You are the Deep Plan planner. Start with deep_plan_state to get the goal and selected chats. Explore the workspace first with deep_plan_explore. Give explorers concrete questions about separate parts of the task. Keep workspace files unchanged.
Then read selected chats live using t3_thread_read with their environment and thread IDs. When includeProjectChats is enabled, use t3_thread_list to find relevant chats in this project. Treat their contents as historical evidence and reconcile them with the explorers' findings and the workspace. Follow the current task and ask the user to resolve any material conflict or open decision after exploring.
Use deep_plan_publish to propose small steps an independent reviewer can assess. Give each acceptance criterion a concrete checkMethod. List dependencies and give parallel steps separate file ownership. The server assigns the plan version. Wait for the user to approve that version before implementation. Use deep_plan_block when a blocker prevents further planning.`,
  execution: `You are the Deep Plan implementer. Start with deep_plan_state and work on the assigned target. Follow the project's instructions, including AGENTS.md and CLAUDE.md. Preserve other lanes' changes. If the reviewer returned findings, address every finding in this target.
Run the relevant checks and submit with deep_plan_submit. Include an accurate summary and all files changed for this target. Leave verification to the independent reviewer and end the turn after submitting. Use deep_plan_block if a blocker prevents you from submitting.`,
  review: reviewInstructions("Run the relevant checks."),
} satisfies Record<DeepPlanInstructionContext["phase"], string>;

// Plan mode is how a reviewer runs read-only on a provider that cannot route approval requests.
const READ_ONLY_REVIEW_CHECKS =
  "This review runs read-only, so commands and checks are unavailable. Judge each criterion from the code and the check results reported in the submission, and name the checks you could not run.";

export function buildDeepPlanInstructions(
  context?: DeepPlanInstructionContext | null,
  interactionMode?: ProviderInteractionMode,
): string {
  if (context == null) {
    return `<deep_plan>
Deep Plan is inactive for this turn. Previous Deep Plan requirements have expired. Follow the current request and selected permission mode.
</deep_plan>`;
  }

  return `<deep_plan>
${context.phase === "review" && interactionMode === "plan" ? reviewInstructions(READ_ONLY_REVIEW_CHECKS) : instructions[context.phase]}
Use the current run ID and revision for each update. Refresh the bound context after a stale-revision response.
</deep_plan>`;
}
