import { ProviderInstanceId, type PullRequestReviewGuideResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { reviewGuideRunOutcome } from "./reviewGuideRunOutcome";

describe("background review guide runs", () => {
  it("announces only new guide outcomes and settles cancelled or unseen runs", () => {
    const before = "2026-10-01T00:00:00Z";
    const after = "2026-10-02T00:00:00Z";
    const baseline = { previousGuideAt: before, previousFailedAt: before, since: 100 };
    const prior: PullRequestReviewGuideResult = {
      currentHeadSha: "head",
      run: null,
      guide: {
        headSha: "head",
        generatedAt: before,
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
        stops: [],
      },
    };
    expect(reviewGuideRunOutcome(prior, baseline, false, 200).kind).toBe("waiting");
    expect(reviewGuideRunOutcome(prior, baseline, true, 200).kind).toBe("settled");
    expect(reviewGuideRunOutcome(prior, baseline, false, 60_101).kind).toBe("settled");
    expect(
      reviewGuideRunOutcome(
        { ...prior, run: { _tag: "Running", headSha: "head", startedAt: after } },
        baseline,
        false,
        200,
      ).kind,
    ).toBe("running");
    expect(
      reviewGuideRunOutcome(
        {
          ...prior,
          run: { _tag: "Failed", headSha: "head", failedAt: before, detail: "old error" },
        },
        baseline,
        false,
        200,
      ).kind,
    ).toBe("waiting");
    expect(
      reviewGuideRunOutcome(
        {
          ...prior,
          run: { _tag: "Failed", headSha: "head", failedAt: after, detail: "new error" },
        },
        baseline,
        true,
        200,
      ),
    ).toEqual({ kind: "failed", detail: "new error" });
    expect(
      reviewGuideRunOutcome(
        { ...prior, guide: { ...prior.guide!, generatedAt: after } },
        baseline,
        true,
        200,
      ).kind,
    ).toBe("ready");
  });
});
