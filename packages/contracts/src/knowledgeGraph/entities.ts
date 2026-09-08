import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import {
  KNOWLEDGE_GRAPH_CONTRACT_VERSION,
  KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH,
  KNOWLEDGE_GRAPH_MAX_EVIDENCE_REFS_PER_ENTITY,
  KnowledgeGraphConfidenceSchema,
  KnowledgeGraphEdgeId,
  KnowledgeGraphEvidenceId,
  KnowledgeGraphFingerprintSchema,
  KnowledgeGraphLabelSchema,
  KnowledgeGraphNodeId,
  KnowledgeGraphPathSchema,
  KnowledgeGraphScopeId,
  KnowledgeGraphSummarySchema,
} from "./common.ts";

const KnowledgeGraphEntityEvidenceIds = Schema.Array(KnowledgeGraphEvidenceId).check(
  Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_EVIDENCE_REFS_PER_ENTITY),
);

export const KnowledgeGraphScopeInput = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optionalKey(ThreadId),
});
export type KnowledgeGraphScopeInput = typeof KnowledgeGraphScopeInput.Type;

export const KnowledgeGraphScopeV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  scopeId: KnowledgeGraphScopeId,
  environmentId: EnvironmentId,
  projectId: ProjectId,
  effectiveWorkspaceRoot: KnowledgeGraphPathSchema,
  isWorktree: Schema.Boolean,
});
export type KnowledgeGraphScopeV1 = typeof KnowledgeGraphScopeV1.Type;

export const KnowledgeGraphSourceLocationV1 = Schema.Struct({
  path: KnowledgeGraphPathSchema,
  startLine: Schema.optionalKey(PositiveInt),
  endLine: Schema.optionalKey(PositiveInt),
  symbol: Schema.optionalKey(KnowledgeGraphLabelSchema),
});
export type KnowledgeGraphSourceLocationV1 = typeof KnowledgeGraphSourceLocationV1.Type;

export const KnowledgeGraphNodeKind = Schema.Literals([
  "repository",
  "package",
  "directory",
  "file",
  "symbol",
  "dependency",
  "technology",
  "documentation",
  "architecture",
]);
export type KnowledgeGraphNodeKind = typeof KnowledgeGraphNodeKind.Type;

export const KnowledgeGraphProvenance = Schema.Literals(["deterministic", "semantic"]);
export type KnowledgeGraphProvenance = typeof KnowledgeGraphProvenance.Type;

export const KnowledgeGraphNodeV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  nodeId: KnowledgeGraphNodeId,
  scopeId: KnowledgeGraphScopeId,
  kind: KnowledgeGraphNodeKind,
  label: KnowledgeGraphLabelSchema,
  summary: Schema.optionalKey(KnowledgeGraphSummarySchema),
  source: Schema.optionalKey(KnowledgeGraphSourceLocationV1),
  language: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  provenance: KnowledgeGraphProvenance,
  confidence: KnowledgeGraphConfidenceSchema,
  evidenceIds: KnowledgeGraphEntityEvidenceIds,
  nodeRevision: NonNegativeInt,
});
export type KnowledgeGraphNodeV1 = typeof KnowledgeGraphNodeV1.Type;

export const KnowledgeGraphEdgeKind = Schema.Literals([
  "contains",
  "declares",
  "imports",
  "depends-on",
  "uses",
  "implements",
  "extends",
  "documents",
  "configures",
  "co-changes-with",
  "relates-to",
]);
export type KnowledgeGraphEdgeKind = typeof KnowledgeGraphEdgeKind.Type;

export const KnowledgeGraphEdgeV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  edgeId: KnowledgeGraphEdgeId,
  scopeId: KnowledgeGraphScopeId,
  kind: KnowledgeGraphEdgeKind,
  sourceNodeId: KnowledgeGraphNodeId,
  targetNodeId: KnowledgeGraphNodeId,
  summary: Schema.optionalKey(KnowledgeGraphSummarySchema),
  provenance: KnowledgeGraphProvenance,
  confidence: KnowledgeGraphConfidenceSchema,
  evidenceIds: KnowledgeGraphEntityEvidenceIds,
  edgeRevision: NonNegativeInt,
});
export type KnowledgeGraphEdgeV1 = typeof KnowledgeGraphEdgeV1.Type;

export const KnowledgeGraphEvidenceKind = Schema.Literals([
  "source",
  "manifest",
  "import",
  "symbol",
  "documentation",
  "co-change",
  "semantic",
]);
export type KnowledgeGraphEvidenceKind = typeof KnowledgeGraphEvidenceKind.Type;

export const KnowledgeGraphEvidenceV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  evidenceId: KnowledgeGraphEvidenceId,
  scopeId: KnowledgeGraphScopeId,
  kind: KnowledgeGraphEvidenceKind,
  source: Schema.optionalKey(KnowledgeGraphSourceLocationV1),
  excerpt: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH)),
  ),
  fingerprint: KnowledgeGraphFingerprintSchema,
  confidence: KnowledgeGraphConfidenceSchema,
  evidenceRevision: NonNegativeInt,
});
export type KnowledgeGraphEvidenceV1 = typeof KnowledgeGraphEvidenceV1.Type;

export const KnowledgeGraphCommittedNodeV1 = Schema.Struct({
  node: KnowledgeGraphNodeV1,
  nodeRevision: NonNegativeInt,
  scopeRevision: NonNegativeInt,
});
export type KnowledgeGraphCommittedNodeV1 = typeof KnowledgeGraphCommittedNodeV1.Type;

export const KnowledgeGraphSourceExcerptV1 = Schema.Struct({
  source: KnowledgeGraphSourceLocationV1,
  excerpt: Schema.String.check(Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH)),
  truncated: Schema.Boolean,
  fingerprint: KnowledgeGraphFingerprintSchema,
});
export type KnowledgeGraphSourceExcerptV1 = typeof KnowledgeGraphSourceExcerptV1.Type;

/**
 * Producer-reported truncation. Wire decoders never slice IDs, collections, or
 * text to satisfy a bound: an oversized payload fails decoding instead. A
 * producer must select a bounded view and report the omitted scope here.
 */
export const KnowledgeGraphTruncationV1 = Schema.Struct({
  eligibleFiles: Schema.Boolean,
  nodes: Schema.Boolean,
  visibleNodes: Schema.Boolean,
  omittedFileCount: NonNegativeInt,
  omittedNodeCount: NonNegativeInt,
});
export type KnowledgeGraphTruncationV1 = typeof KnowledgeGraphTruncationV1.Type;

export const KnowledgeGraphProgressPhase = Schema.Literals([
  "discovering",
  "extracting",
  "persisting",
  "semantic",
  "finalizing",
]);
export type KnowledgeGraphProgressPhase = typeof KnowledgeGraphProgressPhase.Type;

export const KnowledgeGraphProgressV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  phase: KnowledgeGraphProgressPhase,
  discoveredFileCount: NonNegativeInt,
  processedFileCount: NonNegativeInt,
  totalFileCount: Schema.optionalKey(NonNegativeInt),
  queuedSemanticNodeCount: NonNegativeInt,
});
export type KnowledgeGraphProgressV1 = typeof KnowledgeGraphProgressV1.Type;

export const KnowledgeGraphState = Schema.Literals([
  "disabled",
  "idle",
  "indexing",
  "semantic",
  "ready",
  "paused",
  "rate-limited",
  "cancelling",
  "error",
]);
export type KnowledgeGraphState = typeof KnowledgeGraphState.Type;

export const KnowledgeGraphStatusV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  scopeId: KnowledgeGraphScopeId,
  state: KnowledgeGraphState,
  revision: NonNegativeInt,
  indexedFileCount: NonNegativeInt,
  nodeCount: NonNegativeInt,
  edgeCount: NonNegativeInt,
  evidenceCount: NonNegativeInt,
  semanticQueueDepth: NonNegativeInt,
  progress: Schema.optionalKey(KnowledgeGraphProgressV1),
  retryAt: Schema.optionalKey(NonNegativeInt),
  lastIndexedAt: Schema.optionalKey(IsoDateTime),
  errorMessage: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(2_000))),
  truncated: KnowledgeGraphTruncationV1,
});
export type KnowledgeGraphStatusV1 = typeof KnowledgeGraphStatusV1.Type;
