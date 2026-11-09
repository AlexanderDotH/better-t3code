import type { OrchestrationV2UserMessageInputIntent } from "@t3tools/contracts";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export interface UserMessageIntentBadgePresentation {
  readonly label: string;
  readonly accessibilityLabel: string;
}

export function resolveUserMessageIntentBadge(
  intent: OrchestrationV2UserMessageInputIntent | undefined,
): UserMessageIntentBadgePresentation | null {
  switch (intent) {
    case "steer":
      return {
        label: currentInterfaceTranslator().message("mobile.ui.steer"),
        accessibilityLabel: currentInterfaceTranslator().message("mobile.ui.steeredTheActiveTurn"),
      };
    case "promoted_queued_to_steer":
      return {
        label: currentInterfaceTranslator().message("mobile.ui.steer"),
        accessibilityLabel: currentInterfaceTranslator().message(
          "mobile.ui.originallyQueuedThenPromotedToSteerThe",
        ),
      };
    case "queued_turn":
    case "turn_start":
    case undefined:
      return null;
  }
}
