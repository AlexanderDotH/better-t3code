import { observeResize } from "~/lib/observeResize";
import { useStableCallback } from "../../hooks/useStableCallback";
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CheckIcon, CopyIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import { useBetterT3DeviceFeature } from "../../hooks/useBetterT3Feature";
import { useChatVisualMode } from "../../chatVisualModeSync";
import { markdownTableBubblePadding, observeMarkdownTableBubble } from "./markdownTableBubble";
import { useMarkdownTableMotion } from "./useMarkdownTableMotion";
import {
  MARKDOWN_TABLE_DEFAULT_EXPANSION_RATIO,
  MARKDOWN_TABLE_RESIZE_EDGE_STEP_PX,
  MARKDOWN_TABLE_VIEWPORT_GUTTER_PX,
  type MarkdownTableResizeEdge,
  type MarkdownTableWidthBounds,
  resolveDefaultExpandedMarkdownTableWidth,
  resolveDraggedMarkdownTableWidth,
  resolveMarkdownTableWidthBounds,
} from "./markdownTableWidth";
import { markdownTableStateStore } from "./markdownTableState";
import {
  serializeTableElementToCsv,
  serializeTableElementToMarkdown,
} from "../../markdown-clipboard";
import { reportMarkdownActionFailure } from "./markdownActionFailure";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface MarkdownTableSizing extends MarkdownTableWidthBounds {
  readonly contentWidth: number;
  readonly width: number;
}

interface MarkdownTableResizeGesture {
  readonly bounds: MarkdownTableWidthBounds;
  readonly edge: MarkdownTableResizeEdge;
  readonly pointerId: number;
  readonly startPointerX: number;
  readonly startWidth: number;
}

const MARKDOWN_TABLE_RESIZE_EDGES = ["left", "right"] as const;

function measureMarkdownTable(
  container: HTMLElement | null,
  preferredWidth: number | null,
  bubbleLayout: boolean,
): MarkdownTableSizing | null {
  const content = container?.closest<HTMLElement>(".chat-markdown");
  const column = container?.closest<HTMLElement>("[data-chat-column]");
  if (!content || !column) return null;
  const bubble = bubbleLayout
    ? container?.closest<HTMLElement>(".better-chat-bubble[data-presentation-bubble]")
    : null;
  const contentWidth = content.getBoundingClientRect().width;
  const bounds = resolveMarkdownTableWidthBounds(
    contentWidth,
    column.getBoundingClientRect().width,
    bubble ? markdownTableBubblePadding(bubble) : 0,
  );
  const width =
    preferredWidth === null
      ? resolveDefaultExpandedMarkdownTableWidth(contentWidth, bounds)
      : resolveDraggedMarkdownTableWidth({
          bounds,
          deltaX: 0,
          edge: "right",
          startWidth: preferredWidth,
        });
  return { ...bounds, contentWidth, width };
}

export function MarkdownTable({
  children,
  stateKey,
  ...props
}: React.ComponentProps<"table"> & { readonly stateKey: string }) {
  const chatVisualMode = useChatVisualMode();
  const [rememberedState] = useState(() => markdownTableStateStore.get(stateKey));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const resizeGestureRef = useRef<MarkdownTableResizeGesture | null>(null);
  const sizingRef = useRef<MarkdownTableSizing | null>(null);
  const preferredWidthRef = useRef(rememberedState?.width ?? null);
  const [expanded, setExpanded] = useState(() => rememberedState?.expanded ?? false);
  const presentationMotion = useBetterT3DeviceFeature("chat.presentationMotion");
  const [sizing, setSizing] = useState<MarkdownTableSizing | null>(null);
  const tableMotion = useMarkdownTableMotion(
    containerRef,
    `${expanded}:${sizing?.width ?? ""}`,
    chatVisualMode === "better-t3" && presentationMotion,
  );
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandLabel = expanded ? "Collapse table" : "Expand table";
  const copyLabel = copied ? "Copied" : "Copy table";
  const resizable = expanded && sizing != null && Math.round(sizing.maxWidth - sizing.minWidth) > 0;

  const rememberState = useStableCallback((nextExpanded: boolean) => {
    markdownTableStateStore.set(stateKey, {
      expanded: nextExpanded,
      width: preferredWidthRef.current,
    });
  });

  const updateSizing = useStableCallback(
    (resolve: (current: MarkdownTableSizing | null) => MarkdownTableSizing | null) => {
      setSizing((current) => {
        const next = resolve(current);
        sizingRef.current = next;
        return next;
      });
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize table geometry, resize gestures and DOM animation cleanup.
  useLayoutEffect(() => {
    if (!expanded) return;
    const tableContainer = containerRef.current;
    const content = tableContainer?.closest<HTMLElement>(".chat-markdown");
    const chatColumn = tableContainer?.closest<HTMLElement>("[data-chat-column]");
    if (!content || !chatColumn) return;
    const measure = () => {
      const next = measureMarkdownTable(
        tableContainer,
        preferredWidthRef.current,
        chatVisualMode === "better-t3",
      );
      if (!next) return;
      updateSizing((current) =>
        current?.contentWidth === next.contentWidth &&
        current.minWidth === next.minWidth &&
        current.maxWidth === next.maxWidth &&
        current.width === next.width
          ? current
          : next,
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    return observeResize([content, chatColumn], measure);
  }, [expanded, updateSizing, chatVisualMode]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize table geometry, resize gestures and DOM animation cleanup.
  useLayoutEffect(() => {
    if ((!expanded && !tableMotion.animating) || chatVisualMode !== "better-t3") return;
    const table = containerRef.current;
    const bubble = table?.closest<HTMLElement>(".better-chat-bubble[data-presentation-bubble]");
    if (!table || !bubble) return;
    return observeMarkdownTableBubble(table, bubble);
  }, [expanded, chatVisualMode, tableMotion.animating]);

  const setTableWidth = useStableCallback((width: number) => {
    preferredWidthRef.current = width;
    updateSizing((current) => (current ? { ...current, width } : current));
  });

  const beginResize = (edge: MarkdownTableResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
    const current = sizingRef.current;
    if (event.button !== 0 || !current) return;
    const animatedBounds = tableMotion.cancel();
    const startWidth = animatedBounds
      ? resolveDraggedMarkdownTableWidth({
          bounds: current,
          deltaX: 0,
          edge,
          startWidth: animatedBounds.width,
        })
      : current.width;
    if (animatedBounds) setTableWidth(startWidth);
    resizeGestureRef.current = {
      bounds: current,
      edge,
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const continueResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = resizeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    setTableWidth(
      resolveDraggedMarkdownTableWidth({
        bounds: gesture.bounds,
        deltaX: event.clientX - gesture.startPointerX,
        edge: gesture.edge,
        startWidth: gesture.startWidth,
      }),
    );
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeGestureRef.current?.pointerId !== event.pointerId) return;
    resizeGestureRef.current = null;
    rememberState(true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize table geometry, resize gestures and DOM animation cleanup.
  useEffect(
    () => () => {
      if (resizeGestureRef.current) rememberState(true);
    },
    [rememberState, resizeGestureRef],
  );

  const resizeWithKeyboard = (
    edge: MarkdownTableResizeEdge,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const current = sizingRef.current;
    if (!current) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      tableMotion.prepare();
      setTableWidth(event.key === "Home" ? current.minWidth : current.maxWidth);
      rememberState(true);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const edgeStep = MARKDOWN_TABLE_RESIZE_EDGE_STEP_PX * (event.shiftKey ? 4 : 1);
    tableMotion.prepare();
    setTableWidth(
      resolveDraggedMarkdownTableWidth({
        bounds: current,
        deltaX: event.key === "ArrowRight" ? edgeStep : -edgeStep,
        edge,
        startWidth: current.width,
      }),
    );
    rememberState(true);
  };

  function toggleExpanded() {
    const table = tableRef.current;
    if (!table) return;
    tableMotion.prepare();

    if (!expanded) {
      const next = measureMarkdownTable(
        containerRef.current,
        preferredWidthRef.current,
        chatVisualMode === "better-t3",
      );
      if (next) updateSizing(() => next);
      const rows = [...table.rows];
      const columnWidths = rows.reduce<number[]>((widths, row) => {
        [...row.cells].forEach((cell, columnIndex) => {
          widths[columnIndex] = Math.max(
            widths[columnIndex] ?? 0,
            cell.getBoundingClientRect().width,
          );
        });
        return widths;
      }, []);

      [...(table.tHead?.rows[0]?.cells ?? [])].forEach((cell, columnIndex) => {
        cell.style.minWidth = `${columnWidths[columnIndex] ?? cell.getBoundingClientRect().width}px`;
      });
    }

    rememberState(!expanded);
    resizeGestureRef.current = null;
    if (expanded) updateSizing(() => null);
    setExpanded((value) => !value);
  }

  const handleCopy = useStableCallback((format: "markdown" | "csv") => {
    const table = containerRef.current?.querySelector("table");
    if (!table || typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    const text =
      format === "markdown"
        ? serializeTableElementToMarkdown(table)
        : serializeTableElementToCsv(table);
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch((cause) => {
        reportMarkdownActionFailure({ operation: "copy-table", format }, cause);
      });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize table geometry, resize gestures and DOM animation cleanup.
  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="chat-markdown-table-container"
      data-expanded={expanded ? "true" : "false"}
      data-resizable={resizable ? "true" : "false"}
      style={
        {
          "--chat-markdown-table-expanded-width": sizing
            ? `${sizing.width}px`
            : `${MARKDOWN_TABLE_DEFAULT_EXPANSION_RATIO * 100}%`,
          "--chat-markdown-table-viewport-gutter": `${MARKDOWN_TABLE_VIEWPORT_GUTTER_PX}px`,
        } as CSSProperties
      }
    >
      {resizable && sizing
        ? MARKDOWN_TABLE_RESIZE_EDGES.map((edge) => (
            <div
              aria-label={`Resize table from ${edge} edge`}
              aria-orientation="vertical"
              aria-valuemax={Math.round(sizing.maxWidth)}
              aria-valuemin={Math.round(sizing.minWidth)}
              aria-valuenow={Math.round(sizing.width)}
              aria-valuetext={`${Math.round((sizing.width / sizing.contentWidth) * 100)}% of normal width`}
              className="chat-markdown-table-resize-handle"
              data-edge={edge}
              key={edge}
              onKeyDown={(event) => resizeWithKeyboard(edge, event)}
              onLostPointerCapture={endResize}
              onPointerCancel={endResize}
              onPointerDown={(event) => beginResize(edge, event)}
              onPointerMove={continueResize}
              onPointerUp={endResize}
              role="separator"
              tabIndex={0}
            >
              <span aria-hidden="true" />
            </div>
          ))
        : null}
      <ScrollArea radius="none" chainVerticalScroll scrollFade className="w-full max-w-full">
        <table ref={tableRef} {...props}>
          {children}
        </table>
      </ScrollArea>
      <div className="mt-0.5 flex items-center justify-between select-none">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={expanded ? "secondary" : "ghost-muted"}
                size="icon-xs"
                aria-pressed={expanded}
                onClick={toggleExpanded}
                aria-label={expandLabel}
              />
            }
          >
            {expanded ? <Minimize2Icon className="size-3" /> : <Maximize2Icon className="size-3" />}
          </TooltipTrigger>
          <TooltipPopup side="top">{expandLabel}</TooltipPopup>
        </Tooltip>
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost-muted"
                      size="icon-xs"
                      aria-label={copyLabel}
                    />
                  }
                />
              }
            >
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end">
            <MenuItem onClick={() => handleCopy("markdown")}>Copy as Markdown</MenuItem>
            <MenuItem onClick={() => handleCopy("csv")}>Copy as CSV</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}
