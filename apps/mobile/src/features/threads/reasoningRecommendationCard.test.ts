import { describe, expect, it } from "@effect/vitest";

import { buildReasoningRecommendationCardCopy } from "./reasoningRecommendationCard";

describe("reasoning recommendation card copy", () => {
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
});
