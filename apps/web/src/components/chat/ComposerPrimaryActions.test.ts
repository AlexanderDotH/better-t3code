import { describe, expect, it } from "vite-plus/test";

import {
  buildPlanImplementationActionPresentation,
  formatPendingPrimaryActionLabel,
  resolvePlanImplementationReviewPresentation,
} from "./ComposerPrimaryActions";

describe("formatPendingPrimaryActionLabel", () => {
  it("returns 'Submitting...' while responding", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: true,
        questionIndex: 0,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submitting...' while responding regardless of other flags", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: true,
        questionIndex: 3,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submit' in compact mode on the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit");
  });

  it("returns 'Next' in compact mode when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Next");
  });

  it("returns 'Next question' when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Next question");
  });

  it("returns singular 'Submit answer' on the last question when it is the only question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit answer");
  });

  it("returns plural 'Submit answers' on the last question when there are multiple questions", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Submit answers");
  });

  it("returns plural 'Submit answers' for higher question indices", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 5,
      }),
    ).toBe("Submit answers");
  });
});

describe("buildPlanImplementationActionPresentation", () => {
  it("preserves the existing actions when no subagent suggestion is available", () => {
    expect(
      buildPlanImplementationActionPresentation({
        compact: false,
        suggestion: null,
      }),
    ).toEqual({
      primaryLabel: "Implement",
      primaryAriaLabel: null,
      menuActions: [
        {
          id: "standard:new-thread",
          label: "Implement in a new thread",
          target: "new-thread",
          strategy: { kind: "standard" },
          suggested: false,
        },
      ],
    });
  });

  it("offers normal, suggested new-thread, and exact same-thread subagent actions", () => {
    expect(
      buildPlanImplementationActionPresentation({
        compact: false,
        suggestion: {
          strategy: { kind: "subagents", count: 3 },
          supportedCounts: [2, 3, 4],
        },
      }),
    ).toEqual({
      primaryLabel: "Implement with 3 subagents",
      primaryAriaLabel: "Implement with 3 subagents",
      menuActions: [
        {
          id: "standard:same-thread",
          label: "Implement normally",
          target: "same-thread",
          strategy: { kind: "standard" },
          suggested: false,
        },
        {
          id: "standard:new-thread",
          label: "Implement normally in a new thread",
          target: "new-thread",
          strategy: { kind: "standard" },
          suggested: false,
        },
        {
          id: "subagents:3:new-thread",
          label: "Implement with 3 subagents in a new thread",
          target: "new-thread",
          strategy: { kind: "subagents", count: 3 },
          suggested: true,
        },
        {
          id: "subagents:2:same-thread",
          label: "Implement with 2 subagents",
          target: "same-thread",
          strategy: { kind: "subagents", count: 2 },
          suggested: false,
        },
        {
          id: "subagents:3:same-thread",
          label: "Implement with 3 subagents",
          target: "same-thread",
          strategy: { kind: "subagents", count: 3 },
          suggested: true,
        },
        {
          id: "subagents:4:same-thread",
          label: "Implement with 4 subagents",
          target: "same-thread",
          strategy: { kind: "subagents", count: 4 },
          suggested: false,
        },
      ],
    });
  });

  it("uses the compact label while retaining the full accessible label", () => {
    const presentation = buildPlanImplementationActionPresentation({
      compact: true,
      suggestion: {
        strategy: { kind: "subagents", count: 2 },
        supportedCounts: [2, 3],
      },
    });

    expect(presentation.primaryLabel).toBe("2 subagents");
    expect(presentation.primaryAriaLabel).toBe("Implement with 2 subagents");
  });

  it("offers every count advertised by a provider above eight", () => {
    const supportedCounts = Array.from({ length: 11 }, (_, index) => index + 2);
    const presentation = buildPlanImplementationActionPresentation({
      compact: false,
      suggestion: {
        strategy: { kind: "subagents", count: 10 },
        supportedCounts,
      },
    });

    expect(presentation.menuActions).toContainEqual({
      id: "subagents:12:same-thread",
      label: "Implement with 12 subagents",
      target: "same-thread",
      strategy: { kind: "subagents", count: 12 },
      suggested: false,
    });
  });
});

describe("resolvePlanImplementationReviewPresentation", () => {
  it("blocks both implementation actions while the plan is being analyzed", () => {
    expect(resolvePlanImplementationReviewPresentation("reviewing")).toEqual({
      actionsDisabled: true,
      primaryLabel: "Analyzing plan…",
      tooltip: null,
    });
  });

  it("quietly explains when the structural estimate is used", () => {
    expect(resolvePlanImplementationReviewPresentation("fallback")).toEqual({
      actionsDisabled: false,
      primaryLabel: null,
      tooltip: "AI review unavailable; using plan structure estimate.",
    });
  });

  it("does not alter ready or idle implementation actions", () => {
    expect(resolvePlanImplementationReviewPresentation("ready")).toEqual({
      actionsDisabled: false,
      primaryLabel: null,
      tooltip: null,
    });
    expect(resolvePlanImplementationReviewPresentation("idle")).toEqual({
      actionsDisabled: false,
      primaryLabel: null,
      tooltip: null,
    });
  });
});
