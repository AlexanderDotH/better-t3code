import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS,
  KNOWLEDGE_GRAPH_MAX_NODE_CONTENT_EXCERPTS,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_REQUEST_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  KnowledgeGraphNodeContentResultV1,
  KnowledgeGraphPatchV1,
  KnowledgeGraphQueryBatchInput,
  KnowledgeGraphQueryOperationResultV1,
  KnowledgeGraphScopeInput,
  KnowledgeGraphSemanticClaimV1,
  KnowledgeGraphSemanticEnqueueV1,
  KnowledgeGraphSemanticModelOutputV1,
  KnowledgeGraphSemanticModelRequestV1,
  KnowledgeGraphSnapshotV1,
  KnowledgeGraphStreamEvent,
} from "./knowledgeGraph.ts";

const decodeScopeInput = Schema.decodeUnknownSync(KnowledgeGraphScopeInput);
const decodeQuery = Schema.decodeUnknownSync(KnowledgeGraphQueryBatchInput);
const decodeSnapshot = Schema.decodeUnknownSync(KnowledgeGraphSnapshotV1);
const decodePatch = Schema.decodeUnknownSync(KnowledgeGraphPatchV1);
const decodeNodeContent = Schema.decodeUnknownSync(KnowledgeGraphNodeContentResultV1);
const decodeStreamEvent = Schema.decodeUnknownSync(KnowledgeGraphStreamEvent);
const decodeSemanticEnqueue = Schema.decodeUnknownSync(KnowledgeGraphSemanticEnqueueV1);
const decodeSemanticClaim = Schema.decodeUnknownSync(KnowledgeGraphSemanticClaimV1);
const decodeSemanticModelRequest = Schema.decodeUnknownSync(KnowledgeGraphSemanticModelRequestV1);
const decodeSemanticModelOutput = Schema.decodeUnknownSync(KnowledgeGraphSemanticModelOutputV1);
const decodeQueryResult = Schema.decodeUnknownSync(KnowledgeGraphQueryOperationResultV1);

const scope = {
  version: 1,
  scopeId: "scope-1",
  environmentId: "environment-1",
  projectId: "project-1",
  effectiveWorkspaceRoot: "/workspace/project",
  isWorktree: false,
} as const;

const status = {
  version: 1,
  scopeId: "scope-1",
  state: "ready",
  revision: 0,
  indexedFileCount: 0,
  nodeCount: 0,
  edgeCount: 0,
  evidenceCount: 0,
  semanticQueueDepth: 0,
  truncated: {
    eligibleFiles: false,
    nodes: false,
    visibleNodes: false,
    omittedFileCount: 0,
    omittedNodeCount: 0,
  },
} as const;

const node = {
  version: 1,
  nodeId: "node-1",
  scopeId: "scope-1",
  kind: "file",
  label: "src/index.ts",
  provenance: "deterministic",
  confidence: 1,
  evidenceIds: [],
  nodeRevision: 1,
} as const;

const edge = {
  version: 1,
  edgeId: "edge-1",
  scopeId: "scope-1",
  kind: "uses",
  sourceNodeId: "node-1",
  targetNodeId: "node-2",
  provenance: "deterministic",
  confidence: 1,
  evidenceIds: [],
  edgeRevision: 1,
} as const;

const evidence = {
  version: 1,
  evidenceId: "evidence-1",
  scopeId: "scope-1",
  kind: "source",
  fingerprint: "sha256:evidence",
  confidence: 1,
  evidenceRevision: 1,
} as const;

describe("Knowledge Graph scope and query contracts", () => {
  it("accepts only a project/thread selector from a client, never a workspace root", () => {
    const decoded = decodeScopeInput({
      projectId: "project-1",
      threadId: "thread-1",
      effectiveWorkspaceRoot: "/attacker/path",
    });

    expect(decoded).toEqual({ projectId: "project-1", threadId: "thread-1" });
  });

  it("bounds query batches to eight operations and neighbor traversal to depth two", () => {
    const queries = Array.from({ length: KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS }, (_, index) => ({
      id: `query-${index}`,
      type: "overview" as const,
    }));
    expect(decodeQuery({ queries }).queries).toHaveLength(8);
    expect(() =>
      decodeQuery({ queries: [...queries, { id: "query-9", type: "overview" }] }),
    ).toThrow();
    expect(() =>
      decodeQuery({
        queries: [{ id: "neighbors", type: "neighbors", nodeId: "node-1", depth: 3 }],
      }),
    ).toThrow();
  });
});

describe("Knowledge Graph stream contracts", () => {
  it("decodes a bounded snapshot and a contiguous revision patch", () => {
    const snapshot = decodeSnapshot({
      version: 1,
      type: "snapshot",
      scope,
      revision: 0,
      nodes: [],
      edges: [],
      evidence: [],
      status,
      generatedAt: "2026-08-29T10:00:00.000Z",
    });
    const patch = decodePatch({
      version: 1,
      type: "patch",
      scopeId: "scope-1",
      baseRevision: 0,
      revision: 1,
      upsertedNodes: [],
      removedNodeIds: [],
      upsertedEdges: [],
      removedEdgeIds: [],
      upsertedEvidence: [],
      removedEvidenceIds: [],
      changedNodeIds: [],
      status: { ...status, revision: 1 },
    });

    expect(decodeStreamEvent(snapshot).type).toBe("snapshot");
    expect(decodeStreamEvent(patch).type).toBe("patch");
  });

  it("rejects snapshots beyond the 300-node visible bound", () => {
    const nodes = Array.from({ length: 301 }, (_, index) => ({
      version: 1,
      nodeId: `node-${index}`,
      scopeId: "scope-1",
      kind: "file" as const,
      label: `file-${index}.ts`,
      provenance: "deterministic" as const,
      confidence: 1,
      evidenceIds: [],
      nodeRevision: 1,
    }));

    expect(() =>
      decodeSnapshot({
        version: 1,
        type: "snapshot",
        scope,
        revision: 1,
        nodes,
        edges: [],
        evidence: [],
        status: { ...status, revision: 1 },
        generatedAt: "2026-08-29T10:00:00.000Z",
      }),
    ).toThrow();
  });

  it("bounds snapshot edges and evidence independently from total scope counts", () => {
    const snapshot = {
      version: 1,
      type: "snapshot",
      scope,
      revision: 1,
      nodes: [],
      edges: [],
      evidence: [],
      status: { ...status, revision: 1 },
      generatedAt: "2026-08-29T10:00:00.000Z",
    } as const;

    expect(() =>
      decodeSnapshot({
        ...snapshot,
        edges: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES + 1 }, () => edge),
      }),
    ).toThrow();
    expect(() =>
      decodeSnapshot({
        ...snapshot,
        evidence: Array.from({ length: KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE + 1 }, () => evidence),
      }),
    ).toThrow();
  });

  it("bounds every patch collection so a revision cannot become an unbounded frame", () => {
    const patch = {
      version: 1,
      type: "patch",
      scopeId: "scope-1",
      baseRevision: 0,
      revision: 1,
      upsertedNodes: [],
      removedNodeIds: [],
      upsertedEdges: [],
      removedEdgeIds: [],
      upsertedEvidence: [],
      removedEvidenceIds: [],
      changedNodeIds: [],
      status: { ...status, revision: 1 },
    } as const;

    const oversizedCollections = [
      ["upsertedNodes", KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES, () => node],
      ["removedNodeIds", KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES, (index: number) => `node-${index}`],
      ["upsertedEdges", KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES, () => edge],
      ["removedEdgeIds", KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES, (index: number) => `edge-${index}`],
      ["upsertedEvidence", KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE, () => evidence],
      [
        "removedEvidenceIds",
        KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE,
        (index: number) => `evidence-${index}`,
      ],
      ["changedNodeIds", KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES, (index: number) => `node-${index}`],
    ] as const;

    for (const [field, limit, makeValue] of oversizedCollections) {
      expect(() =>
        decodePatch({
          ...patch,
          [field]: Array.from({ length: limit + 1 }, (_, index) => makeValue(index)),
        }),
      ).toThrow();
    }
  });
});

describe("Knowledge Graph query-result contracts", () => {
  it("bounds relationship and evidence payloads for each query operation", () => {
    const result = {
      id: "overview",
      type: "overview",
      nodes: [],
      edges: [],
      evidence: [],
      truncated: false,
    } as const;

    expect(() =>
      decodeQueryResult({
        ...result,
        edges: Array.from({ length: KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES + 1 }, () => edge),
      }),
    ).toThrow();
    expect(() =>
      decodeQueryResult({
        ...result,
        evidence: Array.from(
          { length: KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE + 1 },
          () => evidence,
        ),
      }),
    ).toThrow();
  });

  it("bounds source excerpts returned for one expanded node", () => {
    expect(() =>
      decodeNodeContent({
        version: 1,
        scope,
        revision: 1,
        node,
        excerpts: Array.from({ length: KNOWLEDGE_GRAPH_MAX_NODE_CONTENT_EXCERPTS + 1 }, () => ({
          source: { path: "src/index.ts", startLine: 1, endLine: 2 },
          excerpt: "export const value = 1;",
          truncated: false,
          fingerprint: "sha256:excerpt",
        })),
      }),
    ).toThrow();
  });
});

describe("Knowledge Graph semantic queue contracts", () => {
  it("accepts at most twelve candidates per changed node", () => {
    const candidates = Array.from(
      { length: KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES },
      (_, index) => ({
        sourceNodeId: "node-1",
        candidateNodeId: `candidate-${index}`,
        evidenceIds: [],
        score: 0.5,
      }),
    );
    const base = {
      version: 1,
      environmentId: "environment-1",
      scopeId: "scope-1",
      modelGeneration: 1,
      nodes: [{ nodeId: "node-1", nodeRevision: 1, candidates }],
    } as const;

    expect(decodeSemanticEnqueue(base).nodes[0]?.candidates).toHaveLength(12);
    expect(() =>
      decodeSemanticEnqueue({
        ...base,
        nodes: [
          {
            ...base.nodes[0],
            candidates: [
              ...candidates,
              {
                sourceNodeId: "node-1",
                candidateNodeId: "candidate-13",
                evidenceIds: [],
                score: 0.5,
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("bounds candidate evidence and claimed work before it reaches the model", () => {
    const candidate = {
      sourceNodeId: "node-1",
      candidateNodeId: "node-2",
      evidenceIds: Array.from(
        { length: KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE },
        (_, index) => `evidence-${index}`,
      ),
      score: 0.5,
    } as const;
    const item = {
      version: 1,
      jobId: "job-1",
      environmentId: "environment-1",
      scopeId: "scope-1",
      nodeId: "node-1",
      desiredNodeRevision: 1,
      modelGeneration: 1,
      candidates: [candidate],
      attemptCount: 0,
      availableAt: 0,
      createdAt: 0,
      updatedAt: 0,
    } as const;
    const claim = {
      version: 1,
      claimToken: "claim-1",
      environmentId: "environment-1",
      claimedAt: 0,
      items: [item],
    } as const;

    expect(decodeSemanticClaim(claim).items).toHaveLength(1);
    expect(() =>
      decodeSemanticClaim({
        ...claim,
        items: Array.from({ length: KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE + 1 }, () => item),
      }),
    ).toThrow();
    expect(() =>
      decodeSemanticClaim({
        ...claim,
        items: [
          {
            ...item,
            candidates: [
              {
                ...candidate,
                evidenceIds: [...candidate.evidenceIds, "evidence-overflow"],
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("Knowledge Graph semantic model contracts", () => {
  const candidateNode = { ...node, nodeId: "node-2", label: "src/feature.ts" } as const;
  const candidate = {
    candidateNode,
    evidenceIds: ["evidence-1"],
    score: 0.75,
  } as const;
  const item = { sourceNode: node, candidates: [candidate] } as const;
  const request = {
    version: 1,
    environmentId: "environment-1",
    scopeId: "scope-1",
    baseRevision: 3,
    modelGeneration: 2,
    items: [item],
    evidence: [evidence],
  } as const;
  const semanticEdge = {
    kind: "relates-to",
    sourceNodeId: "node-1",
    targetNodeId: "node-2",
    confidence: 0.75,
    summary: "The files implement the same feature.",
    evidenceIds: ["evidence-1"],
  } as const;

  it("decodes the provider-neutral request and exact structured output", () => {
    expect(decodeSemanticModelRequest(request)).toEqual(request);
    expect(decodeSemanticModelOutput({ version: 1, edges: [semanticEdge] })).toEqual({
      version: 1,
      edges: [semanticEdge],
    });
  });

  it("rejects excess properties at the model boundary", () => {
    expect(() => decodeSemanticModelRequest({ ...request, promptInjection: true })).toThrow();
    expect(() =>
      decodeSemanticModelRequest({
        ...request,
        items: [{ ...item, candidates: [{ ...candidate, ignored: true }] }],
      }),
    ).toThrow();
    expect(() =>
      decodeSemanticModelOutput({ version: 1, edges: [semanticEdge], commentary: "trust me" }),
    ).toThrow();
  });

  it("bounds a batch to two sources and twelve candidates per source", () => {
    expect(() =>
      decodeSemanticModelRequest({
        ...request,
        items: Array.from({ length: KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE + 1 }, () => item),
      }),
    ).toThrow();
    expect(() =>
      decodeSemanticModelRequest({
        ...request,
        items: [
          {
            ...item,
            candidates: Array.from(
              { length: KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES + 1 },
              () => candidate,
            ),
          },
        ],
      }),
    ).toThrow();
  });

  it("bounds candidate and request evidence independently", () => {
    expect(() =>
      decodeSemanticModelRequest({
        ...request,
        items: [
          {
            ...item,
            candidates: [
              {
                ...candidate,
                evidenceIds: Array.from(
                  { length: KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE + 1 },
                  (_, index) => `evidence-${index}`,
                ),
              },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeSemanticModelRequest({
        ...request,
        evidence: Array.from(
          { length: KNOWLEDGE_GRAPH_MAX_SEMANTIC_REQUEST_EVIDENCE + 1 },
          () => evidence,
        ),
      }),
    ).toThrow();
  });

  it("bounds semantic output to the maximum candidate pairs in one batch", () => {
    expect(() =>
      decodeSemanticModelOutput({
        version: 1,
        edges: Array.from(
          {
            length:
              KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE * KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES + 1,
          },
          () => semanticEdge,
        ),
      }),
    ).toThrow();
  });
});
