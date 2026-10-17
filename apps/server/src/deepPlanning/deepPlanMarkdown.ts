import type { DeepPlanDocument } from "@t3tools/contracts";

export function deepPlanMarkdown(plan: DeepPlanDocument): string {
  const sections = [
    `# ${plan.goal}`,
    `## Scope\n${plan.scope.map((item) => `- ${item}`).join("\n")}`,
  ];
  if (plan.decisions.length > 0) {
    sections.push(
      `## Decisions\n${plan.decisions.map((decision) => `- ${decision.text}${decision.rationale ? ` — ${decision.rationale}` : ""}`).join("\n")}`,
    );
  }
  for (const [index, step] of plan.steps.entries()) {
    sections.push(
      [
        `## ${index + 1}. ${step.title}`,
        step.description,
        ...step.acceptanceCriteria.map(
          (criterion) => `- ${criterion.description}\n  Check: ${criterion.checkMethod}`,
        ),
      ].join("\n\n"),
    );
  }
  sections.push(
    `## Final validation\n${plan.finalValidation.description}\n\nCheck: ${plan.finalValidation.checkMethod}`,
  );
  return sections.join("\n\n");
}
