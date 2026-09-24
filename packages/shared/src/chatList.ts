export const CHAT_LIST_ANCHOR_OFFSET = 16;

type ChatTurnState = "running" | "interrupted" | "completed" | "error";

interface ChatTurnSnapshot<TurnId extends string> {
  readonly turnId: TurnId;
  readonly state: ChatTurnState;
}

export interface ChatTurnFoldRetention<TurnId extends string> {
  readonly observedTurn: ChatTurnSnapshot<TurnId> | null;
  readonly retainedTurnIds: ReadonlySet<TurnId>;
}

export function createChatTurnFoldRetention<TurnId extends string>(
  latestTurn: ChatTurnSnapshot<TurnId> | null,
): ChatTurnFoldRetention<TurnId> {
  return {
    observedTurn: latestTurn ? { turnId: latestTurn.turnId, state: latestTurn.state } : null,
    retainedTurnIds: new Set(),
  };
}

/** Keep a settling turn's work visible while the reader is away from the live edge. */
export function advanceChatTurnFoldRetention<TurnId extends string>(
  retention: ChatTurnFoldRetention<TurnId>,
  latestTurn: ChatTurnSnapshot<TurnId> | null,
  followingEnd: boolean,
): ChatTurnFoldRetention<TurnId> {
  const previous = retention.observedTurn;
  const turnChanged =
    previous?.turnId !== latestTurn?.turnId || previous?.state !== latestTurn?.state;
  const shouldRetain =
    !followingEnd &&
    previous?.state === "running" &&
    (latestTurn?.turnId !== previous.turnId || latestTurn.state !== "running");
  if (!turnChanged && (!followingEnd || retention.retainedTurnIds.size === 0)) {
    return retention;
  }

  let retainedTurnIds = retention.retainedTurnIds;
  if (followingEnd && retainedTurnIds.size > 0) {
    retainedTurnIds = new Set<TurnId>();
  } else if (shouldRetain) {
    retainedTurnIds = new Set(retainedTurnIds).add(previous.turnId);
  }
  return {
    observedTurn: latestTurn ? { turnId: latestTurn.turnId, state: latestTurn.state } : null,
    retainedTurnIds,
  };
}

export function forgetRetainedChatTurn<TurnId extends string>(
  retention: ChatTurnFoldRetention<TurnId>,
  turnId: TurnId,
): ChatTurnFoldRetention<TurnId> {
  if (!retention.retainedTurnIds.has(turnId)) return retention;
  const retainedTurnIds = new Set(retention.retainedTurnIds);
  retainedTurnIds.delete(turnId);
  return { ...retention, retainedTurnIds };
}

export interface ChatListAnchoredEndSpace {
  readonly anchorIndex: number;
  readonly anchorOffset: number;
}

export interface ChatListAnchorOptions {
  readonly anchorOffset?: number;
}

export function resolveChatListAnchoredEndSpace<Item, AnchorId>(
  items: ReadonlyArray<Item>,
  anchorId: AnchorId | null,
  getAnchorId: (item: Item) => AnchorId | null,
  options: ChatListAnchorOptions = {},
): ChatListAnchoredEndSpace | undefined {
  if (anchorId === null) {
    return undefined;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) {
      continue;
    }

    const itemAnchorId = getAnchorId(item);
    if (itemAnchorId === null) {
      continue;
    }

    return itemAnchorId === anchorId
      ? {
          anchorIndex: index,
          anchorOffset: options.anchorOffset ?? CHAT_LIST_ANCHOR_OFFSET,
        }
      : undefined;
  }

  return undefined;
}
