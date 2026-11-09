import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  CLAUDE_DRIVER_KIND,
  CODEX_DRIVER_KIND,
  CURSOR_DRIVER_KIND,
  GROK_DRIVER_KIND,
  OPENCODE_DRIVER_KIND,
} from "./model.ts";
import { PlanId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { DeepPlanRunReference } from "./deepPlanning.ts";

export const PLAN_PARALLELISM_REVIEW_DRIVER_KINDS = [
  CODEX_DRIVER_KIND,
  CLAUDE_DRIVER_KIND,
  CURSOR_DRIVER_KIND,
  GROK_DRIVER_KIND,
  OPENCODE_DRIVER_KIND,
] as const;
export type PlanParallelismReviewDriverKind = (typeof PLAN_PARALLELISM_REVIEW_DRIVER_KINDS)[number];

const PLAN_PARALLELISM_REVIEW_DRIVER_KIND_SET = new Set<string>(
  PLAN_PARALLELISM_REVIEW_DRIVER_KINDS,
);

export function isPlanParallelismReviewDriverKind(
  value: unknown,
): value is PlanParallelismReviewDriverKind {
  return typeof value === "string" && PLAN_PARALLELISM_REVIEW_DRIVER_KIND_SET.has(value);
}

export const PlanParallelismReviewCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(2));
export type PlanParallelismReviewCount = typeof PlanParallelismReviewCount.Type;

export const PlanParallelismReviewInput = Schema.Struct({
  threadId: ThreadId,
  deepPlan: Schema.optional(DeepPlanRunReference),
  planId: PlanId,
  expectedPlanUpdatedAt: IsoDateTime,
  implementationProviderInstanceId: ProviderInstanceId,
});
export type PlanParallelismReviewInput = typeof PlanParallelismReviewInput.Type;

export const PlanParallelismReviewResult = Schema.Struct({
  planId: PlanId,
  planUpdatedAt: IsoDateTime,
  implementationProviderInstanceId: ProviderInstanceId,
  recommendedSubagents: PlanParallelismReviewCount,
});
export type PlanParallelismReviewResult = typeof PlanParallelismReviewResult.Type;

export const PlanParallelismReviewErrorReason = Schema.Literals([
  "plan-not-found",
  "plan-stale",
  "reviewer-unavailable",
  "implementation-provider-unsupported",
  "timeout",
  "generation-failed",
  "invalid-output",
]);
export type PlanParallelismReviewErrorReason = typeof PlanParallelismReviewErrorReason.Type;

export class PlanParallelismReviewError extends Schema.TaggedError<PlanParallelismReviewError>()(
  "PlanParallelismReviewError",
  {
    reason: PlanParallelismReviewErrorReason,
    message: TrimmedNonEmptyString,
  },
) {}
