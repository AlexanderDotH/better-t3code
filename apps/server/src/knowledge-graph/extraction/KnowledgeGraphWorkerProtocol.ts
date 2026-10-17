import {
  KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES,
  KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE,
  KnowledgeGraphEdgeV1,
  KnowledgeGraphEvidenceV1,
  KnowledgeGraphFileFingerprintV1,
  KnowledgeGraphNodeV1,
  KnowledgeGraphScopeV1,
  KnowledgeGraphTruncationV1,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const KNOWLEDGE_GRAPH_WORKER_MAX_CHUNK_BYTES = 256 * 1_024;
// Leave room for the fixed envelope and the structured-clone bookkeeping.
export const KNOWLEDGE_GRAPH_WORKER_MAX_PAYLOAD_BYTES =
  KNOWLEDGE_GRAPH_WORKER_MAX_CHUNK_BYTES - 1_024;
export const KNOWLEDGE_GRAPH_WORKER_TIMEOUT_MS = 120_000;

const NonNegativeInteger = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const JobFields = {
  jobId: NonNegativeInteger,
  generation: NonNegativeInteger,
};
const CoChangeGroups = Schema.Array(
  Schema.Array(Schema.String.check(Schema.isMaxLength(4_096))).check(Schema.isMaxLength(32)),
).check(Schema.isMaxLength(128));

export const KnowledgeGraphWorkerInput = Schema.Struct({
  scope: KnowledgeGraphScopeV1,
  workspaceRoot: Schema.String.check(Schema.isMaxLength(4_096)),
  coChangeGroups: Schema.optionalKey(CoChangeGroups),
  maxEligibleFiles: NonNegativeInteger.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES),
  ),
  maxNodes: NonNegativeInteger.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE),
  ),
  seenGeneration: NonNegativeInteger,
});
export type KnowledgeGraphWorkerInput = typeof KnowledgeGraphWorkerInput.Type;

export const KnowledgeGraphWorkerRequest = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("extract"),
    ...JobFields,
    input: KnowledgeGraphWorkerInput,
  }),
  Schema.Struct({ type: Schema.Literal("ack"), ...JobFields, sequence: NonNegativeInteger }),
]);
export type KnowledgeGraphWorkerRequest = typeof KnowledgeGraphWorkerRequest.Type;

const CacheStats = Schema.Struct({
  hits: NonNegativeInteger,
  misses: NonNegativeInteger,
  evictions: NonNegativeInteger,
  sizeBytes: NonNegativeInteger,
  entries: NonNegativeInteger,
});
const Counts = Schema.Struct({
  nodes: NonNegativeInteger,
  edges: NonNegativeInteger,
  evidence: NonNegativeInteger,
  fileFingerprints: NonNegativeInteger,
});
export const KnowledgeGraphWorkerResponse = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("chunk"),
    ...JobFields,
    sequence: NonNegativeInteger,
    payload: Schema.Uint8Array.check(
      Schema.makeFilter(
        (bytes) =>
          bytes.byteLength <= KNOWLEDGE_GRAPH_WORKER_MAX_PAYLOAD_BYTES ||
          "The worker chunk exceeds the IPC byte limit.",
      ),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("done"),
    ...JobFields,
    sequence: NonNegativeInteger,
    counts: Counts,
    truncation: KnowledgeGraphTruncationV1,
    cache: CacheStats,
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    ...JobFields,
    operation: Schema.Literals(["validate-root", "scan", "read", "worker"]),
    message: Schema.String.check(Schema.isMaxLength(2_048)),
  }),
]);
export type KnowledgeGraphWorkerResponse = typeof KnowledgeGraphWorkerResponse.Type;

export const KnowledgeGraphWorkerChunk = Schema.Union([
  Schema.Struct({ section: Schema.Literal("nodes"), items: Schema.Array(KnowledgeGraphNodeV1) }),
  Schema.Struct({ section: Schema.Literal("edges"), items: Schema.Array(KnowledgeGraphEdgeV1) }),
  Schema.Struct({
    section: Schema.Literal("evidence"),
    items: Schema.Array(KnowledgeGraphEvidenceV1),
  }),
  Schema.Struct({
    section: Schema.Literal("fileFingerprints"),
    items: Schema.Array(KnowledgeGraphFileFingerprintV1),
  }),
]);
export type KnowledgeGraphWorkerChunk = typeof KnowledgeGraphWorkerChunk.Type;

export const decodeKnowledgeGraphWorkerRequest = Schema.decodeUnknownSync(
  KnowledgeGraphWorkerRequest,
);
export const decodeKnowledgeGraphWorkerResponse = Schema.decodeUnknownSync(
  KnowledgeGraphWorkerResponse,
);
export const decodeKnowledgeGraphWorkerChunk = Schema.decodeUnknownSync(
  Schema.fromJsonString(KnowledgeGraphWorkerChunk),
);
