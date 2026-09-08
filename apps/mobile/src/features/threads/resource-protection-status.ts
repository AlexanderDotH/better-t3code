import { resolveResourceProtectionPresentation } from "@t3tools/client-runtime/resource-protection";
import type { ResourceProtectionSnapshot, ThreadId } from "@t3tools/contracts";
import type { ResolvedInterfaceLanguage } from "@t3tools/shared/interfaceLanguage";

export interface MobileResourceProtectionStatus {
  readonly kind: "waiting" | "throttled";
  readonly label: string;
}

export function resolveMobileResourceProtectionStatus(
  snapshot: ResourceProtectionSnapshot | null | undefined,
  threadId: ThreadId,
  language: ResolvedInterfaceLanguage = "en",
): MobileResourceProtectionStatus | null {
  const presentation = resolveResourceProtectionPresentation(snapshot, threadId, language);
  return presentation ? { kind: presentation.kind, label: presentation.label } : null;
}
