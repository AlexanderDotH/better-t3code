import type {
  ProjectIndexReviewResultV1,
  ProjectIndexReviewSelection,
  ProjectIndexScopeInput,
} from "@t3tools/contracts";
import type { ProjectIndexClientApi } from "@t3tools/client-runtime/project-indexing";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ProjectIndexSourceLink } from "./ProjectIndexSourceLink";
import { ProjectIndexUsage } from "./ProjectIndexUsage";

export function ProjectIndexReview({
  api,
  scope,
  disabled,
  modelControl,
  modelStatus,
  onOpenSource,
}: {
  readonly api: Pick<ProjectIndexClientApi, "review">;
  readonly scope: ProjectIndexScopeInput;
  readonly disabled: boolean;
  readonly modelControl?: ReactNode;
  readonly modelStatus?: string | null;
  readonly onOpenSource: (path: string, line: number | null) => void;
}) {
  const { message } = useInterfaceTranslator();
  const [selection, setSelection] = useState<ProjectIndexReviewSelection>("workingtree");
  const [result, setResult] = useState<ProjectIndexReviewResultV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);
  useEffect(
    () => () => {
      requestGeneration.current += 1;
    },
    [],
  );

  async function review() {
    if (disabled || busy || !api.review) return;
    const generation = ++requestGeneration.current;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const next = await api.review({ ...scope, selection });
      if (generation === requestGeneration.current) setResult(next);
    } catch (failure) {
      if (generation === requestGeneration.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  return (
    <section
      className="space-y-3"
      aria-label={message("projectIndexing.reviewEnabled")}
      aria-busy={busy}
    >
      <p className="text-xs text-muted-foreground">
        {message("projectIndexing.reviewDescription")}
      </p>
      {modelControl ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">{message("projectIndexing.reviewModel")}</p>
          <p className="text-xs text-muted-foreground">
            {message("projectIndexing.reviewModelDescription")}
          </p>
          {modelControl}
          {modelStatus ? <p className="text-xs text-warning-foreground">{modelStatus}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Select
          value={selection}
          disabled={busy}
          onValueChange={(value) => {
            if (value === "workingtree" || value === "staged") setSelection(value);
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-52"
            aria-label={message("projectIndexing.reviewScope")}
          >
            <SelectValue>{message(`projectIndexing.reviewScope.${selection}`)}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="workingtree">
              {message("projectIndexing.reviewScope.workingtree")}
            </SelectItem>
            <SelectItem value="staged">{message("projectIndexing.reviewScope.staged")}</SelectItem>
          </SelectPopup>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || busy || !api.review}
          onClick={() => void review()}
        >
          {message(busy ? "projectIndexing.reviewing" : "projectIndexing.reviewChanges")}
        </Button>
      </div>
      {!api.review ? (
        <p className="text-xs text-muted-foreground">
          {message("projectIndexing.reviewUnavailable")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="space-y-3 rounded-lg border border-border/60 p-3">
          <p role="status" className="text-sm">
            {result.summary}
          </p>
          <p className="text-xs text-muted-foreground">
            {message(`projectIndexing.reviewScope.${result.selection}`)} ·{" "}
            {result.modelSelection.instanceId} · {result.modelSelection.model}
          </p>
          {result.findings.length === 0 && result.state === "completed" ? (
            <p className="text-xs text-muted-foreground">
              {message("projectIndexing.noReviewFindings")}
            </p>
          ) : null}
          <ul className="space-y-3">
            {result.findings.map((finding) => (
              <li key={finding.id} className="space-y-1 rounded-md bg-muted/35 p-3">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {message(`projectIndexing.severity.${finding.severity}`)} ·{" "}
                  {message(`projectIndexing.reviewCategory.${finding.category}`)}
                </p>
                <p className="text-sm leading-relaxed">{finding.message}</p>
                {finding.sourceSide ? (
                  <p className="text-[11px] text-muted-foreground">
                    {message(`projectIndexing.reviewSource.${finding.sourceSide}`)}
                  </p>
                ) : null}
                {finding.sourceSide === "before" ? (
                  <code className="block break-all text-xs text-muted-foreground">
                    {finding.filePath}:{finding.range.startLine}:{finding.range.startColumn}
                  </code>
                ) : (
                  <ProjectIndexSourceLink
                    path={finding.filePath}
                    range={finding.range}
                    onOpenSource={onOpenSource}
                  />
                )}
                {finding.diffExcerpt ? (
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">
                      {message("projectIndexing.reviewSource.excerpt")}
                    </p>
                    <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">
                      {finding.diffExcerpt}
                    </pre>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {result.gaps.length > 0 ? (
            <ul className="space-y-1 text-xs text-warning-foreground">
              {result.gaps.map((gap) => (
                <li key={gap.id}>{gap.message}</li>
              ))}
            </ul>
          ) : null}
          <ProjectIndexUsage usage={result.usage} />
        </div>
      ) : null}
    </section>
  );
}
