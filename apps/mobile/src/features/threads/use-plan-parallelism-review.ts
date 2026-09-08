import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationProposedPlan,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  resolveMobilePlanParallelismReviewDescriptor,
  validateMobilePlanParallelismReview,
  type MobilePlanParallelismReviewDescriptor,
} from "./plan-parallelism-review";

const reviewCache = new Map<string, number>();
const MAX_CACHED_REVIEWS = 50;

function descriptorKey(
  environmentId: EnvironmentId,
  descriptor: MobilePlanParallelismReviewDescriptor,
) {
  return JSON.stringify([
    environmentId,
    descriptor.threadId,
    descriptor.plan.id,
    descriptor.plan.updatedAt,
    descriptor.implementationProvider.instanceId,
    descriptor.implementationProvider.nativeSubagents?.maxRecommendedSubagents,
    descriptor.reviewerSelection,
  ]);
}

export function useMobilePlanParallelismReview(input: {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly plan: OrchestrationProposedPlan | null;
  readonly implementationProvider: ServerProvider | null;
  readonly reviewerSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
}): number | null {
  const reviewPlanParallelism = useAtomCommand(serverEnvironment.reviewPlanParallelism, {
    reportFailure: false,
  });
  const descriptor = useMemo(
    () => resolveMobilePlanParallelismReviewDescriptor(input),
    [
      input.enabled,
      input.implementationProvider,
      input.plan,
      input.providers,
      input.reviewerSelection,
      input.threadId,
    ],
  );
  const key = descriptor ? descriptorKey(input.environmentId, descriptor) : null;
  const [review, setReview] = useState<{
    readonly key: string;
    readonly count: number | null;
  } | null>(null);

  useEffect(() => {
    if (!descriptor || !key) return;
    const cached = reviewCache.get(key);
    if (cached !== undefined) {
      setReview({ key, count: cached });
      return;
    }
    let cancelled = false;
    setReview({ key, count: null });
    void reviewPlanParallelism({
      environmentId: input.environmentId,
      input: {
        threadId: descriptor.threadId,
        planId: descriptor.plan.id,
        expectedPlanUpdatedAt: descriptor.plan.updatedAt,
        implementationProviderInstanceId: descriptor.implementationProvider.instanceId,
      },
    }).then((result) => {
      if (cancelled || !AsyncResult.isSuccess(result)) return;
      const count = validateMobilePlanParallelismReview(descriptor, result.value);
      if (count === null) return;
      if (reviewCache.size >= MAX_CACHED_REVIEWS) {
        const oldest = reviewCache.keys().next().value;
        if (oldest !== undefined) reviewCache.delete(oldest);
      }
      reviewCache.set(key, count);
      setReview({ key, count });
    });
    return () => {
      cancelled = true;
    };
  }, [descriptor, input.environmentId, key, reviewPlanParallelism]);

  if (!key) return null;
  return reviewCache.get(key) ?? (review?.key === key ? review.count : null);
}
