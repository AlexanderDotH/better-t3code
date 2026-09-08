import { resolveBetterT3FeatureFlag, type ServerSettings } from "@t3tools/contracts";

export interface ResourceProtectionPolicy {
  readonly adaptiveAdmission: boolean;
  readonly processSuspension: boolean;
}

export const DEFAULT_RESOURCE_PROTECTION_POLICY: ResourceProtectionPolicy = {
  adaptiveAdmission: true,
  processSuspension: true,
};

export function resolveResourceProtectionPolicy(
  settings: ServerSettings,
): ResourceProtectionPolicy {
  return {
    adaptiveAdmission: resolveBetterT3FeatureFlag(
      settings.betterT3Environment,
      "resource.adaptiveAdmission",
    ),
    processSuspension: resolveBetterT3FeatureFlag(
      settings.betterT3Environment,
      "resource.processSuspension",
    ),
  };
}
