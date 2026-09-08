import {
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphEvidenceV1,
  type KnowledgeGraphFileFingerprintV1,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeV1,
  KnowledgeGraphOperationError,
  type KnowledgeGraphScopeV1,
  type KnowledgeGraphTruncationV1,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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

function sameArray<A>(left: readonly A[], right: readonly A[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameSource(
  left: KnowledgeGraphNodeV1["source"],
  right: KnowledgeGraphNodeV1["source"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.path === right.path &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine &&
    left.symbol === right.symbol
  );
}

function sameNode(left: KnowledgeGraphNodeV1, right: KnowledgeGraphNodeV1): boolean {
  return (
    left.version === right.version &&
    left.nodeId === right.nodeId &&
    left.scopeId === right.scopeId &&
    left.kind === right.kind &&
    left.label === right.label &&
    left.summary === right.summary &&
    sameSource(left.source, right.source) &&
    left.language === right.language &&
    left.provenance === right.provenance &&
    left.confidence === right.confidence &&
    sameArray(left.evidenceIds, right.evidenceIds)
  );
}

function sameEdge(left: KnowledgeGraphEdgeV1, right: KnowledgeGraphEdgeV1): boolean {
  return (
    left.version === right.version &&
    left.edgeId === right.edgeId &&
    left.scopeId === right.scopeId &&
    left.kind === right.kind &&
    left.sourceNodeId === right.sourceNodeId &&
    left.targetNodeId === right.targetNodeId &&
    left.summary === right.summary &&
    left.provenance === right.provenance &&
    left.confidence === right.confidence &&
    sameArray(left.evidenceIds, right.evidenceIds)
  );
}

function sameEvidence(left: KnowledgeGraphEvidenceV1, right: KnowledgeGraphEvidenceV1): boolean {
  return (
    left.version === right.version &&
    left.evidenceId === right.evidenceId &&
    left.scopeId === right.scopeId &&
    left.kind === right.kind &&
    sameSource(left.source, right.source) &&
    left.excerpt === right.excerpt &&
    left.fingerprint === right.fingerprint &&
    left.confidence === right.confidence
  );
}

function sameFingerprint(
  left: KnowledgeGraphFileFingerprintV1,
  right: KnowledgeGraphFileFingerprintV1,
): boolean {
  return (
    left.path === right.path &&
    left.fingerprint === right.fingerprint &&
    left.sizeBytes === right.sizeBytes &&
    left.extractionVersion === right.extractionVersion
  );
}

function sameTruncation(
  left: KnowledgeGraphTruncationV1,
  right: KnowledgeGraphTruncationV1,
): boolean {
  return (
    left.eligibleFiles === right.eligibleFiles &&
    left.nodes === right.nodes &&
    left.visibleNodes === right.visibleNodes &&
    left.omittedFileCount === right.omittedFileCount &&
    left.omittedNodeCount === right.omittedNodeCount
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

    const nextNodes: KnowledgeGraphNodeV1[] = [];
    const upsertedNodes: KnowledgeGraphNodeV1[] = [];
    for (const node of extraction.nodes) {
      const previous = currentNodes.get(node.nodeId);
      const changed = previous === undefined || !sameNode(previous, node);
      const nextNode: KnowledgeGraphNodeV1 = {
        ...node,
        nodeRevision: changed ? nextRevision : previous.nodeRevision,
      };
      nextNodes.push(nextNode);
      if (changed) upsertedNodes.push(nextNode);
    }
    const nextEdges: KnowledgeGraphEdgeV1[] = [];
    const upsertedEdges: KnowledgeGraphEdgeV1[] = [];
    for (const edge of extraction.edges) {
      const previous = currentEdges.get(edge.edgeId);
      const changed = previous === undefined || !sameEdge(previous, edge);
      const nextEdge: KnowledgeGraphEdgeV1 = {
        ...edge,
        edgeRevision: changed ? nextRevision : previous.edgeRevision,
      };
      nextEdges.push(nextEdge);
      if (changed) upsertedEdges.push(nextEdge);
    }
    const nextEvidence: KnowledgeGraphEvidenceV1[] = [];
    const upsertedEvidence: KnowledgeGraphEvidenceV1[] = [];
    for (const evidence of extraction.evidence) {
      const previous = currentEvidence.get(evidence.evidenceId);
      const changed = previous === undefined || !sameEvidence(previous, evidence);
      const nextEntry: KnowledgeGraphEvidenceV1 = {
        ...evidence,
        evidenceRevision: changed ? nextRevision : previous.evidenceRevision,
      };
      nextEvidence.push(nextEntry);
      if (changed) upsertedEvidence.push(nextEntry);
    }
    const nextNodeIds = new Set(nextNodes.map(({ nodeId }) => nodeId));
    const nextEdgeIds = new Set(nextEdges.map(({ edgeId }) => edgeId));
    const nextEvidenceIds = new Set(nextEvidence.map(({ evidenceId }) => evidenceId));
    const nextFingerprintPaths = new Set(extraction.fileFingerprints.map(({ path }) => path));
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
      !sameTruncation(current.truncation, extraction.truncation);

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

    const processedFileCount = extraction.fileFingerprints.length;
    const discoveredFileCount = processedFileCount + extraction.truncation.omittedFileCount;
    yield* repository
      .updateStatus({
        ...indexingStatus,
        state: "indexing",
        progress: {
          version: 1,
          phase: "persisting",
          discoveredFileCount,
          processedFileCount,
          totalFileCount: discoveredFileCount,
          queuedSemanticNodeCount: currentStatus.semanticQueueDepth,
        },
      })
      .pipe(
        Effect.mapError(() =>
          operationError({
            operation: "index",
            code: "persistence",
            retryable: true,
            detail: "The indexing progress could not be persisted.",
            scopeId: scope.scopeId,
          }),
        ),
      );
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
