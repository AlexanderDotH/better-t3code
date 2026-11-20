import type {
  DeepPlanActiveTurnKind,
  DeepPlanReviewFinding,
  DeepPlanRun,
  DeepPlanStepId,
} from "@t3tools/contracts";

type PromptTurn = {
  readonly kind: DeepPlanActiveTurnKind;
  readonly stepId: DeepPlanStepId | null;
  readonly round: number;
};
type RetryReason = "failed" | "missingResult" | "restarted";

export function deepPlanTurnPrompt(
  run: DeepPlanRun,
  turn: PromptTurn,
  retryReason?: RetryReason,
): string {
  const step = run.plan?.steps.find((candidate) => candidate.id === turn.stepId);
  const title = step?.title ?? "the complete Deep Plan";
  const target = turn.stepId === null ? "the final target" : `step ${turn.stepId}`;
  const isReview = turn.kind === "review" || turn.kind === "finalReview";
  const retry =
    retryReason === "missingResult"
      ? isReview
        ? "The previous turn ended without recording a verdict."
        : "The previous turn ended without submitting its work. Check the work already present before continuing."
      : retryReason === "failed" || retryReason === "restarted"
        ? "The previous turn ended early. Check what already ran before repeating work."
        : "";

  if (isReview) {
    return [
      `Independently review ${title}, round ${turn.round}.`,
      retry,
      "Start with deep_plan_review_context. Read the project rules and inspect the submitted work, then run the checks needed to evaluate the acceptance criteria.",
      "Check correctness, integration, and reuse of existing code. Cite the applicable project rule with any finding about it. Keep the workspace read-only.",
      "Finish by calling deep_plan_review_verdict for the assigned target and round. Request changes for concrete issues that affect the result, and approve when the criteria pass.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const fixing = turn.kind === "fix" || turn.kind === "finalFix";
  const findings =
    (turn.stepId === null
      ? run.finalReview
      : run.steps.find((candidate) => candidate.stepId === turn.stepId)
    )?.reviews.at(-1)?.findings ?? [];
  return [
    fixing ? `Address the review findings for ${title}.` : `Implement the assigned step: ${title}.`,
    retry,
    step?.description ?? run.plan?.finalValidation.description,
    step?.acceptanceCriteria
      .map((criterion) => `- ${criterion.description} (Check: ${criterion.checkMethod})`)
      .join("\n"),
    "Read deep_plan_state for the approved scope, plan, and current review findings. Follow the project rules.",
    turn.stepId === null
      ? "Keep fixes within the approved scope."
      : "Leave other lanes' changes alone.",
    fixing && findings.length > 0
      ? ["Address each of these findings:", ...findings.map(findingTitle)].join("\n")
      : "",
    `Run the relevant checks and call deep_plan_submit for ${target} with a summary and repository-relative paths. An independent reviewer verifies the result.`,
    turn.kind === "fix" ? "List every path the step changed across all its rounds." : "",
    "Use deep_plan_block if an unresolved dependency prevents you from proceeding.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function findingTitle(finding: DeepPlanReviewFinding): string {
  return `- ${finding.title}${finding.file === undefined ? "" : ` (${finding.file})`}`;
}
