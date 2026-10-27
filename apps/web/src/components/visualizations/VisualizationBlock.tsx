import { ChatSizeMotion, ChatSizeMotionContext } from "../chat/ChatSizeMotion";
import { useChatVisualMode } from "../../chatVisualModeSync";
import {
  VISUALIZATION_CHANNEL,
  buildVisualizationActionPrompt,
  isExperimentalVisualization,
  parseVisualization,
  visualizationDataToCsv,
  type VisualizationAction,
  type VisualizationAppearance,
  type VisualizationDocument,
  type VisualizationDataset,
  type VisualizationFormat,
} from "@t3tools/client-runtime/visualizations/model";
import { visualizationLabels } from "@t3tools/client-runtime/visualizations/labels";
import { visualizationPreviewCacheKey } from "@t3tools/client-runtime/visualizations/appearance";
import { readVisualizationSvgDimensions } from "@t3tools/client-runtime/visualizations/sizing";
import { prepareVisualizationSvgExport } from "@t3tools/client-runtime/visualizations/export";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  Maximize2Icon,
  MoveIcon,
  ScanIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useInterfaceLanguage } from "~/interfaceLanguageSync";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { downloadMedia, readMediaPng } from "../media/mediaContent";
import {
  createRenderRequest,
  nextVisualizationRequestId,
  loadVisualizationFrame,
  renderInFrame,
  renderVisualizationPreview,
  requestVisualizationFrame,
} from "./renderer";
import {
  useVisualizationAppearance,
  VISUALIZATION_SURFACE_CLASS_NAME,
} from "./useVisualizationAppearance";

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

function reportExportFailure(cause: unknown, labels: Labels) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: labels.exportFailed,
      ...(cause instanceof Error ? { description: cause.message } : {}),
    }),
  );
}

async function copySource(source: string, labels: Labels) {
  try {
    const copied = await writeTextToClipboard(source, "diagram source");
    toastManager.add(
      copied
        ? { type: "success", title: labels.copied }
        : stackedThreadToast({ type: "error", title: labels.copyFailed }),
    );
  } catch {
    toastManager.add(stackedThreadToast({ type: "error", title: labels.copyFailed }));
  }
}

function hasDiagramDetails(document: VisualizationDocument) {
  return Boolean(
    document.metadata.summary ||
    document.format === "vega" ||
    document.format === "vega-lite" ||
    document.metadata.limitations.length ||
    document.datasets.length,
  );
}

function DiagramDetails({ document, labels }: { document: VisualizationDocument; labels: Labels }) {
  if (!hasDiagramDetails(document)) return null;
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
  const start = page * DATA_PAGE_SIZE;
  return (
    <ChatSizeMotion>
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
                  ).catch((cause: unknown) => reportExportFailure(cause, labels));
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
    </ChatSizeMotion>
  );
}

function DiagramIconButton({
  label,
  tooltip = label,
  children,
  disabled,
  pressed,
  onClick,
}: {
  label: string;
  tooltip?: string;
  children: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={pressed ? "secondary" : "ghost-muted"}
            size="icon-xs"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

function DiagramActionsMenu({
  source,
  showSource,
  sourceRequired = false,
  onSourceChange,
  canExport,
  onExport,
  labels,
}: {
  source: string;
  showSource: boolean;
  sourceRequired?: boolean;
  onSourceChange: (show: boolean) => void;
  canExport: boolean;
  onExport: (format: "svg" | "png") => void;
  labels: Labels;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={<Button variant="ghost-muted" size="icon-xs" aria-label={labels.actions} />}
            />
          }
        >
          <EllipsisIcon />
        </TooltipTrigger>
        <TooltipPopup>{labels.actions}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        <MenuItem disabled={sourceRequired} onClick={() => onSourceChange(!showSource)}>
          <CodeIcon />
          {showSource ? labels.hideSource : labels.showSource}
        </MenuItem>
        <MenuItem onClick={() => void copySource(source, labels)}>
          <CopyIcon />
          {labels.copySource}
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!canExport} onClick={() => onExport("svg")}>
          <DownloadIcon />
          {labels.exportSvg}
        </MenuItem>
        <MenuItem disabled={!canExport} onClick={() => onExport("png")}>
          <DownloadIcon />
          {labels.exportPng}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function DiagramSource({ source, labels }: { source: string; labels: Labels }) {
  return (
    <pre
      className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs focus-visible:outline-ring"
      tabIndex={0}
      role="region"
      aria-label={labels.source}
    >
      <code>{source}</code>
    </pre>
  );
}

function DiagramError({
  error,
  labels,
  onFix,
}: {
  error: string;
  labels: Labels;
  onFix?: (() => void) | undefined;
}) {
  return (
    <div role="alert" className="space-y-2">
      <p className="text-sm text-destructive">{labels.renderFailed}</p>
      <p className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{error}</p>
      {onFix && (
        <Button size="compact" variant="outline" onClick={onFix}>
          {labels.fix}
        </Button>
      )}
    </div>
  );
}

function FullscreenDiagram({
  document,
  theme,
  appearance,
  labels,
  onAction,
}: {
  document: VisualizationDocument;
  theme: Theme;
  appearance: VisualizationAppearance;
  labels: Labels;
  onAction?: ((action: VisualizationAction, error?: string) => void) | undefined;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const request = useMemo(
    () => createRenderRequest(document.format, document.source, theme, true, appearance),
    [document, theme, appearance],
  );
  const renderKey = useMemo(() => visualizationPreviewCacheKey(request), [request]);
  const [result, setResult] = useState<{ key: string; error?: string }>();
  const [panning, setPanning] = useState<{ key: string; enabled: boolean }>();
  const [showSource, setShowSource] = useState(false);
  const currentResult = result?.key === renderKey ? result : undefined;
  const error = currentResult?.error;
  const sourceVisible = showSource || Boolean(error);
  const ready = Boolean(currentResult && !error);
  const pan = panning?.key === renderKey && panning.enabled;

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const target = frame.current;
    if (!target) return () => controller.abort();
    void loadVisualizationFrame(target, document.format, controller.signal)
      .then(() => renderInFrame(target, request, controller.signal))
      .then(() => {
        if (!controller.signal.aborted) setResult({ key: renderKey });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: renderKey,
          error: cause instanceof Error ? cause.message : labels.renderFailed,
        });
      });
    return () => controller.abort();
  }, [document.format, request, renderKey, labels.renderFailed]);

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
    if (!ready || !target || !signal) return;
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
      if (!signal.aborted) reportExportFailure(cause, labels);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <DialogTitle size="sm">
          {labels.title}{" "}
          <span className="font-mono text-muted-foreground">· {document.format}</span>
        </DialogTitle>
        <div className="flex items-center gap-0.5" role="group" aria-label={labels.actions}>
          <DiagramIconButton
            label={labels.zoomOut}
            disabled={!ready}
            onClick={() => view("zoom-out")}
          >
            <ZoomOutIcon />
          </DiagramIconButton>
          <DiagramIconButton
            label={labels.zoomIn}
            disabled={!ready}
            onClick={() => view("zoom-in")}
          >
            <ZoomInIcon />
          </DiagramIconButton>
          <DiagramIconButton label={labels.fit} disabled={!ready} onClick={() => view("fit")}>
            <ScanIcon />
          </DiagramIconButton>
          <DiagramIconButton
            label={labels.pan}
            tooltip={labels.panHint}
            disabled={!ready}
            pressed={Boolean(pan)}
            onClick={() => {
              setPanning({ key: renderKey, enabled: !pan });
              view(pan ? "select" : "pan");
            }}
          >
            <MoveIcon />
          </DiagramIconButton>
          <DiagramActionsMenu
            source={document.source}
            showSource={sourceVisible}
            sourceRequired={Boolean(error)}
            onSourceChange={setShowSource}
            canExport={ready}
            onExport={(format) => void exportImage(format)}
            labels={labels}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <DialogClose
                  render={<Button variant="ghost-muted" size="icon-xs" aria-label={labels.close} />}
                />
              }
            >
              <XIcon />
            </TooltipTrigger>
            <TooltipPopup>{labels.close}</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      {!ready && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          {labels.loading}
        </p>
      )}
      {error && (
        <DiagramError
          error={error}
          labels={labels}
          onFix={onAction ? () => onAction("fix", error) : undefined}
        />
      )}
      <iframe
        ref={frame}
        title={document.metadata.summary || labels.interactive}
        sandbox="allow-scripts"
        className="min-h-64 w-full flex-1 rounded-md border border-border"
        style={{ backgroundColor: appearance.background }}
      />
      <ChatSizeMotion>
        {(sourceVisible || hasDiagramDetails(document)) && (
          <div className="max-h-[30vh] space-y-3 overflow-auto">
            {sourceVisible && <DiagramSource source={document.source} labels={labels} />}
            <DiagramDetails document={document} labels={labels} />
          </div>
        )}
      </ChatSizeMotion>
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
  const chatVisualMode = useChatVisualMode();
  const appearance = useVisualizationAppearance(
    theme,
    chatVisualMode === "better-t3" ? "better-t3" : undefined,
  );
  const parsed = useMemo(() => {
    try {
      return { document: parseVisualization(format, source) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Invalid diagram." };
    }
  }, [format, source]);
  const request = useMemo(
    () => createRenderRequest(format, source, theme, false, appearance),
    [format, source, theme, appearance],
  );
  const renderKey = useMemo(() => visualizationPreviewCacheKey(request), [request]);
  const [render, setRender] = useState<{
    key: string;
    svg?: string;
    url?: string;
    error?: string;
  }>();
  const [open, setOpen] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const currentRender = render?.key === renderKey ? render : undefined;
  const svgUrl = currentRender?.url;
  const dimensions = useMemo(
    () => (currentRender?.svg ? readVisualizationSvgDimensions(currentRender.svg) : null),
    [currentRender],
  );

  useEffect(() => {
    if (!parsed.document) return;
    const controller = new AbortController();
    let previewUrl: string | undefined;
    void renderVisualizationPreview(request, controller.signal)
      .then((svg) => {
        if (!controller.signal.aborted) {
          previewUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          setRender({ key: renderKey, svg, url: previewUrl });
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setRender({
          key: renderKey,
          error: cause instanceof Error ? cause.message : labels.renderFailed,
        });
      });
    return () => {
      controller.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [parsed, request, renderKey, labels.renderFailed]);

  const error = parsed.error || currentRender?.error;
  const sourceVisible = showSource || Boolean(error);
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
    if (!currentRender?.svg) return;
    let exportUrl: string | undefined;
    try {
      const svg = prepareVisualizationSvgExport(currentRender.svg, appearance.background);
      exportUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      if (type === "svg") await downloadMedia(exportUrl, "diagram.svg");
      else await saveBlob(await readMediaPng(exportUrl), "diagram.png");
    } catch (cause) {
      reportExportFailure(cause, labels);
    } finally {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
    }
  };

  return (
    <section
      data-visualization-format={format}
      className={
        (chatVisualMode === "better-t3"
          ? "better-chat-diagram"
          : VISUALIZATION_SURFACE_CLASS_NAME) +
        " my-[0.65rem] overflow-hidden rounded-lg text-foreground leading-snug"
      }
      aria-label={labels.title}
    >
      <ChatSizeMotion>
        <div className="chat-markdown-codeblock-header flex items-center justify-between gap-2 pt-1.5 pr-1.5 pl-3 select-none">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-2xs">
              {labels.title} · {format}
            </span>
            {isExperimentalVisualization(format, source) && (
              <span className="shrink-0 text-2xs text-muted-foreground">{labels.experimental}</span>
            )}
          </span>
          <div
            className="flex shrink-0 items-center gap-0.5"
            role="group"
            aria-label={labels.actions}
          >
            <DiagramIconButton
              label={labels.fullscreen}
              disabled={!currentRender?.svg}
              onClick={() => setOpen(true)}
            >
              <Maximize2Icon />
            </DiagramIconButton>
            <DiagramActionsMenu
              source={source}
              showSource={sourceVisible}
              sourceRequired={Boolean(error)}
              onSourceChange={setShowSource}
              canExport={Boolean(currentRender?.svg)}
              onExport={(type) => void exportPreview(type)}
              labels={labels}
            />
          </div>
        </div>
        <div className="space-y-3 p-3">
          {error ? (
            <DiagramError
              error={error}
              labels={labels}
              onFix={ask ? () => ask("fix", error) : undefined}
            />
          ) : svgUrl ? (
            dimensions ? (
              <div
                className="max-h-[384px] overflow-auto focus-visible:outline-ring"
                tabIndex={0}
                role="region"
                aria-label={labels.preview}
              >
                <div className="flex w-max min-w-full justify-center">
                  <img
                    src={svgUrl}
                    alt={parsed.document?.metadata.summary || labels.title + " (" + format + ")"}
                    width={dimensions.width}
                    height={dimensions.height}
                    style={{ width: dimensions.width, height: dimensions.height }}
                    className="block max-w-none shrink-0"
                  />
                </div>
              </div>
            ) : (
              <img
                src={svgUrl}
                alt={parsed.document?.metadata.summary || labels.title + " (" + format + ")"}
                className="mx-auto block max-h-96 max-w-full"
              />
            )
          ) : (
            <p role="status" className="py-6 text-center text-sm text-muted-foreground">
              {labels.loading}
            </p>
          )}
          {sourceVisible && <DiagramSource source={source} labels={labels} />}
          {parsed.document && <DiagramDetails document={parsed.document} labels={labels} />}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogPopup
            className="h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none"
            bottomStickOnMobile={false}
            showCloseButton={false}
          >
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <DialogDescription className="sr-only">
                {parsed.document?.metadata.summary || labels.interactive}
              </DialogDescription>
              {open && parsed.document && (
                <ChatSizeMotionContext value={false}>
                  <FullscreenDiagram
                    document={parsed.document}
                    theme={theme}
                    appearance={appearance}
                    labels={labels}
                    onAction={ask}
                  />
                </ChatSizeMotionContext>
              )}
            </div>
          </DialogPopup>
        </Dialog>
      </ChatSizeMotion>
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
