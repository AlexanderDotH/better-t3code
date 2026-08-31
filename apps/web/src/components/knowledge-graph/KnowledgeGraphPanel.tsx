import {
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeKind,
  type KnowledgeGraphSnapshotV1,
} from "@t3tools/contracts";
import {
  deriveKnowledgeGraphView,
  type KnowledgeGraphPosition,
} from "@t3tools/client-runtime/knowledge-graph";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { MinusIcon, RotateCcwIcon, SearchIcon, PlusIcon } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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

export interface KnowledgeGraphPanelViewProps {
  readonly snapshot: KnowledgeGraphSnapshotV1;
  readonly positions: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly width: number;
  readonly height: number;
  readonly query: string;
  readonly kinds: ReadonlySet<KnowledgeGraphNodeKind>;
  readonly expandedNodeId: KnowledgeGraphNodeId | null;
  readonly zoom: number;
  readonly prefersReducedMotion: boolean;
  readonly translate: KnowledgeGraphTranslate;
  readonly formatConfidence: (confidence: number) => string;
  readonly onQueryChange: (query: string) => void;
  readonly onToggleKind: (kind: KnowledgeGraphNodeKind) => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onResetView: () => void;
  readonly onExpandNode: (nodeId: KnowledgeGraphNodeId | null) => void;
  readonly onOpenSource: (path: string, line: number | null) => void;
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
            onClick={() => props.onZoomChange(clampZoom(props.zoom - 0.1))}
          >
            <MinusIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.translate("knowledgeGraph.zoomIn")}
            onClick={() => props.onZoomChange(clampZoom(props.zoom + 0.1))}
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
        className="relative min-h-64 flex-1 overflow-hidden bg-muted/15"
        role="region"
        aria-label={props.translate("knowledgeGraph.accessibility.canvas")}
      >
        {view.nodes.length === 0 ? (
          <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
            {props.translate("knowledgeGraph.empty")}
          </p>
        ) : null}
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${props.width} ${props.height}`}
          aria-hidden="true"
        >
          {view.edges.map((edge) => {
            if (!visibleNodeIds.has(edge.sourceNodeId) || !visibleNodeIds.has(edge.targetNodeId)) {
              return null;
            }
            const source = props.positions.get(edge.sourceNodeId);
            const target = props.positions.get(edge.targetNodeId);
            if (!source || !target) return null;
            return (
              <line
                key={edge.edgeId}
                x1={source.x * props.zoom}
                y1={source.y * props.zoom}
                x2={target.x * props.zoom}
                y2={target.y * props.zoom}
                className="stroke-border"
                strokeWidth={1.25}
              />
            );
          })}
        </svg>
        {view.nodes.map((node) => {
          const position = props.positions.get(node.nodeId);
          if (!position) return null;
          const expanded = node.nodeId === props.expandedNodeId;
          return (
            <button
              key={node.nodeId}
              type="button"
              data-graph-node={node.nodeId}
              aria-expanded={expanded}
              aria-label={props.translate("knowledgeGraph.accessibility.node", {
                label: node.label,
              })}
              className={cn(
                "absolute max-w-36 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border px-3 py-1.5 text-xs shadow-sm",
                expanded
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:border-foreground/40",
              )}
              style={{ left: position.x * props.zoom, top: position.y * props.zoom }}
              onClick={() => props.onExpandNode(expanded ? null : node.nodeId)}
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
