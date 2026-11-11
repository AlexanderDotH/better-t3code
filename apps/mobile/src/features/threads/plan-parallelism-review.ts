import { getDeepPlanProposalBlockReason } from "@t3tools/client-runtime/deep-planning";
import {
  resolvePlanParallelismReviewDescriptor,
  type PlanParallelismReviewDescriptor,
} from "@t3tools/client-runtime/plan-implementation";
import type {
  DeepPlanRun,
  DeepPlanRunReference,
  EnvironmentId,
  ModelSelection,
  PlanId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";

export interface MobileProposedPlan {
  readonly id: PlanId;
  readonly updatedAt: string;
  readonly planMarkdown: string;
  readonly implementedAt: string | null;
  readonly implementationThreadId?: ThreadId | null;
  readonly createdAt?: string;
  readonly turnId?: string | null;
  readonly deepPlan?: DeepPlanRunReference;
}

export function resolveMobilePlanParallelismReviewDescriptor(input: {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly plan: MobileProposedPlan | null;
  readonly deepPlanRun?: DeepPlanRun | null | undefined;
  readonly implementationProvider: ServerProvider | null;
  readonly reviewerSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
}): PlanParallelismReviewDescriptor | null {
  const { deepPlanRun, plan, reviewerSelection } = input;
  if (
    plan?.implementedAt !== null ||
    !reviewerSelection ||
    getDeepPlanProposalBlockReason(plan, deepPlanRun) !== null
  ) {
    return null;
  }
  return resolvePlanParallelismReviewDescriptor({
    enabled: input.enabled,
    environmentId: input.environmentId,
    threadId: input.threadId,
    // The server checks a Deep Plan against its run, so the turn item's timestamp reads as stale.
    plan: plan.deepPlan && deepPlanRun ? { ...plan, updatedAt: deepPlanRun.updatedAt } : plan,
    implementationProvider: input.implementationProvider,
    reviewerProvider: input.providers.find(
      (provider) => provider.instanceId === reviewerSelection.instanceId,
    ),
    reviewerSelection,
  });
}
