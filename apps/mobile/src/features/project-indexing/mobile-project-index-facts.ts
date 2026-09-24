import type { ProjectImportV1, ProjectIndexQueryResultV1 } from "@t3tools/contracts";

const MAX_VISIBLE_FACTS_PER_KIND = 8;

type StaticFactInput = Pick<ProjectIndexQueryResultV1, "modules" | "rules" | "evidence"> & {
  readonly imports?: ReadonlyArray<ProjectImportV1>;
};

export function mobileStaticProjectIndexResult(
  result: ProjectIndexQueryResultV1,
): ProjectIndexQueryResultV1 {
  return {
    ...result,
    summary: "",
    entities: result.entities.filter((entity) => entity.provenance !== "llm"),
    callsites: result.callsites.filter((callsite) => callsite.provenance !== "llm"),
    modules: result.modules.filter(
      (module) => module.provenance !== "llm" && module.analysis === undefined,
    ),
    behaviors: [],
    flows: [],
    rules: result.rules.filter((rule) => rule.source === "explicit" && rule.provenance !== "llm"),
    evidence: result.evidence.filter((evidence) => evidence.provenance !== "llm"),
    gaps: result.gaps.filter(
      (gap) => gap.kind !== "provider-error" && gap.kind !== "incomplete-analysis",
    ),
  };
}

export function mobileProjectIndexFacts(result: StaticFactInput) {
  const packages = result.modules.filter(
    (module) => module.provenance !== "llm" && module.analysis === undefined,
  );
  const imports = (result.imports ?? []).filter((record) => record.provenance !== "llm");
  const rules = result.rules.filter(
    (rule) => rule.source === "explicit" && rule.provenance !== "llm",
  );
  const sources = result.evidence.filter((evidence) => evidence.provenance !== "llm");

  return {
    packages: packages.slice(0, MAX_VISIBLE_FACTS_PER_KIND),
    imports: imports.slice(0, MAX_VISIBLE_FACTS_PER_KIND),
    rules: rules.slice(0, MAX_VISIBLE_FACTS_PER_KIND),
    sources: sources.slice(0, MAX_VISIBLE_FACTS_PER_KIND),
    omitted:
      Math.max(0, packages.length - MAX_VISIBLE_FACTS_PER_KIND) +
      Math.max(0, imports.length - MAX_VISIBLE_FACTS_PER_KIND) +
      Math.max(0, rules.length - MAX_VISIBLE_FACTS_PER_KIND) +
      Math.max(0, sources.length - MAX_VISIBLE_FACTS_PER_KIND),
  };
}
