import {
  type KnowledgeGraphEvidenceV1,
  type KnowledgeGraphInvalidateV1,
  type KnowledgeGraphPatchV1,
  type KnowledgeGraphSnapshotV1,
  type KnowledgeGraphStreamEvent,
} from "@t3tools/contracts";

export interface KnowledgeGraphClientState {
  readonly snapshot: KnowledgeGraphSnapshotV1 | null;
  readonly invalidated: KnowledgeGraphInvalidateV1 | null;
}

export const EMPTY_KNOWLEDGE_GRAPH_CLIENT_STATE: KnowledgeGraphClientState = {
  snapshot: null,
  invalidated: null,
};

function revisionGap(
  snapshot: KnowledgeGraphSnapshotV1 | null,
  patch: KnowledgeGraphPatchV1,
): KnowledgeGraphInvalidateV1 {
  return {
    version: 1,
    type: "invalidate",
    scopeId: patch.scopeId,
    reason: "revision-gap",
    expectedRevision: snapshot?.revision ?? 0,
    availableRevision: patch.revision,
  };
}

function applyPatch(
  snapshot: KnowledgeGraphSnapshotV1,
  patch: KnowledgeGraphPatchV1,
): KnowledgeGraphSnapshotV1 {
  const removedNodes = new Set(patch.removedNodeIds);
  const nodes = new Map(snapshot.nodes.map((node) => [node.nodeId, node] as const));
  for (const nodeId of removedNodes) nodes.delete(nodeId);
  for (const node of patch.upsertedNodes) nodes.set(node.nodeId, node);

  const edges = new Map(snapshot.edges.map((edge) => [edge.edgeId, edge] as const));
  for (const edgeId of patch.removedEdgeIds) edges.delete(edgeId);
  for (const edge of patch.upsertedEdges) edges.set(edge.edgeId, edge);
  const retainedNodeIds = new Set(nodes.keys());

  const evidence = new Map<string, KnowledgeGraphEvidenceV1>(
    snapshot.evidence.map((item) => [item.evidenceId, item]),
  );
  for (const evidenceId of patch.removedEvidenceIds) evidence.delete(evidenceId);
  for (const item of patch.upsertedEvidence) evidence.set(item.evidenceId, item);

  return {
    ...snapshot,
    revision: patch.revision,
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter(
      (edge) => retainedNodeIds.has(edge.sourceNodeId) && retainedNodeIds.has(edge.targetNodeId),
    ),
    evidence: [...evidence.values()],
    status: patch.status,
  };
}

export function applyKnowledgeGraphStreamEvent(
  current: KnowledgeGraphClientState,
  event: KnowledgeGraphStreamEvent,
): KnowledgeGraphClientState {
  switch (event.type) {
    case "snapshot":
      return { snapshot: event, invalidated: null };
    case "invalidate":
      return { snapshot: null, invalidated: event };
    case "patch": {
      const snapshot = current.snapshot;
      if (
        snapshot === null ||
        snapshot.scope.scopeId !== event.scopeId ||
        snapshot.revision !== event.baseRevision
      ) {
        return { snapshot: null, invalidated: revisionGap(snapshot, event) };
      }
      return { snapshot: applyPatch(snapshot, event), invalidated: null };
    }
    case "status": {
      const snapshot = current.snapshot;
      if (
        snapshot === null ||
        snapshot.scope.scopeId !== event.scopeId ||
        event.revision < snapshot.revision
      ) {
        return current;
      }
      return {
        snapshot: {
          ...snapshot,
          revision: Math.max(snapshot.revision, event.revision),
          status: event.status,
        },
        invalidated: null,
      };
    }
  }
}
