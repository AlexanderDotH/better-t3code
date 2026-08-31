import {
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE,
  KnowledgeGraphSemanticModelOutputV1,
  KnowledgeGraphSemanticPatchV1,
  type KnowledgeGraphEvidenceId,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphSemanticClaimV1,
  type KnowledgeGraphSnapshotV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const KnowledgeGraphSemanticValidationReason = Schema.Literals([
  "schema",
  "claim",
  "reference",
  "bounds",
]);
export type KnowledgeGraphSemanticValidationReason =
  typeof KnowledgeGraphSemanticValidationReason.Type;

export class KnowledgeGraphSemanticValidationError extends Schema.TaggedErrorClass<KnowledgeGraphSemanticValidationError>()(
  "KnowledgeGraphSemanticValidationError",
  {
    reason: KnowledgeGraphSemanticValidationReason,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Knowledge Graph semantic output is invalid (${this.reason}): ${this.detail}`;
  }
}

const decodeModelOutput = Schema.decodeUnknownEffect(KnowledgeGraphSemanticModelOutputV1);
const decodeSemanticPatch = Schema.decodeUnknownEffect(KnowledgeGraphSemanticPatchV1);

function validationError(
  reason: KnowledgeGraphSemanticValidationReason,
  detail: string,
  cause?: unknown,
): KnowledgeGraphSemanticValidationError {
  return new KnowledgeGraphSemanticValidationError({
    reason,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function edgeKey(input: {
  readonly kind: string;
  readonly sourceNodeId: KnowledgeGraphNodeId;
  readonly targetNodeId: KnowledgeGraphNodeId;
}): string {
  return `${input.sourceNodeId}\u0000${input.kind}\u0000${input.targetNodeId}`;
}

function candidateKey(sourceNodeId: KnowledgeGraphNodeId, targetNodeId: KnowledgeGraphNodeId) {
  return `${sourceNodeId}\u0000${targetNodeId}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface ValidateKnowledgeGraphSemanticOutputInput {
  readonly claim: KnowledgeGraphSemanticClaimV1;
  readonly snapshot: KnowledgeGraphSnapshotV1;
  readonly output: unknown;
  readonly committedAt: string;
}

export const validateKnowledgeGraphSemanticOutput = Effect.fn(
  "KnowledgeGraphSemanticValidation.validate",
)(function* (input: ValidateKnowledgeGraphSemanticOutputInput) {
  const output = yield* decodeModelOutput(input.output, {
    onExcessProperty: "error",
  }).pipe(
    Effect.mapError((cause) =>
      validationError("schema", "Output does not match the exact schema.", cause),
    ),
  );
  const scopeId = input.snapshot.scope.scopeId;
  const modelGenerations = new Set(input.claim.items.map(({ modelGeneration }) => modelGeneration));
  if (
    input.claim.environmentId !== input.snapshot.scope.environmentId ||
    input.claim.items.some((item) => item.scopeId !== scopeId) ||
    modelGenerations.size !== 1
  ) {
    return yield* validationError(
      "claim",
      "The claim environment, scope, or model generation does not match the snapshot.",
    );
  }

  const nodeById = new Map(input.snapshot.nodes.map((node) => [node.nodeId, node]));
  const evidenceIds = new Set(input.snapshot.evidence.map(({ evidenceId }) => evidenceId));
  const claimedSourceIds = new Set<KnowledgeGraphNodeId>();
  const candidateEvidenceByPair = new Map<string, ReadonlySet<KnowledgeGraphEvidenceId>>();
  for (const item of input.claim.items) {
    const source = nodeById.get(item.nodeId);
    if (source === undefined || source.nodeRevision !== item.desiredNodeRevision) {
      return yield* validationError(
        "claim",
        `Claimed node '${item.nodeId}' is missing or has a stale revision.`,
      );
    }
    claimedSourceIds.add(item.nodeId);
    for (const candidate of item.candidates) {
      if (candidate.sourceNodeId !== item.nodeId || !nodeById.has(candidate.candidateNodeId)) {
        return yield* validationError(
          "claim",
          `Candidate '${candidate.candidateNodeId}' does not belong to claimed node '${item.nodeId}'.`,
        );
      }
      candidateEvidenceByPair.set(
        candidateKey(item.nodeId, candidate.candidateNodeId),
        new Set(
          candidate.evidenceIds
            .filter((evidenceId) => evidenceIds.has(evidenceId))
            .slice(0, KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE),
        ),
      );
    }
  }

  const maximumEdgeCount = [...candidateEvidenceByPair.keys()].length;
  if (output.edges.length > maximumEdgeCount) {
    return yield* validationError(
      "bounds",
      `Output contains ${output.edges.length} relations for ${maximumEdgeCount} candidates.`,
    );
  }
  const relationKeys = new Set<string>();
  const changedNodeIds = new Set<KnowledgeGraphNodeId>();
  for (const edge of output.edges) {
    const allowedEvidence = candidateEvidenceByPair.get(
      candidateKey(edge.sourceNodeId, edge.targetNodeId),
    );
    if (!claimedSourceIds.has(edge.sourceNodeId) || allowedEvidence === undefined) {
      return yield* validationError(
        "reference",
        `Relation '${edge.sourceNodeId}' -> '${edge.targetNodeId}' is not a claimed candidate pair.`,
      );
    }
    if (edge.evidenceIds.length === 0) {
      return yield* validationError(
        "reference",
        `Relation '${edge.sourceNodeId}' -> '${edge.targetNodeId}' has no evidence.`,
      );
    }
    if (edge.evidenceIds.some((evidenceId) => !allowedEvidence.has(evidenceId))) {
      return yield* validationError(
        "reference",
        `Relation '${edge.sourceNodeId}' -> '${edge.targetNodeId}' references unclaimed evidence.`,
      );
    }
    const relationKey = edgeKey(edge);
    if (relationKeys.has(relationKey)) {
      return yield* validationError("bounds", `Duplicate semantic relation '${relationKey}'.`);
    }
    relationKeys.add(relationKey);
    changedNodeIds.add(edge.sourceNodeId);
    changedNodeIds.add(edge.targetNodeId);
  }

  return yield* decodeSemanticPatch(
    {
      version: 1,
      scopeId,
      baseRevision: input.snapshot.revision,
      modelGeneration: input.claim.items[0].modelGeneration,
      nodes: [],
      edges: [...output.edges].sort((left, right) => compareStrings(edgeKey(left), edgeKey(right))),
      evidence: [],
      changedNodeIds: [...changedNodeIds].sort(compareStrings),
      committedAt: input.committedAt,
    },
    { onExcessProperty: "error" },
  ).pipe(
    Effect.mapError((cause) =>
      validationError("schema", "The validated output could not form a semantic patch.", cause),
    ),
  );
});
