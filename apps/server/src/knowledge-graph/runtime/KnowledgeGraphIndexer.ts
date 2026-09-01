import {
  type KnowledgeGraphEdgeV1,
  KnowledgeGraphEdgeV1 as KnowledgeGraphEdgeSchema,
  type KnowledgeGraphEvidenceV1,
  KnowledgeGraphEvidenceV1 as KnowledgeGraphEvidenceSchema,
  type KnowledgeGraphFileFingerprintV1,
  KnowledgeGraphFileFingerprintV1 as KnowledgeGraphFileFingerprintSchema,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeV1,
  KnowledgeGraphNodeV1 as KnowledgeGraphNodeSchema,
  KnowledgeGraphOperationError,
  type KnowledgeGraphScopeV1,
  KnowledgeGraphTruncationV1 as KnowledgeGraphTruncationSchema,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { extractKnowledgeGraphInventory } from "../extraction/KnowledgeGraphInventory.ts";
import * as KnowledgeGraphRepository from "../persistence/KnowledgeGraphRepository.ts";

export interface KnowledgeGraphIndexerShape {
  readonly indexScope: (
    scope: KnowledgeGraphScopeV1,
  ) => Effect.Effect<
    Option.Option<KnowledgeGraphRepository.KnowledgeGraphRepositoryCommit>,
    KnowledgeGraphOperationError
  >;
}

export class KnowledgeGraphIndexer extends Context.Service<
  KnowledgeGraphIndexer,
  KnowledgeGraphIndexerShape
>()("t3/knowledge-graph/runtime/KnowledgeGraphIndexer") {}

const encodeNode = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphNodeSchema));
const encodeEdge = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphEdgeSchema));
const encodeEvidence = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphEvidenceSchema));
const encodeFingerprint = Schema.encodeSync(
  Schema.fromJsonString(KnowledgeGraphFileFingerprintSchema),
);
const encodeTruncation = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphTruncationSchema));

function sameNode(left: KnowledgeGraphNodeV1, right: KnowledgeGraphNodeV1): boolean {
  return encodeNode({ ...left, nodeRevision: 0 }) === encodeNode({ ...right, nodeRevision: 0 });
}

function sameEdge(left: KnowledgeGraphEdgeV1, right: KnowledgeGraphEdgeV1): boolean {
  return encodeEdge({ ...left, edgeRevision: 0 }) === encodeEdge({ ...right, edgeRevision: 0 });
}

function sameEvidence(left: KnowledgeGraphEvidenceV1, right: KnowledgeGraphEvidenceV1): boolean {
  return (
    encodeEvidence({ ...left, evidenceRevision: 0 }) ===
    encodeEvidence({ ...right, evidenceRevision: 0 })
  );
}

function sameFingerprint(
  left: KnowledgeGraphFileFingerprintV1,
  right: KnowledgeGraphFileFingerprintV1,
): boolean {
  return (
    encodeFingerprint({ ...left, modifiedAtMs: 0, seenGeneration: 0 }) ===
    encodeFingerprint({ ...right, modifiedAtMs: 0, seenGeneration: 0 })
  );
}

function operationError(input: {
  readonly operation: string;
  readonly code: "persistence" | "internal";
  readonly retryable: boolean;
  readonly detail: string;
  readonly scopeId: KnowledgeGraphScopeV1["scopeId"];
}): KnowledgeGraphOperationError {
  return new KnowledgeGraphOperationError(input);
}

const make = Effect.gen(function* () {
  const repository = yield* KnowledgeGraphRepository.KnowledgeGraphRepository;

  const indexScope: KnowledgeGraphIndexerShape["indexScope"] = Effect.fn(
    "KnowledgeGraphIndexer.indexScope",
  )(function* (scope) {
    yield* repository.ensureScope(scope).pipe(
      Effect.mapError(() =>
        operationError({
          operation: "index",
          code: "persistence",
          retryable: true,
          detail: "The graph scope could not be prepared.",
          scopeId: scope.scopeId,
        }),
      ),
    );
    const current = Option.getOrThrow(
      yield* repository.getDeterministicState(scope.scopeId).pipe(
        Effect.mapError(() =>
          operationError({
            operation: "index",
            code: "persistence",
            retryable: true,
            detail: "The current graph revision could not be read.",
            scopeId: scope.scopeId,
          }),
        ),
      ),
    );
    const currentStatus = Option.getOrThrow(
      yield* repository.getStatus(scope.scopeId).pipe(
        Effect.mapError(() =>
          operationError({
            operation: "index",
            code: "persistence",
            retryable: true,
            detail: "The current graph status could not be read.",
            scopeId: scope.scopeId,
          }),
        ),
      ),
    );
    const {
      errorMessage: _staleErrorMessage,
      retryAt: _staleRetryAt,
      ...indexingStatus
    } = currentStatus;
    yield* repository
      .updateStatus({
        ...indexingStatus,
        state: "indexing",
        progress: {
          version: 1,
          phase: "discovering",
          discoveredFileCount: 0,
          processedFileCount: 0,
          queuedSemanticNodeCount: currentStatus.semanticQueueDepth,
        },
      })
      .pipe(
        Effect.mapError(() =>
          operationError({
            operation: "index",
            code: "persistence",
            retryable: true,
            detail: "The indexing status could not be persisted.",
            scopeId: scope.scopeId,
          }),
        ),
      );

    const extraction = yield* extractKnowledgeGraphInventory({
      scope,
      workspaceRoot: scope.effectiveWorkspaceRoot,
      seenGeneration: current.revision + 1,
    }).pipe(
      Effect.mapError(() =>
        operationError({
          operation: "index",
          code: "internal",
          retryable: true,
          detail: "The project inventory could not be extracted.",
          scopeId: scope.scopeId,
        }),
      ),
    );
    const nextRevision = current.revision + 1;
    const currentNodes = new Map(current.nodes.map((node) => [node.nodeId, node] as const));
    const currentEdges = new Map(current.edges.map((edge) => [edge.edgeId, edge] as const));
    const currentEvidence = new Map(
      current.evidence.map((evidence) => [evidence.evidenceId, evidence] as const),
    );
    const currentFingerprints = new Map(
      current.fileFingerprints.map((fingerprint) => [fingerprint.path, fingerprint] as const),
    );

    const nextNodes = extraction.nodes.map((node) => {
      const previous = currentNodes.get(node.nodeId);
      return {
        ...node,
        nodeRevision:
          previous !== undefined && sameNode(previous, node) ? previous.nodeRevision : nextRevision,
      };
    });
    const nextEdges = extraction.edges.map((edge) => {
      const previous = currentEdges.get(edge.edgeId);
      return {
        ...edge,
        edgeRevision:
          previous !== undefined && sameEdge(previous, edge) ? previous.edgeRevision : nextRevision,
      };
    });
    const nextEvidence = extraction.evidence.map((evidence) => {
      const previous = currentEvidence.get(evidence.evidenceId);
      return {
        ...evidence,
        evidenceRevision:
          previous !== undefined && sameEvidence(previous, evidence)
            ? previous.evidenceRevision
            : nextRevision,
      };
    });
    const nextNodeIds = new Set(nextNodes.map(({ nodeId }) => nodeId));
    const nextEdgeIds = new Set(nextEdges.map(({ edgeId }) => edgeId));
    const nextEvidenceIds = new Set(nextEvidence.map(({ evidenceId }) => evidenceId));
    const nextFingerprintPaths = new Set(extraction.fileFingerprints.map(({ path }) => path));
    const upsertedNodes = nextNodes.filter((node) => {
      const previous = currentNodes.get(node.nodeId);
      return previous === undefined || !sameNode(previous, node);
    });
    const upsertedEdges = nextEdges.filter((edge) => {
      const previous = currentEdges.get(edge.edgeId);
      return previous === undefined || !sameEdge(previous, edge);
    });
    const upsertedEvidence = nextEvidence.filter((evidence) => {
      const previous = currentEvidence.get(evidence.evidenceId);
      return previous === undefined || !sameEvidence(previous, evidence);
    });
    const removedNodeIds = current.nodes
      .filter(({ nodeId }) => !nextNodeIds.has(nodeId))
      .map(({ nodeId }) => nodeId);
    const removedEdgeIds = current.edges
      .filter(({ edgeId }) => !nextEdgeIds.has(edgeId))
      .map(({ edgeId }) => edgeId);
    const removedEvidenceIds = current.evidence
      .filter(({ evidenceId }) => !nextEvidenceIds.has(evidenceId))
      .map(({ evidenceId }) => evidenceId);
    const removedFingerprintPaths = current.fileFingerprints
      .filter(({ path }) => !nextFingerprintPaths.has(path))
      .map(({ path }) => path);
    const fingerprintsChanged =
      removedFingerprintPaths.length > 0 ||
      extraction.fileFingerprints.some((fingerprint) => {
        const previous = currentFingerprints.get(fingerprint.path);
        return previous === undefined || !sameFingerprint(previous, fingerprint);
      });
    const changedEvidenceIds = new Set(upsertedEvidence.map(({ evidenceId }) => evidenceId));
    const changedNodeIds = new Set<KnowledgeGraphNodeId>(upsertedNodes.map(({ nodeId }) => nodeId));
    for (const node of nextNodes) {
      if (node.evidenceIds.some((evidenceId) => changedEvidenceIds.has(evidenceId))) {
        changedNodeIds.add(node.nodeId);
      }
    }
    for (const edge of upsertedEdges) {
      changedNodeIds.add(edge.sourceNodeId);
      changedNodeIds.add(edge.targetNodeId);
    }
    const graphChanged =
      upsertedNodes.length > 0 ||
      upsertedEdges.length > 0 ||
      upsertedEvidence.length > 0 ||
      removedNodeIds.length > 0 ||
      removedEdgeIds.length > 0 ||
      removedEvidenceIds.length > 0 ||
      fingerprintsChanged ||
      encodeTruncation(current.truncation) !== encodeTruncation(extraction.truncation);

    if (!graphChanged) {
      const {
        errorMessage: _staleErrorMessage,
        progress: _progress,
        retryAt: _staleRetryAt,
        ...readyStatus
      } = currentStatus;
      yield* repository
        .updateStatus({
          ...readyStatus,
          state: "ready",
        })
        .pipe(
          Effect.mapError(() =>
            operationError({
              operation: "index",
              code: "persistence",
              retryable: true,
              detail: "The ready graph status could not be persisted.",
              scopeId: scope.scopeId,
            }),
          ),
        );
      return Option.none<KnowledgeGraphRepository.KnowledgeGraphRepositoryCommit>();
    }

    const committedAt = DateTime.formatIso(yield* DateTime.now);
    const committed = yield* repository
      .applyDeterministicPatch({
        version: 1,
        scope,
        baseRevision: current.revision,
        nodes: upsertedNodes,
        edges: upsertedEdges,
        evidence: upsertedEvidence,
        removals: {
          nodeIds: removedNodeIds,
          edgeIds: removedEdgeIds,
          evidenceIds: removedEvidenceIds,
          fingerprintPaths: removedFingerprintPaths,
        },
        fileFingerprints: extraction.fileFingerprints,
        changedNodeIds: [...changedNodeIds],
        truncation: extraction.truncation,
        committedAt,
      })
      .pipe(
        Effect.mapError(() =>
          operationError({
            operation: "index",
            code: "persistence",
            retryable: true,
            detail: "The extracted graph revision could not be committed.",
            scopeId: scope.scopeId,
          }),
        ),
      );
    return Option.some(committed);
  });

  return KnowledgeGraphIndexer.of({ indexScope });
});

export const layer = Layer.effect(KnowledgeGraphIndexer, make);
