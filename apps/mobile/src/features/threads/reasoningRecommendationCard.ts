import type {
  PendingReasoningOverride,
  ReasoningRecommendation,
} from "@t3tools/client-runtime/reasoning-recommendation";

export interface ReasoningRecommendationCardCopy {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly actionAccessibilityLabel: string;
  readonly dismissAccessibilityLabel: string | null;
  readonly armed: boolean;
}

export function buildReasoningRecommendationCardCopy(input: {
  readonly recommendation: ReasoningRecommendation | null;
  readonly pendingOverride: PendingReasoningOverride | null;
}): ReasoningRecommendationCardCopy | null {
  if (input.pendingOverride) {
    return {
      title: `Next turn uses ${input.pendingOverride.targetLabel}`,
      description: `${input.pendingOverride.fromLabel} resumes afterward.`,
      actionLabel: "Undo",
      actionAccessibilityLabel: "Undo one-turn reasoning override",
      dismissAccessibilityLabel: null,
      armed: true,
    };
  }
  if (!input.recommendation) {
    return null;
  }
  const operationLabel =
    input.recommendation.discoveryOperationCount === 1 ? "operation" : "operations";
  return {
    title: `${input.recommendation.targetLabel} is likely enough for repository exploration`,
    description: `${input.recommendation.discoveryOperationCount} read-only discovery ${operationLabel} were observed. Your current ${input.recommendation.currentLabel} effort remains the chat default.`,
    actionLabel: `Use ${input.recommendation.targetLabel} once`,
    actionAccessibilityLabel: `Use ${input.recommendation.targetLabel} for the next turn only`,
    dismissAccessibilityLabel: "Dismiss reasoning suggestion",
    armed: false,
  };
}
