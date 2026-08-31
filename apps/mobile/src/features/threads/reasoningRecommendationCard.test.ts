import { describe, expect, it } from "@effect/vitest";

import {
  REASONING_RECOMMENDATION_CARD_CLASSES,
  buildReasoningRecommendationCardCopy,
} from "./reasoningRecommendationCard";

describe("reasoning recommendation card copy", () => {
  it("uses semantic theme tokens for every card surface", () => {
    expect(REASONING_RECOMMENDATION_CARD_CLASSES).toMatchObject({
      root: expect.stringContaining("border-border"),
      title: expect.stringContaining("text-foreground"),
      description: expect.stringContaining("text-foreground-muted"),
      primaryAction: expect.stringContaining("bg-primary"),
      primaryActionLabel: expect.stringContaining("text-primary-foreground"),
      secondaryAction: expect.stringContaining("bg-subtle"),
      secondaryActionLabel: expect.stringContaining("text-foreground"),
    });
    expect(Object.values(REASONING_RECOMMENDATION_CARD_CLASSES).join(" ")).not.toContain("dark:");
  });

  it("explains the evidence and preserves the chat default", () => {
    expect(
      buildReasoningRecommendationCardCopy({
        recommendation: {
          evidenceTurnId: "turn-1",
          discoveryOperationCount: 5,
          completedToolOperationCount: 5,
          optionId: "reasoningEffort",
          currentValue: "max",
          currentLabel: "Max",
          targetValue: "high",
          targetLabel: "High",
          instanceId: "codex",
          model: "gpt-5.6-sol",
        },
        pendingOverride: null,
      }),
    ).toEqual({
      title: "High is likely enough for repository exploration",
      description:
        "5 read-only discovery operations were observed. Your current Max effort remains the chat default.",
      actionLabel: "Use High once",
      actionAccessibilityLabel: "Use High for the next turn only",
      dismissAccessibilityLabel: "Dismiss reasoning suggestion",
      armed: false,
    });
  });

  it("describes the armed one-turn override and accessible undo action", () => {
    expect(
      buildReasoningRecommendationCardCopy({
        recommendation: null,
        pendingOverride: {
          evidenceTurnId: "turn-1",
          instanceId: "codex",
          model: "gpt-5.6-sol",
          optionId: "reasoningEffort",
          fromValue: "max",
          fromLabel: "Max",
          targetValue: "high",
          targetLabel: "High",
        },
      }),
    ).toMatchObject({
      title: "Next turn uses High",
      description: "Max resumes afterward.",
      actionAccessibilityLabel: "Undo one-turn reasoning override",
      dismissAccessibilityLabel: null,
      armed: true,
    });
  });

  it("suppresses recommendation UI while Auto reasoning is active", () => {
    expect(
      buildReasoningRecommendationCardCopy({
        recommendation: null,
        pendingOverride: {
          evidenceTurnId: "turn-1",
          instanceId: "codex",
          model: "gpt-5.6-sol",
          optionId: "reasoningEffort",
          fromValue: "max",
          fromLabel: "Max",
          targetValue: "high",
          targetLabel: "High",
        },
        autoReasoningActive: true,
      }),
    ).toBeNull();
  });
});
