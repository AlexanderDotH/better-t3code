import type {
  PullRequestActivity,
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestDetail,
  PullRequestListEntry,
  PullRequestMergeability,
} from "@t3tools/contracts";
import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { PullRequestGlyph } from "./pullRequestGlyphs";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

const STATES = {
  open: {
    get label() {
      return currentInterfaceTranslator().message("common.open");
    },
    icon: PullRequestGlyph.pullRequest,
    tint: "accent-adaptive-emerald-600-400",
    text: "text-adaptive-emerald-600-400",
    background: "bg-adaptive-emerald-500-a12-a16",
  },
  merged: {
    get label() {
      return currentInterfaceTranslator().message("pullRequest.state.merged");
    },
    icon: PullRequestGlyph.merged,
    tint: "accent-adaptive-violet-600-400",
    text: "text-adaptive-violet-600-400",
    background: "bg-adaptive-violet-500-a12-a16",
  },
  closed: {
    get label() {
      return currentInterfaceTranslator().message("pullRequest.state.closed");
    },
    icon: PullRequestGlyph.closed,
    tint: "accent-danger-foreground",
    text: "text-danger-foreground",
    background: "bg-danger",
  },
  draft: {
    get label() {
      return currentInterfaceTranslator().message("pullRequest.filter.draft");
    },
    icon: PullRequestGlyph.draft,
    tint: "accent-icon-muted",
    text: "text-foreground-muted",
    background: "bg-grouped-card",
  },
} satisfies Record<
  string,
  { label: string; icon: AppSymbolName; tint: string; text: string; background: string }
>;

export function pullRequestStatus(pr: Pick<PullRequestListEntry, "state" | "isDraft">) {
  return STATES[pr.isDraft && pr.state === "open" ? "draft" : pr.state];
}

export function pullRequestConflict(pr: {
  readonly state: PullRequestListEntry["state"];
  readonly isDraft: boolean;
  readonly mergeability?: PullRequestMergeability | undefined;
  readonly baseBranch?: string | undefined;
}) {
  if (pr.state !== "open" || pr.isDraft || pr.mergeability !== "conflicting") return null;
  return {
    label: pr.baseBranch
      ? `Conflicts with ${pr.baseBranch}`
      : currentInterfaceTranslator().message("pullRequest.state.hasConflicts"),
  };
}

export function checkStatus(check: PullRequestCheck) {
  switch (check.status) {
    case "success":
      return {
        label: currentInterfaceTranslator().message("pullRequest.checkStatus.passed"),
        icon: "checkmark.circle",
        tint: "accent-adaptive-emerald-600-400",
      } as const;
    case "failure":
      return {
        label: currentInterfaceTranslator().message("mobile.agentActivity.failed"),
        icon: "exclamationmark.circle",
        tint: "accent-danger-foreground",
      } as const;
    case "action-required":
      return {
        label: currentInterfaceTranslator().message("mobile.ui.actionRequired"),
        icon: "exclamationmark.circle",
        tint: "accent-warning-foreground",
      } as const;
    case "pending":
      return {
        label: currentInterfaceTranslator().message("mobile.thread.pending"),
        icon: "clock",
        tint: "accent-warning-foreground",
      } as const;
    case "cancelled":
      return {
        label: currentInterfaceTranslator().message("pullRequest.checkStatus.cancelled"),
        icon: "minus",
        tint: "accent-icon-muted",
      } as const;
    case "skipped":
      return {
        label: currentInterfaceTranslator().message("pullRequest.checkStatus.skipped"),
        icon: "slash.circle",
        tint: "accent-icon-muted",
      } as const;
    case "neutral":
      return {
        label: currentInterfaceTranslator().message("pullRequest.checkStatus.neutral"),
        icon: "minus",
        tint: "accent-icon-muted",
      } as const;
  }
}

export function pullRequestChecksSummary(pr: Pick<PullRequestDetail, "checks">) {
  const failed = pr.checks.filter((check) => check.status === "failure").length;
  const required = pr.checks.filter((check) => check.status === "action-required").length;
  const pending = pr.checks.filter((check) => check.status === "pending").length;
  const passed = pr.checks.filter((check) => check.status === "success").length;
  const count = pr.checks.length ? `${passed} of ${pr.checks.length}` : undefined;
  if (failed)
    return {
      label: `${failed} ${failed === 1 ? "check" : "checks"} failing`,
      title: `${failed} ${failed === 1 ? "check" : "checks"} failing`,
      count,
      icon: "exclamationmark.circle",
      tint: "accent-danger-foreground",
    } as const;
  if (required)
    return {
      label: `${required} need attention`,
      title: currentInterfaceTranslator().message("mobile.ui.checksNeedAttention"),
      count: `${required} awaiting action`,
      icon: "exclamationmark.circle",
      tint: "accent-warning-foreground",
    } as const;
  if (pending)
    return {
      label: `${pending} pending`,
      title: currentInterfaceTranslator().message("mobile.ui.checksRunning"),
      count: `${pending} pending`,
      icon: "clock",
      tint: "accent-warning-foreground",
    } as const;
  if (passed)
    return {
      label: `${passed} of ${pr.checks.length} passed`,
      title:
        passed === pr.checks.length
          ? currentInterfaceTranslator().message("pullRequest.checksSummary.allPassed")
          : currentInterfaceTranslator().message("mobile.ui.checksCompleted"),
      count,
      icon: "checkmark.circle",
      tint: "accent-adaptive-emerald-600-400",
    } as const;
  return {
    label: pr.checks.length
      ? `${pr.checks.length} completed`
      : currentInterfaceTranslator().message("pullRequest.checksSummary.none"),
    title: pr.checks.length
      ? currentInterfaceTranslator().message("mobile.ui.checksCompleted")
      : currentInterfaceTranslator().message("pullRequest.checksSummary.none"),
    count,
    icon: "minus",
    tint: "accent-icon-muted",
  } as const;
}

// GitHub and Forgejo send uppercase review states; Bitbucket and GitCafe send lowercase.
export function normalizedReviewState(reviewState: string | null) {
  return reviewState?.toUpperCase().replaceAll("-", "_");
}

export function pullRequestReviewSummary(
  pr: Pick<PullRequestDetail, "reviewers">,
  activity: Pick<PullRequestActivity, "comments" | "commits"> | null,
) {
  const latest = new Map<string, PullRequestActivity["comments"][number]>();
  const comments = new Map<string, PullRequestActivity["comments"][number]>();
  for (const review of activity?.comments ?? []) {
    const state = normalizedReviewState(review.reviewState);
    if (review.kind !== "review" || !state) continue;
    const key = review.author?.login ?? review.id;
    if (state === "COMMENTED") {
      const previous = comments.get(key);
      if (!previous || Date.parse(review.createdAt) >= Date.parse(previous.createdAt))
        comments.set(key, { ...review, reviewState: state });
      continue;
    }
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state)) continue;
    const previous = latest.get(key);
    if (!previous || Date.parse(review.createdAt) >= Date.parse(previous.createdAt))
      latest.set(key, { ...review, reviewState: state });
  }
  const reviews = [
    ...[...latest.values()].filter((review) => review.reviewState !== "DISMISSED"),
    ...[...comments.entries()].filter(([key]) => !latest.has(key)).map(([, review]) => review),
  ];
  const requested = reviews.filter((review) => review.reviewState === "CHANGES_REQUESTED");
  const newestCommit = Math.max(
    0,
    ...(activity?.commits.map((commit) => Date.parse(commit.committedDate)) ?? []),
  );
  const approved = reviews.filter(
    (review) => review.reviewState === "APPROVED" && Date.parse(review.createdAt) >= newestCommit,
  );
  if (requested.length)
    return {
      title: currentInterfaceTranslator().message("pullRequest.review.changesRequested"),
      count: `${requested.length} ${requested.length === 1 ? "reviewer" : "reviewers"}`,
      icon: "xmark.circle.fill",
      tint: "accent-danger-foreground",
      reviews,
    } as const;
  if (approved.length)
    return {
      title:
        approved.length === 1 && approved[0]?.author
          ? `Approved by ${approved[0].author.login}`
          : currentInterfaceTranslator().message("mobile.ui.reviewsApproved"),
      count: `${approved.length} approved`,
      icon: "checkmark.circle",
      tint: "accent-adaptive-emerald-600-400",
      reviews,
    } as const;
  const commented = reviews.filter((review) => review.reviewState === "COMMENTED");
  if (commented.length && !pr.reviewers.length)
    return {
      title: currentInterfaceTranslator().message("mobile.ui.reviews"),
      count: `${commented.length} commented`,
      icon: "bubble.left",
      tint: "accent-icon-muted",
      reviews,
    } as const;
  return {
    title: pr.reviewers.length
      ? currentInterfaceTranslator().message("mobile.ui.awaitingReview")
      : currentInterfaceTranslator().message("pullRequest.reviewer.request"),
    count: pr.reviewers.length
      ? `${pr.reviewers.length} requested`
      : currentInterfaceTranslator().message("mobile.ui.noneAssigned"),
    icon: "person.2",
    tint: "accent-icon-muted",
    reviews,
  } as const;
}

export function pullRequestBranchSummary(
  pr: Pick<PullRequestDetail, "mergeability" | "baseComparison" | "behindBy" | "baseBranch">,
) {
  if (pr.mergeability === "conflicting") return "Has conflicts";
  if (pr.baseComparison === "behind") return `${pr.behindBy ?? ""} behind ${pr.baseBranch}`.trim();
  if (pr.baseComparison === "up-to-date") return "Up to date";
  return pr.mergeability === "mergeable"
    ? currentInterfaceTranslator().message("mobile.ui.noConflicts")
    : currentInterfaceTranslator().message("mobile.ui.notReported");
}

export function pullRequestChecksStatus(state: PullRequestChecksState) {
  if (state === "passing")
    return { icon: "checkmark.circle", tint: "accent-adaptive-emerald-600-400" } as const;
  if (state === "failing")
    return { icon: "xmark.circle.fill", tint: "accent-danger-foreground" } as const;
  return { icon: "clock", tint: "accent-warning-foreground" } as const;
}
