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

export const REASONING_RECOMMENDATION_CARD_CLASSES = {
  root: "gap-2.5 rounded-[20px] border border-border bg-card p-4",
  title: "font-t3-bold text-base text-foreground",
  description: "font-sans text-sm leading-normal text-foreground-muted",
  primaryAction: "items-center justify-center rounded-[14px] bg-primary px-3.5 py-2.5",
  primaryActionLabel: "font-t3-extrabold text-sm text-primary-foreground",
  secondaryAction: "items-center justify-center rounded-[14px] bg-subtle px-3.5 py-2.5",
  secondaryActionLabel: "font-t3-bold text-sm text-foreground",
} as const;

export function buildReasoningRecommendationCardCopy(input: {
  readonly recommendation: ReasoningRecommendation | null;
  readonly pendingOverride: PendingReasoningOverride | null;
  readonly autoReasoningActive?: boolean;
}): ReasoningRecommendationCardCopy | null {
  if (input.autoReasoningActive) {
    return null;
  }
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
