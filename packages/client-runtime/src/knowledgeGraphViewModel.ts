import {
  KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeKind,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphSnapshotV1,
  type KnowledgeGraphTruncationV1,
} from "@t3tools/contracts";

export interface KnowledgeGraphPosition {
  readonly x: number;
  readonly y: number;
}

export interface KnowledgeGraphViewport {
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
}

const MIN_KNOWLEDGE_GRAPH_SCALE = 0.5;
const MAX_KNOWLEDGE_GRAPH_SCALE = 2.5;
const KNOWLEDGE_GRAPH_HORIZONTAL_PADDING = 76;
const KNOWLEDGE_GRAPH_VERTICAL_PADDING = 24;

export function clampKnowledgeGraphViewport(
  viewport: KnowledgeGraphViewport,
): KnowledgeGraphViewport {
  return {
    scale: Math.min(
      MAX_KNOWLEDGE_GRAPH_SCALE,
      Math.max(MIN_KNOWLEDGE_GRAPH_SCALE, Number.isFinite(viewport.scale) ? viewport.scale : 1),
    ),
    translateX: Number.isFinite(viewport.translateX) ? viewport.translateX : 0,
    translateY: Number.isFinite(viewport.translateY) ? viewport.translateY : 0,
  };
}

export function screenPointFromGraphPoint(
  point: KnowledgeGraphPosition,
  viewport: KnowledgeGraphViewport,
): KnowledgeGraphPosition {
  const resolved = clampKnowledgeGraphViewport(viewport);
  return {
    x: point.x * resolved.scale + resolved.translateX,
    y: point.y * resolved.scale + resolved.translateY,
  };
}

export function graphPointFromScreenPoint(
  point: KnowledgeGraphPosition,
  viewport: KnowledgeGraphViewport,
): KnowledgeGraphPosition {
  const resolved = clampKnowledgeGraphViewport(viewport);
  return {
    x: (point.x - resolved.translateX) / resolved.scale,
    y: (point.y - resolved.translateY) / resolved.scale,
  };
}

export interface KnowledgeGraphRelationshipView {
  readonly edge: KnowledgeGraphEdgeV1;
  readonly direction: "incoming" | "outgoing";
  readonly otherNode: KnowledgeGraphNodeV1;
}

export interface KnowledgeGraphViewModel {
  readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
  readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
  readonly expandedNode: KnowledgeGraphNodeV1 | null;
  readonly relationships: ReadonlyArray<KnowledgeGraphRelationshipView>;
  readonly matchingNodeCount: number;
  readonly truncation: KnowledgeGraphTruncationV1;
}

export interface KnowledgeGraphViewInput {
  readonly snapshot: KnowledgeGraphSnapshotV1;
  readonly query?: string;
  readonly kinds?: ReadonlySet<KnowledgeGraphNodeKind>;
  readonly expandedNodeId?: KnowledgeGraphNodeId | null;
  readonly maxVisibleNodes?: number;
}

const searchableNodeText = (node: KnowledgeGraphNodeV1): string =>
  [node.label, node.summary, node.source?.path, node.source?.symbol, node.language, node.kind]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLocaleLowerCase();

function matchesNode(
  node: KnowledgeGraphNodeV1,
  normalizedQuery: string,
  kinds: ReadonlySet<KnowledgeGraphNodeKind> | undefined,
): boolean {
  if (kinds && kinds.size > 0 && !kinds.has(node.kind)) return false;
  return normalizedQuery.length === 0 || searchableNodeText(node).includes(normalizedQuery);
}

function relationshipViews(
  snapshot: KnowledgeGraphSnapshotV1,
  expandedNode: KnowledgeGraphNodeV1 | null,
): ReadonlyArray<KnowledgeGraphRelationshipView> {
  if (!expandedNode) return [];
  const nodesById = new Map(snapshot.nodes.map((node) => [node.nodeId, node] as const));
  return snapshot.edges.flatMap((edge): ReadonlyArray<KnowledgeGraphRelationshipView> => {
    if (edge.sourceNodeId === expandedNode.nodeId) {
      const otherNode = nodesById.get(edge.targetNodeId);
      return otherNode ? [{ edge, direction: "outgoing", otherNode }] : [];
    }
    if (edge.targetNodeId === expandedNode.nodeId) {
      const otherNode = nodesById.get(edge.sourceNodeId);
      return otherNode ? [{ edge, direction: "incoming", otherNode }] : [];
    }
    return [];
  });
}

export function deriveKnowledgeGraphView(input: KnowledgeGraphViewInput): KnowledgeGraphViewModel {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const matchingNodes = input.snapshot.nodes.filter((node) =>
    matchesNode(node, query, input.kinds),
  );
  const maxVisibleNodes = Math.max(
    1,
    Math.min(
      KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
      input.maxVisibleNodes ?? KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
    ),
  );
  const nodes = matchingNodes.slice(0, maxVisibleNodes);
  const visibleNodeIds = new Set(nodes.map((node) => node.nodeId));
  const edges = input.snapshot.edges.filter(
    (edge) => visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId),
  );
  const expandedNode = input.expandedNodeId
    ? (input.snapshot.nodes.find((node) => node.nodeId === input.expandedNodeId) ?? null)
    : null;

  return {
    nodes,
    edges,
    expandedNode,
    relationships: relationshipViews(input.snapshot, expandedNode),
    matchingNodeCount: matchingNodes.length,
    truncation: {
      ...input.snapshot.status.truncated,
      visibleNodes:
        input.snapshot.status.truncated.visibleNodes || matchingNodes.length > maxVisibleNodes,
      omittedNodeCount:
        input.snapshot.status.truncated.omittedNodeCount +
        Math.max(0, matchingNodes.length - maxVisibleNodes),
    },
  };
}

export interface KnowledgeGraphLayoutInput {
  readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
  readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
  readonly width: number;
  readonly height: number;
  readonly pinned?: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly initialPositions?: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly iterations?: number;
}

interface MutablePosition {
  x: number;
  y: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));

const collisionRadius = (node: KnowledgeGraphNodeV1): number =>
  Math.min(72, Math.max(28, 18 + node.label.length * 3.2));

function initialPosition(
  index: number,
  count: number,
  width: number,
  height: number,
): MutablePosition {
  if (count <= 1) return { x: width / 2, y: height / 2 };
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const radius = Math.sqrt((index + 0.5) / count) * Math.min(width, height) * 0.38;
  return {
    x: width / 2 + Math.cos(angle) * radius,
    y: height / 2 + Math.sin(angle) * radius,
  };
}

/**
 * A deterministic, finite force pass shared by web and mobile. Web executes
 * it in a Worker; mobile can reuse the identical bounded projection without
 * persisting presentation coordinates in the graph contract.
 */
export function computeKnowledgeGraphLayout(
  input: KnowledgeGraphLayoutInput,
): ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition> {
  const width = Math.max(1, Number.isFinite(input.width) ? input.width : 1);
  const height = Math.max(1, Number.isFinite(input.height) ? input.height : 1);
  const horizontalPadding = Math.min(KNOWLEDGE_GRAPH_HORIZONTAL_PADDING, width / 2);
  const verticalPadding = Math.min(KNOWLEDGE_GRAPH_VERTICAL_PADDING, height / 2);
  const nodes = input.nodes.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES);
  const positions = new Map<KnowledgeGraphNodeId, MutablePosition>();
  const pinned = input.pinned ?? new Map<KnowledgeGraphNodeId, KnowledgeGraphPosition>();
  const initialPositions =
    input.initialPositions ?? new Map<KnowledgeGraphNodeId, KnowledgeGraphPosition>();
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const edges = input.edges.filter(
    (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
  );
  const radii = new Map(nodes.map((node) => [node.nodeId, collisionRadius(node)] as const));

  nodes.forEach((node, index) => {
    const fixed = pinned.get(node.nodeId);
    const initial = initialPositions.get(node.nodeId);
    const position = initial ?? initialPosition(index, nodes.length, width, height);
    positions.set(
      node.nodeId,
      fixed
        ? { ...fixed }
        : {
            x: clamp(position.x, horizontalPadding, width - horizontalPadding),
            y: clamp(position.y, verticalPadding, height - verticalPadding),
          },
    );
  });

  const iterations = Math.max(0, Math.min(64, Math.trunc(input.iterations ?? 40)));
  const repulsionScale = Math.min(1, 64 / Math.max(1, nodes.length));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const movement = new Map<KnowledgeGraphNodeId, MutablePosition>(
      nodes.map((node) => [node.nodeId, { x: 0, y: 0 }]),
    );

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex]!;
      const leftPosition = positions.get(left.nodeId)!;
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex]!;
        const rightPosition = positions.get(right.nodeId)!;
        let dx = rightPosition.x - leftPosition.x;
        let dy = rightPosition.y - leftPosition.y;
        if (dx === 0 && dy === 0) {
          dx = leftIndex % 2 === 0 ? 0.01 : -0.01;
          dy = rightIndex % 2 === 0 ? 0.01 : -0.01;
        }
        const distance = Math.max(1, Math.hypot(dx, dy));
        const unitX = dx / distance;
        const unitY = dy / distance;
        const minimumDistance = radii.get(left.nodeId)! + radii.get(right.nodeId)! + 12;
        const overlap = Math.max(0, minimumDistance - distance);
        const repulsion =
          Math.min(2.5, (minimumDistance * minimumDistance * 0.14) / (distance * distance)) *
            repulsionScale +
          Math.min(7, overlap * 0.1);
        movement.get(left.nodeId)!.x -= unitX * repulsion;
        movement.get(left.nodeId)!.y -= unitY * repulsion;
        movement.get(right.nodeId)!.x += unitX * repulsion;
        movement.get(right.nodeId)!.y += unitY * repulsion;
      }
    }

    for (const edge of edges) {
      const source = positions.get(edge.sourceNodeId)!;
      const target = positions.get(edge.targetNodeId)!;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const unitX = dx / distance;
      const unitY = dy / distance;
      const restingDistance = radii.get(edge.sourceNodeId)! + radii.get(edge.targetNodeId)! + 52;
      const spring = clamp((distance - restingDistance) * 0.022, -4, 4);
      movement.get(edge.sourceNodeId)!.x += unitX * spring;
      movement.get(edge.sourceNodeId)!.y += unitY * spring;
      movement.get(edge.targetNodeId)!.x -= unitX * spring;
      movement.get(edge.targetNodeId)!.y -= unitY * spring;
    }

    for (const node of nodes) {
      const fixed = pinned.get(node.nodeId);
      if (fixed) {
        positions.set(node.nodeId, { ...fixed });
        continue;
      }
      const current = positions.get(node.nodeId)!;
      const delta = movement.get(node.nodeId)!;
      const deltaLength = Math.hypot(delta.x, delta.y);
      const stepScale = deltaLength > 8 ? 8 / deltaLength : 1;
      positions.set(node.nodeId, {
        x: clamp(
          current.x + delta.x * stepScale + (width / 2 - current.x) * 0.004,
          horizontalPadding,
          width - horizontalPadding,
        ),
        y: clamp(
          current.y + delta.y * stepScale + (height / 2 - current.y) * 0.004,
          verticalPadding,
          height - verticalPadding,
        ),
      });
    }
  }

  return new Map([...positions].map(([nodeId, position]) => [nodeId, { ...position }] as const));
}
