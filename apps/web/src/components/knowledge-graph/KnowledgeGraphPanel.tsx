import {
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeKind,
  type KnowledgeGraphSnapshotV1,
} from "@t3tools/contracts";
import {
  deriveKnowledgeGraphView,
  screenPointFromGraphPoint,
  type KnowledgeGraphPosition,
  type KnowledgeGraphViewport,
} from "@t3tools/client-runtime/knowledge-graph";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { MinusIcon, RotateCcwIcon, SearchIcon, PlusIcon } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { resolveKnowledgeGraphZeroNodeState } from "./knowledgeGraphPanelState";

export type KnowledgeGraphTranslate = (
  key: InterfaceMessageKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

const NODE_KINDS = [
  "repository",
  "package",
  "directory",
  "file",
  "symbol",
  "dependency",
  "technology",
  "documentation",
  "architecture",
] as const satisfies ReadonlyArray<KnowledgeGraphNodeKind>;

const NODE_KIND_CLASS_NAMES = {
  repository: "border-violet-500/50 bg-violet-500/12",
  package: "border-blue-500/45 bg-blue-500/10",
  directory: "border-amber-500/45 bg-amber-500/10",
  file: "border-slate-500/45 bg-slate-500/10",
  symbol: "border-zinc-500/45 bg-zinc-500/10",
  dependency: "border-cyan-500/45 bg-cyan-500/10",
  technology: "border-emerald-500/45 bg-emerald-500/10",
  documentation: "border-orange-500/45 bg-orange-500/10",
  architecture: "border-fuchsia-500/45 bg-fuchsia-500/10",
} as const satisfies Readonly<Record<KnowledgeGraphNodeKind, string>>;

const PROMINENT_NODE_KINDS = new Set<KnowledgeGraphNodeKind>([
  "repository",
  "package",
  "architecture",
]);

export interface KnowledgeGraphPanelViewProps {
  readonly snapshot: KnowledgeGraphSnapshotV1;
  readonly positions: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly width: number;
  readonly height: number;
  readonly query: string;
  readonly kinds: ReadonlySet<KnowledgeGraphNodeKind>;
  readonly expandedNodeId: KnowledgeGraphNodeId | null;
  readonly hoveredNodeId: KnowledgeGraphNodeId | null;
  readonly draggingNodeId: KnowledgeGraphNodeId | null;
  readonly pinnedNodeIds?: ReadonlySet<KnowledgeGraphNodeId>;
  readonly viewport: KnowledgeGraphViewport;
  readonly layoutAnimating: boolean;
  readonly prefersReducedMotion: boolean;
  readonly translate: KnowledgeGraphTranslate;
  readonly formatConfidence: (confidence: number) => string;
  readonly onQueryChange: (query: string) => void;
  readonly onToggleKind: (kind: KnowledgeGraphNodeKind) => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onResetView: () => void;
  readonly onExpandNode: (nodeId: KnowledgeGraphNodeId | null) => void;
  readonly onNodeHover: (nodeId: KnowledgeGraphNodeId | null) => void;
  readonly onOpenSource: (path: string, line: number | null) => void;
  readonly onCanvasPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onNodePointerDown: (
    nodeId: KnowledgeGraphNodeId,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly headerActions?: React.ReactNode;
  readonly expandedDetails?: React.ReactNode;
}

const clampZoom = (zoom: number): number => Math.min(2.5, Math.max(0.5, zoom));

function GraphToolbar(props: KnowledgeGraphPanelViewProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-border/70 p-3">
      <label className="relative block">
        <span className="sr-only">{props.translate("knowledgeGraph.search.label")}</span>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          nativeInput
          type="search"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
          aria-label={props.translate("knowledgeGraph.search.label")}
          placeholder={props.translate("knowledgeGraph.search.placeholder")}
          className="w-full [&_[data-slot=input]]:pl-8"
        />
      </label>
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label={props.translate("knowledgeGraph.filters.label")}
      >
        {NODE_KINDS.map((kind) => (
          <Button
            key={kind}
            size="xs"
            variant={props.kinds.has(kind) ? "secondary" : "ghost-muted"}
            aria-pressed={props.kinds.has(kind)}
            onClick={() => props.onToggleKind(kind)}
          >
            {props.translate(`knowledgeGraph.nodeKind.${kind}`)}
          </Button>
        ))}
        <div
          className="ms-auto flex items-center gap-1"
          role="group"
          aria-label={props.translate("knowledgeGraph.accessibility.zoomControls")}
        >
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.translate("knowledgeGraph.zoomOut")}
            onClick={() => props.onZoomChange(clampZoom(props.viewport.scale - 0.1))}
          >
            <MinusIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.translate("knowledgeGraph.zoomIn")}
            onClick={() => props.onZoomChange(clampZoom(props.viewport.scale + 0.1))}
          >
            <PlusIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.translate("knowledgeGraph.resetView")}
            onClick={props.onResetView}
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExpandedNode(props: {
  readonly view: ReturnType<typeof deriveKnowledgeGraphView>;
  readonly translate: KnowledgeGraphTranslate;
  readonly formatConfidence: KnowledgeGraphPanelViewProps["formatConfidence"];
  readonly onOpenSource: KnowledgeGraphPanelViewProps["onOpenSource"];
  readonly details?: React.ReactNode;
}) {
  const node = props.view.expandedNode;
  if (!node) return null;
  return (
    <aside
      data-expanded-node={node.nodeId}
      className="max-h-64 shrink-0 overflow-y-auto border-t border-border/70 bg-background/95 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{node.label}</h3>
          {node.summary ? (
            <p className="mt-1 text-xs text-muted-foreground">{node.summary}</p>
          ) : null}
        </div>
        {node.source ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => props.onOpenSource(node.source!.path, node.source!.startLine ?? null)}
          >
            {props.translate("knowledgeGraph.openSource")}
          </Button>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{props.translate("knowledgeGraph.provenance")}</dt>
        <dd>{props.translate(`knowledgeGraph.provenance.${node.provenance}`)}</dd>
        <dt className="text-muted-foreground">{props.translate("knowledgeGraph.confidence")}</dt>
        <dd>{props.formatConfidence(node.confidence)}</dd>
      </dl>
      <ul
        className="mt-3 space-y-1 text-xs"
        aria-label={props.translate("knowledgeGraph.relationships")}
      >
        {props.view.relationships.map((relationship) => (
          <li
            key={relationship.edge.edgeId}
            className="rounded-md bg-muted/45 px-2 py-1.5"
            aria-label={props.translate("knowledgeGraph.accessibility.relationship", {
              source:
                relationship.direction === "outgoing" ? node.label : relationship.otherNode.label,
              relationship: props.translate(`knowledgeGraph.edgeKind.${relationship.edge.kind}`),
              target:
                relationship.direction === "outgoing" ? relationship.otherNode.label : node.label,
            })}
          >
            <span className="text-muted-foreground">
              {props.translate(`knowledgeGraph.direction.${relationship.direction}`)} ·{" "}
              {props.translate(`knowledgeGraph.edgeKind.${relationship.edge.kind}`)}
            </span>{" "}
            <span>{relationship.otherNode.label}</span>
          </li>
        ))}
      </ul>
      {props.details}
    </aside>
  );
}

export function KnowledgeGraphPanelView(props: KnowledgeGraphPanelViewProps) {
  const view = deriveKnowledgeGraphView({
    snapshot: props.snapshot,
    query: props.query,
    kinds: props.kinds,
    expandedNodeId: props.expandedNodeId,
  });
  const visibleNodeIds = new Set(view.nodes.map((node) => node.nodeId));
  const candidateFocusedNodeId = props.hoveredNodeId ?? props.expandedNodeId;
  const focusedNodeId =
    candidateFocusedNodeId && visibleNodeIds.has(candidateFocusedNodeId)
      ? candidateFocusedNodeId
      : null;
  const relatedNodeIds = new Set<KnowledgeGraphNodeId>(focusedNodeId ? [focusedNodeId] : []);
  if (focusedNodeId) {
    for (const edge of view.edges) {
      if (edge.sourceNodeId === focusedNodeId) relatedNodeIds.add(edge.targetNodeId);
      if (edge.targetNodeId === focusedNodeId) relatedNodeIds.add(edge.sourceNodeId);
    }
  }
  const zeroNodeState =
    props.snapshot.status.nodeCount === 0
      ? resolveKnowledgeGraphZeroNodeState(props.snapshot.status)
      : null;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-background text-foreground"
      aria-label={props.translate("knowledgeGraph.title")}
      data-motion={props.prefersReducedMotion ? "reduced" : "standard"}
    >
      <GraphToolbar {...props} />
      {props.headerActions ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-border/70 px-3 py-2">
          {props.headerActions}
        </div>
      ) : null}
      <div className="px-3 py-1.5 text-xs text-muted-foreground" aria-live="polite">
        {props.translate("knowledgeGraph.resultCount", { count: view.matchingNodeCount })}
      </div>
      {view.truncation.eligibleFiles || view.truncation.nodes || view.truncation.visibleNodes ? (
        <div className="border-y border-warning/25 bg-warning/8 px-3 py-2 text-xs" role="status">
          <p>{props.translate("knowledgeGraph.truncated")}</p>
          {view.truncation.omittedNodeCount > 0 ? (
            <p className="text-muted-foreground">
              {props.translate("knowledgeGraph.omittedNodes", {
                count: view.truncation.omittedNodeCount,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      <div
        className="relative min-h-64 flex-1 touch-none cursor-grab overflow-hidden bg-muted/15 active:cursor-grabbing"
        role="region"
        aria-label={props.translate("knowledgeGraph.accessibility.canvas")}
        data-knowledge-graph-canvas="true"
        data-layout-state={props.layoutAnimating ? "animating" : "settled"}
        onPointerDown={props.onCanvasPointerDown}
      >
        {view.nodes.length === 0 ? (
          <div
            className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground"
            data-empty-state={zeroNodeState?.messageKey ?? "knowledgeGraph.noResults"}
            role={zeroNodeState?.role ?? "status"}
          >
            <div className="max-w-sm space-y-1">
              <p>{props.translate(zeroNodeState?.messageKey ?? "knowledgeGraph.noResults")}</p>
              {zeroNodeState?.role === "alert" && props.snapshot.status.errorMessage ? (
                <p className="text-xs">{props.snapshot.status.errorMessage}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden="true"
          data-knowledge-graph-edges="true"
        >
          {view.edges.map((edge) => {
            if (!visibleNodeIds.has(edge.sourceNodeId) || !visibleNodeIds.has(edge.targetNodeId)) {
              return null;
            }
            const source = props.positions.get(edge.sourceNodeId);
            const target = props.positions.get(edge.targetNodeId);
            if (!source || !target) return null;
            const sourcePoint = screenPointFromGraphPoint(source, props.viewport);
            const targetPoint = screenPointFromGraphPoint(target, props.viewport);
            const highlighted =
              focusedNodeId !== null &&
              (edge.sourceNodeId === focusedNodeId || edge.targetNodeId === focusedNodeId);
            return (
              <line
                key={edge.edgeId}
                x1={sourcePoint.x}
                y1={sourcePoint.y}
                x2={targetPoint.x}
                y2={targetPoint.y}
                data-highlighted={highlighted ? "true" : "false"}
                className={cn(
                  "transition-[stroke,opacity,stroke-width] duration-150",
                  highlighted
                    ? "stroke-primary opacity-90"
                    : cn("stroke-border", focusedNodeId ? "opacity-30" : "opacity-65"),
                )}
                strokeWidth={highlighted ? 2.25 : 1.25}
              />
            );
          })}
        </svg>
        {view.nodes.map((node) => {
          const position = props.positions.get(node.nodeId);
          if (!position) return null;
          const screenPosition = screenPointFromGraphPoint(position, props.viewport);
          const expanded = node.nodeId === props.expandedNodeId;
          const related = focusedNodeId === null || relatedNodeIds.has(node.nodeId);
          const dragging = node.nodeId === props.draggingNodeId;
          const pinned = props.pinnedNodeIds?.has(node.nodeId) ?? false;
          return (
            <button
              key={node.nodeId}
              type="button"
              data-graph-node={node.nodeId}
              data-graph-node-kind={node.kind}
              data-related={related ? "true" : "false"}
              data-pinned={pinned ? "true" : "false"}
              aria-expanded={expanded}
              aria-label={props.translate("knowledgeGraph.accessibility.node", {
                label: node.label,
              })}
              className={cn(
                "absolute max-w-36 -translate-x-1/2 -translate-y-1/2 touch-none cursor-grab select-none rounded-full border px-3 py-1.5 text-xs shadow-sm active:cursor-grabbing",
                NODE_KIND_CLASS_NAMES[node.kind],
                PROMINENT_NODE_KINDS.has(node.kind) && "px-3.5 py-2 font-medium shadow-md",
                pinned && "ring-2 ring-primary/35 ring-offset-1 ring-offset-background",
                props.layoutAnimating && !props.prefersReducedMotion && !dragging
                  ? "will-change-[left,top]"
                  : null,
                "transition-[opacity,border-color,background-color,box-shadow] duration-150",
                !related && "opacity-60",
                expanded
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:border-foreground/60 hover:shadow-md",
              )}
              style={{ left: screenPosition.x, top: screenPosition.y }}
              onClick={() => props.onExpandNode(expanded ? null : node.nodeId)}
              onPointerEnter={() => props.onNodeHover(node.nodeId)}
              onPointerLeave={() => props.onNodeHover(null)}
              onPointerDown={(event) => props.onNodePointerDown(node.nodeId, event)}
            >
              <span className="block truncate">{node.label}</span>
              <span className="sr-only">
                {props.translate("knowledgeGraph.accessibility.nodeHint")}
              </span>
            </button>
          );
        })}
      </div>
      <ExpandedNode
        view={view}
        translate={props.translate}
        formatConfidence={props.formatConfidence}
        onOpenSource={props.onOpenSource}
        details={props.expandedDetails}
      />
    </section>
  );
}
