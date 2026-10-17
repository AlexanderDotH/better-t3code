import type {
  DeepPlanRun,
  DeepPlanSourceCitation,
  DeepPlanSourceSnapshot,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

export function deepPlanSourceTitle(source: DeepPlanSourceSnapshot): string {
  return [source.environmentLabel, source.projectTitle, source.threadTitle]
    .filter(Boolean)
    .join(" / ");
}

export function deepPlanCitationTitles(
  citations: ReadonlyArray<DeepPlanSourceCitation> | undefined,
  sources: ReadonlyArray<DeepPlanSourceSnapshot>,
  unavailableLabel: string,
): ReadonlyArray<string> {
  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  return [
    ...new Set(
      (citations ?? []).map((citation) => {
        const source = sourcesById.get(citation.sourceId);
        return source ? deepPlanSourceTitle(source) : unavailableLabel;
      }),
    ),
  ];
}

export function formatDeepPlanForDisplay(
  run: DeepPlanRun,
  translator: InterfaceTranslator,
  options: { readonly includeImplementation?: boolean } = {},
): string {
  const plan = run.plan;
  if (!plan) return "";
  const { message } = translator;
  const citations = (references: ReadonlyArray<DeepPlanSourceCitation> | undefined) => {
    const titles = deepPlanCitationTitles(
      references,
      run.sources,
      message("chat.deepPlan.sourceUnavailable"),
    );
    const labels = titles.map((title) =>
      title.replace(/[\\`*_[\]<>]/g, (character) => "\\" + character),
    );
    return labels.length ? `\n\n${message("chat.deepPlan.sources")}: ${labels.join("; ")}` : "";
  };
  const overview = [
    `# ${plan.goal}`,
    "",
    `## ${message("chat.deepPlan.scope")}`,
    "",
    ...plan.scope.map((item) => `- ${item}`),
    ...(plan.decisions.length
      ? [
          "",
          `## ${message("chat.deepPlan.decisions")}`,
          "",
          ...plan.decisions.map(
            (decision) =>
              `- ${decision.text}${decision.rationale ? ` — ${decision.rationale}` : ""}${citations(decision.sources)}`,
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
        `${step.description}${citations(step.sources)}`,
        ...(step.dependencies.length
          ? [
              "",
              `${message("chat.deepPlan.dependencies")}: ${step.dependencies
                .map((id) => stepTitles.get(id))
                .filter(Boolean)
                .join("; ")}`,
            ]
          : []),
        "",
        ...step.acceptanceCriteria.map(
          (criterion) =>
            `- [ ] ${criterion.description}\n  ${message("chat.deepPlan.checkMethod")}: ${criterion.checkMethod}${citations(criterion.sources)}`,
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
