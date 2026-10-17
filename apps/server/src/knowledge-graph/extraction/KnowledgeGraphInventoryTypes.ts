import {
  KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES,
  KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE,
  type KnowledgeGraphScopeV1,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export interface ExtractKnowledgeGraphInventoryInput {
  readonly scope: KnowledgeGraphScopeV1;
  readonly workspaceRoot: string;
  readonly coChangeGroups?: readonly (readonly string[])[];
  readonly maxEligibleFiles?: number;
  readonly maxNodes?: number;
  readonly seenGeneration?: number;
  readonly generation?: number;
}

export class KnowledgeGraphInventoryError extends Schema.TaggedError<KnowledgeGraphInventoryError>()(
  "KnowledgeGraphInventoryError",
  {
    operation: Schema.Literals(["validate-root", "scan", "read", "worker"]),
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const target = this.relativePath.length === 0 ? this.workspaceRoot : this.relativePath;
    return `Knowledge Graph inventory ${this.operation} failed at '${target}'.`;
  }
}

export const isKnowledgeGraphInventoryError = Schema.is(KnowledgeGraphInventoryError);

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

export function resolveKnowledgeGraphInventoryBounds(
  input: Pick<ExtractKnowledgeGraphInventoryInput, "maxEligibleFiles" | "maxNodes">,
): {
  readonly maxEligibleFiles: number;
  readonly maxNodes: number;
} {
  return {
    maxEligibleFiles: boundedPositiveInteger(
      input.maxEligibleFiles,
      KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES,
      KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES,
    ),
    maxNodes: boundedPositiveInteger(
      input.maxNodes,
      KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE,
      KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE,
    ),
  };
}
