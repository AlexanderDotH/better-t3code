import type { PullRequestReviewGuideResult } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../../../state/atom-registry";
import { pullRequestReviewKey } from "../pullRequestReviewDrafts";
import type { PullRequestParams } from "../usePullRequestDiff";
import type { GuideRunBaseline } from "./reviewGuideRunOutcome";

export type GuideRunWatch = GuideRunBaseline & {
  readonly params: PullRequestParams;
  readonly answeredRunning: boolean;
};
export const guideRunWatchesAtom = Atom.make<Readonly<Record<string, GuideRunWatch>>>({}).pipe(
  Atom.keepAlive,
);
const shown = new Map<string, Set<symbol>>();

export function watchReviewGuideRun(
  params: PullRequestParams,
  previous: PullRequestReviewGuideResult | null,
  answeredRunning = false,
) {
  const key = pullRequestReviewKey(params);
  appAtomRegistry.update(guideRunWatchesAtom, (current) =>
    current[key]
      ? current
      : {
          ...current,
          [key]: {
            params,
            previousGuideAt: previous?.guide?.generatedAt ?? null,
            previousFailedAt: previous?.run?._tag === "Failed" ? previous.run.failedAt : null,
            since: Date.now(),
            answeredRunning,
          },
        },
  );
}
export function settleReviewGuideRun(key: string) {
  appAtomRegistry.update(guideRunWatchesAtom, (current) => {
    if (!current[key]) return current;
    const { [key]: _settled, ...rest } = current;
    return rest;
  });
}
export function showReviewGuide(params: PullRequestParams) {
  const key = pullRequestReviewKey(params);
  const token = Symbol();
  const showing = shown.get(key) ?? new Set<symbol>();
  showing.add(token);
  shown.set(key, showing);
  return () => {
    showing.delete(token);
    if (!showing.size) shown.delete(key);
  };
}
export const isReviewGuideShown = (key: string) => shown.has(key);
