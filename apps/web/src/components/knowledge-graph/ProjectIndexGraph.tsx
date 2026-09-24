import type {
  ProjectCallsiteV1,
  ProjectEntityV1,
  ProjectImportV1,
  ProjectIndexGraphOverviewV1,
} from "@t3tools/contracts";
import { ExpandIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { layoutProjectIndexGraph } from "./projectIndexGraphLayout";
import {
  buildProjectIndexMap,
  layoutProjectIndexOverview,
  PROJECT_MAP_ROOT,
  type ProjectIndexMap,
  type ProjectMapNode,
} from "./projectIndexOverviewLayout";
import { useProjectGraphMotion } from "./useProjectGraphMotion";
import "./ProjectIndexGraph.css";

const EMPTY_IMPORTS: ReadonlyArray<ProjectImportV1> = [];
const INITIAL_VIEWPORT = { scale: 1, translateX: 0, translateY: 0 };

function fitNodes(nodes: ReadonlyArray<{ x: number; y: number }>, width: number, height: number) {
  if (nodes.length === 0) return INITIAL_VIEWPORT;
  const left = Math.min(...nodes.map((node) => node.x)) - 80;
  const top = Math.min(...nodes.map((node) => node.y)) - 40;
  const right = Math.max(...nodes.map((node) => node.x)) + 80;
  const bottom = Math.max(...nodes.map((node) => node.y)) + 90;
  const scale = Math.max(0.15, Math.min(1, width / (right - left), height / (bottom - top)));
  return {
    scale,
    translateX: (width - (left + right) * scale) / 2,
    translateY: (height - (top + bottom) * scale) / 2,
  };
}

function nodeCategory(kind: ProjectEntityV1["kind"] | "directory") {
  if (kind === "directory") return "directory";
  if (kind === "file" || kind === "module" || kind === "namespace") return "file";
  if (["class", "interface", "type", "enum"].includes(kind)) return "type";
  return "symbol";
}

export function ProjectIndexGraph({
  entities,
  callsites,
  imports = EMPTY_IMPORTS,
  selectedEntityId,
  onSelectEntity,
  overview,
  map,
  loadingPath,
  onSelectMapNode,
}: {
  readonly entities: ReadonlyArray<ProjectEntityV1>;
  readonly callsites: ReadonlyArray<ProjectCallsiteV1>;
  readonly imports?: ReadonlyArray<ProjectImportV1> | undefined;
  readonly selectedEntityId: string | null;
  readonly onSelectEntity: (entityId: string) => void;
  readonly overview?: ProjectIndexGraphOverviewV1 | undefined;
  readonly map?: ProjectIndexMap | undefined;
  readonly loadingPath?: string | null;
  readonly onSelectMapNode?: (node: ProjectMapNode) => void;
}) {
  const { message, number } = useInterfaceTranslator();
  const graphId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const overviewLayout = useMemo(
    () =>
      overview
        ? layoutProjectIndexOverview(map ?? buildProjectIndexMap(overview, new Map(), new Set()))
        : null,
    [overview, map],
  );
  const targetLayout = useMemo(() => {
    if (overviewLayout) return overviewLayout;
    const symbols = layoutProjectIndexGraph(entities, callsites, selectedEntityId, imports);
    const nodes = symbols.nodes.map(({ entity, x, y }) => ({
      id: entity.id,
      name: entity.name,
      qualifiedName: entity.qualifiedName,
      filePath: entity.filePath,
      kind: entity.kind,
      freshness: entity.freshness,
      fileCount: null,
      line: entity.range.startLine,
      parentId: entity.containerId ?? null,
      entityId: entity.id,
      expandable: false,
      expanded: false,
      x,
      y,
    }));
    return { ...symbols, nodes, byId: new Map(nodes.map((node) => [node.id, node])) };
  }, [entities, callsites, selectedEntityId, imports, overviewLayout]);
  const [viewport, setViewport] = useState(() =>
    fitNodes(targetLayout.nodes, targetLayout.width, targetLayout.height),
  );
  const nodes = useProjectGraphMotion(targetLayout.nodes);
  const layout = useMemo(
    () => ({
      ...targetLayout,
      nodes,
      byId: new Map(nodes.map((node) => [node.id, node])),
    }),
    [nodes, targetLayout],
  );
  const focusedId =
    hoveredId ?? (selectedEntityId && layout.byId.has(selectedEntityId) ? selectedEntityId : null);
  const hasNodes = layout.nodes.length > 0;
  const neighbors = useMemo(() => {
    if (!focusedId) return null;
    const connected = new Set([focusedId]);
    for (const edge of layout.edges) {
      if (edge.sourceId === focusedId) connected.add(edge.targetId);
      if (edge.targetId === focusedId) connected.add(edge.sourceId);
    }
    return connected;
  }, [focusedId, layout.edges]);

  const zoom = useCallback(
    (factor: number, x = layout.width / 2, y = layout.height / 2) => {
      setViewport((current) => {
        const scale = Math.max(0.15, Math.min(2.5, current.scale * factor));
        const ratio = scale / current.scale;
        return {
          scale,
          translateX: x - (x - current.translateX) * ratio,
          translateY: y - (y - current.translateY) * ratio,
        };
      });
    },
    [layout.width, layout.height],
  );
  const fit = () => setViewport(fitNodes(nodes, layout.width, layout.height));

  useEffect(() => {
    if (!hasNodes) return;
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      event.preventDefault();
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      zoom(event.deltaY > 0 ? 0.9 : 1.1, point.x, point.y);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [hasNodes, zoom]);

  if (!hasNodes) return null;

  return (
    <section className="project-index-graph" aria-label={message("projectIndexing.graph")}>
      <div className="project-index-graph-toolbar">
        <div>
          <span className="project-index-graph-eyebrow">{message("projectIndexing.graphMap")}</span>
          <p className="project-index-graph-count">
            {overview
              ? message("projectIndexing.graphOverviewCount", {
                  files: number(overview.indexedFiles),
                  nodes: number(layout.nodes.length),
                  relationships: number(layout.edges.length),
                })
              : message("projectIndexing.graphCount", {
                  entities: layout.nodes.length,
                  relationships: layout.edges.length,
                })}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={message("projectIndexing.graphZoomOut")}
            disabled={viewport.scale <= 0.15}
            onClick={() => zoom(0.8)}
          >
            <MinusIcon />
          </Button>
          <span className="project-index-graph-scale">{Math.round(viewport.scale * 100)}%</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={message("projectIndexing.graphZoomIn")}
            disabled={viewport.scale >= 2.5}
            onClick={() => zoom(1.25)}
          >
            <PlusIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={message("projectIndexing.graphFit")}
            onClick={fit}
          >
            <ExpandIcon />
          </Button>
        </div>
      </div>
      <svg
        ref={svgRef}
        className="project-index-graph-canvas"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label={message("projectIndexing.graphNavigation")}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "+" || event.key === "=") zoom(1.25);
          else if (event.key === "-") zoom(0.8);
          else if (event.key === "Home") fit();
          else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            setViewport((current) => ({
              ...current,
              translateX:
                current.translateX +
                (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0),
              translateY:
                current.translateY +
                (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0),
            }));
          } else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest("button"))
          )
            return;
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
            matrix.inverse(),
          );
          drag.current = { pointerId: event.pointerId, x: point.x, y: point.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const previous = drag.current;
          if (!previous || previous.pointerId !== event.pointerId) return;
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
            matrix.inverse(),
          );
          setViewport((current) => ({
            ...current,
            translateX: current.translateX + point.x - previous.x,
            translateY: current.translateY + point.y - previous.y,
          }));
          drag.current = { pointerId: event.pointerId, x: point.x, y: point.y };
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <defs>
          <pattern id={`${graphId}-grid`} width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 17 18 h 2 M 18 17 v 2" className="project-index-graph-grid" />
          </pattern>
          <marker
            id={`${graphId}-arrow`}
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 7 3.5 L 0 7 z" fill="context-stroke" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${graphId}-grid)`} aria-hidden="true" />
        <g
          transform={`translate(${viewport.translateX} ${viewport.translateY}) scale(${viewport.scale})`}
        >
          {layout.clusters.map((cluster) => (
            <g key={cluster.filePath} aria-hidden="true" className="project-index-graph-cluster">
              <text x={cluster.x} y={cluster.y - cluster.radius - 36} textAnchor="middle">
                {cluster.filePath.length > 42
                  ? `…${cluster.filePath.slice(-41)}`
                  : cluster.filePath}
              </text>
            </g>
          ))}
          {layout.edges.map((edge) => {
            const source = layout.byId.get(edge.sourceId);
            const target = layout.byId.get(edge.targetId);
            if (!source || !target) return null;
            const highlighted = edge.sourceId === focusedId || edge.targetId === focusedId;
            const distance = Math.hypot(target.x - source.x, target.y - source.y) || 1;
            const endX = target.x - ((target.x - source.x) / distance) * 13;
            const endY = target.y - ((target.y - source.y) / distance) * 13;
            const curve = Math.min(32, distance * 0.12);
            return (
              <path
                key={edge.id}
                className="project-index-graph-edge"
                data-kind={edge.kind}
                data-highlighted={highlighted}
                data-dimmed={focusedId !== null && !highlighted}
                d={
                  source === target
                    ? `M ${source.x} ${source.y - 10} c 48 -45 48 45 8 16`
                    : `M ${source.x} ${source.y} Q ${(source.x + target.x) / 2 - curve} ${(source.y + target.y) / 2 - curve} ${endX} ${endY}`
                }
                fill="none"
                vectorEffect="non-scaling-stroke"
                markerEnd={edge.kind === "contains" ? undefined : `url(#${graphId}-arrow)`}
              />
            );
          })}
          {layout.nodes.map((node) => (
            <foreignObject
              key={node.id}
              x={node.x - 68}
              y={node.y - 16}
              width="136"
              height="80"
              className="project-index-graph-node-wrap"
              data-dimmed={neighbors !== null && !neighbors.has(node.id)}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="project-index-graph-node"
                      data-kind={nodeCategory(node.kind)}
                      data-expanded={node.expanded}
                      data-loading={node.id === loadingPath}
                      aria-busy={node.id === loadingPath}
                      aria-expanded={node.expandable ? node.expanded : undefined}
                      data-stale={node.freshness !== null && node.freshness !== "current"}
                      data-show-label={
                        layout.nodes.length <= 16 ||
                        overview !== undefined ||
                        neighbors?.has(node.id) === true ||
                        node.kind === "file" ||
                        viewport.scale > 1.5
                      }
                      aria-pressed={selectedEntityId === node.id}
                      aria-label={
                        node.id === PROJECT_MAP_ROOT
                          ? message("projectIndexing.graphRoot")
                          : node.entityId === null
                            ? node.filePath
                            : `${node.qualifiedName} · ${node.filePath}:${node.line}`
                      }
                      onClick={() => (overview ? onSelectMapNode?.(node) : onSelectEntity(node.id))}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onFocus={() => setHoveredId(node.id)}
                      onBlur={() => setHoveredId(null)}
                    />
                  }
                >
                  <span className="project-index-graph-node-dot">
                    {node.expandable ? (
                      node.expanded ? (
                        <MinusIcon aria-hidden />
                      ) : (
                        <PlusIcon aria-hidden />
                      )
                    ) : null}
                  </span>
                  <span className="project-index-graph-node-label">
                    {node.id === PROJECT_MAP_ROOT
                      ? message("projectIndexing.graphRoot")
                      : node.name}
                  </span>
                  {node.fileCount !== null ? (
                    <span className="project-index-graph-node-count">
                      {node.kind === "file"
                        ? message("projectIndexing.kind.file")
                        : message("projectIndexing.graphFileCount", {
                            count: number(node.fileCount),
                          })}
                    </span>
                  ) : null}
                </TooltipTrigger>
                <TooltipPopup>
                  <p>
                    {node.id === PROJECT_MAP_ROOT
                      ? message("projectIndexing.graphRoot")
                      : node.qualifiedName}
                  </p>
                  <p className="mt-1 font-mono text-xs">
                    {node.filePath}
                    {node.line === null ? "" : `:${node.line}`}
                  </p>
                  {node.expandable ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {message(
                        node.expanded
                          ? "projectIndexing.graphCollapse"
                          : "projectIndexing.graphExpand",
                      )}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {node.kind === "directory"
                      ? message("projectIndexing.graphDirectory")
                      : message(`projectIndexing.kind.${node.kind}`)}
                    {node.freshness === null
                      ? ""
                      : ` · ${message(`projectIndexing.freshness.${node.freshness}`)}`}
                  </p>
                </TooltipPopup>
              </Tooltip>
            </foreignObject>
          ))}
        </g>
      </svg>
      <div className="project-index-graph-footer">
        <div className="project-index-graph-legend">
          {overview ? (
            <span data-kind="directory">{message("projectIndexing.graphDirectory")}</span>
          ) : null}
          <span data-kind="file">{message("projectIndexing.kind.file")}</span>
          {overview ? (
            <span data-kind="contains">{message("projectIndexing.graphHierarchy")}</span>
          ) : null}
          {!overview || layout.nodes.some((node) => node.entityId !== null) ? (
            <>
              <span data-kind="symbol">{message("projectIndexing.graphSymbols")}</span>
              <span data-kind="type">{message("projectIndexing.graphTypes")}</span>
            </>
          ) : null}
        </div>
        <p>{message("projectIndexing.graphNavigation")}</p>
      </div>
      <details className="project-index-graph-notes">
        <summary>{message("projectIndexing.graphRelationships")}</summary>
        <p>
          {message(
            overview ? "projectIndexing.graphOverviewLegend" : "projectIndexing.graphMapLegend",
          )}
        </p>
        {overview && overview.omittedFiles > 0 ? (
          <p>
            {message("projectIndexing.graphFilesOmitted", { count: number(overview.omittedFiles) })}
          </p>
        ) : null}
        <p>{message("projectIndexing.staticRelationshipsHint")}</p>
        {layout.omittedEntities > 0 ? (
          <p>{message("projectIndexing.graphOmitted", { count: layout.omittedEntities })}</p>
        ) : null}
        {layout.relationshipsOmitted ? (
          <p>{message("projectIndexing.graphRelationshipsOmitted")}</p>
        ) : null}
      </details>
    </section>
  );
}
