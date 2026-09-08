import type { KnowledgeGraphEdgeV1, KnowledgeGraphNodeV1 } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  advanceKnowledgeGraphLayoutFrame,
  makeKnowledgeGraphLayoutRequest,
  mergeKnowledgeGraphPinnedPositions,
} from "./knowledgeGraphLayout";

const scopeId = "scope-1" as KnowledgeGraphNodeV1["scopeId"];

const nodes = Array.from(
  { length: 305 },
  (_, index): KnowledgeGraphNodeV1 => ({
    version: 1,
    nodeId: `node-${index}` as KnowledgeGraphNodeV1["nodeId"],
    scopeId,
    kind: "file",
    label: `Node ${index}`,
    provenance: "deterministic",
    confidence: 1,
    evidenceIds: [],
    nodeRevision: 1,
  }),
);

describe("makeKnowledgeGraphLayoutRequest", () => {
  it("caps worker work and disables iterative motion for reduced-motion users", () => {
    const request = makeKnowledgeGraphLayoutRequest({
      requestId: 7,
      nodes,
      edges: [],
      width: 800,
      height: 600,
      pinned: new Map(),
      prefersReducedMotion: true,
    });

    expect(request.nodes).toHaveLength(300);
    expect(request.type).toBe("start");
    expect(request.iterations).toBe(0);
    expect(request.requestId).toBe(7);
  });

  it("uses one finite worker pass for regular motion", () => {
    const request = makeKnowledgeGraphLayoutRequest({
      requestId: 8,
      nodes: nodes.slice(0, 3),
      edges: [],
      width: 640,
      height: 480,
      pinned: new Map([[nodes[0]!.nodeId, { x: 20, y: 30 }]]),
      prefersReducedMotion: false,
    });

    expect(request.iterations).toBeGreaterThan(0);
    expect(request.iterations).toBeLessThanOrEqual(64);
    expect(request.pinned).toEqual([[nodes[0]!.nodeId, { x: 20, y: 30 }]]);
  });

  it("advances the live physics map in bounded frames while keeping drag pins fixed", () => {
    const request = makeKnowledgeGraphLayoutRequest({
      requestId: 9,
      nodes: nodes.slice(0, 3),
      edges: [
        {
          version: 1,
          edgeId: "edge-1" as KnowledgeGraphEdgeV1["edgeId"],
          scopeId,
          kind: "uses",
          sourceNodeId: nodes[0]!.nodeId,
          targetNodeId: nodes[1]!.nodeId,
          provenance: "deterministic",
          confidence: 1,
          evidenceIds: [],
          edgeRevision: 1,
        },
      ],
      width: 640,
      height: 480,
      pinned: new Map([[nodes[0]!.nodeId, { x: 100, y: 120 }]]),
      initialPositions: new Map([
        [nodes[0]!.nodeId, { x: 100, y: 120 }],
        [nodes[1]!.nodeId, { x: 500, y: 120 }],
        [nodes[2]!.nodeId, { x: 320, y: 360 }],
      ]),
      prefersReducedMotion: false,
    });
    const frame = advanceKnowledgeGraphLayoutFrame({
      request,
      positions: new Map(request.initialPositions),
      pinned: new Map(request.pinned),
      remainingIterations: request.iterations,
    });

    expect(frame.remainingIterations).toBe(request.iterations - 2);
    expect(frame.positions.get(nodes[0]!.nodeId)).toEqual({ x: 100, y: 120 });
    expect(frame.positions.get(nodes[1]!.nodeId)).not.toEqual({ x: 500, y: 120 });
  });

  it("exhausts the animation budget without requiring a continuous timer", () => {
    const request = makeKnowledgeGraphLayoutRequest({
      requestId: 10,
      nodes: nodes.slice(0, 6),
      edges: [],
      width: 640,
      height: 480,
      pinned: new Map(),
      prefersReducedMotion: false,
    });
    let positions = new Map(request.initialPositions);
    if (positions.size === 0) {
      positions = new Map(
        request.nodes.map((entry, index) => [entry.nodeId, { x: 100 + index * 60, y: 200 }]),
      );
    }
    let remainingIterations = request.iterations;
    let frameCount = 0;
    while (remainingIterations > 0) {
      const frame = advanceKnowledgeGraphLayoutFrame({
        request,
        positions,
        pinned: new Map(),
        remainingIterations,
      });
      positions = new Map(frame.positions);
      remainingIterations = frame.remainingIterations;
      frameCount += 1;
    }

    expect(frameCount).toBe(32);
    const finished = advanceKnowledgeGraphLayoutFrame({
      request,
      positions,
      pinned: new Map(),
      remainingIterations,
    });
    expect(finished.positions).toBe(positions);
    expect(finished.stable).toBe(true);
  });

  it("overlays live drag pins without mutating the finite worker result", () => {
    const workerPositions = new Map([
      [nodes[0]!.nodeId, { x: 10, y: 20 }],
      [nodes[1]!.nodeId, { x: 30, y: 40 }],
    ]);
    const pinned = new Map([[nodes[0]!.nodeId, { x: 100, y: 120 }]]);

    expect(mergeKnowledgeGraphPinnedPositions(workerPositions, pinned)).toEqual(
      new Map([
        [nodes[0]!.nodeId, { x: 100, y: 120 }],
        [nodes[1]!.nodeId, { x: 30, y: 40 }],
      ]),
    );
    expect(workerPositions.get(nodes[0]!.nodeId)).toEqual({ x: 10, y: 20 });
    expect(mergeKnowledgeGraphPinnedPositions(workerPositions, new Map())).toBe(workerPositions);
  });
});
