import {
  VISUALIZATION_CHANNEL,
  buildVisualizationActionPrompt,
  isExperimentalVisualization,
  parseVisualization,
  visualizationDataToCsv,
  type VisualizationAction,
  type VisualizationDocument,
  type VisualizationDataset,
  type VisualizationFormat,
} from "@t3tools/client-runtime/visualizations/model";
import { visualizationLabels } from "@t3tools/client-runtime/visualizations/labels";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CodeIcon,
  CopyIcon,
  Maximize2Icon,
  MoveIcon,
  ScanIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useInterfaceLanguage } from "~/interfaceLanguageSync";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";
import { downloadMedia, readMediaPng } from "../media/mediaContent";
import {
  createRenderRequest,
  nextVisualizationRequestId,
  loadVisualizationFrame,
  renderInFrame,
  renderVisualizationPreview,
  requestVisualizationFrame,
} from "./renderer";

type Labels = ReturnType<typeof visualizationLabels>;
type Theme = "light" | "dark";

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    await downloadMedia(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function DiagramDetails({ document, labels }: { document: VisualizationDocument; labels: Labels }) {
  const { metadata, datasets } = document;
  const isData = document.format === "vega" || document.format === "vega-lite";
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      {metadata.summary && <p className="text-sm text-foreground">{metadata.summary}</p>}
      {isData && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            {metadata.sources.length
              ? `${labels.sources}: ${metadata.sources.join(" · ")}`
              : labels.noSource}
          </span>
          {metadata.asOf && (
            <span>
              {labels.asOf}: {metadata.asOf}
            </span>
          )}
          {metadata.kind && <span>{labels[metadata.kind]}</span>}
        </div>
      )}
      {metadata.limitations.length > 0 && (
        <p>
          {labels.limitations}: {metadata.limitations.join(" · ")}
        </p>
      )}
      {datasets.map((dataset, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- Inline datasets may repeat names; their order is fixed within this document.
        <SourceDataTable key={`${dataset.name}:${index}`} dataset={dataset} labels={labels} />
      ))}
    </div>
  );
}

const DATA_PAGE_SIZE = 100;

function SourceDataTable({ dataset, labels }: { dataset: VisualizationDataset; labels: Labels }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string>();
  const start = page * DATA_PAGE_SIZE;
  return (
    <details
      className="rounded-md border border-border"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-3 py-2 text-foreground focus-visible:outline-ring">
        {labels.sourceData} · {dataset.name} ({dataset.rows.length})
      </summary>
      {expanded && (
        <>
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
            <Button
              size="compact"
              variant="outline"
              onClick={() => {
                void saveBlob(
                  new Blob([visualizationDataToCsv(dataset)], { type: "text/csv;charset=utf-8" }),
                  "diagram-data.csv",
                ).catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : labels.exportFailed),
                );
              }}
            >
              {labels.exportCsv}
            </Button>
            {dataset.rows.length > DATA_PAGE_SIZE && (
              <>
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  {labels.previous}
                </Button>
                <span>
                  {start + 1}–{Math.min(start + DATA_PAGE_SIZE, dataset.rows.length)} /{" "}
                  {dataset.rows.length}
                </span>
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={start + DATA_PAGE_SIZE >= dataset.rows.length}
                  onClick={() => setPage(page + 1)}
                >
                  {labels.next}
                </Button>
              </>
            )}
          </div>
          {error && (
            <p role="alert" className="px-3 pb-2 text-destructive">
              {error}
            </p>
          )}
          <div
            className="max-h-64 overflow-auto"
            tabIndex={0}
            role="region"
            aria-label={labels.sourceData}
          >
            <table className="w-full border-collapse text-left text-xs">
              <caption className="sr-only">
                {labels.sourceData}: {dataset.name}
              </caption>
              <thead className="sticky top-0 bg-muted text-foreground">
                <tr>
                  {dataset.columns.map((column) => (
                    <th
                      scope="col"
                      className="border-t border-border px-3 py-2 font-medium"
                      key={column}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataset.rows.slice(start, start + DATA_PAGE_SIZE).map((row, index) => (
                  // oxlint-disable-next-line react/no-array-index-key -- Source row numbers remain stable within this immutable document, including duplicate rows.
                  <tr key={start + index}>
                    {dataset.columns.map((column) => (
                      <td className="border-t border-border px-3 py-1.5 font-mono" key={column}>
                        {row[column] == null
                          ? "—"
                          : typeof row[column] === "object"
                            ? JSON.stringify(row[column])
                            : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}

function FollowUpActions({
  labels,
  onAction,
}: {
  labels: Labels;
  onAction?: ((action: VisualizationAction) => void) | undefined;
}) {
  if (!onAction) return null;
  const groups = [
    {
      label: labels.learning,
      actions: [
        ["simpler", labels.simpler],
        ["step-by-step", labels.stepByStep],
        ["check-understanding", labels.checkUnderstanding],
      ],
    },
    {
      label: labels.analysis,
      actions: [
        ["break-down", labels.breakDown],
        ["compare-periods", labels.comparePeriods],
        ["explain-assumptions", labels.explainAssumptions],
      ],
    },
  ] as const;
  return (
    <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label}>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
          <div className="flex flex-wrap gap-1">
            {group.actions.map(([action, label]) => (
              <Button key={action} variant="ghost" size="compact" onClick={() => onAction(action)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FullscreenDiagram({
  document,
  theme,
  labels,
  onAction,
}: {
  document: VisualizationDocument;
  theme: Theme;
  labels: Labels;
  onAction?: ((action: VisualizationAction, error?: string) => void) | undefined;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [pan, setPan] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const target = frame.current;
    if (!target) return;
    void loadVisualizationFrame(target, document.format, controller.signal)
      .then(() =>
        renderInFrame(
          target,
          createRenderRequest(document.format, document.source, theme, true),
          controller.signal,
        ),
      )
      .then(() => {
        if (!controller.signal.aborted) setReady(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : labels.renderFailed);
      });
    return () => controller.abort();
  }, [document, theme, labels.renderFailed]);

  const view = (action: "zoom-in" | "zoom-out" | "fit" | "pan" | "select") => {
    frame.current?.contentWindow?.postMessage(
      {
        channel: VISUALIZATION_CHANNEL,
        type: "view",
        requestId: nextVisualizationRequestId(),
        action,
      },
      "*",
    );
  };
  const exportImage = async (format: "svg" | "png") => {
    const target = frame.current;
    const signal = lifetime.current?.signal;
    if (!target || !signal) return;
    try {
      const response = await requestVisualizationFrame(
        target,
        {
          channel: VISUALIZATION_CHANNEL,
          type: format === "svg" ? "export-svg" : "export-png",
          requestId: nextVisualizationRequestId(),
        },
        signal,
      );
      if (response.type === "result")
        await saveBlob(new Blob([response.svg], { type: "image/svg+xml" }), "diagram.svg");
      else if (response.type === "png") await downloadMedia(response.dataUrl, "diagram.png");
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : labels.exportFailed);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={labels.title}>
        <Button
          variant="ghost"
          size="compact"
          aria-label={labels.copySource}
          onClick={() => {
            void writeTextToClipboard(document.source, "diagram source")
              .then((copied) => {
                if (!copied) setError(labels.copyFailed);
              })
              .catch(() => setError(labels.copyFailed));
          }}
        >
          <CopyIcon />
        </Button>
        <Button
          variant="outline"
          size="compact"
          disabled={!ready}
          aria-label={labels.zoomOut}
          onClick={() => view("zoom-out")}
        >
          <ZoomOutIcon />
        </Button>
        <Button
          variant="outline"
          size="compact"
          disabled={!ready}
          aria-label={labels.zoomIn}
          onClick={() => view("zoom-in")}
        >
          <ZoomInIcon />
        </Button>
        <Button variant="outline" size="compact" disabled={!ready} onClick={() => view("fit")}>
          <ScanIcon />
          {labels.fit}
        </Button>
        <Button
          variant="outline"
          size="compact"
          disabled={!ready}
          aria-pressed={pan}
          onClick={() => {
            setPan(!pan);
            view(pan ? "select" : "pan");
          }}
        >
          <MoveIcon />
          {labels.panHint}
        </Button>
        <Button
          variant="ghost"
          size="compact"
          disabled={!ready}
          onClick={() => void exportImage("svg")}
        >
          {labels.exportSvg}
        </Button>
        <Button
          variant="ghost"
          size="compact"
          disabled={!ready}
          onClick={() => void exportImage("png")}
        >
          {labels.exportPng}
        </Button>
      </div>
      {!ready && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          {labels.loading}
        </p>
      )}
      {error && (
        <div role="alert" className="text-sm text-destructive">
          {labels.renderFailed}: {error}
          {onAction && (
            <Button variant="outline" size="compact" onClick={() => onAction("fix", error)}>
              {labels.fix}
            </Button>
          )}
        </div>
      )}
      <iframe
        ref={frame}
        title={document.metadata.summary || labels.interactive}
        sandbox="allow-scripts"
        className="min-h-64 w-full flex-1 rounded-md border border-border bg-background"
      />
      <div className="max-h-[30vh] space-y-3 overflow-auto">
        <DiagramDetails document={document} labels={labels} />
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {labels.source}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
            <code>{document.source}</code>
          </pre>
        </details>
        <FollowUpActions labels={labels} onAction={onAction} />
      </div>
    </div>
  );
}

function VisualizationContent({
  format,
  source,
  theme,
  onAction,
}: {
  format: VisualizationFormat;
  source: string;
  theme: Theme;
  onAction?: ((prompt: string) => void) | undefined;
}) {
  const { language } = useInterfaceLanguage();
  const locale = language === "de" ? "de" : "en";
  const labels = visualizationLabels(locale);
  const parsed = useMemo(() => {
    try {
      return { document: parseVisualization(format, source) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Invalid diagram." };
    }
  }, [format, source]);
  const [render, setRender] = useState<{ svg?: string; url?: string; error?: string }>({});
  const [open, setOpen] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [notice, setNotice] = useState<string>();
  const svgUrl = render.url;
  useEffect(() => {
    if (!parsed.document) return;
    const controller = new AbortController();
    let previewUrl: string | undefined;
    void renderVisualizationPreview(createRenderRequest(format, source, theme), controller.signal)
      .then((svg) => {
        if (!controller.signal.aborted) {
          previewUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          setRender({ svg, url: previewUrl });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setRender({ error: cause instanceof Error ? cause.message : labels.renderFailed });
      });
    return () => {
      controller.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [parsed, format, source, theme, labels.renderFailed]);
  const error = parsed.error || render.error;
  const ask = onAction
    ? (action: VisualizationAction, renderError?: string) => {
        onAction(
          buildVisualizationActionPrompt({
            action,
            format,
            source,
            locale,
            ...(renderError ? { error: renderError } : {}),
          }),
        );
        setOpen(false);
      }
    : undefined;
  const exportPreview = async (type: "svg" | "png") => {
    if (!svgUrl) return;
    try {
      if (type === "svg") await downloadMedia(svgUrl, "diagram.svg");
      else await saveBlob(await readMediaPng(svgUrl), "diagram.png");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : labels.exportFailed);
    }
  };
  return (
    <section
      className="not-prose my-3 overflow-hidden rounded-lg border border-border bg-background text-foreground"
      aria-label={labels.title}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/40 px-3 py-2">
        <span className="mr-auto text-xs font-medium">
          {labels.title} <span className="font-mono text-muted-foreground">· {format}</span>
        </span>
        {isExperimentalVisualization(format, source) && (
          <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            {labels.experimental}
          </span>
        )}
        <Button
          variant="ghost"
          size="compact"
          aria-pressed={showSource}
          onClick={() => setShowSource(!showSource)}
        >
          <CodeIcon />
          {labels.source}
        </Button>
        <Button
          variant="ghost"
          size="compact"
          aria-label={labels.copySource}
          onClick={() => {
            void writeTextToClipboard(source, "diagram source")
              .then((copied) => setNotice(copied ? labels.copied : labels.copyFailed))
              .catch(() => setNotice(labels.copyFailed));
          }}
        >
          <CopyIcon />
        </Button>
        <Button variant="ghost" size="compact" disabled={!render.svg} onClick={() => setOpen(true)}>
          <Maximize2Icon />
          {labels.fullscreen}
        </Button>
      </div>
      <div className="space-y-3 p-3">
        {error ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-destructive">
              {labels.renderFailed}: {error}
            </p>
            {ask && (
              <Button size="compact" variant="outline" onClick={() => ask("fix", error)}>
                {labels.fix}
              </Button>
            )}
          </div>
        ) : svgUrl ? (
          <img
            src={svgUrl}
            alt={parsed.document?.metadata.summary || `${labels.title} (${format})`}
            className="mx-auto max-h-96 max-w-full"
          />
        ) : (
          <p role="status" className="py-6 text-center text-sm text-muted-foreground">
            {labels.loading}
          </p>
        )}
        {(showSource || error) && (
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
            <code>{source}</code>
          </pre>
        )}
        {render.svg && (
          <div className="flex gap-1">
            <Button size="compact" variant="ghost" onClick={() => void exportPreview("svg")}>
              {labels.exportSvg}
            </Button>
            <Button size="compact" variant="ghost" onClick={() => void exportPreview("png")}>
              {labels.exportPng}
            </Button>
          </div>
        )}
        {notice && (
          <p role="status" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        {parsed.document && <DiagramDetails document={parsed.document} labels={labels} />}
        <FollowUpActions labels={labels} onAction={ask} />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup
          className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-3 p-4"
          bottomStickOnMobile={false}
          showCloseButton={false}
        >
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-base">
              {labels.title} · {format}
            </DialogTitle>
            <DialogClose render={<Button variant="outline" size="compact" />}>
              {labels.close}
            </DialogClose>
          </div>
          <DialogDescription className="sr-only">
            {parsed.document?.metadata.summary || labels.interactive}
          </DialogDescription>
          {open && parsed.document && (
            <FullscreenDiagram
              document={parsed.document}
              theme={theme}
              labels={labels}
              onAction={ask}
            />
          )}
        </DialogPopup>
      </Dialog>
    </section>
  );
}

export function VisualizationBlock(props: Parameters<typeof VisualizationContent>[0]) {
  return (
    <VisualizationContent
      key={JSON.stringify([props.format, props.source, props.theme])}
      {...props}
    />
  );
}
