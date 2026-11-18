import {
  USAGE_CONTRACT_VERSION,
  type UsageProviderKind,
  type UsageSpeed,
} from "@t3tools/contracts";
import { mergeUsage, type EnvironmentUsage } from "@t3tools/shared/usageMerge";

export function mergeModelUsage(
  environments: readonly EnvironmentUsage[],
  provider: UsageProviderKind,
  model: string,
  speed?: UsageSpeed,
) {
  return mergeUsage(environments, USAGE_CONTRACT_VERSION, {
    speed,
    keepBucket: (bucket) => bucket.provider === provider && bucket.model === model,
  });
}
