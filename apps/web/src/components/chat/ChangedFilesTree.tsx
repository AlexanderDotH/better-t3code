import { useSyncLayout } from "@legendapp/list/react";
import { type OrchestrationV2CheckpointFileTotals, type RunId } from "@t3tools/contracts";
import { type MouseEvent, type ReactNode, memo, useLayoutEffect, useRef, useState } from "react";
import { type TurnDiffFileChange } from "../../types";
import { buildTurnDiffTree, type TurnDiffTreeNode } from "../../lib/turnDiffTree";
import { ChevronRightIcon, FileDiffIcon } from "lucide-react";
import { ChevronsDownUp, ChevronsUpDown, Folder, FolderClosed } from "lucide";
import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  changedFileName,
  selectChangedFilePreview,
  summarizeChangedFileScopes,
} from "./changedFilesPresentation";
import { MiddleTruncate } from "../ui/middle-truncate";
import { MorphIcon } from "~/components/MorphIcon";
import { observeResize } from "~/lib/observeResize";

import { ChatDetailPanel } from "./ChatDetailPanel";
import { summarizeTurnDiffStats } from "./changedFilesPresentation";

const COMPACT_FILE_LIMIT = 3;

function CompactChangedFilesCard({
  runId,
  files,
  expanded,
  onExpandedChange,
  resolvedTheme,
  onOpenTurnDiff,
  onFileContextMenu,
  motionEnabled = false,
}: {
  runId: RunId;
  files: ReadonlyArray<TurnDiffFileChange>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
  motionEnabled?: boolean;
}) {
  const translate = useInterfaceTranslator().message;
  const renderFiles = (visibleFiles: ReadonlyArray<TurnDiffFileChange>) => (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {visibleFiles.map((file) => (
        <Tooltip key={file.path}>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="group inline-flex max-w-full cursor-pointer items-center gap-1.5 py-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                data-presentation-file={file.path}
                aria-label={file.path}
                onClick={() => onOpenTurnDiff(runId, file.path)}
                onContextMenu={
                  onFileContextMenu
                    ? (event) => {
                        event.preventDefault();
                        onFileContextMenu(file.path, event);
                      }
                    : undefined
                }
              />
            }
          >
            <PierreEntryIcon pathValue={file.path} kind="file" theme={resolvedTheme} />
            <span className="min-w-0 max-w-72 truncate font-medium group-hover:underline">
              {changedFileName(file.path)}
            </span>
            <DiffStatLabel additions={file.additions} deletions={file.deletions} layout="inline" />
          </TooltipTrigger>
          <TooltipPopup side="top">{file.path}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
  return (
    <div className="mt-3" data-changed-files-state="compact">
      {renderFiles(files.slice(0, COMPACT_FILE_LIMIT))}
      <ChatDetailPanel expanded={expanded} motion={motionEnabled}>
        {renderFiles(files.slice(COMPACT_FILE_LIMIT))}
      </ChatDetailPanel>
      {files.length > COMPACT_FILE_LIMIT ? (
        <button
          type="button"
          aria-expanded={expanded}
          data-scroll-anchor-ignore
          className="mt-1 w-full rounded-md py-1.5 text-center text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded
            ? translate("chat.files.showFewer")
            : translate("chat.files.showAll", { count: files.length })}
        </button>
      ) : null}
    </div>
  );
}

const ClassicChangedFilesCard = memo(function ClassicChangedFilesCard(props: {
  runId: RunId;
  files: ReadonlyArray<TurnDiffFileChange>;
  expanded: boolean;
  showCompactPreview: boolean;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onExpandedChange: (expanded: boolean) => void;
  onToggleAllDirectories: () => void;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  classicPresentation?: {
    expanded: boolean;
    showCompactPreview: boolean;
    onExpandedChange: (expanded: boolean) => void;
  };
  compactPresentation?: {
    expanded: boolean;
    motionEnabled?: boolean;
    onExpandedChange: (expanded: boolean) => void;
  };
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
}) {
  const translate = useInterfaceTranslator().message;
  const {
    runId,
    files,
    expanded,
    showCompactPreview,
    allDirectoriesExpanded,
    resolvedTheme,
    onExpandedChange,
    onToggleAllDirectories,
    onOpenTurnDiff,
    onFileContextMenu,
  } = props;
  const summaryStat = summarizeTurnDiffStats(files);
  const scopeSummary = summarizeChangedFileScopes(files);
  const previewFiles = selectChangedFilePreview(files);
  const compactPreviewVisible = showCompactPreview && !expanded;

  return (
    <div
      className="@container/changed-files mt-4 rounded-2xl border border-border/70 bg-secondary p-2 dark:border-transparent dark:bg-input/32"
      data-changed-files-state={
        expanded ? "expanded" : compactPreviewVisible ? "preview" : "collapsed"
      }
    >
      <div
        data-changed-files-header=""
        className={cn(
          "flex items-center justify-between gap-2 rounded-xl",
          expanded && "sticky top-2 z-10 mb-2 bg-secondary dark:bg-background",
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          data-scroll-anchor-ignore
          className="group flex min-w-0 flex-1 items-center rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onExpandedChange(!expanded)}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-foreground text-xs leading-4">
              <span>{translate("chat.changedFiles.count", { count: files.length })}</span>
              {hasNonZeroStat(summaryStat) && (
                <DiffStatLabel
                  additions={summaryStat.additions}
                  className="text-xs leading-4"
                  deletions={summaryStat.deletions}
                  layout="inline"
                />
              )}
            </span>
            <span className="ml-1 hidden min-w-0 flex-1 truncate text-2xs text-muted-foreground group-hover:text-foreground/80 @[24rem]/changed-files:inline">
              {expanded ? translate("chat.changedFiles.hide") : translate("chat.changedFiles.show")}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5 pr-1">
          {expanded ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="outline"
                    className="!size-[22px]"
                    aria-label={
                      allDirectoriesExpanded
                        ? translate("chat.changedFiles.collapseFolders")
                        : translate("chat.changedFiles.expandFolders")
                    }
                    data-scroll-anchor-ignore
                    aria-expanded={allDirectoriesExpanded}
                    onClick={onToggleAllDirectories}
                  />
                }
              >
                {allDirectoriesExpanded ? (
                  <MorphIcon icon={ChevronsDownUp} className="size-3" />
                ) : (
                  <MorphIcon icon={ChevronsUpDown} className="size-3" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {allDirectoriesExpanded
                  ? translate("chat.changedFiles.collapseFolders")
                  : translate("chat.changedFiles.expandFolders")}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  aria-label={translate("chat.changedFiles.openDiff")}
                  onClick={() => onOpenTurnDiff(runId, files[0]?.path)}
                />
              }
            >
              <FileDiffIcon className="size-3" />
              <span className="hidden @[24rem]/changed-files:inline">
                {translate("chat.changedFiles.openDiff")}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top">{translate("chat.changedFiles.openFullDiff")}</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      {expanded ? (
        <ChangedFilesTree
          key={`changed-files-tree:${runId}`}
          runId={runId}
          files={files}
          allDirectoriesExpanded={allDirectoriesExpanded}
          resolvedTheme={resolvedTheme}
          onOpenTurnDiff={onOpenTurnDiff}
          onFileContextMenu={onFileContextMenu}
        />
      ) : compactPreviewVisible ? (
        <div className="px-2 pb-1.5 pt-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-muted-foreground">
            {scopeSummary.map((scope, index) => (
              <span key={scope.label} className="inline-flex items-center gap-1">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <span className="font-mono text-foreground/75">{scope.label}</span>
                <span>{translate("chat.changedFiles.scopeCount", { count: scope.fileCount })}</span>
              </span>
            ))}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {previewFiles.map((file) => (
              <Tooltip key={file.path}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex max-w-48 items-center gap-1 rounded-md border border-border/70 bg-background/45 px-1.5 py-1 font-mono text-3xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={() => onOpenTurnDiff(runId, file.path)}
                      onContextMenu={
                        onFileContextMenu
                          ? (event) => {
                              event.preventDefault();
                              onFileContextMenu(file.path, event);
                            }
                          : undefined
                      }
                    />
                  }
                >
                  <PierreEntryIcon
                    pathValue={file.path}
                    kind="file"
                    theme={resolvedTheme}
                    className="size-3 shrink-0 text-muted-foreground/70"
                  />
                  <span className="truncate">{changedFileName(file.path)}</span>
                </TooltipTrigger>
                <TooltipPopup side="top">{file.path}</TooltipPopup>
              </Tooltip>
            ))}
            <button
              type="button"
              aria-expanded={false}
              data-scroll-anchor-ignore
              className="rounded-md px-1.5 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => onExpandedChange(true)}
            >
              {translate("chat.changedFiles.showAll", { count: files.length })}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});

const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {};
const VIRTUALIZE_AFTER_ROWS = 250;
const ROW_OVERSCAN = 8;

interface ChangedFileRow {
  node: TurnDiffTreeNode;
  depth: number;
}

export type ChangedFileContextMenuHandler = (filePath: string, event: MouseEvent) => void;

export const ChangedFilesCard = memo(function ChangedFilesCard(props: {
  runId: RunId;
  /** May be a prefix of the changed files; `totals` covers all of them. */
  files: ReadonlyArray<TurnDiffFileChange>;
  totals: OrchestrationV2CheckpointFileTotals;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onToggleAllDirectories: () => void;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  classicPresentation?: {
    expanded: boolean;
    showCompactPreview: boolean;
    onExpandedChange: (expanded: boolean) => void;
  };
  compactPresentation?: {
    expanded: boolean;
    motionEnabled?: boolean;
    onExpandedChange: (expanded: boolean) => void;
  };
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
}) {
  const {
    runId,
    files,
    totals,
    allDirectoriesExpanded,
    resolvedTheme,
    onToggleAllDirectories,
    onOpenTurnDiff,
    onFileContextMenu,
  } = props;
  const syncTimelineLayout = useSyncLayout();
  const hiddenFileCount = totals.count - files.length;
  const hasDirectories = files.some((file) => /[/\\]/.test(file.path));

  if (props.classicPresentation) {
    return <ClassicChangedFilesCard {...props} {...props.classicPresentation} />;
  }

  if (props.compactPresentation) {
    return <CompactChangedFilesCard {...props} {...props.compactPresentation} />;
  }

  return (
    <div
      className="@container/changed-files mt-4 rounded-lg bg-secondary dark:bg-input/20"
      data-changed-files-state="tree"
    >
      <div
        data-changed-files-header=""
        className="sticky top-2 z-10 flex items-center justify-between gap-2 rounded-t-lg bg-secondary px-3 py-2 dark:bg-background dark:bg-linear-to-b dark:from-input/20 dark:to-input/20"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-foreground">
          <span>
            {totals.count.toLocaleString()} changed file{totals.count === 1 ? "" : "s"}
          </span>
          {hasNonZeroStat(totals) && (
            <DiffStatLabel
              additions={totals.additions}
              deletions={totals.deletions}
              layout="inline"
              className="text-xs leading-4"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasDirectories && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={
                      allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"
                    }
                    data-scroll-anchor-ignore
                    onClick={() => {
                      onToggleAllDirectories();
                      syncTimelineLayout();
                    }}
                  />
                }
              >
                <MorphIcon
                  className="size-3"
                  icon={allDirectoriesExpanded ? ChevronsDownUp : ChevronsUpDown}
                />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
              </TooltipPopup>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  aria-label="Open diff"
                  onClick={() => onOpenTurnDiff(runId, files[0]?.path)}
                />
              }
            >
              <FileDiffIcon className="size-3" />
              <span className="hidden @[24rem]/changed-files:inline">Open diff</span>
            </TooltipTrigger>
            <TooltipPopup side="top">Open the full diff</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      <ChangedFilesTree
        key={`${runId}:${allDirectoriesExpanded}`}
        runId={runId}
        files={files}
        allDirectoriesExpanded={allDirectoriesExpanded}
        resolvedTheme={resolvedTheme}
        onOpenTurnDiff={onOpenTurnDiff}
        onFileContextMenu={onFileContextMenu}
      />
      {hiddenFileCount > 0 && (
        <div className="px-3 pb-2">
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            onClick={() => onOpenTurnDiff(runId, files[0]?.path)}
          >
            {hiddenFileCount.toLocaleString()} more file{hiddenFileCount === 1 ? "" : "s"} in the
            full diff
          </Button>
        </div>
      )}
    </div>
  );
});

const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  runId: RunId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
}) {
  const { files, allDirectoriesExpanded, onOpenTurnDiff, resolvedTheme, runId, onFileContextMenu } =
    props;
  // Place state before tree derivation to preserve its compiler cache.
  const [directoryExpansionState, setDirectoryExpansionState] = useState<{
    key: string | null;
    overrides: Record<string, boolean>;
  }>({ key: null, overrides: {} });
  const syncTimelineLayout = useSyncLayout();
  const treeNodes = buildTurnDiffTree(files);
  const directoryPathsKey = collectDirectoryPaths(treeNodes).join("\u0000");
  const hasDirectoryNodes = directoryPathsKey.length > 0;
  const expansionStateKey = `${allDirectoriesExpanded ? "expanded" : "collapsed"}\u0000${directoryPathsKey}`;
  const expandedDirectories =
    directoryExpansionState.key === expansionStateKey
      ? directoryExpansionState.overrides
      : EMPTY_DIRECTORY_OVERRIDES;

  const toggleDirectory = (pathValue: string) => {
    setDirectoryExpansionState((current) => {
      const nextOverrides = current.key === expansionStateKey ? current.overrides : {};
      return {
        key: expansionStateKey,
        overrides: {
          ...nextOverrides,
          [pathValue]: !(nextOverrides[pathValue] ?? allDirectoriesExpanded),
        },
      };
    });
    // Measure before paint instead of waiting for LegendList's deferred shrink measurement.
    syncTimelineLayout();
  };

  const rows = collectExpandedRows(treeNodes, expandedDirectories, allDirectoriesExpanded);
  const virtualized = rows.length > VIRTUALIZE_AFTER_ROWS;

  const renderRow = ({ node, depth }: ChangedFileRow) => {
    const leftPadding = 8 + depth * 14;
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? allDirectoriesExpanded;
      return (
        <button
          key={`dir:${node.path}`}
          type="button"
          data-scroll-anchor-ignore
          aria-expanded={isExpanded}
          className="group flex h-7 w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          style={{ paddingLeft: `${leftPadding}px` }}
          onClick={() => toggleDirectory(node.path)}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
              isExpanded && "rotate-90",
            )}
          />
          <MorphIcon
            className="size-3.5 shrink-0 text-muted-foreground/75"
            icon={isExpanded ? Folder : FolderClosed}
          />
          <span className="truncate font-mono text-2xs text-muted-foreground/90 group-hover:text-foreground/90">
            {node.name}
          </span>
          {hasNonZeroStat(node.stat) && (
            <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums">
              <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
            </span>
          )}
        </button>
      );
    }

    return (
      <button
        key={`file:${node.path}`}
        type="button"
        className="group flex h-7 w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={() => onOpenTurnDiff(runId, node.path)}
        onContextMenu={
          onFileContextMenu
            ? (event) => {
                event.preventDefault();
                onFileContextMenu(node.path, event);
              }
            : undefined
        }
      >
        {hasDirectoryNodes || depth > 0 ? (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        ) : null}
        <PierreEntryIcon
          pathValue={node.path}
          kind="file"
          theme={resolvedTheme}
          className="size-3.5 text-muted-foreground/70"
        />
        <span className="flex min-w-0 font-mono text-xs text-foreground/85 group-hover:text-foreground">
          <MiddleTruncate value={node.name} />
        </span>
        {node.stat && (
          <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums">
            <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        )}
      </button>
    );
  };

  return <ChangedFilesRows rows={rows} renderRow={renderRow} virtualized={virtualized} />;
});

function ChangedFilesRows({
  rows,
  renderRow,
  virtualized,
}: {
  rows: ReadonlyArray<ChangedFileRow>;
  renderRow: (row: ChangedFileRow) => ReactNode;
  virtualized: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rowSizeRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 40, rowHeight: 28 });
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes scroll, window resize and ancestor resizes to compute the virtualized row range
  useLayoutEffect(() => {
    const container = containerRef.current;
    const rowSize = rowSizeRef.current;
    if (!virtualized || !container || !rowSize) return;

    // The card is inside a virtualized timeline item, so its own scrollTop is always zero.
    // Observe its ancestors too: streaming text and timeline layout can move the card.
    const ancestors: HTMLElement[] = [container, rowSize];
    let scrollElement: HTMLElement | null = null;
    for (let parent = container.parentElement; parent; parent = parent.parentElement) {
      ancestors.push(parent);
      if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) {
        scrollElement = parent;
        break;
      }
    }

    const measure = () => {
      const rowHeight = rowSize.getBoundingClientRect().height;
      if (rowHeight <= 0) return;
      const listTop = container.getBoundingClientRect().top;
      const viewportTop = scrollElement
        ? scrollElement.getBoundingClientRect().top + scrollElement.clientTop
        : 0;
      const viewportHeight = scrollElement?.clientHeight ?? document.documentElement.clientHeight;
      const start = Math.max(
        0,
        Math.min(rows.length, Math.floor((viewportTop - listTop) / rowHeight) - ROW_OVERSCAN),
      );
      const end = Math.max(
        start,
        Math.min(
          rows.length,
          Math.ceil((viewportTop + viewportHeight - listTop) / rowHeight) + ROW_OVERSCAN,
        ),
      );
      setRange((current) =>
        current.start === start && current.end === end && current.rowHeight === rowHeight
          ? current
          : { start, end, rowHeight },
      );
    };
    measure();
    const scrollTarget = scrollElement ?? globalThis.window;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    globalThis.window.addEventListener("resize", onScroll);
    const stopObserving = observeResize(ancestors, measure);
    return () => {
      scrollTarget.removeEventListener("scroll", onScroll);
      globalThis.window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
      stopObserving();
    };
  }, [virtualized, rows.length]);

  const focusedIndex =
    focusedPath === null ? -1 : rows.findIndex((row) => row.node.path === focusedPath);
  const start = virtualized ? range.start : 0;
  const end = virtualized ? Math.min(rows.length, range.end) : rows.length;
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  // Keep keyboard focus on its row when mouse scrolling moves it outside the render window.
  if (focusedIndex >= 0 && focusedIndex < start) indices.unshift(focusedIndex);
  if (focusedIndex >= end) indices.push(focusedIndex);
  return (
    <div className="p-2">
      <div
        ref={containerRef}
        className="relative"
        style={virtualized ? { height: rows.length * range.rowHeight } : undefined}
        onFocusCapture={(event) => {
          const row = event.target.closest<HTMLElement>("[data-changed-file-row]");
          setFocusedPath(row?.dataset.changedFileRow ?? null);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocusedPath(null);
        }}
      >
        {virtualized && (
          <div
            ref={rowSizeRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute h-7"
          />
        )}
        {indices.map((index) => {
          const row = rows[index]!;
          return (
            <div
              key={`${row.node.kind}:${row.node.path}`}
              data-changed-file-row={row.node.path}
              className={virtualized ? "absolute inset-x-0" : undefined}
              style={virtualized ? { top: index * range.rowHeight } : undefined}
            >
              {renderRow(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function collectExpandedRows(
  nodes: ReadonlyArray<TurnDiffTreeNode>,
  overrides: Readonly<Record<string, boolean>>,
  allDirectoriesExpanded: boolean,
  depth = 0,
  rows: ChangedFileRow[] = [],
): ChangedFileRow[] {
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "directory" && (overrides[node.path] ?? allDirectoriesExpanded)) {
      collectExpandedRows(node.children, overrides, allDirectoriesExpanded, depth + 1, rows);
    }
  }
  return rows;
}

function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}
