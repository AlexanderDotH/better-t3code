import { resolveResourceProtectionPresentation } from "@t3tools/client-runtime/resource-protection";
import type { EnvironmentId, ResourceProtectionSnapshot, ThreadId } from "@t3tools/contracts";
import type { ResolvedInterfaceLanguage } from "@t3tools/shared/interfaceLanguage";

export interface ResourceProtectionBanner {
  readonly id: string;
  readonly variant: "info" | "warning";
  readonly urgent: boolean;
  readonly title: string;
  readonly description: string;
  readonly className: string;
}

export function buildResourceProtectionBanner(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly snapshot: ResourceProtectionSnapshot | null | undefined;
  readonly language?: ResolvedInterfaceLanguage;
}): ResourceProtectionBanner | null {
  const presentation = resolveResourceProtectionPresentation(
    input.snapshot,
    input.threadId,
    input.language,
  );
  if (!presentation) return null;
  const throttled = presentation.kind === "throttled";
  return {
    id: `resource-protection:${input.environmentId}:${input.threadId}`,
    variant: throttled ? "warning" : "info",
    urgent: throttled,
    title: presentation.label,
    description: presentation.description,
    className: "resource-protection-banner-surface px-4 py-2.5 sm:px-5 sm:py-3",
  };
}
