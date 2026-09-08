import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildPlanParallelismReviewCacheKey,
  cachedPlanParallelismReview,
  IDLE_REVIEW_STATE,
  requestPlanParallelismReview,
  resolvePlanParallelismReviewSetup,
  type PlanParallelismReviewHookInput,
  type PlanParallelismReviewState,
  type ReviewPlanParallelism,
} from "@t3tools/client-runtime/plan-implementation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../state/use-atom-command";
import { serverEnvironment } from "../state/server";

interface InternalReviewState extends PlanParallelismReviewState {
  readonly cacheKey: string | null;
}

export function usePlanParallelismReview(
  input: PlanParallelismReviewHookInput,
): PlanParallelismReviewState {
  const review = useAtomCommand(serverEnvironment.reviewPlanParallelism, { reportFailure: false });
  const reviewPlan = useCallback<ReviewPlanParallelism>(
    async (environmentId, input) => {
      const result = await review({ environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
    [review],
  );
  const {
    enabled,
    environmentId,
    implementationProvider,
    plan,
    reviewerProvider,
    reviewerSelection,
    threadId,
  } = input;
  const setup = useMemo(
    () =>
      resolvePlanParallelismReviewSetup({
        enabled,
        environmentId,
        implementationProvider,
        plan,
        reviewerProvider,
        reviewerSelection,
        threadId,
      }),
    [
      enabled,
      environmentId,
      implementationProvider,
      plan,
      reviewerProvider,
      reviewerSelection,
      threadId,
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

    let cancelled = false;
    void requestPlanParallelismReview(descriptor, reviewPlan).then((result) => {
      if (cancelled) {
        return;
      }
      setReviewState({ cacheKey, ...result });
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, descriptor, reviewPlan]);

  if (!descriptor || !cacheKey) {
    return setup.inactiveStatus === "fallback"
      ? { status: "fallback", reviewedSubagentCount: null }
      : IDLE_REVIEW_STATE;
  }
  const cachedCount = cachedPlanParallelismReview(cacheKey);
  if (cachedCount !== null) {
    return { status: "ready", reviewedSubagentCount: cachedCount };
  }
  if (reviewState.cacheKey !== cacheKey) {
    return { status: "reviewing", reviewedSubagentCount: null };
  }
  return reviewState;
}
