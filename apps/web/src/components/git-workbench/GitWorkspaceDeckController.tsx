import type { GitWorkspaceDeckControllerProps } from "./GitWorkspaceDeckController.model";
import { useGitWorkspaceDeckController } from "./GitWorkspaceDeckController.orchestration";
import { GitWorkspaceDeckPresentation } from "./GitWorkspaceDeckController.presentation";

export {
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
