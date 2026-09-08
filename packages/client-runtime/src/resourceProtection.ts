import type { ResourceProtectionSnapshot, ThreadId } from "@t3tools/contracts";
import {
  translateInterfaceMessage,
  type ResolvedInterfaceLanguage,
} from "@t3tools/shared/interfaceLanguage";

export interface ResourceProtectionPresentation {
  readonly kind: "waiting" | "throttled";
  readonly label: string;
  readonly description: string;
}

export function resolveResourceProtectionPresentation(
  snapshot: ResourceProtectionSnapshot | null | undefined,
  threadId: ThreadId | null | undefined,
  language: ResolvedInterfaceLanguage = "en",
): ResourceProtectionPresentation | null {
  if (!snapshot || !threadId || !snapshot.affectedThreadIds.includes(threadId)) return null;

  switch (snapshot.state) {
    case "waiting":
      return {
        kind: "waiting",
        label: translateInterfaceMessage(language, "resourceProtection.waiting.label"),
        description: translateInterfaceMessage(language, "resourceProtection.waiting.description"),
      };
    case "throttled":
    case "recovering":
      return {
        kind: "throttled",
        label: translateInterfaceMessage(language, "resourceProtection.throttled.label"),
        description:
          snapshot.state === "recovering"
            ? translateInterfaceMessage(language, "resourceProtection.recovering.description")
            : translateInterfaceMessage(language, "resourceProtection.throttled.description"),
      };
    case "normal":
      return null;
    case "unavailable":
      return snapshot.waitingStarts > 0
        ? {
            kind: "waiting",
            label: translateInterfaceMessage(language, "resourceProtection.waiting.label"),
            description: translateInterfaceMessage(
              language,
              "resourceProtection.unavailableWaiting.description",
            ),
          }
        : {
            kind: "throttled",
            label: translateInterfaceMessage(language, "resourceProtection.throttled.label"),
            description: translateInterfaceMessage(
              language,
              "resourceProtection.unavailableThrottled.description",
            ),
          };
  }
}
