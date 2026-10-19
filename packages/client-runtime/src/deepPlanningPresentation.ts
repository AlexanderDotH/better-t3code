import type {
  DeepPlanRun,
  DeepPlanSourceCitation,
  DeepPlanSourceSnapshot,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import { isDeepPlanSourceSummarized } from "./deepPlanningRun.ts";

const COMPLETED_CHECKLIST_VISIBLE_MS = 60_000;

export function getDeepPlanComposerChecklistExpiresAt(
  run: Pick<DeepPlanRun, "phase" | "updatedAt">,
): number | null {
  if (run.phase !== "completed") return null;
  const updatedAt = Date.parse(run.updatedAt);
  return Number.isFinite(updatedAt) ? updatedAt + COMPLETED_CHECKLIST_VISIBLE_MS : 0;
}

export function deepPlanSourceTitle(source: DeepPlanSourceSnapshot): string {
  return [source.environmentLabel, source.projectTitle, source.threadTitle]
    .filter(Boolean)
    .join(" / ");
}

export function selectDeepPlanSourceAnalysis(run: DeepPlanRun, translator: InterfaceTranslator) {
  const coverageById = new Map(run.sourceCoverage.map((entry) => [entry.sourceId, entry]));
  return run.sources
    .map((source) => {
      const coverage = coverageById.get(source.sourceId);
      const complete = isDeepPlanSourceSummarized(run, source);
      const failed = coverage?.status === "unavailable" || coverage?.status === "failed";
      const readCount = coverage?.readRecordCount ?? 0;
      const read = coverage?.status === "ready" && readCount === source.recordCount;
      const reading = !read && readCount > 0;
      const label = complete
        ? translator.message("chat.deepPlan.done")
        : failed
          ? (coverage.error ?? translator.message("chat.deepPlan.sourceUnavailable"))
          : read
            ? translator.message("chat.deepPlan.analysisRead")
            : reading
              ? translator.message("chat.deepPlan.analysisReading", {
                  percent: Math.min(99, Math.floor((readCount / source.recordCount) * 100)),
                })
              : translator.message("chat.deepPlan.analysisPending");
      return {
        source,
        complete,
        failed,
        label,
        priority: complete ? 3 : failed ? 0 : read || reading ? 1 : 2,
      };
    })
    .sort((left, right) => left.priority - right.priority);
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
