import {
  PROJECT_INDEX_DEFAULT_QUERY_TOKENS,
  PROJECT_INDEX_MAX_QUERY_TOKENS,
  type ProjectIndexQueryResultV1,
} from "@t3tools/contracts";

import { estimateProjectIndexTokens } from "../semantic/ProjectIndexContextBudget.ts";

export function projectContextTokenBudget(requested: number | undefined): number {
  return Math.min(requested ?? PROJECT_INDEX_DEFAULT_QUERY_TOKENS, PROJECT_INDEX_MAX_QUERY_TOKENS);
}

/** Counts the complete wire response, including its own count and continuation. */
export function measureProjectContextResult(
  result: ProjectIndexQueryResultV1,
  budget: number,
): ProjectIndexQueryResultV1 {
  const estimatedTokens = estimateProjectIndexTokens(
    JSON.stringify({ ...result, estimatedTokens: budget }),
  );
  return { ...result, estimatedTokens };
}

export function projectContextResultFits(
  result: ProjectIndexQueryResultV1,
  budget: number,
): boolean {
  return measureProjectContextResult(result, budget).estimatedTokens <= budget;
}
