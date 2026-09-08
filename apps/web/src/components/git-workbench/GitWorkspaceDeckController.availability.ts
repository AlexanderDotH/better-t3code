import { resolveWorkspaceDeckActiveCard } from "../workspace-deck/workspaceCardDeck.logic";
import type { ChatWorkspaceCardId } from "./ChatWorkspaceDeck";
import type { GitWorkbenchTabId } from "./GitWorkbench.types";
import type { ScopedWorkspaceDeckSelection } from "./GitWorkspaceDeckSessionState";

export const DESKTOP_WORKBENCH_MEDIA_QUERY = "(min-width: 48rem)";

export interface GitDeckAvailabilityInput {
  readonly cwd: string | null;
  readonly isRepository: boolean | null;
  readonly workbenchSupported: boolean;
}

export function resolveGitDeckCardIds(
  input: GitDeckAvailabilityInput,
): readonly ChatWorkspaceCardId[] {
  const gitAvailable =
    input.cwd !== null && input.isRepository === true && input.workbenchSupported;
  return gitAvailable ? ["chat", "git", "mcp"] : ["chat", "mcp"];
}

export interface GitWorkbenchDataVisibilityInput {
  readonly activeCard: ChatWorkspaceCardId;
  readonly expandedCard: ChatWorkspaceCardId | null;
  readonly gitAvailable: boolean;
}

export function shouldLoadGitWorkbenchData(input: GitWorkbenchDataVisibilityInput): boolean {
  return input.gitAvailable && (input.activeCard === "git" || input.expandedCard === "git");
}

export interface GitRepositoryInsightsVisibilityInput {
  readonly activeTab: GitWorkbenchTabId;
  readonly expandedCard: ChatWorkspaceCardId | null;
  readonly gitAvailable: boolean;
}

export function shouldLoadGitRepositoryInsights(
  input: GitRepositoryInsightsVisibilityInput,
): boolean {
  return input.gitAvailable && input.expandedCard === "git" && input.activeTab === "overview";
}

export function resolveScopedWorkspaceDeckActiveCard(input: {
  readonly availableCardIds: readonly ChatWorkspaceCardId[];
  readonly currentSelection: ScopedWorkspaceDeckSelection;
  readonly rememberedCard: ChatWorkspaceCardId | null;
  readonly scopeKey: string;
}): ChatWorkspaceCardId {
  const scopedCard =
    input.currentSelection.scopeKey === input.scopeKey
      ? input.currentSelection.card
      : input.rememberedCard;
  return (
    resolveWorkspaceDeckActiveCard({
      activeCard: scopedCard,
      cardIds: input.availableCardIds,
      fallbackCard: "chat",
    }) ?? "chat"
  );
}
