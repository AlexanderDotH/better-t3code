import { useAtomValue } from "@effect/atom-react";
import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { deriveThreadCheckpointSummaries } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { EnvironmentId, ReviewDiffPreviewSource, ThreadId } from "@t3tools/contracts";

import { useCheckpointDiff } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentPresentation } from "../../state/presentation";
import { lastReviewGitSectionsAtom, reviewEnvironment } from "../../state/review";
import { lastReviewTurnDiffsAtom } from "../../state/reviewTurnDiffs";
import { environmentSession } from "../../state/session";
import { useSelectedThreadProjection } from "../../state/use-thread-detail";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import {
  buildReviewSectionItems,
  getReadyReviewCheckpoints,
  getReviewSectionIdForCheckpoint,
  resolveReviewSelectedSectionId,
  reviewTurnDiffsBySectionId,
  type ReviewSectionItem,
} from "./reviewModel";
import { setReviewSelectedSectionId, type ReviewCacheForThread } from "./reviewState";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { reviewTargetSectionId } from "./review-preferences";

const NO_GIT_SECTIONS_ATOM = Atom.make<ReadonlyArray<ReviewDiffPreviewSource>>([]).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:review:git-sections:null"),
);
const NO_TURN_DIFFS_ATOM = Atom.make<Readonly<Record<number, string>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:review:turn-diffs:null"),
);

export function useReviewSections(input: {
  readonly enabled?: boolean;
  readonly environmentId?: EnvironmentId;
  readonly threadId?: ThreadId;
  readonly reviewCache: ReviewCacheForThread;
  readonly ignoreWhitespace?: boolean;
  readonly revision?: string | number;
}) {
  const translator = useMobileInterfaceTranslator();
  const { environmentId, reviewCache, threadId } = input;
  const enabled = input.enabled ?? true;
  const ignoreWhitespace = input.ignoreWhitespace ?? false;
  const revision = input.revision;
  const commitSha =
    typeof revision === "string" && /^[a-f\d]{40,64}$/i.test(revision) ? revision : undefined;
  const [sectionOverride, setSectionOverride] = useState<{
    revision: typeof revision;
    id: string;
  } | null>(null);
  const fileAccessSession = useEnvironmentQuery(
    environmentId === undefined ? null : environmentSession.sessionStateAtom(environmentId),
  );
  const fileEnvironment = useEnvironmentPresentation(environmentId ?? null);
  const fileAccess = resolveFilesystemReadAccess({
    isCatalogReady: fileEnvironment.isReady,
    connection: fileEnvironment.presentation?.connection ?? null,
    session: fileAccessSession.data,
    sessionError: fileAccessSession.error,
  });
  const { canReadFiles } = fileAccess;
  const selectedThread = useSelectedThreadProjection();
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  const diffPreview = useEnvironmentQuery(
    canReadFiles && enabled && environmentId !== undefined && selectedThreadCwd !== null
      ? reviewEnvironment.diffPreview({
          environmentId,
          input: { cwd: selectedThreadCwd, ignoreWhitespace, ...(commitSha ? { commitSha } : {}) },
        })
      : null,
  );
  const lastGitSections = useAtomValue(
    environmentId !== undefined && selectedThreadCwd !== null
      ? lastReviewGitSectionsAtom(environmentId, selectedThreadCwd)
      : NO_GIT_SECTIONS_ATOM,
  );

  const lastTurnDiffs = useAtomValue(
    environmentId !== undefined && threadId !== undefined
      ? lastReviewTurnDiffsAtom(environmentId, threadId)
      : NO_TURN_DIFFS_ATOM,
  );

  const readyCheckpoints = getReadyReviewCheckpoints(
    selectedThread === null ? [] : deriveThreadCheckpointSummaries(selectedThread.projection),
  );
  const checkpointBySectionId = new Map(
    readyCheckpoints.map((checkpoint) => [getReviewSectionIdForCheckpoint(checkpoint), checkpoint]),
  );
  // Turns show their last answered diff; the active turn's live query below overrides it.
  // Section ids and the selection do not depend on the live query, so they are resolved first.
  const cachedSections = buildReviewSectionItems({
    checkpoints: readyCheckpoints,
    gitSections:
      canReadFiles || fileAccess.isPending
        ? (diffPreview.data?.sources ?? (ignoreWhitespace || commitSha ? [] : lastGitSections))
        : [],
    turnDiffById: ignoreWhitespace
      ? {}
      : reviewTurnDiffsBySectionId(readyCheckpoints, lastTurnDiffs),
    loadingGitSections: fileAccess.isPending || diffPreview.isPending,
  });
  const selectedSectionId = resolveReviewSelectedSectionId(
    cachedSections,
    (sectionOverride && sectionOverride.revision === revision ? sectionOverride.id : null) ??
      reviewTargetSectionId(revision) ??
      reviewCache.selectedSectionId,
  );

  const selectedCheckpoint =
    selectedSectionId === null ? undefined : checkpointBySectionId.get(selectedSectionId);
  const activeCheckpoint = selectedCheckpoint ?? readyCheckpoints[0] ?? null;
  const activeSectionId = activeCheckpoint
    ? getReviewSectionIdForCheckpoint(activeCheckpoint)
    : null;
  const activeTurnDiff = useCheckpointDiff({
    environmentId: enabled ? (environmentId ?? null) : null,
    threadId: enabled ? (threadId ?? null) : null,
    fromTurnCount:
      enabled && activeCheckpoint ? Math.max(0, activeCheckpoint.checkpointTurnCount - 1) : null,
    toTurnCount: enabled ? (activeCheckpoint?.checkpointTurnCount ?? null) : null,
    ignoreWhitespace,
  });

  const reviewSections = cachedSections.map((section): ReviewSectionItem => {
    if (section.kind === "turn") {
      return section.id === activeSectionId
        ? {
            ...section,
            diff: activeTurnDiff.data?.diff ?? section.diff,
            isLoading: activeTurnDiff.isPending,
          }
        : section;
    }
    // Keep the selected section while its grant loads, without displaying cached host files.
    return fileAccess.isPending ? { ...section, diff: null, isLoading: true } : section;
  });
  const selectedSection =
    reviewSections.find((section) => section.id === selectedSectionId) ?? null;

  const refreshSelectedSection = async () => {
    if (!enabled) {
      return;
    }
    if (selectedSection?.kind === "turn") {
      activeTurnDiff.refresh();
      return;
    }
    diffPreview.refresh();
  };

  const selectSection = (sectionId: string) => {
    setSectionOverride({ revision, id: sectionId });
    if (reviewCache.threadKey) {
      setReviewSelectedSectionId(reviewCache.threadKey, sectionId);
    }
  };

  return {
    error:
      diffPreview.error ??
      activeTurnDiff.error ??
      (selectedSection === null && !fileAccess.isPending && !canReadFiles
        ? (fileAccess.error ?? translator.message("mobile.ui.thisConnectionCannotReadLocalDiffs"))
        : null),
    isSelectedSectionPending:
      selectedSection?.kind === "turn" ? activeTurnDiff.isPending : diffPreview.isPending,
    reviewSections,
    selectedSection,
    refreshSelectedSection,
    selectSection,
  };
}
