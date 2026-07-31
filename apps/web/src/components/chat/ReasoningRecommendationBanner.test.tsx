import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type {
  PendingReasoningOverride,
  ReasoningRecommendation,
} from "@t3tools/client-runtime/reasoning-recommendation";

import { ComposerBannerStack } from "./ComposerBannerStack";
import { buildReasoningRecommendationBannerItem } from "./ReasoningRecommendationBanner";

const recommendation = {
  evidenceTurnId: "turn-1",
  discoveryOperationCount: 6,
  completedToolOperationCount: 6,
  optionId: "reasoningEffort",
  currentValue: "max",
  currentLabel: "Max",
  targetValue: "high",
  targetLabel: "High",
  instanceId: "codex",
  model: "gpt-5.6-sol",
} satisfies ReasoningRecommendation;

const pending = {
  evidenceTurnId: "turn-1",
  instanceId: "codex",
  model: "gpt-5.6-sol",
  optionId: "reasoningEffort",
  fromValue: "max",
  fromLabel: "Max",
  targetValue: "high",
  targetLabel: "High",
} satisfies PendingReasoningOverride;

describe("reasoning recommendation banner", () => {
  it("renders the observed evidence, one-turn action, default reassurance, and dismissal label", () => {
    const item = buildReasoningRecommendationBannerItem({
      recommendation,
      pendingOverride: null,
      onAccept: vi.fn(),
      onDismiss: vi.fn(),
      onUndo: vi.fn(),
    });
    const markup = renderToStaticMarkup(<ComposerBannerStack items={item ? [item] : []} />);

    expect(markup).toContain("High is likely enough for repository exploration");
    expect(markup).toContain("6 read-only discovery operations");
    expect(markup).toContain("Your current Max effort remains the chat default.");
    expect(markup).toContain("Use High once");
    expect(markup).toContain('aria-label="Dismiss reasoning suggestion"');
  });

  it("renders the armed next-turn state with an accessible undo action", () => {
    const item = buildReasoningRecommendationBannerItem({
      recommendation: null,
      pendingOverride: pending,
      onAccept: vi.fn(),
      onDismiss: vi.fn(),
      onUndo: vi.fn(),
    });
    const markup = renderToStaticMarkup(<ComposerBannerStack items={item ? [item] : []} />);

    expect(markup).toContain("Next turn uses High");
    expect(markup).toContain("Max resumes afterward.");
    expect(markup).toContain('aria-label="Undo one-turn reasoning override"');
    expect(markup).not.toContain("Dismiss reasoning suggestion");
  });
});
