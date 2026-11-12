import type { PullRequestReviewGuideResult } from "@t3tools/contracts";

export type GuideRunBaseline = {
  readonly previousGuideAt: string | null;
  readonly previousFailedAt: string | null;
  readonly since: number;
};

export function reviewGuideRunOutcome(
  data: PullRequestReviewGuideResult,
  baseline: GuideRunBaseline,
  sawRunning: boolean,
  now: number,
) {
  if (data.run?._tag === "Running") return { kind: "running" as const };
  if (data.run?._tag === "Failed" && data.run.failedAt !== baseline.previousFailedAt)
    return { kind: "failed" as const, detail: data.run.detail };
  if (data.guide && data.guide.generatedAt !== baseline.previousGuideAt)
    return { kind: "ready" as const, guide: data.guide };
  return {
    kind: sawRunning || now - baseline.since > 60_000 ? ("settled" as const) : ("waiting" as const),
  };
}
