import type {
  EnvironmentId,
  ModelSelection,
  PlanParallelismReviewInput,
  PlanParallelismReviewResult,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { isPlanParallelismReviewDriverKind } from "@t3tools/contracts";
import type { PlanParallelismReviewStatus } from "./planImplementation.ts";

const MAX_CACHED_PLAN_REVIEWS = 50;
const MAX_CACHED_PLAN_REVIEW_BYTES = 64 * 1024;
const cachedReviews = new Map<string, number>();
const inFlightPlanParallelismReviews = new Map<string, Promise<PlanParallelismReviewState>>();

export function cachedPlanParallelismReview(cacheKey: string): number | null {
  const value = cachedReviews.get(cacheKey);
  if (value === undefined) return null;
  cachedReviews.delete(cacheKey);
  cachedReviews.set(cacheKey, value);
  return value;
}

function cachePlanReview(cacheKey: string, count: number): void {
  const entrySize = cacheKey.length * 2 + 8;
  if (entrySize > MAX_CACHED_PLAN_REVIEW_BYTES) return;
  cachedReviews.delete(cacheKey);
  cachedReviews.set(cacheKey, count);
  let totalBytes = [...cachedReviews.keys()].reduce((total, key) => total + key.length * 2 + 8, 0);
  while (
    cachedReviews.size > MAX_CACHED_PLAN_REVIEWS ||
    totalBytes > MAX_CACHED_PLAN_REVIEW_BYTES
  ) {
    const oldest = cachedReviews.keys().next().value;
    if (oldest === undefined) break;
    totalBytes -= oldest.length * 2 + 8;
    cachedReviews.delete(oldest);
  }
}
export interface PlanParallelismReviewDescriptor {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly planId: PlanParallelismReviewInput["planId"];
  readonly planUpdatedAt: PlanParallelismReviewInput["expectedPlanUpdatedAt"];
  readonly implementationProviderInstanceId: ProviderInstanceId;
  readonly maxRecommendedSubagents: number;
  readonly reviewerSelection: ModelSelection;
}

export interface PlanParallelismReviewHookInput {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly plan: {
    readonly id: PlanParallelismReviewInput["planId"];
    readonly updatedAt: PlanParallelismReviewInput["expectedPlanUpdatedAt"];
  } | null;
  readonly implementationProvider: ServerProvider | null | undefined;
  readonly reviewerProvider: ServerProvider | null | undefined;
  readonly reviewerSelection: ModelSelection;
}

export interface PlanParallelismReviewSetup {
  readonly descriptor: PlanParallelismReviewDescriptor | null;
  readonly inactiveStatus: Extract<PlanParallelismReviewStatus, "idle" | "fallback">;
}

export interface PlanParallelismReviewState {
  readonly status: PlanParallelismReviewStatus;
  readonly reviewedSubagentCount: number | null;
}

export type ReviewPlanParallelism = (
  environmentId: EnvironmentId,
  input: PlanParallelismReviewInput,
) => Promise<PlanParallelismReviewResult>;

export const IDLE_REVIEW_STATE: PlanParallelismReviewState = {
  status: "idle",
  reviewedSubagentCount: null,
};

export function serializeReviewerSelection(selection: ModelSelection): string {
  const options = [...(selection.options ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return JSON.stringify([selection.instanceId, selection.model, options]);
}

export function buildPlanParallelismReviewCacheKey(
  descriptor: PlanParallelismReviewDescriptor,
): string {
  return JSON.stringify([
    descriptor.environmentId,
    descriptor.threadId,
    descriptor.planId,
    descriptor.planUpdatedAt,
    descriptor.implementationProviderInstanceId,
    descriptor.maxRecommendedSubagents,
    serializeReviewerSelection(descriptor.reviewerSelection),
  ]);
}

export function createPlanParallelismReviewRequest(
  descriptor: PlanParallelismReviewDescriptor,
): PlanParallelismReviewInput {
  return {
    threadId: descriptor.threadId,
    planId: descriptor.planId,
    expectedPlanUpdatedAt: descriptor.planUpdatedAt,
    implementationProviderInstanceId: descriptor.implementationProviderInstanceId,
  };
}

export function validatePlanParallelismReviewResult(
  descriptor: PlanParallelismReviewDescriptor,
  result: PlanParallelismReviewResult,
): number | null {
  if (
    result.planId !== descriptor.planId ||
    result.planUpdatedAt !== descriptor.planUpdatedAt ||
    result.implementationProviderInstanceId !== descriptor.implementationProviderInstanceId
  ) {
    return null;
  }
  if (
    !Number.isInteger(result.recommendedSubagents) ||
    result.recommendedSubagents < 2 ||
    result.recommendedSubagents > descriptor.maxRecommendedSubagents
  ) {
    return null;
  }
  return result.recommendedSubagents;
}

export function requestPlanParallelismReview(
  descriptor: PlanParallelismReviewDescriptor,
  reviewPlanParallelism: ReviewPlanParallelism,
): Promise<PlanParallelismReviewState> {
  const cacheKey = buildPlanParallelismReviewCacheKey(descriptor);
  const cachedCount = cachedPlanParallelismReview(cacheKey);
  if (cachedCount !== null) {
    return Promise.resolve({ status: "ready", reviewedSubagentCount: cachedCount });
  }

  const existingReview = inFlightPlanParallelismReviews.get(cacheKey);
  if (existingReview) {
    return existingReview;
  }

  const review = (async (): Promise<PlanParallelismReviewState> => {
    try {
      const result = await reviewPlanParallelism(
        descriptor.environmentId,
        createPlanParallelismReviewRequest(descriptor),
      );
      const reviewedSubagentCount = validatePlanParallelismReviewResult(descriptor, result);
      if (reviewedSubagentCount === null) {
        return { status: "fallback", reviewedSubagentCount: null };
      }
      cachePlanReview(cacheKey, reviewedSubagentCount);
      return { status: "ready", reviewedSubagentCount };
    } catch {
      return { status: "fallback", reviewedSubagentCount: null };
    }
  })();
  inFlightPlanParallelismReviews.set(cacheKey, review);
  void review.then(() => {
    if (inFlightPlanParallelismReviews.get(cacheKey) === review) {
      inFlightPlanParallelismReviews.delete(cacheKey);
    }
  });
  return review;
}

export function resolvePlanParallelismReviewSetup(
  input: PlanParallelismReviewHookInput,
): PlanParallelismReviewSetup {
  const provider = input.implementationProvider;
  const capability = provider?.nativeSubagents;
  if (
    !input.enabled ||
    !input.threadId ||
    !input.plan ||
    !provider?.enabled ||
    !provider.installed ||
    provider.availability === "unavailable" ||
    !capability ||
    capability.toolName.trim().length === 0
  ) {
    return { descriptor: null, inactiveStatus: "idle" };
  }

  const maxRecommendedSubagents = Math.floor(capability.maxRecommendedSubagents);
  if (maxRecommendedSubagents < 2) {
    return { descriptor: null, inactiveStatus: "idle" };
  }

  const reviewerProvider = input.reviewerProvider;
  if (
    !reviewerProvider?.enabled ||
    !reviewerProvider.installed ||
    reviewerProvider.status !== "ready" ||
    reviewerProvider.availability === "unavailable" ||
    reviewerProvider.instanceId !== input.reviewerSelection.instanceId ||
    !isPlanParallelismReviewDriverKind(reviewerProvider.driver)
  ) {
    return { descriptor: null, inactiveStatus: "fallback" };
  }

  return {
    descriptor: {
      environmentId: input.environmentId,
      threadId: input.threadId,
      planId: input.plan.id,
      planUpdatedAt: input.plan.updatedAt,
      implementationProviderInstanceId: provider.instanceId,
      maxRecommendedSubagents,
      reviewerSelection: input.reviewerSelection,
    },
    inactiveStatus: "idle",
  };
}

export function resolvePlanParallelismReviewDescriptor(
  input: PlanParallelismReviewHookInput,
): PlanParallelismReviewDescriptor | null {
  return resolvePlanParallelismReviewSetup(input).descriptor;
}

export function __resetPlanParallelismReviewCacheForTests(): void {
  cachedReviews.clear();
  inFlightPlanParallelismReviews.clear();
}
