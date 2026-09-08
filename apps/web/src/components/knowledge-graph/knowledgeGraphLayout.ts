import {
  computeKnowledgeGraphLayout,
  type KnowledgeGraphPosition,
} from "@t3tools/client-runtime/knowledge-graph";
import {
  KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeV1,
} from "@t3tools/contracts";

export interface KnowledgeGraphLayoutRequest {
  readonly type: "start";
  readonly requestId: number;
  readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
  readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
  readonly width: number;
  readonly height: number;
  readonly pinned: ReadonlyArray<readonly [KnowledgeGraphNodeId, KnowledgeGraphPosition]>;
  readonly initialPositions: ReadonlyArray<readonly [KnowledgeGraphNodeId, KnowledgeGraphPosition]>;
  readonly iterations: number;
}

export interface KnowledgeGraphLayoutPinRequest {
  readonly type: "pin";
  readonly requestId: number;
  readonly pinned: ReadonlyArray<readonly [KnowledgeGraphNodeId, KnowledgeGraphPosition]>;
}

export interface KnowledgeGraphLayoutVisibilityRequest {
  readonly type: "visibility";
  readonly requestId: number;
  readonly active: boolean;
}

export type KnowledgeGraphLayoutWorkerRequest =
  | KnowledgeGraphLayoutRequest
  | KnowledgeGraphLayoutPinRequest
  | KnowledgeGraphLayoutVisibilityRequest;

export interface KnowledgeGraphLayoutResponse {
  readonly type: "frame";
  readonly requestId: number;
  readonly positions: ReadonlyArray<readonly [KnowledgeGraphNodeId, KnowledgeGraphPosition]>;
  readonly settled: boolean;
}

export const KNOWLEDGE_GRAPH_LAYOUT_ITERATIONS_PER_FRAME = 2;
export const KNOWLEDGE_GRAPH_LAYOUT_FRAME_DELAY_MS = 32;
export const KNOWLEDGE_GRAPH_LAYOUT_STABLE_DISTANCE = 0.08;

export function mergeKnowledgeGraphPinnedPositions(
  positions: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>,
  pinned: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>,
): ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition> {
  return pinned.size === 0 ? positions : new Map([...positions, ...pinned]);
}

export function makeKnowledgeGraphLayoutRequest(input: {
  readonly requestId: number;
  readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
  readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
  readonly width: number;
  readonly height: number;
  readonly pinned: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly initialPositions?: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly prefersReducedMotion: boolean;
}): KnowledgeGraphLayoutRequest {
  const nodes = input.nodes.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES);
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  return {
    type: "start",
    requestId: input.requestId,
    nodes,
    edges: input.edges.filter(
      (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
    ),
    width: Math.max(1, input.width),
    height: Math.max(1, input.height),
    pinned: [...input.pinned].filter(([nodeId]) => nodeIds.has(nodeId)),
    initialPositions: [...(input.initialPositions ?? [])].filter(([nodeId]) => nodeIds.has(nodeId)),
    iterations: input.prefersReducedMotion ? 0 : 64,
  };
}

export function advanceKnowledgeGraphLayoutFrame(input: {
  readonly request: KnowledgeGraphLayoutRequest;
  readonly positions: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly pinned: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly remainingIterations: number;
}): {
  readonly positions: ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>;
  readonly remainingIterations: number;
  readonly stable: boolean;
} {
  const iterations = Math.min(
    KNOWLEDGE_GRAPH_LAYOUT_ITERATIONS_PER_FRAME,
    Math.max(0, input.remainingIterations),
  );
  if (iterations === 0) {
    return { positions: input.positions, remainingIterations: 0, stable: true };
  }
  const positions = computeKnowledgeGraphLayout({
    nodes: input.request.nodes,
    edges: input.request.edges,
    width: input.request.width,
    height: input.request.height,
    pinned: input.pinned,
    initialPositions: input.positions,
    iterations,
  });
  let maximumMovement = 0;
  for (const [nodeId, position] of positions) {
    const previous = input.positions.get(nodeId);
    if (!previous) continue;
    maximumMovement = Math.max(
      maximumMovement,
      Math.hypot(position.x - previous.x, position.y - previous.y),
    );
  }
  return {
    positions,
    remainingIterations: Math.max(0, input.remainingIterations - iterations),
    stable: maximumMovement <= KNOWLEDGE_GRAPH_LAYOUT_STABLE_DISTANCE,
  };
}
