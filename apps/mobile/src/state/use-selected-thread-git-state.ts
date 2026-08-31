import { useMemo } from "react";

import { dedupeRemoteBranchesWithLocalMatches } from "@t3tools/shared/git";

import { useBranches } from "./queries";
import { useEnvironmentQuery } from "./query";
import { sourceControlEnvironment } from "./sourceControl";
import { useVcsActionState } from "./use-vcs-action-state";
import { useThreadSelection } from "./use-thread-selection";
import { useSelectedThreadWorktree } from "./use-selected-thread-worktree";
import { mobileGitWorkbenchCanActivate } from "../features/threads/git/mobile-git-workbench";
import { useMobileGitWorkbenchAvailability } from "../features/threads/git/use-mobile-git-workbench";

export function useSelectedThreadGitState() {
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  const gitWorkbenchAvailability = useMobileGitWorkbenchAvailability({
    environmentId: selectedThread?.environmentId ?? null,
    threadId: selectedThread?.id ?? null,
  });
  const gitWorkbenchEnabled = mobileGitWorkbenchCanActivate(gitWorkbenchAvailability);

  const selectedThreadGitTarget = useMemo(
    () => ({
      environmentId: gitWorkbenchEnabled ? (selectedThread?.environmentId ?? null) : null,
      cwd: gitWorkbenchEnabled ? selectedThreadCwd : null,
    }),
    [gitWorkbenchEnabled, selectedThread?.environmentId, selectedThreadCwd],
  );
  const gitActionState = useVcsActionState(selectedThreadGitTarget);
  const sourceControlDiscovery = useEnvironmentQuery(
    !gitWorkbenchEnabled || selectedThread === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: selectedThread.environmentId,
          input: {},
        }),
  );

  const selectedThreadBranchTarget = useMemo(
    () => ({
      environmentId: gitWorkbenchEnabled ? (selectedThread?.environmentId ?? null) : null,
      cwd: gitWorkbenchEnabled ? (selectedThreadProject?.workspaceRoot ?? null) : null,
      query: null,
    }),
    [gitWorkbenchEnabled, selectedThread?.environmentId, selectedThreadProject?.workspaceRoot],
  );
  const selectedThreadBranchState = useBranches(selectedThreadBranchTarget);
  const selectedThreadBranches = useMemo(
    () =>
      dedupeRemoteBranchesWithLocalMatches(selectedThreadBranchState.data?.refs ?? []).filter(
        (branch) => !branch.isRemote,
      ),
    [selectedThreadBranchState.data?.refs],
  );

  return {
    gitOperationLabel: gitActionState.currentLabel,
    sourceControlDiscovery,
    selectedThreadBranches,
    selectedThreadBranchesLoading: selectedThreadBranchState.isPending,
  };
}
