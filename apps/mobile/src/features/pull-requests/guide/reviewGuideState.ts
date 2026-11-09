import type { PullRequestReviewGuideResult } from "@t3tools/contracts";
import { currentInterfaceTranslator } from "../../../localization/currentInterfaceTranslator";

export function reviewGuideState(data: PullRequestReviewGuideResult | null) {
  const guide = data?.guide ?? null;
  return {
    guide,
    running: data?.run?._tag === "Running",
    stale: guide !== null && data?.currentHeadSha != null && guide.headSha !== data.currentHeadSha,
    failure:
      data?.run?._tag === "Failed" && data.run.headSha === data.currentHeadSha
        ? data.run.detail
        : null,
  };
}

export function guideNoticeState(state: {
  readonly data: PullRequestReviewGuideResult | null;
  readonly isPending: boolean;
  readonly running: boolean;
  readonly startError: string | null;
  readonly error: string | null;
}) {
  const { guide, stale, failure } = reviewGuideState(state.data);
  if (state.running) {
    return {
      kind: "writing" as const,
      title: currentInterfaceTranslator().message("mobile.ui.rewritingGuide"),
      description: guide
        ? currentInterfaceTranslator().message("mobile.ui.youCanKeepReadingThisGuideWhile")
        : currentInterfaceTranslator().message("mobile.ui.anAgentIsReadingTheChangeAnd"),
      action: guide
        ? currentInterfaceTranslator().message("mobile.ui.rewriting")
        : currentInterfaceTranslator().message("mobile.ui.writingGuide"),
    };
  }
  const error = state.startError ?? failure;
  if (error) {
    return {
      kind: "failed" as const,
      title: currentInterfaceTranslator().message("mobile.ui.couldNotWriteGuide"),
      description: error,
      action: "Try again",
    };
  }
  if (state.error) {
    return {
      kind: "unavailable" as const,
      title: currentInterfaceTranslator().message("mobile.ui.couldNotRefreshGuide"),
      description: state.error,
      action: "Try again",
    };
  }
  if (!state.data) {
    return {
      kind: "loading" as const,
      title: currentInterfaceTranslator().message("mobile.ui.reviewGuide"),
      description: currentInterfaceTranslator().message("mobile.ui.checkingForASavedGuide"),
      action: "Loading guide…",
    };
  }
  if (stale) {
    return {
      kind: "stale" as const,
      title: currentInterfaceTranslator().message("mobile.ui.newChangesSinceThisGuide"),
      description: currentInterfaceTranslator().message("mobile.ui.youCanReadThePreviousGuideOr"),
      action: "Rewrite guide",
    };
  }
  return {
    kind: guide ? ("ready" as const) : ("empty" as const),
    title: currentInterfaceTranslator().message("mobile.ui.reviewGuide"),
    description: currentInterfaceTranslator().message("mobile.ui.getATourOfTheChangeWith"),
    action: "Write guide",
  };
}
