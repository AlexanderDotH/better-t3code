import { GaugeIcon } from "lucide-react";

import type {
  PendingReasoningOverride,
  ReasoningRecommendation,
} from "@t3tools/client-runtime/reasoning-recommendation";

import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

export function buildReasoningRecommendationBannerItem(input: {
  readonly recommendation: ReasoningRecommendation | null;
  readonly pendingOverride: PendingReasoningOverride | null;
  readonly autoReasoningActive?: boolean;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
  readonly translate: InterfaceTranslator["message"];
}): ComposerBannerStackItem | null {
  if (input.autoReasoningActive) {
    return null;
  }
  if (input.pendingOverride !== null) {
    return {
      id: `reasoning-override:${input.pendingOverride.evidenceTurnId}`,
      variant: "info",
      icon: <GaugeIcon />,
      title: input.translate("chat.reasoning.overrideTitle", {
        target: input.pendingOverride.targetLabel,
      }),
      description: input.translate("chat.reasoning.overrideDescription", {
        from: input.pendingOverride.fromLabel,
      }),
      actions: (
        <Button
          size="xs"
          variant="outline"
          aria-label={input.translate("chat.composer.undoReasoning")}
          onClick={input.onUndo}
        >
          {input.translate("chat.reasoning.undo")}
        </Button>
      ),
    };
  }
  if (input.recommendation === null) {
    return null;
  }
  return {
    id: `reasoning-recommendation:${input.recommendation.evidenceTurnId}`,
    variant: "info",
    icon: <GaugeIcon />,
    title: input.translate("chat.reasoning.recommendationTitle", {
      target: input.recommendation.targetLabel,
    }),
    description: input.translate("chat.reasoning.recommendationDescription", {
      count: input.recommendation.discoveryOperationCount,
      current: input.recommendation.currentLabel,
    }),
    actions: (
      <Button size="xs" variant="outline" onClick={input.onAccept}>
        {input.translate("chat.reasoning.useOnce", {
          target: input.recommendation.targetLabel,
        })}
      </Button>
    ),
    dismissLabel: input.translate("chat.reasoning.dismiss"),
    onDismiss: input.onDismiss,
  };
}
