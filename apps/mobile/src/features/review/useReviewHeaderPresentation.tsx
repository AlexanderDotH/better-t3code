import { mobileGitWorkbenchCanActivate } from "../../state/git-workbench-availability";
import { useEnvironmentQuery } from "../../state/query";
import { useMobileGitWorkbenchAvailability } from "../../state/use-git-workbench-availability";
import { useSelectedThreadGitActions } from "../../state/use-selected-thread-git-actions";
import { useSelectedThreadGitState } from "../../state/use-selected-thread-git-state";
import { useThreadSelection } from "../../state/use-thread-selection";
import { vcsEnvironment } from "../../state/vcs";
import { useThreadGitMenuDefinition } from "../threads/ThreadGitControls";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReviewSectionItem } from "./reviewModel";
import type { AppBarMenuItem, AppBarMenu } from "../../components/ui/AppBar.types";
import type { AppSymbolName } from "../../components/ui/AppSymbol";

interface ReviewHeaderPresentation {
  readonly title: string;
  readonly subtitle: string;
  readonly gitMenu: AppBarMenu | null;
  readonly menuIcon: AppSymbolName;
  readonly refreshAction?: AppBarMenuItem;
}

export function useReviewHeaderPresentation(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly subtitle: string;
  readonly androidSubtitle: string;
  readonly selectedThreadCwd: string | null;
  readonly selectedSection: ReviewSectionItem | null;
  readonly onRefresh: () => Promise<void>;
}): ReviewHeaderPresentation {
  const { selectedThread } = useThreadSelection();
  const gitEnabled = mobileGitWorkbenchCanActivate(
    useMobileGitWorkbenchAvailability({
      environmentId: props.environmentId,
      threadId: props.threadId,
    }),
  );
  const gitState = useSelectedThreadGitState(gitEnabled);
  const gitActions = useSelectedThreadGitActions(gitEnabled);
  const gitStatusQuery = useEnvironmentQuery(
    gitEnabled && selectedThread !== null && props.selectedThreadCwd !== null
      ? vcsEnvironment.status({
          environmentId: selectedThread.environmentId,
          input: { cwd: props.selectedThreadCwd },
        })
      : null,
  );
  // Selection-based git hooks apply only to reviews of the selected thread.
  const gitMenuAvailable =
    gitEnabled && selectedThread !== null && String(selectedThread.id) === String(props.threadId);
  const gitMenu = useThreadGitMenuDefinition({
    gitEnabled,
    environmentId: props.environmentId,
    threadId: props.threadId,
    currentBranch: selectedThread?.branch ?? null,
    gitStatus: gitStatusQuery.data,
    gitOperationLabel: gitState.gitOperationLabel,
    onPull: gitActions.onPullSelectedThreadBranch,
    onRunAction: gitActions.onRunSelectedThreadGitAction,
  });
  return {
    title: props.title,
    subtitle: props.subtitle,
    menuIcon: "ellipsis",
    gitMenu: gitMenuAvailable ? gitMenu : null,
  };
}
