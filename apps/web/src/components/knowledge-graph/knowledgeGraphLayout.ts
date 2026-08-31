import {
  KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeV1,
} from "@t3tools/contracts";
import type { KnowledgeGraphPosition } from "@t3tools/client-runtime/knowledge-graph";

export interface KnowledgeGraphLayoutRequest {
  readonly requestId: number;
  readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
  readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
  readonly width: number;
  readonly height: number;
  readonly pinned: ReadonlyArray<readonly [KnowledgeGraphNodeId, KnowledgeGraphPosition]>;
  readonly iterations: number;
}

export interface KnowledgeGraphLayoutResponse {
  readonly requestId: number;
  readonly positions: ReadonlyArray<readonly [KnowledgeGraphNodeId, KnowledgeGraphPosition]>;
}

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
  readonly prefersReducedMotion: boolean;
}): KnowledgeGraphLayoutRequest {
  const nodes = input.nodes.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES);
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  return {
    requestId: input.requestId,
    nodes,
    edges: input.edges.filter(
      (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
    ),
    width: Math.max(1, input.width),
    height: Math.max(1, input.height),
    pinned: [...input.pinned].filter(([nodeId]) => nodeIds.has(nodeId)),
    iterations: input.prefersReducedMotion ? 0 : 40,
  };
}
