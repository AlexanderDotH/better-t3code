export type WorkspaceDeckCard = "chat" | "git";
export type WorkspaceDeckShuffleDirection = "to-chat" | "to-git";

export const GIT_COMPACT_PULL_THRESHOLD = 36;
export const GIT_COMPACT_PULL_VERTICAL_DOMINANCE = 1.25;

export interface DeckCardRequest {
  readonly activeCard: WorkspaceDeckCard;
  readonly requestedCard: WorkspaceDeckCard;
  readonly isRecording: boolean;
}

export interface DeckCardRequestResult {
  readonly activeCard: WorkspaceDeckCard;
  readonly blockedReason: "recording" | null;
  readonly shouldCollapseDrawer: boolean;
}

export function resolveDeckCardRequest(request: DeckCardRequest): DeckCardRequestResult {
  if (request.requestedCard === "git" && request.isRecording) {
    return {
      activeCard: request.activeCard,
      blockedReason: "recording",
      shouldCollapseDrawer: false,
    };
  }

  return {
    activeCard: request.requestedCard,
    blockedReason: null,
    shouldCollapseDrawer: request.requestedCard === "chat",
  };
}

export function resolveDeckShuffleDirection(
  activeCard: WorkspaceDeckCard,
  requestedCard: WorkspaceDeckCard,
): WorkspaceDeckShuffleDirection | null {
  if (activeCard === requestedCard) return null;
  return requestedCard === "git" ? "to-git" : "to-chat";
}

export interface ActionRequiredDeckState {
  readonly activeCard: WorkspaceDeckCard;
  readonly drawerExpanded: boolean;
  readonly actionRequired: boolean;
}

export interface ResolvedActionRequiredDeckState {
  readonly activeCard: WorkspaceDeckCard;
  readonly drawerExpanded: boolean;
  readonly didPromoteChat: boolean;
}

export function resolveActionRequiredDeckState(
  state: ActionRequiredDeckState,
): ResolvedActionRequiredDeckState {
  if (!state.actionRequired) {
    return {
      activeCard: state.activeCard,
      drawerExpanded: state.drawerExpanded,
      didPromoteChat: false,
    };
  }

  const didPromoteChat = state.activeCard !== "chat" || state.drawerExpanded;
  return {
    activeCard: "chat",
    drawerExpanded: false,
    didPromoteChat,
  };
}

export interface GitCompactPullGesture {
  readonly button: number;
  readonly cancelled: boolean;
  readonly endX: number;
  readonly endY: number;
  readonly isPrimary: boolean;
  readonly startX: number;
  readonly startY: number;
}

export function shouldExpandGitCompactPull(gesture: GitCompactPullGesture): boolean {
  if (gesture.cancelled || !gesture.isPrimary || gesture.button !== 0) return false;

  const upwardDistance = gesture.startY - gesture.endY;
  const horizontalDistance = Math.abs(gesture.endX - gesture.startX);
  return (
    upwardDistance >= GIT_COMPACT_PULL_THRESHOLD &&
    upwardDistance >= horizontalDistance * GIT_COMPACT_PULL_VERTICAL_DOMINANCE
  );
}

export interface BufferedEditScope {
  readonly cwd: string;
  readonly environmentId: string;
  readonly path: string;
}

export function selectBufferedPathsForScope(
  entries: Iterable<BufferedEditScope>,
  environmentId: string,
  cwd: string,
): readonly string[] {
  return [...entries]
    .filter((entry) => entry.environmentId === environmentId && entry.cwd === cwd)
    .map((entry) => entry.path);
}

export function bufferedRevisionDisposition(
  baseRevision: string,
  currentRevision: string | undefined,
): "conflict" | "save" {
  return currentRevision !== undefined && currentRevision === baseRevision ? "save" : "conflict";
}
