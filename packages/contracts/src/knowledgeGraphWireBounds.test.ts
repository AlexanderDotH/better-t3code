import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  KNOWLEDGE_GRAPH_MAX_CLAIM_TOKEN_LENGTH,
  KNOWLEDGE_GRAPH_MAX_EDGE_ID_LENGTH,
  KNOWLEDGE_GRAPH_MAX_EVIDENCE_ID_LENGTH,
  KNOWLEDGE_GRAPH_MAX_EVIDENCE_REFS_PER_ENTITY,
  KNOWLEDGE_GRAPH_MAX_NODE_ID_LENGTH,
  KNOWLEDGE_GRAPH_MAX_QUERY_FILTER_KINDS,
  KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES,
  KNOWLEDGE_GRAPH_MAX_SCOPE_ID_LENGTH,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_JOB_ID_LENGTH,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  KNOWLEDGE_GRAPH_MAX_WIRE_PAYLOAD_BYTES,
  KnowledgeGraphClaimToken,
  KnowledgeGraphEdgeId,
  KnowledgeGraphEdgeV1,
  KnowledgeGraphEvidenceId,
  KnowledgeGraphNodeId,
  KnowledgeGraphNodeV1,
  KnowledgeGraphPatchV1,
  KnowledgeGraphQueryInput,
  KnowledgeGraphQueryResultV1,
  KnowledgeGraphScopeId,
  KnowledgeGraphSemanticJobId,
  KnowledgeGraphSnapshotV1,
} from "./knowledgeGraph.ts";

const exactLengthId = (prefix: string, length: number): string => `${prefix}:`.padEnd(length, "x");

const scopeId = exactLengthId("scope", KNOWLEDGE_GRAPH_MAX_SCOPE_ID_LENGTH);
const evidenceIds = Array.from(
  { length: KNOWLEDGE_GRAPH_MAX_EVIDENCE_REFS_PER_ENTITY },
  (_, index) => exactLengthId(`e${index}`, KNOWLEDGE_GRAPH_MAX_EVIDENCE_ID_LENGTH),
);

const node = {
  version: 1,
  nodeId: exactLengthId("node", KNOWLEDGE_GRAPH_MAX_NODE_ID_LENGTH),
  scopeId,
  kind: "file",
  label: "x",
  provenance: "deterministic",
  confidence: 1,
  evidenceIds,
  nodeRevision: 1,
} as const;

const edge = {
  version: 1,
  edgeId: exactLengthId("edge", KNOWLEDGE_GRAPH_MAX_EDGE_ID_LENGTH),
  scopeId,
  kind: "uses",
  sourceNodeId: exactLengthId("source", KNOWLEDGE_GRAPH_MAX_NODE_ID_LENGTH),
  targetNodeId: exactLengthId("target", KNOWLEDGE_GRAPH_MAX_NODE_ID_LENGTH),
  provenance: "deterministic",
  confidence: 1,
  evidenceIds,
  edgeRevision: 1,
} as const;

const evidence = {
  version: 1,
  evidenceId: exactLengthId("evidence", KNOWLEDGE_GRAPH_MAX_EVIDENCE_ID_LENGTH),
  scopeId,
  kind: "source",
  fingerprint: "x",
  confidence: 1,
  evidenceRevision: 1,
} as const;

const scope = {
  version: 1,
  scopeId,
  environmentId: "environment-1",
  projectId: "project-1",
  effectiveWorkspaceRoot: "/workspace/project",
  isWorktree: false,
} as const;

const status = {
  version: 1,
  scopeId,
  state: "ready",
  revision: 1,
  indexedFileCount: 0,
  nodeCount: KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  edgeCount: KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES,
  evidenceCount: KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE,
  semanticQueueDepth: 0,
  truncated: {
    eligibleFiles: false,
    nodes: false,
    visibleNodes: false,
    omittedFileCount: 0,
    omittedNodeCount: 0,
  },
} as const;

const encodedBytes = <Value, Encoded>(
  schema: Schema.Codec<Value, Encoded, never, never>,
  value: Value,
): number => new TextEncoder().encode(JSON.stringify(Schema.encodeSync(schema)(value))).byteLength;
const decodeEdgeId = Schema.decodeUnknownSync(KnowledgeGraphEdgeId);
const decodeSemanticJobId = Schema.decodeUnknownSync(KnowledgeGraphSemanticJobId);
const decodeClaimToken = Schema.decodeUnknownSync(KnowledgeGraphClaimToken);

describe("Knowledge Graph wire bounds", () => {
  it.each([
    [KnowledgeGraphScopeId, KNOWLEDGE_GRAPH_MAX_SCOPE_ID_LENGTH],
    [KnowledgeGraphNodeId, KNOWLEDGE_GRAPH_MAX_NODE_ID_LENGTH],
    [KnowledgeGraphEdgeId, KNOWLEDGE_GRAPH_MAX_EDGE_ID_LENGTH],
    [KnowledgeGraphEvidenceId, KNOWLEDGE_GRAPH_MAX_EVIDENCE_ID_LENGTH],
    [KnowledgeGraphSemanticJobId, KNOWLEDGE_GRAPH_MAX_SEMANTIC_JOB_ID_LENGTH],
    [KnowledgeGraphClaimToken, KNOWLEDGE_GRAPH_MAX_CLAIM_TOKEN_LENGTH],
  ] as const)("bounds branded identifiers without changing valid values", (schema, limit) => {
    const decode = Schema.decodeUnknownSync(schema);
    const accepted = exactLengthId("kg", limit);

    expect(decode(accepted)).toBe(accepted);
    expect(() => decode(`${accepted}x`)).toThrow();
  });

  it("retains the longest IDs derived from valid scope and node IDs", () => {
    const semanticEdgeId = `semantic:${node.nodeId}:co-changes-with:${edge.targetNodeId}`;
    const semanticJobId = `${scopeId}:${node.nodeId}`;
    const claimToken = `environment-00000000-0000-0000-0000-000000000000:1788048000000:${semanticJobId}`;

    expect(decodeEdgeId(semanticEdgeId)).toBe(semanticEdgeId);
    expect(decodeSemanticJobId(semanticJobId)).toBe(semanticJobId);
    expect(decodeClaimToken(claimToken)).toBe(claimToken);
  });

  it("bounds evidence references on every wire entity", () => {
    const decodeNode = Schema.decodeUnknownSync(KnowledgeGraphNodeV1);
    const decodeEdge = Schema.decodeUnknownSync(KnowledgeGraphEdgeV1);

    expect(decodeNode(node).evidenceIds).toHaveLength(KNOWLEDGE_GRAPH_MAX_EVIDENCE_REFS_PER_ENTITY);
    expect(decodeEdge(edge).evidenceIds).toHaveLength(KNOWLEDGE_GRAPH_MAX_EVIDENCE_REFS_PER_ENTITY);
    expect(() =>
      decodeNode({
        ...node,
        evidenceIds: [
          ...node.evidenceIds,
          exactLengthId("overflow", KNOWLEDGE_GRAPH_MAX_EVIDENCE_ID_LENGTH),
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeEdge({
        ...edge,
        evidenceIds: [
          ...edge.evidenceIds,
          exactLengthId("overflow", KNOWLEDGE_GRAPH_MAX_EVIDENCE_ID_LENGTH),
        ],
      }),
    ).toThrow();
  });

  it("keeps maximum visible snapshot and patch collections inside the encoded byte budget", () => {
    const decodeSnapshot = Schema.decodeUnknownSync(KnowledgeGraphSnapshotV1);
    const decodePatch = Schema.decodeUnknownSync(KnowledgeGraphPatchV1);
    const snapshot = decodeSnapshot({
      version: 1,
      type: "snapshot",
      scope,
      revision: 1,
      nodes: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES }, () => node),
      edges: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES }, () => edge),
      evidence: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE }, () => evidence),
      status,
      generatedAt: "2026-08-30T00:00:00.000Z",
    });
    const patch = decodePatch({
      version: 1,
      type: "patch",
      scopeId,
      baseRevision: 0,
      revision: 1,
      upsertedNodes: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES }, () => node),
      removedNodeIds: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES }, () => node.nodeId),
      upsertedEdges: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES }, () => edge),
      removedEdgeIds: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES }, () => edge.edgeId),
      upsertedEvidence: Array.from(
        { length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE },
        () => evidence,
      ),
      removedEvidenceIds: Array.from(
        { length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE },
        () => evidence.evidenceId,
      ),
      changedNodeIds: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES }, () => node.nodeId),
      status,
    });

    expect(encodedBytes(KnowledgeGraphSnapshotV1, snapshot)).toBeLessThanOrEqual(
      KNOWLEDGE_GRAPH_MAX_WIRE_PAYLOAD_BYTES,
    );
    expect(encodedBytes(KnowledgeGraphPatchV1, patch)).toBeLessThanOrEqual(
      KNOWLEDGE_GRAPH_MAX_WIRE_PAYLOAD_BYTES,
    );
  });

  it("rejects an otherwise valid stream payload beyond the encoded byte budget", () => {
    const decodeSnapshot = Schema.decodeUnknownSync(KnowledgeGraphSnapshotV1);

    expect(() =>
      decodeSnapshot({
        version: 1,
        type: "snapshot",
        scope,
        revision: 1,
        nodes: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES }, () => node),
        edges: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES }, () => ({
          ...edge,
          summary: "s".repeat(4_000),
        })),
        evidence: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE }, () => evidence),
        status,
        generatedAt: "2026-08-30T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("bounds query filters, requests, and aggregate results", () => {
    const decodeInput = Schema.decodeUnknownSync(KnowledgeGraphQueryInput);
    const decodeResult = Schema.decodeUnknownSync(KnowledgeGraphQueryResultV1);
    const kinds = Array.from({ length: KNOWLEDGE_GRAPH_MAX_QUERY_FILTER_KINDS }, () => "file");
    const input = decodeInput({
      scope: { projectId: "project-1" },
      queries: [{ id: "search", type: "search", text: "query", kinds }],
    });
    expect(input.queries).toHaveLength(1);
    expect(() =>
      decodeInput({
        scope: { projectId: "project-1" },
        queries: [{ id: "search", type: "search", text: "query", kinds: [...kinds, "file"] }],
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        scope: { projectId: "p".repeat(KNOWLEDGE_GRAPH_MAX_WIRE_PAYLOAD_BYTES) },
        queries: [{ id: "overview", type: "overview" }],
      }),
    ).toThrow();

    const operation = {
      id: "overview",
      type: "overview",
      nodes: Array.from({ length: KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES }, () => node),
      edges: Array.from({ length: KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES }, () => edge),
      evidence: Array.from({ length: KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE }, () => evidence),
      truncated: false,
    } as const;
    const allowed = decodeResult({
      version: 1,
      scope,
      revision: 1,
      results: [operation],
    });
    expect(encodedBytes(KnowledgeGraphQueryResultV1, allowed)).toBeLessThanOrEqual(
      KNOWLEDGE_GRAPH_MAX_WIRE_PAYLOAD_BYTES,
    );
    expect(() =>
      decodeResult({
        version: 1,
        scope,
        revision: 1,
        results: Array.from({ length: KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS }, () => operation),
      }),
    ).toThrow();
  });
});
