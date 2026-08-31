import type {
  KnowledgeGraphEvidenceId,
  KnowledgeGraphSemanticClaimV1,
  KnowledgeGraphSemanticModelRequestV1,
  KnowledgeGraphSnapshotV1,
} from "@t3tools/contracts";
import {
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_REQUEST_EVIDENCE,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { KnowledgeGraphSemanticValidationError } from "./KnowledgeGraphSemanticValidation.ts";

export { KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE as KNOWLEDGE_GRAPH_SEMANTIC_BATCH_SIZE } from "@t3tools/contracts";

function claimError(detail: string): KnowledgeGraphSemanticValidationError {
  return new KnowledgeGraphSemanticValidationError({ reason: "claim", detail });
}

export const buildKnowledgeGraphSemanticModelRequest = Effect.fn(
  "KnowledgeGraphSemanticRequest.build",
)(function* (input: {
  readonly claim: KnowledgeGraphSemanticClaimV1;
  readonly snapshot: KnowledgeGraphSnapshotV1;
}) {
  const scopeId = input.snapshot.scope.scopeId;
  const firstClaimItem = input.claim.items[0];
  if (firstClaimItem === undefined) {
    return yield* claimError("The semantic claim is empty.");
  }
  const modelGeneration = firstClaimItem.modelGeneration;
  if (
    input.claim.environmentId !== input.snapshot.scope.environmentId ||
    input.claim.items.length > KNOWLEDGE_GRAPH_MAX_SEMANTIC_BATCH_SIZE ||
    input.claim.items.some(
      (item) => item.scopeId !== scopeId || item.modelGeneration !== modelGeneration,
    )
  ) {
    return yield* claimError(
      "The semantic claim exceeds the batch bound or spans environments, scopes, or models.",
    );
  }

  const nodeById = new Map(input.snapshot.nodes.map((node) => [node.nodeId, node]));
  const evidenceById = new Map(
    input.snapshot.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const requestedEvidenceIds = new Set<KnowledgeGraphEvidenceId>();
  const items: Array<KnowledgeGraphSemanticModelRequestV1["items"][number]> = [];
  for (const item of input.claim.items) {
    const sourceNode = nodeById.get(item.nodeId);
    if (sourceNode === undefined || sourceNode.nodeRevision !== item.desiredNodeRevision) {
      return yield* claimError(`Claimed node '${item.nodeId}' is missing or stale.`);
    }
    const candidates: Array<
      KnowledgeGraphSemanticModelRequestV1["items"][number]["candidates"][number]
    > = [];
    for (const candidate of item.candidates) {
      const candidateNode = nodeById.get(candidate.candidateNodeId);
      if (candidate.sourceNodeId !== item.nodeId || candidateNode === undefined) {
        return yield* claimError(
          `Candidate '${candidate.candidateNodeId}' does not belong to '${item.nodeId}'.`,
        );
      }
      const candidateEvidenceIds = candidate.evidenceIds
        .filter((evidenceId) => evidenceById.has(evidenceId))
        .slice(0, KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE);
      for (const evidenceId of candidateEvidenceIds) {
        if (requestedEvidenceIds.size >= KNOWLEDGE_GRAPH_MAX_SEMANTIC_REQUEST_EVIDENCE) break;
        requestedEvidenceIds.add(evidenceId);
      }
      candidates.push({
        candidateNode,
        evidenceIds: candidateEvidenceIds.filter((evidenceId) =>
          requestedEvidenceIds.has(evidenceId),
        ),
        score: candidate.score,
      });
    }
    items.push({ sourceNode, candidates });
  }

  const [firstItem, ...remainingItems] = items;
  if (firstItem === undefined) {
    return yield* claimError("The semantic claim is empty.");
  }

  return {
    version: 1 as const,
    environmentId: input.claim.environmentId,
    scopeId,
    baseRevision: input.snapshot.revision,
    modelGeneration,
    items: [firstItem, ...remainingItems],
    evidence: [...requestedEvidenceIds].flatMap((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return evidence === undefined ? [] : [evidence];
    }),
  } satisfies KnowledgeGraphSemanticModelRequestV1;
});
