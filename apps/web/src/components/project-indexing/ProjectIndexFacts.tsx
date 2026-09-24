import type { ProjectIndexQueryResultV1 } from "@t3tools/contracts";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { isSourceDerivedFact } from "./isSourceDerivedFact";
import { ProjectIndexSourceLink } from "./ProjectIndexSourceLink";

const FACT_LIMIT = 24;
const PACKAGE_LINK_LIMIT = 6;

export function ProjectIndexFacts({
  result,
  onOpenSource,
}: {
  readonly result: Pick<ProjectIndexQueryResultV1, "modules" | "imports" | "rules" | "evidence">;
  readonly onOpenSource: (path: string, line: number | null) => void;
}) {
  const { message } = useInterfaceTranslator();
  const packages = result.modules.filter(isSourceDerivedFact);
  const imports = (result.imports ?? []).filter(isSourceDerivedFact);
  const rules = result.rules.filter(
    (rule) => rule.source === "explicit" && rule.provenance !== "llm",
  );
  const packageById = new Map(packages.map((entry) => [entry.id, entry]));
  const evidenceById = new Map(
    result.evidence.filter((entry) => entry.provenance !== "llm").map((entry) => [entry.id, entry]),
  );

  if (packages.length === 0 && imports.length === 0 && rules.length === 0) return null;

  return (
    <section className="space-y-4" aria-label={message("projectIndexing.indexDetails")}>
      {packages.length > 0 ? (
        <section className="space-y-2" aria-label={message("projectIndexing.staticPackages")}>
          <h4 className="text-xs font-medium">{message("projectIndexing.staticPackages")}</h4>
          <ul className="space-y-2">
            {packages.slice(0, FACT_LIMIT).map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border/60 p-3 text-xs">
                <p className="font-medium">{entry.name}</p>
                {entry.filePaths.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {entry.filePaths.slice(0, PACKAGE_LINK_LIMIT).map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="break-all font-mono text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => onOpenSource(path, null)}
                      >
                        {path}
                      </button>
                    ))}
                    {entry.filePaths.length > PACKAGE_LINK_LIMIT ? (
                      <span className="text-muted-foreground">
                        {message("projectIndexing.detailTruncated")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {entry.dependsOnModuleIds.length > 0 ? (
                  <p className="mt-2 text-muted-foreground">
                    {message("projectIndexing.staticDependencies")}:{" "}
                    {entry.dependsOnModuleIds
                      .slice(0, PACKAGE_LINK_LIMIT)
                      .map((id) => packageById.get(id)?.name ?? id)
                      .join(", ")}
                    {entry.dependsOnModuleIds.length > PACKAGE_LINK_LIMIT
                      ? ` · ${message("projectIndexing.detailTruncated")}`
                      : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {packages.length > FACT_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              {message("projectIndexing.detailTruncated")}
            </p>
          ) : null}
        </section>
      ) : null}
      {imports.length > 0 ? (
        <section className="space-y-2" aria-label={message("projectIndexing.staticDependencies")}>
          <h4 className="text-xs font-medium">{message("projectIndexing.staticDependencies")}</h4>
          <ul className="max-h-72 divide-y divide-border/50 overflow-auto rounded-lg border border-border/60 text-xs">
            {imports.slice(0, FACT_LIMIT).map((entry) => (
              <li key={entry.id} className="space-y-1 p-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <code className="break-all">{entry.specifier}</code>
                  <span className="text-muted-foreground">
                    {message(`projectIndexing.importResolution.${entry.resolution}`)}
                  </span>
                </div>
                {entry.targetPath ? (
                  <button
                    type="button"
                    className="break-all font-mono text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => {
                      if (entry.targetPath) onOpenSource(entry.targetPath, null);
                    }}
                  >
                    {entry.targetPath}
                  </button>
                ) : entry.packageName ? (
                  <p className="text-muted-foreground">{entry.packageName}</p>
                ) : null}
                <ProjectIndexSourceLink
                  path={entry.filePath}
                  range={entry.range}
                  onOpenSource={onOpenSource}
                />
              </li>
            ))}
          </ul>
          {imports.length > FACT_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              {message("projectIndexing.detailTruncated")}
            </p>
          ) : null}
        </section>
      ) : null}
      {rules.length > 0 ? (
        <section className="space-y-2" aria-label={message("projectIndexing.staticRules")}>
          <h4 className="text-xs font-medium">{message("projectIndexing.staticRules")}</h4>
          <ul className="space-y-2">
            {rules.slice(0, FACT_LIMIT).map((rule) => (
              <li
                key={rule.id}
                className="space-y-1 rounded-lg border border-border/60 p-3 text-xs"
              >
                <p className="font-medium">{rule.name}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{rule.description}</p>
                {rule.evidenceIds.flatMap((id) => {
                  const source = evidenceById.get(id);
                  return source
                    ? [
                        <ProjectIndexSourceLink
                          key={source.id}
                          path={source.filePath}
                          range={source.range}
                          onOpenSource={onOpenSource}
                        />,
                      ]
                    : [];
                })}
              </li>
            ))}
          </ul>
          {rules.length > FACT_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              {message("projectIndexing.detailTruncated")}
            </p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
