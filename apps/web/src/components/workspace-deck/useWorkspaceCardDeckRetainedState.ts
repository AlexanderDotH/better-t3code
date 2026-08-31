import { useRef, useState } from "react";

import type {
  ActiveWorkspaceDeckMorph,
  WorkspaceDeckMorphCapture,
  WorkspaceDeckMorphIntent,
  WorkspaceDeckSurfaceSnapshot,
} from "./workspaceCardDeck.morph";
import type { WorkspaceDeckTransition } from "./workspaceCardDeck.logic";

export function useWorkspaceCardDeckRetainedState<CardId extends string>(input: {
  readonly activeCard: CardId;
  readonly cardIds: readonly CardId[];
  readonly expandedCard: CardId | null;
  readonly onExpandedCardCollapseComplete: ((cardId: CardId) => void) | undefined;
  readonly resetKey: string;
}) {
  const previousActiveCardRef = useRef(input.activeCard);
  const previousResetKeyRef = useRef(input.resetKey);
  const transitionTokenRef = useRef(0);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const morphHostRefs = useRef(new Map<CardId, HTMLDivElement>());
  const peekSlotRefs = useRef(new Map<CardId, HTMLDivElement>());
  const expandedCardRef = useRef<CardId | null>(input.expandedCard);
  const cardIdsRef = useRef(input.cardIds);
  const previousExpandedCardRef = useRef<CardId | null>(input.expandedCard);
  const previousCollapseResetKeyRef = useRef(input.resetKey);
  const collapsingCardRef = useRef<CardId | null>(null);
  const collapseCompleteCallbackRef = useRef(input.onExpandedCardCollapseComplete);
  const activeCardRef = useRef(input.activeCard);
  const pendingMorphIntentRef = useRef<WorkspaceDeckMorphIntent<CardId> | null>(null);
  const pendingMorphCaptureRef = useRef<WorkspaceDeckMorphCapture<CardId> | null>(null);
  const activeMorphRef = useRef<ActiveWorkspaceDeckMorph | null>(null);
  const activeExpansionMorphRef = useRef<ActiveWorkspaceDeckMorph | null>(null);
  const expansionMorphTokenRef = useRef(0);
  const previousMorphExpandedCardRef = useRef<CardId | null>(input.expandedCard);
  const previousMorphResetKeyRef = useRef(input.resetKey);
  const surfaceSnapshotByCardRef = useRef(new Map<CardId, WorkspaceDeckSurfaceSnapshot>());
  const transitionRef = useRef<WorkspaceDeckTransition<CardId> | null>(null);
  const [frozenCompactHeight, setFrozenCompactHeight] = useState<number | null>(null);
  const [collapsingCard, setCollapsingCard] = useState<CardId | null>(null);
  const [transition, setTransition] = useState<WorkspaceDeckTransition<CardId> | null>(null);

  expandedCardRef.current = input.expandedCard;
  activeCardRef.current = input.activeCard;
  cardIdsRef.current = input.cardIds;
  collapseCompleteCallbackRef.current = input.onExpandedCardCollapseComplete;
  transitionRef.current = transition;

  return {
    activeCardRef,
    activeExpansionMorphRef,
    activeMorphRef,
    cardIdsRef,
    collapseCompleteCallbackRef,
    collapsingCard,
    collapsingCardRef,
    deckRef,
    expandedCardRef,
    expansionMorphTokenRef,
    frozenCompactHeight,
    morphHostRefs,
    peekSlotRefs,
    pendingMorphCaptureRef,
    pendingMorphIntentRef,
    previousActiveCardRef,
    previousCollapseResetKeyRef,
    previousExpandedCardRef,
    previousMorphExpandedCardRef,
    previousMorphResetKeyRef,
    previousResetKeyRef,
    setCollapsingCard,
    setFrozenCompactHeight,
    setTransition,
    surfaceSnapshotByCardRef,
    transition,
    transitionRef,
    transitionTokenRef,
  };
}
