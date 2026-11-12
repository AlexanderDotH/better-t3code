import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { PullRequestReviewGuide } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useCallback } from "react";
import { pullRequestReviewKey } from "../pullRequestReviewDrafts";
import type { PullRequestParams } from "../usePullRequestDiff";
import {
  EMPTY_GUIDE_PROGRESS,
  guideProgressVersion,
  moveGuideProgress,
  setGuideStopRead,
} from "./guideProgress";

const progressFamily = Atom.family((_key: string) =>
  Atom.make(EMPTY_GUIDE_PROGRESS).pipe(Atom.keepAlive),
);

export function useGuideProgress(params: PullRequestParams, guide: PullRequestReviewGuide | null) {
  const atom = progressFamily(
    `${pullRequestReviewKey(params)}:${guide ? guideProgressVersion(guide) : "empty"}`,
  );
  const progress = useAtomValue(atom);
  const update = useAtomSet(atom);
  const count = guide?.stops.length ?? 0;
  const open = useCallback(
    (position: number, markCurrentRead = false) =>
      update((current) => moveGuideProgress(current, position, count, markCurrentRead)),
    [count, update],
  );
  const markRead = (position: number, read: boolean) =>
    update((current) => setGuideStopRead(current, position, read, count));
  return { ...progress, open, markRead };
}
