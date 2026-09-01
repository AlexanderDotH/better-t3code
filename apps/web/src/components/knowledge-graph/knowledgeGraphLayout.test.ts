import type { KnowledgeGraphNodeV1 } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
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
