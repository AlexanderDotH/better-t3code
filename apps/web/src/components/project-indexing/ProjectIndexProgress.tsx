import type { ProjectIndexStatusV1 } from "@t3tools/contracts";
import { deriveProjectIndexStage } from "@t3tools/client-runtime/project-indexing";
import { TriangleAlertIcon } from "lucide-react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import "./ProjectIndexProgress.css";

const VISIBLE_GAPS = 12;

export function ProjectIndexProgress({ status }: { readonly status: ProjectIndexStatusV1 }) {
  const { message, number, date } = useInterfaceTranslator();
  const { coverage } = status;
  const stage = deriveProjectIndexStage(status);
  const filePhase = stage === "discovering" || stage === "extracting";
  const progressLabel =
    stage === "resolving"
      ? message("projectIndexing.resolutionProgress", {
          resolved: number(coverage.resolvedCallsites),
          candidates: number(coverage.candidateCallsites),
        })
      : filePhase
        ? status.state === "discovering"
          ? message("projectIndexing.discoveredProgress", {
              count: number(coverage.discoveredFiles),
            })
          : message("projectIndexing.chatFileProgress", {
              indexed: number(coverage.indexedFiles),
              eligible: number(coverage.eligibleFiles),
            })
        : coverage.totalImports === undefined
          ? message("projectIndexing.indexSummary", {
              files: number(coverage.indexedFiles),
              entities: number(coverage.totalEntities),
            })
          : message("projectIndexing.staticFacts", {
              files: number(coverage.indexedFiles),
              symbols: number(coverage.totalEntities),
              imports: number(coverage.totalImports),
              calls: number(coverage.totalCallsites),
            });
  const progress =
    filePhase && status.state !== "discovering" && coverage.eligibleFiles > 0
      ? {
          value: Math.min(coverage.indexedFiles, coverage.eligibleFiles),
          max: coverage.eligibleFiles,
        }
      : null;
  const percentage = progress
    ? number(progress.value / progress.max, { style: "percent", maximumFractionDigits: 0 })
    : null;
  const failed = status.state === "failed";
  const error = status.lastError ?? status.job?.lastError;
  const reportedIssue = status.gaps.find((gap) => gap.id !== "runtime:additional-gaps");

  return (
    <div className="space-y-3">
      <div
        className={
          failed
            ? "rounded-lg border border-destructive/35 bg-destructive/5 p-3"
            : "rounded-lg border border-border/60 bg-muted/20 p-3"
        }
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p
            role={failed && !error ? "alert" : "status"}
            aria-live={failed && !error ? "assertive" : "polite"}
            className="flex items-center gap-2 text-sm font-medium"
          >
            {failed ? <TriangleAlertIcon aria-hidden className="size-4 text-destructive" /> : null}
            {message(`projectIndexing.state.${stage}`)}
          </p>
          <time dateTime={status.updatedAt} className="text-xs text-muted-foreground">
            {message("projectIndexing.updatedAt", {
              time: date(new Date(status.updatedAt), { timeStyle: "short" }),
            })}
          </time>
        </div>
        {failed ? (
          <p className="mt-2 text-xs leading-relaxed text-foreground/80">
            {message("projectIndexing.failedSummary")}
          </p>
        ) : null}
        <div className="mt-2 flex items-baseline justify-between gap-4 text-xs">
          <p className="text-muted-foreground">{progressLabel}</p>
          {percentage ? (
            <span aria-hidden className="shrink-0 font-medium tabular-nums text-foreground/80">
              {percentage}
            </span>
          ) : null}
        </div>
        {progress ? (
          <progress
            aria-label={message("projectIndexing.files")}
            aria-valuetext={`${progressLabel} · ${percentage}`}
            value={progress.value}
            max={progress.max}
            className="project-index-progress mt-2.5 block h-1.5 w-full overflow-hidden rounded-full"
          />
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 break-words text-xs leading-relaxed text-destructive">
            {error}
          </p>
        ) : failed && reportedIssue ? (
          <p className="mt-2 line-clamp-2 break-words text-xs leading-relaxed text-foreground/80">
            <span className="font-medium">{message("projectIndexing.reportedIssue")}:</span>{" "}
            {reportedIssue.message}
          </p>
        ) : null}
      </div>
      {!status.settings.enabled ? (
        <p className="text-sm text-muted-foreground">{message("projectIndexing.disabledHint")}</p>
      ) : coverage.totalEntities === 0 && status.state === "idle" ? (
        <p className="text-sm text-muted-foreground">{message("projectIndexing.noIndex")}</p>
      ) : null}
    </div>
  );
}

export function ProjectIndexDiagnostics({ status }: { readonly status: ProjectIndexStatusV1 }) {
  const { message, number } = useInterfaceTranslator();
  const { coverage } = status;
  const issueCount = `${number(status.gaps.length)}${status.gaps.some((gap) => gap.id === "runtime:additional-gaps") ? "+" : ""}`;
  return (
    <details className="rounded-lg border border-border/60 px-3 py-2 text-xs">
      <summary className="cursor-pointer py-0.5 text-foreground/80 focus-visible:outline-2 focus-visible:outline-ring">
        {message("projectIndexing.indexDetails")}
        {status.gaps.length > 0
          ? ` · ${message("projectIndexing.reportedIssues", { count: issueCount })}`
          : ""}
      </summary>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{message("projectIndexing.files")}</dt>
          <dd className="font-medium tabular-nums">
            {number(coverage.indexedFiles)} / {number(coverage.eligibleFiles)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{message("projectIndexing.entities")}</dt>
          <dd className="font-medium tabular-nums">{number(coverage.totalEntities)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{message("projectIndexing.callsites")}</dt>
          <dd className="font-medium tabular-nums">{number(coverage.totalCallsites)}</dd>
        </div>
        {coverage.totalImports !== undefined ? (
          <div>
            <dt className="text-muted-foreground">{message("projectIndexing.imports")}</dt>
            <dd className="font-medium tabular-nums">{number(coverage.totalImports)}</dd>
          </div>
        ) : null}
      </dl>
      {coverage.totalImports !== undefined && coverage.resolvedImports !== undefined ? (
        <p className="mt-3 text-muted-foreground">
          {message("projectIndexing.resolvedImports", {
            resolved: number(coverage.resolvedImports),
            total: number(coverage.totalImports),
          })}
        </p>
      ) : null}
      <p className="mt-3 leading-relaxed text-muted-foreground">
        {message("projectIndexing.callsiteCoverage", {
          resolved: number(coverage.resolvedCallsites),
          candidate: number(coverage.candidateCallsites),
          unresolved: number(coverage.unresolvedCallsites),
        })}
        {coverage.skippedFiles > 0 || coverage.failedFiles > 0 ? (
          <>
            {" "}
            {message("projectIndexing.fileGaps", {
              skipped: number(coverage.skippedFiles),
              failed: number(coverage.failedFiles),
            })}
          </>
        ) : null}
      </p>
      {status.gaps.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-border/60 pt-3">
          {status.gaps.slice(0, VISIBLE_GAPS).map((gap) => (
            <li key={gap.id} className="break-words leading-relaxed text-muted-foreground">
              {gap.filePath ? <code className="me-1 font-mono">{gap.filePath}</code> : null}
              {gap.message}
            </li>
          ))}
        </ul>
      ) : null}
      {status.gaps.length > VISIBLE_GAPS ? (
        <p className="mt-2 text-muted-foreground">
          {message("projectIndexing.moreGaps", { count: status.gaps.length - VISIBLE_GAPS })}
        </p>
      ) : null}
    </details>
  );
}
