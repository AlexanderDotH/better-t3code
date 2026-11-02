import type { MobileProposedPlan } from "./plan-parallelism-review";
import type { EnvironmentId, ModelSelection, ServerProvider, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useEffectEvent, useState } from "react";

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
  readonly plan: MobileProposedPlan | null;
  readonly implementationProvider: ServerProvider | null;
  readonly reviewerSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
}): number | null {
  const reviewPlanParallelism = useAtomCommand(serverEnvironment.reviewPlanParallelism, {
    reportFailure: false,
  });
  const descriptor = resolveMobilePlanParallelismReviewDescriptor(input);
  const key = descriptor ? descriptorKey(input.environmentId, descriptor) : null;
  const [review, setReview] = useState<{
    readonly key: string;
    readonly count: number | null;
  } | null>(null);

  const requestReview = useEffectEvent((requestKey: string, isCancelled: () => boolean) => {
    if (!descriptor || reviewCache.has(requestKey)) return;
    void reviewPlanParallelism({
      environmentId: input.environmentId,
      input: {
        threadId: descriptor.threadId,
        planId: descriptor.plan.id,
        expectedPlanUpdatedAt: descriptor.plan.updatedAt,
        implementationProviderInstanceId: descriptor.implementationProvider.instanceId,
      },
    }).then((result) => {
      if (isCancelled() || !AsyncResult.isSuccess(result)) return;
      const count = validateMobilePlanParallelismReview(descriptor, result.value);
      if (count === null) return;
      if (reviewCache.size >= MAX_CACHED_REVIEWS) {
        const oldest = reviewCache.keys().next().value;
        if (oldest !== undefined) reviewCache.delete(oldest);
      }
      reviewCache.set(requestKey, count);
      setReview({ key: requestKey, count });
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the remote reviewer request until this plan revision is replaced or unmounted.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    requestReview(key, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return null;
  return reviewCache.get(key) ?? (review?.key === key ? review.count : null);
}
