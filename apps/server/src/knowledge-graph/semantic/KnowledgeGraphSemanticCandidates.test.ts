import { describe, expect, it } from "vite-plus/test";
import {
  KnowledgeGraphEdgeV1,
  KnowledgeGraphEvidenceV1,
  KnowledgeGraphNodeV1,
  type KnowledgeGraphNodeId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { buildKnowledgeGraphSemanticEnqueueNodes } from "./KnowledgeGraphSemanticCandidates.ts";

const scopeId = "scope-candidates";
const decodeNode = Schema.decodeUnknownSync(KnowledgeGraphNodeV1);
const decodeEvidence = Schema.decodeUnknownSync(KnowledgeGraphEvidenceV1);
const decodeEdge = Schema.decodeUnknownSync(KnowledgeGraphEdgeV1);

const node = (input: {
  readonly nodeId: string;
  readonly label: string;
  readonly path: string;
  readonly evidenceIds: ReadonlyArray<string>;
}) =>
  decodeNode({
    version: 1,
    nodeId: input.nodeId,
    scopeId,
    kind: "file",
    label: input.label,
    source: { path: input.path },
    provenance: "deterministic",
    confidence: 1,
    evidenceIds: input.evidenceIds,
    nodeRevision: 7,
  });

const evidence = (evidenceId: string, path: string) =>
  decodeEvidence({
    version: 1,
    evidenceId,
    scopeId,
    kind: "source",
    source: { path },
    fingerprint: `sha256:${evidenceId}`,
    confidence: 1,
    evidenceRevision: 7,
  });

describe("Knowledge Graph semantic candidates", () => {
  it("caps each changed node at twelve candidates with stable ordering", () => {
    const source = node({
      nodeId: "node-source",
      label: "source.ts",
      path: "src/source.ts",
      evidenceIds: ["evidence-source"],
    });
    const candidates = Array.from({ length: 20 }, (_, index) => {
      const suffix = index.toString().padStart(2, "0");
      return node({
        nodeId: `node-${suffix}`,
        label: `candidate-${suffix}.ts`,
        path: `src/candidate-${suffix}.ts`,
        evidenceIds: [`evidence-${suffix}`],
      });
    });
    const nodes = [source, ...candidates];
    const evidenceEntries = [
      evidence("evidence-source", "src/source.ts"),
      ...candidates.map((candidate, index) =>
        evidence(`evidence-${index.toString().padStart(2, "0")}`, candidate.source!.path),
      ),
    ];

    const first = buildKnowledgeGraphSemanticEnqueueNodes({
      changedNodeIds: [source.nodeId],
      nodes,
      edges: [],
      evidence: evidenceEntries,
    });
    const second = buildKnowledgeGraphSemanticEnqueueNodes({
      changedNodeIds: [source.nodeId],
      nodes: nodes.toReversed(),
      edges: [],
      evidence: evidenceEntries.toReversed(),
    });

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]?.candidates).toHaveLength(12);
    expect(first[0]?.candidates.map(({ candidateNodeId }) => candidateNodeId)).toEqual(
      Array.from({ length: 12 }, (_, index) => `node-${index.toString().padStart(2, "0")}`),
    );
  });

  it("prefers structural evidence, excludes self and unknown nodes, and cites only known evidence", () => {
    const source = node({
      nodeId: "node-source",
      label: "SourceService",
      path: "src/source.ts",
      evidenceIds: ["evidence-source"],
    });
    const direct = node({
      nodeId: "node-direct",
      label: "DirectService",
      path: "other/direct.ts",
      evidenceIds: ["evidence-direct"],
    });
    const nearby = node({
      nodeId: "node-nearby",
      label: "NearbyService",
      path: "src/nearby.ts",
      evidenceIds: ["evidence-nearby"],
    });
    const unrelated = node({
      nodeId: "node-unrelated",
      label: "Readme",
      path: "docs/readme.md",
      evidenceIds: ["evidence-unrelated"],
    });
    const edge = decodeEdge({
      version: 1,
      edgeId: "edge-direct",
      scopeId,
      kind: "uses",
      sourceNodeId: source.nodeId,
      targetNodeId: direct.nodeId,
      provenance: "deterministic",
      confidence: 1,
      evidenceIds: ["evidence-edge", "evidence-missing"],
      edgeRevision: 7,
    });
    const result = buildKnowledgeGraphSemanticEnqueueNodes({
      changedNodeIds: [source.nodeId, source.nodeId, "node-missing" as KnowledgeGraphNodeId],
      nodes: [source, direct, nearby, unrelated],
      edges: [edge],
      evidence: [
        evidence("evidence-source", "src/source.ts"),
        evidence("evidence-direct", "other/direct.ts"),
        evidence("evidence-nearby", "src/nearby.ts"),
        evidence("evidence-unrelated", "docs/readme.md"),
        evidence("evidence-edge", "src/source.ts"),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.candidates.map(({ candidateNodeId }) => candidateNodeId)).toEqual([
      direct.nodeId,
      nearby.nodeId,
    ]);
    expect(result[0]?.candidates[0]?.evidenceIds).toEqual([
      "evidence-direct",
      "evidence-edge",
      "evidence-source",
    ]);
    expect(result[0]?.candidates[0]?.evidenceIds).not.toContain("evidence-missing");
  });
});
