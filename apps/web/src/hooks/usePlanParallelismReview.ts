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
import { useEffect, useMemo, useState } from "react";

import { reviewPlanParallelismForEnvironment } from "../environmentApi";
import { LRUCache } from "../lib/lruCache";
import type { PlanParallelismReviewStatus } from "../planImplementation";

const MAX_CACHED_PLAN_REVIEWS = 50;
const MAX_CACHED_PLAN_REVIEW_BYTES = 64 * 1024;
const planParallelismReviewCache = new LRUCache<number>(
  MAX_CACHED_PLAN_REVIEWS,
  MAX_CACHED_PLAN_REVIEW_BYTES,
);
const inFlightPlanParallelismReviews = new Map<string, Promise<PlanParallelismReviewState>>();

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

type ReviewPlanParallelism = (
  environmentId: EnvironmentId,
  input: PlanParallelismReviewInput,
) => Promise<PlanParallelismReviewResult>;

interface InternalReviewState extends PlanParallelismReviewState {
  readonly cacheKey: string | null;
}

const IDLE_REVIEW_STATE: PlanParallelismReviewState = {
  status: "idle",
  reviewedSubagentCount: null,
};

function serializeReviewerSelection(selection: ModelSelection): string {
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
  reviewPlanParallelism: ReviewPlanParallelism = reviewPlanParallelismForEnvironment,
): Promise<PlanParallelismReviewState> {
  const cacheKey = buildPlanParallelismReviewCacheKey(descriptor);
  const cachedCount = planParallelismReviewCache.get(cacheKey);
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
      planParallelismReviewCache.set(cacheKey, reviewedSubagentCount, cacheKey.length * 2 + 8);
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

export function usePlanParallelismReview(
  input: PlanParallelismReviewHookInput,
): PlanParallelismReviewState {
  const reviewerSelectionKey = serializeReviewerSelection(input.reviewerSelection);
  const setup = useMemo(
    () => resolvePlanParallelismReviewSetup(input),
    [
      input.enabled,
      input.environmentId,
      input.implementationProvider,
      input.plan,
      input.reviewerProvider,
      input.threadId,
      reviewerSelectionKey,
    ],
  );
  const descriptor = setup.descriptor;
  const cacheKey = useMemo(
    () => (descriptor ? buildPlanParallelismReviewCacheKey(descriptor) : null),
    [descriptor],
  );
  const [reviewState, setReviewState] = useState<InternalReviewState>({
    cacheKey: null,
    ...IDLE_REVIEW_STATE,
  });

  useEffect(() => {
    if (!descriptor || !cacheKey) {
      return;
    }

    const cachedCount = planParallelismReviewCache.get(cacheKey);
    if (cachedCount !== null) {
      setReviewState({ cacheKey, status: "ready", reviewedSubagentCount: cachedCount });
      return;
    }

    let cancelled = false;
    setReviewState({ cacheKey, status: "reviewing", reviewedSubagentCount: null });
    void requestPlanParallelismReview(descriptor).then((result) => {
      if (cancelled) {
        return;
      }
      setReviewState({ cacheKey, ...result });
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, descriptor]);

  if (!descriptor || !cacheKey) {
    return setup.inactiveStatus === "fallback"
      ? { status: "fallback", reviewedSubagentCount: null }
      : IDLE_REVIEW_STATE;
  }
  const cachedCount = planParallelismReviewCache.get(cacheKey);
  if (cachedCount !== null) {
    return { status: "ready", reviewedSubagentCount: cachedCount };
  }
  if (reviewState.cacheKey !== cacheKey) {
    return { status: "reviewing", reviewedSubagentCount: null };
  }
  return reviewState;
}

export function __resetPlanParallelismReviewCacheForTests(): void {
  planParallelismReviewCache.clear();
  inFlightPlanParallelismReviews.clear();
}
