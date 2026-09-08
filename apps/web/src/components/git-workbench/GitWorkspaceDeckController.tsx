import type { GitWorkspaceDeckControllerProps } from "./GitWorkspaceDeckController.model";
import { useGitWorkspaceDeckController } from "./GitWorkspaceDeckController.orchestration";
import { GitWorkspaceDeckPresentation } from "./GitWorkspaceDeckController.presentation";

export {
  resolveGitDeckCardIds,
  resolveScopedWorkspaceDeckActiveCard,
  shouldLoadGitRepositoryInsights,
  shouldLoadGitWorkbenchData,
  type GitDeckAvailabilityInput,
  type GitRepositoryInsightsVisibilityInput,
  type GitWorkbenchDataVisibilityInput,
  type GitWorkspaceDeckChatControls,
  type GitWorkspaceDeckControllerProps,
  type GitWorkspaceDeckGitPeekControls,
} from "./GitWorkspaceDeckController.model";

export function ChatWorkspaceDeckController(props: GitWorkspaceDeckControllerProps) {
  const presentation = useGitWorkspaceDeckController(props);
  return <GitWorkspaceDeckPresentation {...presentation} />;
}

/** @deprecated Import the neutral ChatWorkspaceDeckController composition instead. */
export const GitWorkspaceDeckController = ChatWorkspaceDeckController;
