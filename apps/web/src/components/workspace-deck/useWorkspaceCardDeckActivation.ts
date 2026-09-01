import { useCallback, type RefObject } from "react";

import type { PreparedWorkspaceDeckPeek } from "./workspaceCardDeck.model";
import type {
  WorkspaceDeckMorphCapture,
  WorkspaceDeckMorphIntent,
} from "./workspaceCardDeck.morph";

export function useWorkspaceCardDeckActivation<CardId extends string>(input: {
  readonly activeCardRef: RefObject<CardId>;
  readonly captureMorphRequest: (
    intent: WorkspaceDeckMorphIntent<CardId>,
  ) => WorkspaceDeckMorphCapture<CardId> | null;
  readonly cleanupActiveMorph: () => void;
  readonly expandedCardRef: RefObject<CardId | null>;
  readonly interactionLocked: boolean;
  readonly onRequestCard: (cardId: CardId, direction: "backward" | "forward") => boolean | void;
  readonly pendingMorphCaptureRef: RefObject<WorkspaceDeckMorphCapture<CardId> | null>;
  readonly pendingMorphIntentRef: RefObject<WorkspaceDeckMorphIntent<CardId> | null>;
}) {
  const {
    activeCardRef,
    captureMorphRequest,
    cleanupActiveMorph,
    expandedCardRef,
    interactionLocked,
    onRequestCard,
    pendingMorphCaptureRef,
    pendingMorphIntentRef,
  } = input;
  return useCallback(
    (peek: PreparedWorkspaceDeckPeek<CardId>) => {
      if (interactionLocked) return;
      const intent = {
        direction: peek.direction,
        fromId: activeCardRef.current,
        toId: peek.card.id,
      } satisfies WorkspaceDeckMorphIntent<CardId>;
      pendingMorphIntentRef.current = intent;
      pendingMorphCaptureRef.current =
        expandedCardRef.current === activeCardRef.current ? null : captureMorphRequest(intent);
      const accepted = onRequestCard(peek.card.id, peek.direction);
      if (accepted === false) {
        pendingMorphIntentRef.current = null;
        pendingMorphCaptureRef.current = null;
        return;
      }
      cleanupActiveMorph();
    },
    [
      activeCardRef,
      captureMorphRequest,
      cleanupActiveMorph,
      expandedCardRef,
      interactionLocked,
      onRequestCard,
      pendingMorphCaptureRef,
      pendingMorphIntentRef,
    ],
  );
}
