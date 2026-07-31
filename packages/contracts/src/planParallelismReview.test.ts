import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  PLAN_PARALLELISM_REVIEW_DRIVER_KINDS,
  PlanParallelismReviewCount,
  PlanParallelismReviewError,
  PlanParallelismReviewInput,
  PlanParallelismReviewResult,
  isPlanParallelismReviewDriverKind,
} from "./planParallelismReview.ts";

const decodeCount = Schema.decodeUnknownSync(PlanParallelismReviewCount);
const decodeInput = Schema.decodeUnknownSync(PlanParallelismReviewInput);
const decodeResult = Schema.decodeUnknownSync(PlanParallelismReviewResult);

describe("plan parallelism review contracts", () => {
  it("allows every supported reviewer driver and excludes unregistered drivers", () => {
    expect(PLAN_PARALLELISM_REVIEW_DRIVER_KINDS).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "opencode",
    ]);
    expect(isPlanParallelismReviewDriverKind("codex")).toBe(true);
    expect(isPlanParallelismReviewDriverKind("customReviewer")).toBe(false);
  });

  it("accepts recommendation counts above the current provider snapshots", () => {
    expect(decodeCount(2)).toBe(2);
    expect(decodeCount(12)).toBe(12);
  });

  it.each([1, 2.5, 0, -3])("rejects an invalid recommendation count: %s", (value) => {
    expect(() => decodeCount(value)).toThrow();
  });

  it("decodes the canonical request and response shapes", () => {
    const input = decodeInput({
      threadId: "thread-review",
      planId: "plan-review",
      expectedPlanUpdatedAt: "2026-07-31T12:00:00.000Z",
      implementationProviderInstanceId: "codex_work",
    });
    const result = decodeResult({
      planId: "plan-review",
      planUpdatedAt: "2026-07-31T12:00:00.000Z",
      implementationProviderInstanceId: "codex_work",
      recommendedSubagents: 7,
    });

    expect(input.threadId).toBe("thread-review");
    expect(input.expectedPlanUpdatedAt).toBe("2026-07-31T12:00:00.000Z");
    expect(result.recommendedSubagents).toBe(7);
  });

  it("provides a single tagged error with typed failure reasons", () => {
    const error = new PlanParallelismReviewError({
      reason: "plan-stale",
      message: "The plan changed before review completed.",
    });

    expect(error._tag).toBe("PlanParallelismReviewError");
    expect(error.reason).toBe("plan-stale");
    expect(error.message).toBe("The plan changed before review completed.");
  });
});
