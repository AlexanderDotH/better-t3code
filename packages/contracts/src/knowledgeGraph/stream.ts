import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";
import {
  KNOWLEDGE_GRAPH_CONTRACT_VERSION,
  KNOWLEDGE_GRAPH_MAX_NEIGHBOR_DEPTH,
  KNOWLEDGE_GRAPH_MAX_NODE_CONTENT_EXCERPTS,
  KNOWLEDGE_GRAPH_MAX_QUERY_FILTER_KINDS,
  KNOWLEDGE_GRAPH_MAX_QUERY_INPUT_BYTES,
  KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  KNOWLEDGE_GRAPH_MAX_WIRE_PAYLOAD_BYTES,
  KnowledgeGraphEdgeId,
  KnowledgeGraphEvidenceId,
  KnowledgeGraphNodeId,
  KnowledgeGraphQueryLimitSchema,
  KnowledgeGraphScopeId,
  knowledgeGraphEncodedJsonByteLength,
} from "./common.ts";
import {
  KnowledgeGraphEdgeKind,
  KnowledgeGraphEdgeV1,
  KnowledgeGraphEvidenceV1,
  KnowledgeGraphNodeKind,
  KnowledgeGraphNodeV1,
  KnowledgeGraphScopeInput,
  KnowledgeGraphScopeV1,
  KnowledgeGraphSourceExcerptV1,
  KnowledgeGraphStatusV1,
} from "./entities.ts";

const VisibleKnowledgeGraphNodes = Schema.Array(KnowledgeGraphNodeV1).check(
  Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
);
const VisibleKnowledgeGraphEdges = Schema.Array(KnowledgeGraphEdgeV1).check(
  Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES),
);
const VisibleKnowledgeGraphEvidence = Schema.Array(KnowledgeGraphEvidenceV1).check(
  Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE),
);

const streamPayloadWithinByteBudget = Schema.makeFilter(
  (payload: unknown) =>
    knowledgeGraphEncodedJsonByteLength(payload) <= KNOWLEDGE_GRAPH_MAX_WIRE_PAYLOAD_BYTES ||
    `Knowledge Graph wire payloads must not exceed ${KNOWLEDGE_GRAPH_MAX_WIRE_PAYLOAD_BYTES} encoded bytes.`,
);

const queryInputWithinByteBudget = Schema.makeFilter(
  (payload: unknown) =>
    knowledgeGraphEncodedJsonByteLength(payload) <= KNOWLEDGE_GRAPH_MAX_QUERY_INPUT_BYTES ||
    `Knowledge Graph query inputs must not exceed ${KNOWLEDGE_GRAPH_MAX_QUERY_INPUT_BYTES} encoded bytes.`,
);

/**
 * A complete bounded view for a revision. Collection limits and the encoded
 * byte check are decode errors, not lossy transforms. Capability-gated V1
 * clients therefore either receive the producer's explicitly truncated view
 * or reject the frame and recover through the normal invalidate/snapshot path.
 */
export const KnowledgeGraphSnapshotV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  type: Schema.Literal("snapshot"),
  scope: KnowledgeGraphScopeV1,
  revision: NonNegativeInt,
  nodes: VisibleKnowledgeGraphNodes,
  edges: VisibleKnowledgeGraphEdges,
  evidence: VisibleKnowledgeGraphEvidence,
  status: KnowledgeGraphStatusV1,
  generatedAt: IsoDateTime,
}).check(streamPayloadWithinByteBudget);
export type KnowledgeGraphSnapshotV1 = typeof KnowledgeGraphSnapshotV1.Type;

/** A revision patch follows the same reject-without-truncating wire policy. */
export const KnowledgeGraphPatchV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  type: Schema.Literal("patch"),
  scopeId: KnowledgeGraphScopeId,
  baseRevision: NonNegativeInt,
  revision: NonNegativeInt,
  upsertedNodes: VisibleKnowledgeGraphNodes,
  removedNodeIds: Schema.Array(KnowledgeGraphNodeId).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
  ),
  upsertedEdges: VisibleKnowledgeGraphEdges,
  removedEdgeIds: Schema.Array(KnowledgeGraphEdgeId).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES),
  ),
  upsertedEvidence: VisibleKnowledgeGraphEvidence,
  removedEvidenceIds: Schema.Array(KnowledgeGraphEvidenceId).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE),
  ),
  changedNodeIds: Schema.Array(KnowledgeGraphNodeId).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
  ),
  status: KnowledgeGraphStatusV1,
}).check(streamPayloadWithinByteBudget);
export type KnowledgeGraphPatchV1 = typeof KnowledgeGraphPatchV1.Type;

export const KnowledgeGraphStatusEventV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  type: Schema.Literal("status"),
  scopeId: KnowledgeGraphScopeId,
  revision: NonNegativeInt,
  status: KnowledgeGraphStatusV1,
});
export type KnowledgeGraphStatusEventV1 = typeof KnowledgeGraphStatusEventV1.Type;

export const KnowledgeGraphInvalidateReason = Schema.Literals([
  "revision-gap",
  "scope-changed",
  "rebuild",
  "cleared",
]);
export type KnowledgeGraphInvalidateReason = typeof KnowledgeGraphInvalidateReason.Type;

export const KnowledgeGraphInvalidateV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  type: Schema.Literal("invalidate"),
  scopeId: KnowledgeGraphScopeId,
  reason: KnowledgeGraphInvalidateReason,
  expectedRevision: NonNegativeInt,
  availableRevision: NonNegativeInt,
});
export type KnowledgeGraphInvalidateV1 = typeof KnowledgeGraphInvalidateV1.Type;

export const KnowledgeGraphStreamEvent = Schema.Union([
  KnowledgeGraphSnapshotV1,
  KnowledgeGraphPatchV1,
  KnowledgeGraphStatusEventV1,
  KnowledgeGraphInvalidateV1,
]);
export type KnowledgeGraphStreamEvent = typeof KnowledgeGraphStreamEvent.Type;

export const KnowledgeGraphSubscribeInput = Schema.Struct({
  scope: KnowledgeGraphScopeInput,
  afterRevision: Schema.optionalKey(NonNegativeInt),
});
export type KnowledgeGraphSubscribeInput = typeof KnowledgeGraphSubscribeInput.Type;

const KnowledgeGraphQueryId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const KnowledgeGraphNeighborDepth = PositiveInt.check(
  Schema.isLessThanOrEqualTo(KNOWLEDGE_GRAPH_MAX_NEIGHBOR_DEPTH),
);
const KnowledgeGraphNodeKindFilters = Schema.Array(KnowledgeGraphNodeKind).check(
  Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_QUERY_FILTER_KINDS),
);
const KnowledgeGraphEdgeKindFilters = Schema.Array(KnowledgeGraphEdgeKind).check(
  Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_QUERY_FILTER_KINDS),
);

export const KnowledgeGraphOverviewQuery = Schema.Struct({
  id: KnowledgeGraphQueryId,
  type: Schema.Literal("overview"),
});
export const KnowledgeGraphSearchQuery = Schema.Struct({
  id: KnowledgeGraphQueryId,
  type: Schema.Literal("search"),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(1_000)),
  kinds: Schema.optionalKey(KnowledgeGraphNodeKindFilters),
  limit: Schema.optionalKey(KnowledgeGraphQueryLimitSchema),
});
export const KnowledgeGraphNodeQuery = Schema.Struct({
  id: KnowledgeGraphQueryId,
  type: Schema.Literal("node"),
  nodeId: KnowledgeGraphNodeId,
});
export const KnowledgeGraphNeighborsQuery = Schema.Struct({
  id: KnowledgeGraphQueryId,
  type: Schema.Literal("neighbors"),
  nodeId: KnowledgeGraphNodeId,
  direction: Schema.optionalKey(Schema.Literals(["incoming", "outgoing", "both"])),
  depth: KnowledgeGraphNeighborDepth,
  kinds: Schema.optionalKey(KnowledgeGraphEdgeKindFilters),
  limit: Schema.optionalKey(KnowledgeGraphQueryLimitSchema),
});
export const KnowledgeGraphPathQuery = Schema.Struct({
  id: KnowledgeGraphQueryId,
  type: Schema.Literal("path"),
  sourceNodeId: KnowledgeGraphNodeId,
  targetNodeId: KnowledgeGraphNodeId,
  maxDepth: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(8))),
});

export const KnowledgeGraphQueryOperation = Schema.Union([
  KnowledgeGraphOverviewQuery,
  KnowledgeGraphSearchQuery,
  KnowledgeGraphNodeQuery,
  KnowledgeGraphNeighborsQuery,
  KnowledgeGraphPathQuery,
]);
export type KnowledgeGraphQueryOperation = typeof KnowledgeGraphQueryOperation.Type;

const KnowledgeGraphQueryOperations = Schema.Array(KnowledgeGraphQueryOperation).check(
  Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS),
);

export const KnowledgeGraphQueryBatchInput = Schema.Struct({
  queries: KnowledgeGraphQueryOperations,
}).check(queryInputWithinByteBudget);
export type KnowledgeGraphQueryBatchInput = typeof KnowledgeGraphQueryBatchInput.Type;

export const KnowledgeGraphQueryInput = Schema.Struct({
  scope: KnowledgeGraphScopeInput,
  queries: KnowledgeGraphQueryOperations,
}).check(queryInputWithinByteBudget);
export type KnowledgeGraphQueryInput = typeof KnowledgeGraphQueryInput.Type;

export const KnowledgeGraphQueryOperationResultV1 = Schema.Struct({
  id: KnowledgeGraphQueryId,
  type: Schema.Literals(["overview", "search", "node", "neighbors", "path"]),
  nodes: Schema.Array(KnowledgeGraphNodeV1).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES),
  ),
  edges: Schema.Array(KnowledgeGraphEdgeV1).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES),
  ),
  evidence: Schema.Array(KnowledgeGraphEvidenceV1).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE),
  ),
  truncated: Schema.Boolean,
});
export type KnowledgeGraphQueryOperationResultV1 = typeof KnowledgeGraphQueryOperationResultV1.Type;

/**
 * Aggregate query responses share the stream byte budget. Producers set each
 * operation's `truncated` flag before encoding; decoders never drop results.
 */
export const KnowledgeGraphQueryResultV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  scope: KnowledgeGraphScopeV1,
  revision: NonNegativeInt,
  results: Schema.Array(KnowledgeGraphQueryOperationResultV1).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS),
  ),
}).check(streamPayloadWithinByteBudget);
export type KnowledgeGraphQueryResultV1 = typeof KnowledgeGraphQueryResultV1.Type;

export const KnowledgeGraphNodeContentInput = Schema.Struct({
  scope: KnowledgeGraphScopeInput,
  nodeId: KnowledgeGraphNodeId,
});
export type KnowledgeGraphNodeContentInput = typeof KnowledgeGraphNodeContentInput.Type;

export const KnowledgeGraphNodeContentResultV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  scope: KnowledgeGraphScopeV1,
  revision: NonNegativeInt,
  node: KnowledgeGraphNodeV1,
  excerpts: Schema.Array(KnowledgeGraphSourceExcerptV1).check(
    Schema.isMaxLength(KNOWLEDGE_GRAPH_MAX_NODE_CONTENT_EXCERPTS),
  ),
});
export type KnowledgeGraphNodeContentResultV1 = typeof KnowledgeGraphNodeContentResultV1.Type;

export const KnowledgeGraphRebuildMode = Schema.Literals(["incremental", "semantic", "full"]);
export type KnowledgeGraphRebuildMode = typeof KnowledgeGraphRebuildMode.Type;

export const KnowledgeGraphRebuildInput = Schema.Struct({
  scope: KnowledgeGraphScopeInput,
  mode: KnowledgeGraphRebuildMode,
});
export type KnowledgeGraphRebuildInput = typeof KnowledgeGraphRebuildInput.Type;

export const KnowledgeGraphCancelInput = Schema.Struct({ scope: KnowledgeGraphScopeInput });
export type KnowledgeGraphCancelInput = typeof KnowledgeGraphCancelInput.Type;

export const KnowledgeGraphPauseInput = Schema.Struct({
  scope: KnowledgeGraphScopeInput,
  paused: Schema.Boolean,
});
export type KnowledgeGraphPauseInput = typeof KnowledgeGraphPauseInput.Type;

export const KnowledgeGraphClearInput = Schema.Union([
  Schema.Struct({ target: Schema.Literal("scope"), scope: KnowledgeGraphScopeInput }),
  Schema.Struct({ target: Schema.Literal("environment") }),
]);
export type KnowledgeGraphClearInput = typeof KnowledgeGraphClearInput.Type;

export const KnowledgeGraphMutationResultV1 = Schema.Struct({
  version: Schema.Literal(KNOWLEDGE_GRAPH_CONTRACT_VERSION),
  accepted: Schema.Boolean,
  status: Schema.optionalKey(KnowledgeGraphStatusV1),
});
export type KnowledgeGraphMutationResultV1 = typeof KnowledgeGraphMutationResultV1.Type;

export const KnowledgeGraphOperationErrorCode = Schema.Literals([
  "unsupported",
  "disabled",
  "scope-not-found",
  "revision-gap",
  "busy",
  "cancelled",
  "persistence",
  "internal",
]);
export type KnowledgeGraphOperationErrorCode = typeof KnowledgeGraphOperationErrorCode.Type;

export class KnowledgeGraphOperationError extends Schema.TaggedErrorClass<KnowledgeGraphOperationError>()(
  "KnowledgeGraphOperationError",
  {
    operation: TrimmedNonEmptyString,
    code: KnowledgeGraphOperationErrorCode,
    retryable: Schema.Boolean,
    detail: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
    scopeId: Schema.optionalKey(KnowledgeGraphScopeId),
  },
) {
  override get message(): string {
    return `Knowledge Graph ${this.operation} failed: ${this.detail}`;
  }
}
