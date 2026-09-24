import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useEnvironmentQuery } from "../../state/query";
import { getProjectFileQueryAtom } from "../files/projectFilesQueryState";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";

const SOURCE_CONTEXT_LINES = 80;
const SOURCE_LEADING_LINES = 20;

export function ProjectIndexSourceDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly workspaceRoot: string;
  readonly path: string;
  readonly line: number | null;
  readonly onClose: () => void;
}) {
  const { message, number } = useInterfaceTranslator();
  const file = useEnvironmentQuery(
    getProjectFileQueryAtom(props.environmentId, props.workspaceRoot, props.path),
  );
  const [pageStart, setPageStart] = useState<number | null>(null);
  const lines = file.data?.contents.split(/\r?\n/) ?? [];
  const initialStart = Math.max(
    0,
    Math.min((props.line ?? 1) - 1 - SOURCE_LEADING_LINES, lines.length - SOURCE_CONTEXT_LINES),
  );
  const start = pageStart ?? initialStart;
  const visibleLines = lines.slice(start, start + SOURCE_CONTEXT_LINES);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-4xl overflow-hidden">
        <DialogHeader className="pe-12">
          <DialogTitle className="break-all font-mono text-sm">
            {props.path}
            {props.line ? `:${props.line}` : ""}
          </DialogTitle>
          <DialogDescription>
            {props.environmentLabel} · {props.workspaceRoot}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-6">
          {file.error ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {file.error}
            </p>
          ) : null}
          {!file.data && !file.error ? (
            <p role="status" className="text-sm text-muted-foreground">
              {message("common.loading")}
            </p>
          ) : null}
          {file.data ? (
            <>
              {file.data.truncated ? (
                <p className="text-xs text-warning-foreground">
                  {message("projectIndexing.sourceTruncated")}
                </p>
              ) : null}
              <pre className="max-h-[60dvh] overflow-auto rounded-lg border border-border/60 bg-muted/35 py-2 text-xs leading-5">
                <code>
                  {visibleLines.map((text, index) => {
                    const line = start + index + 1;
                    return (
                      <span
                        key={line}
                        className={line === props.line ? "block bg-primary/10 pe-4" : "block pe-4"}
                      >
                        <span
                          aria-hidden
                          className="me-3 inline-block min-w-12 ps-3 text-right text-muted-foreground select-none"
                        >
                          {line}
                        </span>
                        {text || " "}
                      </span>
                    );
                  })}
                </code>
              </pre>
              <div className="flex flex-wrap items-center gap-2">
                <span className="me-auto text-xs text-muted-foreground tabular-nums">
                  {number(start + 1)}–{number(start + visibleLines.length)} / {number(lines.length)}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={start === 0}
                  onClick={() => setPageStart(0)}
                >
                  {message("projectIndexing.firstPage")}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={start + SOURCE_CONTEXT_LINES >= lines.length}
                  onClick={() => setPageStart(start + SOURCE_CONTEXT_LINES)}
                >
                  {message("projectIndexing.nextPage")}
                </Button>
              </div>
            </>
          ) : null}
          {file.error ? (
            <Button size="xs" variant="outline" onClick={file.refresh}>
              {message("projectIndexing.retry")}
            </Button>
          ) : null}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
