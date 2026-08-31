export {
  DESKTOP_WORKBENCH_MEDIA_QUERY,
  resolveGitDeckCardIds,
  resolveScopedWorkspaceDeckActiveCard,
  shouldLoadGitRepositoryInsights,
  shouldLoadGitWorkbenchData,
  type GitDeckAvailabilityInput,
  type GitRepositoryInsightsVisibilityInput,
  type GitWorkbenchDataVisibilityInput,
} from "./GitWorkspaceDeckController.availability";
export type {
  GitWorkspaceDeckChatControls,
  GitWorkspaceDeckControllerProps,
  GitWorkspaceDeckGitPeekControls,
} from "./GitWorkspaceDeckController.contracts";
export {
  CODE_MIX_COLORS,
  EMPTY_HISTORY,
  relativeAge,
} from "./GitWorkspaceDeckController.formatting";
export {
  actionForOperation,
  compactStatus,
  directIntent,
  fallbackCompactStatus,
  mapChanges,
  mapCommitDetail,
  mapDiff,
  mapInsights,
  mapInteractiveRebasePlan,
  mapOperation,
  mapQueue,
  mapRebaseNode,
  mapSnapshot,
  mapUndo,
  repositoryState,
} from "./GitWorkspaceDeckController.mapping";
