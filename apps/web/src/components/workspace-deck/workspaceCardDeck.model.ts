import type { ReactNode } from "react";

import {
  findDuplicateWorkspaceDeckCardId,
  resolveWorkspaceDeckActiveCard,
  resolveWorkspaceDeckRoles,
  type WorkspaceDeckDirection,
  type WorkspaceDeckPosition,
} from "./workspaceCardDeck.logic";

export interface WorkspaceDeckCardDefinition<CardId extends string> {
  readonly id: CardId;
  readonly label: string;
  readonly renderBody: (context: {
    readonly active: boolean;
    readonly expanded: boolean;
  }) => ReactNode;
  readonly renderPeek: (context: {
    readonly position: Extract<WorkspaceDeckPosition, "previous" | "next">;
    readonly blocked: boolean;
    readonly requestActivation: () => void;
  }) => ReactNode;
}

export interface PreparedWorkspaceDeckPeek<CardId extends string> {
  readonly card: WorkspaceDeckCardDefinition<CardId>;
  readonly direction: WorkspaceDeckDirection;
  readonly position: Extract<WorkspaceDeckPosition, "previous" | "next">;
}

export interface PreparedWorkspaceCardDeckView<CardId extends string> {
  readonly activeCard: CardId;
  readonly activeCardDefinition: WorkspaceDeckCardDefinition<CardId>;
  readonly cardIds: readonly CardId[];
  readonly compactHeightReferenceCard: CardId;
  readonly peekCards: readonly PreparedWorkspaceDeckPeek<CardId>[];
}

export function prepareWorkspaceCardDeckView<CardId extends string>(input: {
  readonly activeCard: CardId;
  readonly cards: readonly WorkspaceDeckCardDefinition<CardId>[];
  readonly compactHeightReferenceCard: CardId;
}): PreparedWorkspaceCardDeckView<CardId> {
  const cardIds = input.cards.map(({ id }) => id);
  const duplicateCardId = findDuplicateWorkspaceDeckCardId(cardIds);
  if (duplicateCardId !== null) {
    throw new Error(`Duplicate workspace card id: ${duplicateCardId}`);
  }
  const firstCard = input.cards[0];
  if (firstCard === undefined) {
    throw new Error("WorkspaceCardDeck requires at least one card");
  }
  const activeCard = resolveWorkspaceDeckActiveCard({
    cardIds,
    activeCard: input.activeCard,
    fallbackCard: firstCard.id,
  });
  if (activeCard === null) {
    throw new Error("WorkspaceCardDeck could not resolve an active card");
  }
  const cardsById = new Map(input.cards.map((card) => [card.id, card]));
  const activeCardDefinition = cardsById.get(activeCard);
  if (activeCardDefinition === undefined) {
    throw new Error(`WorkspaceCardDeck could not find active card definition: ${activeCard}`);
  }
  const compactHeightReferenceCard = cardIds.includes(input.compactHeightReferenceCard)
    ? input.compactHeightReferenceCard
    : activeCard;
  const peekCards = resolveWorkspaceDeckRoles(cardIds, activeCard).flatMap((role) => {
    if (role.position !== "previous" && role.position !== "next") return [];
    const card = cardsById.get(role.id);
    if (card === undefined) return [];
    return [
      {
        card,
        direction: role.position === "previous" ? "backward" : "forward",
        position: role.position,
      } satisfies PreparedWorkspaceDeckPeek<CardId>,
    ];
  });
  return {
    activeCard,
    activeCardDefinition,
    cardIds,
    compactHeightReferenceCard,
    peekCards,
  };
}
