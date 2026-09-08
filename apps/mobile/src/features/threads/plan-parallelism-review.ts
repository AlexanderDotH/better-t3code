import type {
  ModelSelection,
  OrchestrationProposedPlan,
  PlanParallelismReviewResult,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { isPlanParallelismReviewDriverKind } from "@t3tools/contracts";

export interface MobilePlanParallelismReviewDescriptor {
  readonly threadId: ThreadId;
  readonly plan: Pick<OrchestrationProposedPlan, "id" | "updatedAt">;
  readonly implementationProvider: ServerProvider;
  readonly reviewerSelection: ModelSelection;
}

export function resolveMobilePlanParallelismReviewDescriptor(input: {
  readonly enabled: boolean;
  readonly threadId: ThreadId;
  readonly plan: OrchestrationProposedPlan | null;
  readonly implementationProvider: ServerProvider | null;
  readonly reviewerSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
}): MobilePlanParallelismReviewDescriptor | null {
  const capability = input.implementationProvider?.nativeSubagents;
  if (
    !input.enabled ||
    !input.plan ||
    input.plan.implementedAt !== null ||
    !input.implementationProvider?.enabled ||
    !input.implementationProvider.installed ||
    input.implementationProvider.availability === "unavailable" ||
    !capability ||
    capability.maxRecommendedSubagents < 2 ||
    !input.reviewerSelection
  ) {
    return null;
  }
  const reviewer = input.providers.find(
    (provider) => provider.instanceId === input.reviewerSelection?.instanceId,
  );
  if (
    !reviewer?.enabled ||
    !reviewer.installed ||
    reviewer.status !== "ready" ||
    reviewer.availability === "unavailable" ||
    !isPlanParallelismReviewDriverKind(reviewer.driver)
  ) {
    return null;
  }
  return {
    threadId: input.threadId,
    plan: input.plan,
    implementationProvider: input.implementationProvider,
    reviewerSelection: input.reviewerSelection,
  };
}

export function validateMobilePlanParallelismReview(
  descriptor: MobilePlanParallelismReviewDescriptor,
  result: PlanParallelismReviewResult,
): number | null {
  const ceiling = Math.floor(
    descriptor.implementationProvider.nativeSubagents?.maxRecommendedSubagents ?? 0,
  );
  return result.planId === descriptor.plan.id &&
    result.planUpdatedAt === descriptor.plan.updatedAt &&
    result.implementationProviderInstanceId === descriptor.implementationProvider.instanceId &&
    Number.isInteger(result.recommendedSubagents) &&
    result.recommendedSubagents >= 2 &&
    result.recommendedSubagents <= ceiling
    ? result.recommendedSubagents
    : null;
}
