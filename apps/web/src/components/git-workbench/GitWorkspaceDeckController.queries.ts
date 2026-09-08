import { useMemo } from "react";

import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { gitWorkbenchEnvironment } from "~/state/gitWorkbench";

import type { ChatWorkspaceCardId } from "./ChatWorkspaceDeck";
import {
  mapChanges,
  mapInsights,
  mapSnapshot,
  shouldLoadGitRepositoryInsights,
  shouldLoadGitWorkbenchData,
  type GitWorkspaceDeckControllerProps,
} from "./GitWorkspaceDeckController.model";
import type { useGitWorkspaceDeckSession } from "./GitWorkspaceDeckController.session";

export function useGitWorkspaceDeckQueries(input: {
  readonly gitAvailable: boolean;
  readonly isDesktop: boolean;
  readonly props: GitWorkspaceDeckControllerProps;
  readonly resolvedActiveCard: ChatWorkspaceCardId;
  readonly session: ReturnType<typeof useGitWorkspaceDeckSession>;
}) {
  const { props, session } = input;
  const gitExpanded = session.expandedCard === "git";
  const wantsWorkbenchData = shouldLoadGitWorkbenchData({
    activeCard: input.resolvedActiveCard,
    expandedCard: session.expandedCard,
    gitAvailable: input.gitAvailable,
  });
  const workbenchQuery = useEnvironmentQuery(
    wantsWorkbenchData && props.cwd
      ? gitWorkbenchEnvironment.workbench({
          environmentId: props.environmentId,
          input: { cwd: props.cwd },
        })
      : null,
  );
  const projection = workbenchQuery.data;
  const contractSnapshot = projection?.snapshot ?? null;
  const snapshot = useMemo(
    () => (contractSnapshot ? mapSnapshot(contractSnapshot, props.legacyStatus) : null),
    [contractSnapshot, props.legacyStatus],
  );
  const insightsQuery = useEnvironmentQuery(
    shouldLoadGitRepositoryInsights({
      activeTab: session.activeTab,
      expandedCard: session.expandedCard,
      gitAvailable: input.gitAvailable,
    }) && props.cwd
      ? gitWorkbenchEnvironment.insights({
          environmentId: props.environmentId,
          input: { cwd: props.cwd },
        })
      : null,
  );
  const insights = useMemo(() => mapInsights(insightsQuery.data), [insightsQuery.data]);
  const changes = useMemo(
    () => mapChanges(contractSnapshot, session.diffs),
    [contractSnapshot, session.diffs],
  );
  const selectedChange =
    changes.find((candidate) => candidate.id === session.selectedChangeId) ?? null;
  const changesDiffQuery = useEnvironmentQuery(
    wantsWorkbenchData &&
      gitExpanded &&
      session.activeTab === "changes" &&
      props.cwd &&
      selectedChange
      ? gitWorkbenchEnvironment.changesDiff({
          environmentId: props.environmentId,
          input: {
            cwd: props.cwd,
            ...(contractSnapshot?.stateToken
              ? { expectedStateToken: contractSnapshot.stateToken }
              : {}),
            path: selectedChange.path,
            source: selectedChange.id.endsWith("::index") ? "staged" : "unstaged",
          },
        })
      : null,
  );
  const fileQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && props.cwd && session.selectedFilePath
      ? projectEnvironment.readFile({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, relativePath: session.selectedFilePath },
        })
      : null,
  );
  const flushBufferedPath = session.bufferFlushQueue[0] ?? null;
  const bufferedFileQuery = useEnvironmentQuery(
    input.isDesktop && !props.activeTurn && props.cwd && flushBufferedPath
      ? projectEnvironment.readFile({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, relativePath: flushBufferedPath },
        })
      : null,
  );
  const historyQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && session.activeTab === "history" && props.cwd
      ? gitWorkbenchEnvironment.history({
          environmentId: props.environmentId,
          input: {
            cwd: props.cwd,
            cursor: session.historyCursor,
            limit: 50,
            ...(session.historyRefName.trim() && session.historyCursor === 0
              ? { refName: session.historyRefName.trim() }
              : {}),
            ...(session.historyPath.trim() ? { path: session.historyPath.trim() } : {}),
            ...(session.historySnapshotOid ? { snapshotOid: session.historySnapshotOid } : {}),
          },
        })
      : null,
  );
  const commitDetailQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && session.selectedCommitOid && props.cwd
      ? gitWorkbenchEnvironment.commitDetail({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, oid: session.selectedCommitOid },
        })
      : null,
  );
  const commitPatchQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && session.commitPatchTarget && props.cwd
      ? gitWorkbenchEnvironment.commitFileDiff({
          environmentId: props.environmentId,
          input: {
            cwd: props.cwd,
            oid: session.commitPatchTarget.oid,
            path: session.commitPatchTarget.path,
          },
        })
      : null,
  );
  const refsQuery = useEnvironmentQuery(
    wantsWorkbenchData &&
      gitExpanded &&
      (session.activeTab === "branches" || session.activeTab === "history") &&
      props.cwd
      ? vcsEnvironment.listRefs({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, limit: 100, refKind: "all" },
        })
      : null,
  );
  const interactiveRebasePlanQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && props.cwd && session.rebasePlanTarget
      ? gitWorkbenchEnvironment.interactiveRebasePlan({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, upstreamRef: session.rebasePlanTarget },
        })
      : null,
  );
  const sessionAccessQuery = useEnvironmentQuery(
    wantsWorkbenchData
      ? gitWorkbenchEnvironment.sessionAccess({
          environmentId: props.environmentId,
          input: {},
        })
      : null,
  );

  return {
    bufferedFileQuery,
    changes,
    changesDiffQuery,
    commitDetailQuery,
    commitPatchQuery,
    contractSnapshot,
    fileQuery,
    historyQuery,
    insights,
    interactiveRebasePlanQuery,
    projection,
    refsQuery,
    selectedChange,
    sessionAccessQuery,
    snapshot,
    wantsWorkbenchData,
    workbenchQuery,
  };
}
