import { resolveResourceProtectionPresentation } from "@t3tools/client-runtime/resource-protection";
import type { EnvironmentId, ResourceProtectionSnapshot, ThreadId } from "@t3tools/contracts";

export interface ResourceProtectionBanner {
  readonly id: string;
  readonly variant: "info" | "warning";
  readonly urgent: boolean;
  readonly title: string;
  readonly description: string;
}

export function buildResourceProtectionBanner(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly snapshot: ResourceProtectionSnapshot | null | undefined;
}): ResourceProtectionBanner | null {
  const presentation = resolveResourceProtectionPresentation(input.snapshot, input.threadId);
  if (!presentation) return null;
  const throttled = presentation.kind === "throttled";
  return {
    id: `resource-protection:${input.environmentId}:${input.threadId}`,
    variant: throttled ? "warning" : "info",
    urgent: throttled,
    title: presentation.label,
    description: presentation.description,
  };
}
