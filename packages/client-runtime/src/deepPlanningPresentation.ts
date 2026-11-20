import type { DeepPlanDocument, DeepPlanLegacyRun, DeepPlanRun } from "@t3tools/contracts";
import {
  createInterfaceTranslator,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";

const FINISHED_CHECKLIST_VISIBLE_MS = 60_000;
const english = createInterfaceTranslator({ language: "en", locale: "en-US" });

export function getDeepPlanComposerChecklistExpiresAt(
  run: Pick<DeepPlanRun, "phase" | "updatedAt"> | DeepPlanLegacyRun,
): number | null {
  if (!("phase" in run) || (run.phase !== "completed" && run.phase !== "cancelled")) return null;
  const updatedAt = Date.parse(run.updatedAt);
  return Number.isFinite(updatedAt) ? updatedAt + FINISHED_CHECKLIST_VISIBLE_MS : 0;
}

export function formatDeepPlanMarkdown(plan: DeepPlanDocument): string {
  return formatDeepPlanForDisplay({ plan }, english);
}

export function formatDeepPlanForDisplay(
  run: Pick<DeepPlanRun, "plan"> | DeepPlanLegacyRun,
  { message }: InterfaceTranslator,
  options: { readonly includeImplementation?: boolean } = {},
): string {
  if (!("plan" in run) || !run.plan) return "";
  const { plan } = run;
  const overview = [
    `# ${plan.goal}`,
    "",
    `## ${message("chat.deepPlan.scope")}`,
    "",
    ...plan.scope.map((item) => `- ${item}`),
    ...(plan.nonGoals.length
      ? [
          "",
          `## ${message("chat.deepPlan.nonGoals")}`,
          "",
          ...plan.nonGoals.map((item) => `- ${item}`),
        ]
      : []),
    ...(plan.decisions.length
      ? [
          "",
          `## ${message("chat.deepPlan.decisions")}`,
          "",
          ...plan.decisions.map(
            (decision) =>
              `- ${decision.text}${decision.rationale ? `: ${decision.rationale}` : ""}`,
          ),
        ]
      : []),
    ...(plan.affectedAreas.length
      ? [
          "",
          `## ${message("chat.deepPlan.affectedAreas")}`,
          "",
          ...plan.affectedAreas.map((area) => `- ${area}`),
        ]
      : []),
  ];
  if (options.includeImplementation === false) return overview.join("\n") + "\n";
  const stepTitles = new Map(plan.steps.map((step) => [step.id, step.title]));
  return (
    [
      ...overview,
      "",
      `## ${message("chat.deepPlan.checklist")}`,
      "",
      ...plan.steps.flatMap((step, index) => [
        `### ${index + 1}. ${step.title}`,
        "",
        step.description,
        ...(step.dependencies.length
          ? [
              "",
              `${message("chat.deepPlan.dependencies")}: ${step.dependencies
                .map((id) => stepTitles.get(id))
                .filter(Boolean)
                .join(", ")}`,
            ]
          : []),
        "",
        ...step.acceptanceCriteria.map(
          (criterion) =>
            `- [ ] ${criterion.description}\n  ${message("chat.deepPlan.checkMethod")}: ${criterion.checkMethod}`,
        ),
        "",
      ]),
      `## ${message("chat.deepPlan.finalValidation")}`,
      "",
      plan.finalValidation.description,
      "",
      `${message("chat.deepPlan.checkMethod")}: ${plan.finalValidation.checkMethod}`,
    ].join("\n") + "\n"
  );
}
