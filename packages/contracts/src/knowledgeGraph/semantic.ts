import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import {
  KNOWLEDGE_GRAPH_CONTRACT_VERSION,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_REQUEST_EVIDENCE,
  KnowledgeGraphClaimToken,
  KnowledgeGraphConfidenceSchema,
  KnowledgeGraphEdgeId,
  KnowledgeGraphEvidenceId,
  KnowledgeGraphFingerprintSchema,
  KnowledgeGraphModelGeneration,
  KnowledgeGraphNodeId,
  KnowledgeGraphPathSchema,
  KnowledgeGraphScopeId,
  KnowledgeGraphSemanticJobId,
  KnowledgeGraphSummarySchema,
} from "./common.ts";
import {
  KnowledgeGraphCommittedNodeV1,
  KnowledgeGraphEdgeKind,
  KnowledgeGraphEdgeV1,
  KnowledgeGraphEvidenceV1,
  KnowledgeGraphNodeV1,
  KnowledgeGraphScopeV1,
  KnowledgeGraphTruncationV1,
} from "./entities.ts";
import { KnowledgeGraphPatchV1 } from "./stream.ts";

export const KnowledgeGraphFileFingerprintV1 = Schema.Struct({
  path: KnowledgeGraphPathSchema,
  fingerprint: KnowledgeGraphFingerprintSchema,
  sizeBytes: NonNegativeInt,
  modifiedAtMs: NonNegativeInt,
  extractionVersion: PositiveInt,
  seenGeneration: NonNegativeInt,
});
export type KnowledgeGraphFileFingerprintV1 = typeof KnowledgeGraphFileFingerprintV1.Type;

const KnowledgeGraphEntityRemovalsV1 = Schema.Struct({
  nodeIds: Schema.Array(KnowledgeGraphNodeId),
  edgeIds: Schema.Array(KnowledgeGraphEdgeId),
  evidenceIds: Schema.Array(KnowledgeGraphEvidenceId),
  fingerprintPaths: Schema.Array(KnowledgeGraphPathSchema),
});

export const KnowledgeGraphDeterministicPatchV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  scope: KnowledgeGraphScopeV1,
  baseRevision: NonNegativeInt,
  nodes: Schema.Array(KnowledgeGraphNodeV1),
  edges: Schema.Array(KnowledgeGraphEdgeV1),
  evidence: Schema.Array(KnowledgeGraphEvidenceV1),
  removals: KnowledgeGraphEntityRemovalsV1,
  fileFingerprints: Schema.Array(KnowledgeGraphFileFingerprintV1),
  changedNodeIds: Schema.Array(KnowledgeGraphNodeId),
  truncation: KnowledgeGraphTruncationV1,
  committedAt: IsoDateTime,
});
export type KnowledgeGraphDeterministicPatchV1 = typeof KnowledgeGraphDeterministicPatchV1.Type;

export const KnowledgeGraphSemanticEdgeV1 = Schema.Struct({
  kind: KnowledgeGraphEdgeKind,
  sourceNodeId: KnowledgeGraphNodeId,
  targetNodeId: KnowledgeGraphNodeId,
  confidence: KnowledgeGraphConfidenceSchema,
  summary: KnowledgeGraphSummarySchema,
  evidenceIds: Schema.Array(KnowledgeGraphEvidenceId).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type KnowledgeGraphSemanticEdgeV1 = typeof KnowledgeGraphSemanticEdgeV1.Type;

export const KnowledgeGraphSemanticCandidateContextV1 = Schema.Struct({
  candidateNode: KnowledgeGraphNodeV1,
  evidenceIds: Schema.Array(KnowledgeGraphEvidenceId).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE),
  ),
  score: KnowledgeGraphConfidenceSchema,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type KnowledgeGraphSemanticCandidateContextV1 =
  typeof KnowledgeGraphSemanticCandidateContextV1.Type;

export const KnowledgeGraphSemanticItemContextV1 = Schema.Struct({
  sourceNode: KnowledgeGraphNodeV1,
  candidates: Schema.Array(KnowledgeGraphSemanticCandidateContextV1).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type KnowledgeGraphSemanticItemContextV1 = typeof KnowledgeGraphSemanticItemContextV1.Type;

export const KnowledgeGraphSemanticModelRequestV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  environmentId: EnvironmentId,
  scopeId: KnowledgeGraphScopeId,
  baseRevision: NonNegativeInt,
  modelGeneration: KnowledgeGraphModelGeneration,
  items: Schema.NonEmptyArray(KnowledgeGraphSemanticItemContextV1).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE),
  ),
  evidence: Schema.Array(KnowledgeGraphEvidenceV1).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_SEMANTIC_REQUEST_EVIDENCE),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type KnowledgeGraphSemanticModelRequestV1 = typeof KnowledgeGraphSemanticModelRequestV1.Type;

export const KnowledgeGraphSemanticModelOutputV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  edges: Schema.Array(KnowledgeGraphSemanticEdgeV1).check(
    Schema.isMaxLength(
      KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE * KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES,
    ),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type KnowledgeGraphSemanticModelOutputV1 = typeof KnowledgeGraphSemanticModelOutputV1.Type;

export const KnowledgeGraphSemanticModelResultV1 = KnowledgeGraphSemanticModelOutputV1;
export type KnowledgeGraphSemanticModelResultV1 = KnowledgeGraphSemanticModelOutputV1;

export const KnowledgeGraphSemanticPatchV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  scopeId: KnowledgeGraphScopeId,
  baseRevision: NonNegativeInt,
  modelGeneration: KnowledgeGraphModelGeneration,
  nodes: Schema.Array(KnowledgeGraphNodeV1),
  edges: Schema.Array(KnowledgeGraphSemanticEdgeV1),
  evidence: Schema.Array(KnowledgeGraphEvidenceV1),
  changedNodeIds: Schema.Array(KnowledgeGraphNodeId),
  committedAt: IsoDateTime,
});
export type KnowledgeGraphSemanticPatchV1 = typeof KnowledgeGraphSemanticPatchV1.Type;

export const KnowledgeGraphCommittedPatchV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  scopeId: KnowledgeGraphScopeId,
  baseRevision: NonNegativeInt,
  revision: NonNegativeInt,
  patch: KnowledgeGraphPatchV1,
  changedNodes: Schema.Array(KnowledgeGraphCommittedNodeV1),
});
export type KnowledgeGraphCommittedPatchV1 = typeof KnowledgeGraphCommittedPatchV1.Type;

export const KnowledgeGraphSemanticCandidateV1 = Schema.Struct({
  sourceNodeId: KnowledgeGraphNodeId,
  candidateNodeId: KnowledgeGraphNodeId,
  evidenceIds: Schema.Array(KnowledgeGraphEvidenceId).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE),
  ),
  score: KnowledgeGraphConfidenceSchema,
});
export type KnowledgeGraphSemanticCandidateV1 = typeof KnowledgeGraphSemanticCandidateV1.Type;

const KnowledgeGraphSemanticCandidatesV1 = Schema.Array(KnowledgeGraphSemanticCandidateV1).check(
  Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES),
);

export const KnowledgeGraphSemanticEnqueueNodeV1 = Schema.Struct({
  nodeId: KnowledgeGraphNodeId,
  nodeRevision: NonNegativeInt,
  candidates: KnowledgeGraphSemanticCandidatesV1,
});
export type KnowledgeGraphSemanticEnqueueNodeV1 = typeof KnowledgeGraphSemanticEnqueueNodeV1.Type;

export const KnowledgeGraphSemanticEnqueueV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  environmentId: EnvironmentId,
  scopeId: KnowledgeGraphScopeId,
  modelGeneration: KnowledgeGraphModelGeneration,
  nodes: Schema.Array(KnowledgeGraphSemanticEnqueueNodeV1),
});
export type KnowledgeGraphSemanticEnqueueV1 = typeof KnowledgeGraphSemanticEnqueueV1.Type;

export const KnowledgeGraphSemanticFailureCategory = Schema.Literals([
  "rate-limited",
  "model-unavailable",
  "entitlement",
  "invalid-output",
  "cancelled",
  "internal",
]);
export type KnowledgeGraphSemanticFailureCategory =
  typeof KnowledgeGraphSemanticFailureCategory.Type;

export const KnowledgeGraphSemanticFailureV1 = Schema.Struct({
  category: KnowledgeGraphSemanticFailureCategory,
  retryable: Schema.Boolean,
  retryAt: Schema.optionalKey(NonNegativeInt),
  detail: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
});
export type KnowledgeGraphSemanticFailureV1 = typeof KnowledgeGraphSemanticFailureV1.Type;

export const KnowledgeGraphSemanticQueueItemV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  jobId: KnowledgeGraphSemanticJobId,
  environmentId: EnvironmentId,
  scopeId: KnowledgeGraphScopeId,
  nodeId: KnowledgeGraphNodeId,
  desiredNodeRevision: NonNegativeInt,
  modelGeneration: KnowledgeGraphModelGeneration,
  candidates: KnowledgeGraphSemanticCandidatesV1,
  attemptCount: NonNegativeInt,
  availableAt: NonNegativeInt,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
});
export type KnowledgeGraphSemanticQueueItemV1 = typeof KnowledgeGraphSemanticQueueItemV1.Type;

export const KnowledgeGraphSemanticClaimV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  claimToken: KnowledgeGraphClaimToken,
  environmentId: EnvironmentId,
  claimedAt: NonNegativeInt,
  items: Schema.NonEmptyArray(KnowledgeGraphSemanticQueueItemV1).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE),
  ),
});
export type KnowledgeGraphSemanticClaimV1 = typeof KnowledgeGraphSemanticClaimV1.Type;

export const KnowledgeGraphSemanticClaimCompletionV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  claim: KnowledgeGraphSemanticClaimV1,
  semanticPatch: KnowledgeGraphSemanticPatchV1,
});
export type KnowledgeGraphSemanticClaimCompletionV1 =
  typeof KnowledgeGraphSemanticClaimCompletionV1.Type;
