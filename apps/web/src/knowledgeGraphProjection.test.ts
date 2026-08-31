import type {
  KnowledgeGraphEdgeV1,
  KnowledgeGraphNodeV1,
  KnowledgeGraphPatchV1,
  KnowledgeGraphSnapshotV1,
  KnowledgeGraphStreamEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyKnowledgeGraphStreamEvent,
  type KnowledgeGraphClientState,
} from "@t3tools/client-runtime/state/knowledge-graph";

const scopeId = "scope-1" as KnowledgeGraphSnapshotV1["scope"]["scopeId"];

function node(index: number): KnowledgeGraphNodeV1 {
  return {
    version: 1,
    nodeId: `node-${index}` as KnowledgeGraphNodeV1["nodeId"],
    scopeId,
    kind: "file",
    label: `Node ${index}`,
    provenance: "deterministic",
    confidence: 1,
    evidenceIds: [],
    nodeRevision: index,
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
    confidence: 1,
    evidenceIds: [],
    edgeRevision: index,
  };
}

function snapshot(): KnowledgeGraphSnapshotV1 {
  const first = node(1);
  const second = node(2);
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
    revision: 2,
    nodes: [first, second],
    edges: [edge(1, first.nodeId, second.nodeId)],
    evidence: [],
    status: {
      version: 1,
      scopeId,
      state: "ready",
      revision: 2,
      indexedFileCount: 2,
      nodeCount: 2,
      edgeCount: 1,
      evidenceCount: 0,
      semanticQueueDepth: 0,
      truncated: {
        eligibleFiles: false,
        nodes: false,
        visibleNodes: false,
        omittedFileCount: 0,
        omittedNodeCount: 0,
      },
    },
    generatedAt: "2026-08-29T00:00:00.000Z",
  };
}

describe("applyKnowledgeGraphStreamEvent", () => {
  const state = (value: KnowledgeGraphSnapshotV1): KnowledgeGraphClientState => ({
    snapshot: value,
    invalidated: null,
  });

  it("applies a contiguous patch with removals and upserts", () => {
    const initial = snapshot();
    const replacement = { ...node(3), label: "Replacement" };
    const patch: KnowledgeGraphPatchV1 = {
      version: 1,
      type: "patch",
      scopeId,
      baseRevision: 2,
      revision: 3,
      upsertedNodes: [replacement],
      removedNodeIds: [initial.nodes[1]!.nodeId],
      upsertedEdges: [],
      removedEdgeIds: [initial.edges[0]!.edgeId],
      upsertedEvidence: [],
      removedEvidenceIds: [],
      changedNodeIds: [replacement.nodeId],
      status: { ...initial.status, revision: 3, nodeCount: 2, edgeCount: 0 },
    };

    const next = applyKnowledgeGraphStreamEvent(state(initial), patch).snapshot;

    expect(next?.revision).toBe(3);
    expect(next?.nodes.map((entry) => entry.label)).toEqual(["Node 1", "Replacement"]);
    expect(next?.edges).toEqual([]);
  });

  it("drops stale state on revision gaps and explicit invalidation", () => {
    const initial = snapshot();
    const gap = {
      version: 1,
      type: "patch",
      scopeId,
      baseRevision: 9,
      revision: 10,
      upsertedNodes: [],
      removedNodeIds: [],
      upsertedEdges: [],
      removedEdgeIds: [],
      upsertedEvidence: [],
      removedEvidenceIds: [],
      changedNodeIds: [],
      status: { ...initial.status, revision: 10 },
    } as KnowledgeGraphStreamEvent;
    const invalidate = {
      version: 1,
      type: "invalidate",
      scopeId,
      reason: "revision-gap",
      expectedRevision: 2,
      availableRevision: 10,
    } as KnowledgeGraphStreamEvent;

    expect(applyKnowledgeGraphStreamEvent(state(initial), gap).snapshot).toBeNull();
    expect(applyKnowledgeGraphStreamEvent(state(initial), invalidate).snapshot).toBeNull();
  });

  it("keeps entities while applying a current status update", () => {
    const initial = snapshot();
    const event: KnowledgeGraphStreamEvent = {
      version: 1,
      type: "status",
      scopeId,
      revision: 3,
      status: { ...initial.status, revision: 3, state: "paused" },
    };

    expect(applyKnowledgeGraphStreamEvent(state(initial), event).snapshot).toMatchObject({
      revision: 3,
      nodes: initial.nodes,
      status: { state: "paused" },
    });
  });
});
