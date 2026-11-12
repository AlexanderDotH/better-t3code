import type { MobileProposedPlan } from "./plan-parallelism-review";
import {
  buildPlanParallelismReviewCacheKey,
  cachedPlanParallelismReview,
  requestPlanParallelismReview,
  type PlanParallelismReviewState,
} from "@t3tools/client-runtime/plan-implementation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  DeepPlanRun,
  EnvironmentId,
  ModelSelection,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveMobilePlanParallelismReviewDescriptor } from "./plan-parallelism-review";

export function useMobilePlanParallelismReview(input: {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly plan: MobileProposedPlan | null;
  readonly deepPlanRun?: DeepPlanRun | null | undefined;
  readonly implementationProvider: ServerProvider | null;
  readonly reviewerSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
}): PlanParallelismReviewState {
  const reviewPlanParallelism = useAtomCommand(serverEnvironment.reviewPlanParallelism, {
    reportFailure: false,
  });
  const descriptor = resolveMobilePlanParallelismReviewDescriptor(input);
  const key = descriptor ? buildPlanParallelismReviewCacheKey(descriptor) : null;
  const [review, setReview] = useState<{
    readonly key: string;
    readonly state: PlanParallelismReviewState;
  } | null>(null);

  const requestReview = useEffectEvent((requestKey: string, isCancelled: () => boolean) => {
    if (!descriptor) return;
    void requestPlanParallelismReview(descriptor, async (environmentId, reviewInput) => {
      const result = await reviewPlanParallelism({ environmentId, input: reviewInput });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    }).then((state) => {
      if (!isCancelled()) setReview({ key: requestKey, state });
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

  if (!key)
    return {
      status:
        input.enabled &&
        input.plan?.implementedAt === null &&
        (input.implementationProvider?.nativeSubagents?.maxRecommendedSubagents ?? 0) >= 2
          ? "fallback"
          : "idle",
      reviewedSubagentCount: null,
    };
  const cached = cachedPlanParallelismReview(key);
  if (cached !== null) return { status: "ready", reviewedSubagentCount: cached };
  return review?.key === key ? review.state : { status: "reviewing", reviewedSubagentCount: null };
}
