import {
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphPatchV1,
  type KnowledgeGraphSnapshotV1,
  type KnowledgeGraphStatusEventV1,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_KNOWLEDGE_GRAPH_CLIENT_STATE,
  applyKnowledgeGraphStreamEvent,
} from "./knowledgeGraphState.ts";

const scopeId = "scope-1" as KnowledgeGraphNodeV1["scopeId"];

const node = (id: string, revision = 1): KnowledgeGraphNodeV1 => ({
  version: 1,
  nodeId: id as KnowledgeGraphNodeV1["nodeId"],
  scopeId,
  kind: "file",
  label: id,
  provenance: "deterministic",
  confidence: 1,
  evidenceIds: [],
  nodeRevision: revision,
});

const edge = (source: string, target: string): KnowledgeGraphEdgeV1 => ({
  version: 1,
  edgeId: `${source}:${target}` as KnowledgeGraphEdgeV1["edgeId"],
  scopeId,
  kind: "uses",
  sourceNodeId: source as KnowledgeGraphNodeV1["nodeId"],
  targetNodeId: target as KnowledgeGraphNodeV1["nodeId"],
  provenance: "deterministic",
  confidence: 1,
  evidenceIds: [],
  edgeRevision: 1,
});

const snapshot = (): KnowledgeGraphSnapshotV1 => ({
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
  nodes: [node("a"), node("b")],
  edges: [edge("a", "b")],
  evidence: [],
  status: {
    version: 1,
    scopeId,
    state: "ready",
    revision: 1,
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
});

describe("Knowledge Graph client stream state", () => {
  it("applies revisioned patches and removes edges whose endpoints disappear", () => {
    const initial = applyKnowledgeGraphStreamEvent(EMPTY_KNOWLEDGE_GRAPH_CLIENT_STATE, snapshot());
    const patch: KnowledgeGraphPatchV1 = {
      version: 1,
      type: "patch",
      scopeId,
      baseRevision: 1,
      revision: 2,
      upsertedNodes: [node("c", 2)],
      removedNodeIds: ["b" as KnowledgeGraphNodeV1["nodeId"]],
      upsertedEdges: [edge("a", "c")],
      removedEdgeIds: [],
      upsertedEvidence: [],
      removedEvidenceIds: [],
      changedNodeIds: ["b", "c"] as KnowledgeGraphNodeV1["nodeId"][],
      status: { ...snapshot().status, revision: 2, nodeCount: 2 },
    };

    const next = applyKnowledgeGraphStreamEvent(initial, patch);

    expect(next.snapshot?.revision).toBe(2);
    expect(next.snapshot?.nodes.map((entry) => entry.nodeId)).toEqual(["a", "c"]);
    expect(next.snapshot?.edges.map((entry) => entry.edgeId)).toEqual(["a:c"]);
    expect(next.invalidated).toBeNull();
  });

  it("invalidates on a revision gap instead of applying a partial graph", () => {
    const initial = applyKnowledgeGraphStreamEvent(EMPTY_KNOWLEDGE_GRAPH_CLIENT_STATE, snapshot());
    const patch: KnowledgeGraphPatchV1 = {
      version: 1,
      type: "patch",
      scopeId,
      baseRevision: 4,
      revision: 5,
      upsertedNodes: [],
      removedNodeIds: [],
      upsertedEdges: [],
      removedEdgeIds: [],
      upsertedEvidence: [],
      removedEvidenceIds: [],
      changedNodeIds: [],
      status: { ...snapshot().status, revision: 5 },
    };

    const next = applyKnowledgeGraphStreamEvent(initial, patch);

    expect(next.snapshot).toBeNull();
    expect(next.invalidated?.reason).toBe("revision-gap");
  });

  it("updates status without losing nodes and clears on a server invalidation", () => {
    const initial = applyKnowledgeGraphStreamEvent(EMPTY_KNOWLEDGE_GRAPH_CLIENT_STATE, snapshot());
    const status: KnowledgeGraphStatusEventV1 = {
      version: 1,
      type: "status",
      scopeId,
      revision: 2,
      status: { ...snapshot().status, revision: 2, state: "paused" },
    };
    const paused = applyKnowledgeGraphStreamEvent(initial, status);
    const invalidated = applyKnowledgeGraphStreamEvent(paused, {
      version: 1,
      type: "invalidate",
      scopeId,
      reason: "cleared",
      expectedRevision: 2,
      availableRevision: 3,
    });

    expect(paused.snapshot?.nodes).toHaveLength(2);
    expect(paused.snapshot?.status.state).toBe("paused");
    expect(invalidated.snapshot).toBeNull();
    expect(invalidated.invalidated?.reason).toBe("cleared");
  });

  it("ignores a stale status event instead of regressing the graph state", () => {
    const initial = applyKnowledgeGraphStreamEvent(EMPTY_KNOWLEDGE_GRAPH_CLIENT_STATE, {
      ...snapshot(),
      revision: 3,
      status: { ...snapshot().status, revision: 3, state: "ready" },
    });
    const staleStatus: KnowledgeGraphStatusEventV1 = {
      version: 1,
      type: "status",
      scopeId,
      revision: 2,
      status: { ...snapshot().status, revision: 2, state: "indexing" },
    };

    expect(applyKnowledgeGraphStreamEvent(initial, staleStatus)).toBe(initial);
  });
});
