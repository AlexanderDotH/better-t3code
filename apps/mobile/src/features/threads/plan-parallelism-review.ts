import {
  resolvePlanParallelismReviewDescriptor,
  type PlanParallelismReviewDescriptor,
} from "@t3tools/client-runtime/plan-implementation";
import type {
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
  readonly implementationProvider: ServerProvider | null;
  readonly reviewerSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
}): PlanParallelismReviewDescriptor | null {
  const { plan, reviewerSelection } = input;
  if (plan?.implementedAt !== null || plan.deepPlan || !reviewerSelection) {
    return null;
  }
  return resolvePlanParallelismReviewDescriptor({
    enabled: input.enabled,
    environmentId: input.environmentId,
    threadId: input.threadId,
    plan,
    implementationProvider: input.implementationProvider,
    reviewerProvider: input.providers.find(
      (provider) => provider.instanceId === reviewerSelection.instanceId,
    ),
    reviewerSelection,
  });
}
