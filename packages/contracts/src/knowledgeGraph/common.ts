import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const KNOWLEDGE_GRAPH_CONTRACT_VERSION = 1 as const;
export const KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES = 25_000;
export const KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE = 100_000;
export const KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES = 300;
export const KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES = 1_200;
export const KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE = 100;
export const KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS = 8;
export const KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES = 100;
export const KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES = 400;
export const KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE = 100;
export const KNOWLEDGE_GRAPH_MAX_NEIGHBOR_DEPTH = 2;
export const KNOWLEDGE_GRAPH_MAX_NODE_CONTENT_EXCERPTS = 20;
export const KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE = 2;
export const KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES = 12;
export const KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE = 8;
export const KNOWLEDGE_GRAPH_MAX_SEMANTIC_REQUEST_EVIDENCE = 256;
export const KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH = 12_000;
export const KNOWLEDGE_GRAPH_MAX_EVIDENCE_REFS_PER_ENTITY = 8;
export const KNOWLEDGE_GRAPH_MAX_QUERY_FILTER_KINDS = 16;
export const KNOWLEDGE_GRAPH_MAX_QUERY_INPUT_BYTES = 64 * 1024;
export const KNOWLEDGE_GRAPH_MAX_WIRE_PAYLOAD_BYTES = 8 * 1024 * 1024;

// Deterministic IDs are short hashes. The larger edge/job/token budgets also
// cover IDs derived from multiple valid component IDs without truncating them.
export const KNOWLEDGE_GRAPH_MAX_SCOPE_ID_LENGTH = 128;
export const KNOWLEDGE_GRAPH_MAX_NODE_ID_LENGTH = 256;
export const KNOWLEDGE_GRAPH_MAX_EDGE_ID_LENGTH = 640;
export const KNOWLEDGE_GRAPH_MAX_EVIDENCE_ID_LENGTH = 256;
export const KNOWLEDGE_GRAPH_MAX_SEMANTIC_JOB_ID_LENGTH = 512;
export const KNOWLEDGE_GRAPH_MAX_CLAIM_TOKEN_LENGTH = 1_024;

export const KnowledgeGraphPathSchema = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
export const KnowledgeGraphLabelSchema = TrimmedNonEmptyString.check(Schema.isMaxLength(1_024));
export const KnowledgeGraphSummarySchema = TrimmedNonEmptyString.check(Schema.isMaxLength(20_000));
export const KnowledgeGraphFingerprintSchema = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
export const KnowledgeGraphConfidenceSchema = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);
export const KnowledgeGraphQueryLimitSchema = PositiveInt.check(
  Schema.isLessThanOrEqualTo(KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES),
);

const knowledgeGraphId = (maximumLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maximumLength));

export function knowledgeGraphEncodedJsonByteLength(value: unknown): number {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 0 : new TextEncoder().encode(encoded).byteLength;
}

export const KnowledgeGraphScopeId = knowledgeGraphId(KNOWLEDGE_GRAPH_MAX_SCOPE_ID_LENGTH).pipe(
  Schema.brand("KnowledgeGraphScopeId"),
);
export type KnowledgeGraphScopeId = typeof KnowledgeGraphScopeId.Type;

export const KnowledgeGraphNodeId = knowledgeGraphId(KNOWLEDGE_GRAPH_MAX_NODE_ID_LENGTH).pipe(
  Schema.brand("KnowledgeGraphNodeId"),
);
export type KnowledgeGraphNodeId = typeof KnowledgeGraphNodeId.Type;

export const KnowledgeGraphEdgeId = knowledgeGraphId(KNOWLEDGE_GRAPH_MAX_EDGE_ID_LENGTH).pipe(
  Schema.brand("KnowledgeGraphEdgeId"),
);
export type KnowledgeGraphEdgeId = typeof KnowledgeGraphEdgeId.Type;

export const KnowledgeGraphEvidenceId = knowledgeGraphId(
  KNOWLEDGE_GRAPH_MAX_EVIDENCE_ID_LENGTH,
).pipe(Schema.brand("KnowledgeGraphEvidenceId"));
export type KnowledgeGraphEvidenceId = typeof KnowledgeGraphEvidenceId.Type;

export const KnowledgeGraphSemanticJobId = knowledgeGraphId(
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_JOB_ID_LENGTH,
).pipe(Schema.brand("KnowledgeGraphSemanticJobId"));
export type KnowledgeGraphSemanticJobId = typeof KnowledgeGraphSemanticJobId.Type;

export const KnowledgeGraphClaimToken = knowledgeGraphId(
  KNOWLEDGE_GRAPH_MAX_CLAIM_TOKEN_LENGTH,
).pipe(Schema.brand("KnowledgeGraphClaimToken"));
export type KnowledgeGraphClaimToken = typeof KnowledgeGraphClaimToken.Type;

export const KnowledgeGraphModelGeneration = NonNegativeInt.pipe(
  Schema.brand("KnowledgeGraphModelGeneration"),
);
export type KnowledgeGraphModelGeneration = typeof KnowledgeGraphModelGeneration.Type;
