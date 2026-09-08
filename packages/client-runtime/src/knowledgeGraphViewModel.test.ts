import {
  KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphNodeKind,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphSnapshotV1,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  clampKnowledgeGraphViewport,
  computeKnowledgeGraphLayout,
  deriveKnowledgeGraphView,
  graphPointFromScreenPoint,
  screenPointFromGraphPoint,
} from "./knowledgeGraphViewModel.ts";

const scopeId = "scope-1" as KnowledgeGraphNodeV1["scopeId"];

function node(index: number, overrides: Partial<KnowledgeGraphNodeV1> = {}): KnowledgeGraphNodeV1 {
  return {
    version: 1,
    nodeId: `node-${index}` as KnowledgeGraphNodeV1["nodeId"],
    scopeId,
    kind: "file",
    label: `Node ${index}`,
    provenance: "deterministic",
    confidence: 1,
    evidenceIds: [],
    nodeRevision: 1,
    ...overrides,
  };
}

function edge(
  index: number,
  sourceNodeId: KnowledgeGraphNodeV1["nodeId"],
  targetNodeId: KnowledgeGraphNodeV1["nodeId"],
): KnowledgeGraphEdgeV1 {
  return {
    version: 1,
    edgeId: `edge-${index}` as KnowledgeGraphEdgeV1["edgeId"],
    scopeId,
    kind: "uses",
    sourceNodeId,
    targetNodeId,
    provenance: "deterministic",
    confidence: 0.9,
    evidenceIds: [],
    edgeRevision: 1,
  };
}

function snapshot(
  nodes: readonly KnowledgeGraphNodeV1[],
  edges: readonly KnowledgeGraphEdgeV1[] = [],
): KnowledgeGraphSnapshotV1 {
  return {
    version: 1,
    type: "snapshot",
    scope: {
      version: 1,
      scopeId,
      environmentId: "env-1" as KnowledgeGraphSnapshotV1["scope"]["environmentId"],
      projectId: "project-1" as KnowledgeGraphSnapshotV1["scope"]["projectId"],
      effectiveWorkspaceRoot: "/workspace",
      isWorktree: false,
    },
    revision: 1,
    nodes: [...nodes],
    edges: [...edges],
    evidence: [],
    status: {
      version: 1,
      scopeId,
      state: "ready",
      revision: 1,
      indexedFileCount: nodes.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      evidenceCount: 0,
      semanticQueueDepth: 0,
      truncated: {
        eligibleFiles: false,
        nodes: false,
        visibleNodes: nodes.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
        omittedFileCount: 0,
        omittedNodeCount: Math.max(0, nodes.length - KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
      },
    },
    generatedAt: "2026-08-29T00:00:00.000Z",
  } as KnowledgeGraphSnapshotV1;
}

describe("deriveKnowledgeGraphView", () => {
  it("caps the visible graph at 300 nodes and prunes edges with hidden endpoints", () => {
    const nodes = Array.from({ length: 305 }, (_, index) => node(index));
    const edges = [
      edge(1, nodes[0]!.nodeId, nodes[1]!.nodeId),
      edge(2, nodes[0]!.nodeId, nodes[304]!.nodeId),
    ];

    const view = deriveKnowledgeGraphView({ snapshot: snapshot(nodes, edges) });

    expect(view.nodes).toHaveLength(KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES);
    expect(view.edges.map((entry) => entry.edgeId)).toEqual([edges[0]!.edgeId]);
    expect(view.truncation.visibleNodes).toBe(true);
    expect(view.matchingNodeCount).toBe(305);
  });

  it("searches source metadata, filters kinds, and exposes one expanded relationship list", () => {
    const packageNode = node(1, { kind: "package", label: "Runtime package" });
    const sourceNode = node(2, {
      kind: "file",
      label: "Graph state",
      summary: "Applies revisioned patches",
      source: { path: "packages/client-runtime/src/knowledgeGraphState.ts", startLine: 12 },
      provenance: "semantic",
      confidence: 0.82,
    });
    const unrelatedNode = node(3, { kind: "technology", label: "React" });
    const relationship = edge(1, packageNode.nodeId, sourceNode.nodeId);

    const view = deriveKnowledgeGraphView({
      snapshot: snapshot([packageNode, sourceNode, unrelatedNode], [relationship]),
      query: "revisioned",
      kinds: new Set<KnowledgeGraphNodeKind>(["file"]),
      expandedNodeId: sourceNode.nodeId,
    });

    expect(view.nodes.map((entry) => entry.nodeId)).toEqual([sourceNode.nodeId]);
    expect(view.expandedNode?.nodeId).toBe(sourceNode.nodeId);
    expect(view.relationships).toEqual([
      expect.objectContaining({
        direction: "incoming",
        edge: relationship,
        otherNode: packageNode,
      }),
    ]);
  });
});

describe("computeKnowledgeGraphLayout", () => {
  it("returns deterministic finite positions and preserves dragged pins", () => {
    const nodes = [node(1), node(2), node(3)];
    const edges = [edge(1, nodes[0]!.nodeId, nodes[1]!.nodeId)];
    const input = {
      nodes,
      edges,
      width: 640,
      height: 420,
      pinned: new Map([[nodes[0]!.nodeId, { x: 40, y: 50 }]]),
    };

    const first = computeKnowledgeGraphLayout(input);
    const second = computeKnowledgeGraphLayout(input);

    expect(first).toEqual(second);
    expect(first.get(nodes[0]!.nodeId)).toEqual({ x: 40, y: 50 });
    for (const position of first.values()) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(640);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(420);
    }
  });

  it("keeps unpinned node labels inside the canvas gutters", () => {
    const layout = computeKnowledgeGraphLayout({
      nodes: Array.from({ length: 12 }, (_, index) => node(index)),
      edges: [],
      width: 640,
      height: 420,
      iterations: 40,
    });

    for (const position of layout.values()) {
      expect(position.x).toBeGreaterThanOrEqual(76);
      expect(position.x).toBeLessThanOrEqual(640 - 76);
      expect(position.y).toBeGreaterThanOrEqual(24);
      expect(position.y).toBeLessThanOrEqual(420 - 24);
    }
  });

  it("relaxes linked nodes from a previous animation frame without moving drag pins", () => {
    const nodes = [node(1), node(2), node(3)];
    const initialPositions = new Map([
      [nodes[0]!.nodeId, { x: 100, y: 120 }],
      [nodes[1]!.nodeId, { x: 520, y: 120 }],
      [nodes[2]!.nodeId, { x: 320, y: 330 }],
    ]);
    const layout = computeKnowledgeGraphLayout({
      nodes,
      edges: [edge(1, nodes[0]!.nodeId, nodes[1]!.nodeId)],
      width: 640,
      height: 420,
      pinned: new Map([[nodes[0]!.nodeId, initialPositions.get(nodes[0]!.nodeId)!]]),
      initialPositions,
      iterations: 2,
    });

    expect(layout.get(nodes[0]!.nodeId)).toEqual({ x: 100, y: 120 });
    expect(layout.get(nodes[1]!.nodeId)!.x).toBeLessThan(520);
  });

  it("separates overlapping labels with deterministic collision forces", () => {
    const nodes = [node(1, { label: "Long overlapping node" }), node(2, { label: "Peer node" })];
    const initialPositions = new Map(
      nodes.map((entry) => [entry.nodeId, { x: 320, y: 210 }] as const),
    );
    const layout = computeKnowledgeGraphLayout({
      nodes,
      edges: [],
      width: 640,
      height: 420,
      initialPositions,
      iterations: 8,
    });
    const first = layout.get(nodes[0]!.nodeId)!;
    const second = layout.get(nodes[1]!.nodeId)!;

    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(20);
  });
});

describe("Knowledge Graph viewport", () => {
  it("clamps zoom and round-trips graph coordinates for gestures", () => {
    const viewport = clampKnowledgeGraphViewport({ scale: 9, translateX: 40, translateY: -20 });
    const graphPoint = graphPointFromScreenPoint({ x: 190, y: 80 }, viewport);

    expect(viewport.scale).toBe(2.5);
    expect(screenPointFromGraphPoint(graphPoint, viewport)).toEqual({ x: 190, y: 80 });
    expect(clampKnowledgeGraphViewport({ scale: 0, translateX: 0, translateY: 0 }).scale).toBe(0.5);
  });
});
