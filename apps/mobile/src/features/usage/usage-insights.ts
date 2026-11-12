import { USAGE_CONTRACT_VERSION, type UsageProviderKind } from "@t3tools/contracts";
import { mergeUsage, type EnvironmentUsage } from "@t3tools/shared/usageMerge";

export function mergeModelUsage(
  environments: readonly EnvironmentUsage[],
  provider: UsageProviderKind,
  model: string,
) {
  return mergeUsage(
    environments.map((environment) => ({
      ...environment,
      summary: {
        ...environment.summary,
        buckets: environment.summary.buckets.filter(
          (bucket) => bucket.provider === provider && bucket.model === model,
        ),
      },
    })),
    USAGE_CONTRACT_VERSION,
  );
}
