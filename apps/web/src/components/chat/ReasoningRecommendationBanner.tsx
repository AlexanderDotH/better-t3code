import { GaugeIcon } from "lucide-react";

import type {
  PendingReasoningOverride,
  ReasoningRecommendation,
} from "@t3tools/client-runtime/reasoning-recommendation";

import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

export function buildReasoningRecommendationBannerItem(input: {
  readonly recommendation: ReasoningRecommendation | null;
  readonly pendingOverride: PendingReasoningOverride | null;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
}): ComposerBannerStackItem | null {
  if (input.pendingOverride !== null) {
    return {
      id: `reasoning-override:${input.pendingOverride.evidenceTurnId}`,
      variant: "info",
      icon: <GaugeIcon />,
      title: `Next turn uses ${input.pendingOverride.targetLabel}`,
      description: `${input.pendingOverride.fromLabel} resumes afterward.`,
      actions: (
        <Button
          size="xs"
          variant="outline"
          aria-label="Undo one-turn reasoning override"
          onClick={input.onUndo}
        >
          Undo
        </Button>
      ),
    };
  }
  if (input.recommendation === null) {
    return null;
  }
  const operationLabel =
    input.recommendation.discoveryOperationCount === 1 ? "operation" : "operations";
  return {
    id: `reasoning-recommendation:${input.recommendation.evidenceTurnId}`,
    variant: "info",
    icon: <GaugeIcon />,
    title: `${input.recommendation.targetLabel} is likely enough for repository exploration`,
    description: `${input.recommendation.discoveryOperationCount} read-only discovery ${operationLabel} were observed. Your current ${input.recommendation.currentLabel} effort remains the chat default.`,
    actions: (
      <Button size="xs" variant="outline" onClick={input.onAccept}>
        Use {input.recommendation.targetLabel} once
      </Button>
    ),
    dismissLabel: "Dismiss reasoning suggestion",
    onDismiss: input.onDismiss,
  };
}
